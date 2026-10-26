import { requireAdmin, type Caller } from "../auth";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { sendPublishEmailsSoon } from "../email-outbox";
import { parseTicketing } from "../event-input";
import { HttpError, okPrivate, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { ADMIN_EVENT_SELECT, ADMIN_ORGANISER_SELECT, toAdminEvent, toAdminOrganiser } from "../records";
import type { Handler } from "../route";
import type { AdminOrganiserRecord, AdminSummary, EventStatus, OrganiserStatus, SuspendOrganiserResult } from "../types";
import { fail, requireString } from "../validation";
import { requireEventForAdmin } from "./event-queries";
import { ADMIN_PAYOUTS_REQUIRED, payoutsRefused } from "./events";

const ORGANISER_STATUSES: OrganiserStatus[] = ["pending", "approved", "rejected"];
const EVENT_STATUSES: EventStatus[] = ["draft", "pending_review", "published", "rejected"];

async function requireReason(req: Request): Promise<string> {
  const body = await readJson(req);
  const errors: Record<string, string> = {};
  const reason = requireString(body.reason, "reason", errors, 1000);
  if (Object.keys(errors).length > 0) fail(errors);
  return reason;
}

// ---------------------------------------------------------------------------
// Organiser applications
// ---------------------------------------------------------------------------

/** The admin view of one organiser (with its newest log entries), or undefined. */
async function findAdminOrganiser(db: Db, organiserId: string): Promise<AdminOrganiserRecord | undefined> {
  const [row] = await db.query(`${ADMIN_ORGANISER_SELECT} where o.id = $1`, [organiserId]);
  return row ? toAdminOrganiser(row) : undefined;
}

/** Longest admin organiser search text (longer input is cut, as in the public event search). */
export const MAX_ORGANISER_SEARCH_LENGTH = 100;

/**
 * Folds text for the admin organiser search: compatibility-decomposed
 * (NFKD, so "ＣＡＦＥ" is "CAFE"), combining diacritical marks (U+0300–U+036F)
 * removed, lower-cased. ORGANISER_SEARCH_FOLD is the same in SQL, applied to
 * the columns; the two must stay in step.
 */
export function foldOrganiserSearch(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const ORGANISER_SEARCH_FOLD = (column: string) =>
  `lower(regexp_replace(normalize(coalesce(${column}, ''), NFKD), '[\\u0300-\\u036f]', '', 'g'))`;

/** A LIKE pattern matching `text` anywhere, its wildcards (and the escape character) matched literally. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Longest admin event search text (longer input is cut, as in the organiser search). */
export const MAX_EVENT_SEARCH_LENGTH = 100;

/**
 * An admin search parameter as the SQL compares it: control characters
 * (C0, DEL, C1) removed (Postgres text can't hold NUL, and none of them can
 * match a name or title), trimmed, cut to `maxLength`, then folded
 * (foldOrganiserSearch). Empty: no search.
 */
export function parseAdminSearch(raw: string | null, maxLength: number): string {
  const cleaned = (raw ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, maxLength);
  return foldOrganiserSearch(cleaned).trim();
}

/**
 * An optional boolean query parameter: "1" or "true", "0" or "false";
 * absent or empty is undefined. Anything else is a 400 naming the parameter.
 */
function parseBooleanParam(qs: URLSearchParams, name: string): boolean | undefined {
  const raw = qs.get(name);
  if (raw === null || raw === "") return undefined;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new HttpError(400, `${name} must be 1 or 0.`, { [name]: "Must be 1 or 0." });
}

/**
 * GET /api/admin/organisers?status=pending&q=&limit=&cursor= — most recently
 * updated first. Each item is an AdminOrganiserRecord: the full record
 * (social handles included) plus its newest 20 profile-edit and takedown log
 * entries.
 *
 * `q` (optional, trimmed, at most MAX_ORGANISER_SEARCH_LENGTH characters)
 * keeps organisers whose name, contact email or social handles (Instagram,
 * TikTok, Facebook page, X) contain it, ignoring case and accents
 * (foldOrganiserSearch); a leading "@" is ignored for the handles. `limit`
 * is 20 by default, at most 50. No index serves the search (a substring of a
 * folded expression can't use a btree, and pg_trgm isn't installed): it
 * scans one status's organisers through organisers_status_updated_idx, a
 * few hundred rows at most for a while.
 */
export const adminListOrganisers: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const status = (qs.get("status") ?? "pending") as OrganiserStatus;
  if (!ORGANISER_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of: ${ORGANISER_STATUSES.join(", ")}`);
  }
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const params: unknown[] = [status];
  const where = ["o.status = $1::public.organiser_status"];
  const q = parseAdminSearch(qs.get("q"), MAX_ORGANISER_SEARCH_LENGTH);
  if (q) {
    params.push(containsPattern(q));
    const any = `$${params.length}`;
    const handle = q.replace(/^@+/, "");
    params.push(handle ? containsPattern(handle) : null);
    const h = `$${params.length}`;
    where.push(
      `(${ORGANISER_SEARCH_FOLD("o.display_name")} like ${any}
        or ${ORGANISER_SEARCH_FOLD("o.contact_email")} like ${any}
        or (${h}::text is not null and (
              ${ORGANISER_SEARCH_FOLD("o.instagram_handle")} like ${h}
           or ${ORGANISER_SEARCH_FOLD("o.tiktok_handle")} like ${h}
           or ${ORGANISER_SEARCH_FOLD("o.facebook_page")} like ${h}
           or ${ORGANISER_SEARCH_FOLD("o.x_handle")} like ${h})))`,
    );
  }
  params.push(limit + 1, offset);

  const rows = await db.query(
    `${ADMIN_ORGANISER_SELECT} where ${where.join(" and ")}
     order by o.updated_at desc, o.id limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return okPrivate(toPage(rows.map(toAdminOrganiser), offset, limit));
};

/**
 * Conditional on the application still being pending, so two admins
 * reviewing at once can't both decide — the second gets a 409.
 */
async function reviewOrganiser(
  admin: Caller,
  organiserId: string,
  deps: Deps,
  decision: { status: "approved" } | { status: "rejected"; reason: string },
) {
  const reason = decision.status === "rejected" ? decision.reason : null;
  const rows = isUuid(organiserId)
    ? await deps.db.query(
        `update public.organisers
         set status = $2::public.organiser_status, rejection_reason = $3, reviewed_by = $4, reviewed_at = now()
         where id = $1 and status = 'pending'
         returning id`,
        [organiserId, decision.status, reason, admin.userId],
      )
    : [];
  if (rows.length === 0) {
    throw new HttpError(409, "This application is no longer pending — it may already have been reviewed.");
  }
  return okPrivate(await findAdminOrganiser(deps.db, organiserId));
}

/** POST /api/admin/organisers/[organiserId]/approve */
export const adminApproveOrganiser: Handler<{ organiserId: string }> = async (req, { organiserId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  return reviewOrganiser(admin, organiserId, deps, { status: "approved" });
};

/** POST /api/admin/organisers/[organiserId]/reject — body { reason } */
export const adminRejectOrganiser: Handler<{ organiserId: string }> = async (req, { organiserId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  const reason = await requireReason(req);
  return reviewOrganiser(admin, organiserId, deps, { status: "rejected", reason });
};

/** Longest takedown reason (matches the organiser_profile_edits.reason check constraint). */
export const MAX_SUSPEND_REASON_LENGTH = 500;

const ORGANISER_NOT_FOUND = "Organiser not found.";

/**
 * POST /api/admin/organisers/[organiserId]/suspend — body { reason }. Takes
 * an approved organiser down (private.suspend_organiser, one transaction):
 * status 'rejected' with the reason (shown to the organiser, like a
 * rejection) and the reviewing admin; every published event unpublished
 * (back to draft) and every event waiting for review rejected, each logged in
 * the event moderation log with the reason; and the takedown appended to the
 * organiser's log. Nothing is deleted. Unknown organiser: 404; not approved
 * (including already taken down by another admin): 409.
 */
export const adminSuspendOrganiser: Handler<{ organiserId: string }> = async (req, { organiserId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  const body = await readJson(req);
  const errors: Record<string, string> = {};
  const reason = parseMessageText(body.reason, "reason", errors, {
    allowLinks: true,
    label: "Reasons",
    maxLength: MAX_SUSPEND_REASON_LENGTH,
  });
  if (Object.keys(errors).length > 0) fail(errors);
  if (!isUuid(organiserId)) throw new HttpError(404, ORGANISER_NOT_FOUND);

  const [row] = await deps.db.query<{
    result: "suspended" | "not_approved" | "not_found";
    events_unpublished: number;
    submissions_rejected: number;
  }>(
    `select result, events_unpublished, submissions_rejected from private.suspend_organiser($1, $2, $3)`,
    [organiserId, admin.userId, reason],
  );
  if (row.result === "not_found") throw new HttpError(404, ORGANISER_NOT_FOUND);
  if (row.result === "not_approved") {
    throw new HttpError(409, "Only an approved organiser can be suspended — this one may already have been suspended.");
  }
  const result: SuspendOrganiserResult = {
    organiser: (await findAdminOrganiser(deps.db, organiserId))!,
    eventsUnpublished: row.events_unpublished,
    submissionsRejected: row.submissions_rejected,
  };
  return okPrivate(result);
};

/**
 * POST /api/admin/organisers/[organiserId]/remove-video — body { reason }.
 * Removes the organiser's featured video, whatever their status
 * (private.admin_remove_featured_video), logged on the organiser's log as a
 * profile edit by the admin with the reason. 200 with the organiser (nothing
 * logged when there was no video); 400 reason; 404 unknown.
 */
export const adminRemoveFeaturedVideo: Handler<{ organiserId: string }> = async (req, { organiserId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  const body = await readJson(req);
  const errors: Record<string, string> = {};
  const reason = parseMessageText(body.reason, "reason", errors, {
    allowLinks: true,
    label: "Reasons",
    maxLength: MAX_SUSPEND_REASON_LENGTH,
  });
  if (Object.keys(errors).length > 0) fail(errors);
  if (!isUuid(organiserId)) throw new HttpError(404, ORGANISER_NOT_FOUND);

  const [row] = await deps.db.query<{ result: "removed" | "unchanged" | "not_found" }>(
    `select private.admin_remove_featured_video($1, $2, $3) as result`,
    [organiserId, admin.userId, reason],
  );
  if (row.result === "not_found") throw new HttpError(404, ORGANISER_NOT_FOUND);
  return okPrivate((await findAdminOrganiser(deps.db, organiserId))!);
};

/**
 * POST /api/admin/organisers/[organiserId]/remove-logo — body { reason }.
 * Removes the organiser's logo, whatever their status
 * (private.admin_remove_organiser_logo), logged on the organiser's log as a
 * profile edit by the admin with the reason. 200 with the organiser (nothing
 * logged when there was no logo); 400 reason; 404 unknown.
 */
export const adminRemoveOrganiserLogo: Handler<{ organiserId: string }> = async (req, { organiserId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  const body = await readJson(req);
  const errors: Record<string, string> = {};
  const reason = parseMessageText(body.reason, "reason", errors, {
    allowLinks: true,
    label: "Reasons",
    maxLength: MAX_SUSPEND_REASON_LENGTH,
  });
  if (Object.keys(errors).length > 0) fail(errors);
  if (!isUuid(organiserId)) throw new HttpError(404, ORGANISER_NOT_FOUND);

  const [row] = await deps.db.query<{ result: "removed" | "unchanged" | "not_found" }>(
    `select private.admin_remove_organiser_logo($1, $2, $3) as result`,
    [organiserId, admin.userId, reason],
  );
  if (row.result === "not_found") throw new HttpError(404, ORGANISER_NOT_FOUND);
  return okPrivate((await findAdminOrganiser(deps.db, organiserId))!);
};

// ---------------------------------------------------------------------------
// Event submissions
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/events?status=pending_review&q=&upcoming=&platformManaged=&limit=&cursor=
 * — soonest first. Items are AdminEventRecords (EventRecord plus
 * `organiserPlatformManaged` and the trending `curation`, read by a primary
 * key join on private.event_curation: no request per row).
 *
 * - `q` (optional; control characters removed, trimmed, at most
 *   MAX_EVENT_SEARCH_LENGTH characters used): the title or the organiser's
 *   name contains it, ignoring case and accents (parseAdminSearch); LIKE
 *   wildcards match literally.
 * - `upcoming` (1/true or 0/false): only events that haven't ended
 *   (`ends_at > now()`, in progress included), or every event. Absent:
 *   true for `status=published` (the live list; past events with `upcoming=0`),
 *   false for every other status (what an admin has to act on, whenever it is).
 * - `platformManaged` (1/true or 0/false): only events of platform-managed
 *   organisers (no owner account: the ones admins check in at the door), or
 *   only of organisers with an account. Absent: both.
 *
 * Anything else for a boolean is a 400 (fieldErrors on the parameter).
 * Served by events_status_starts_idx (status, starts_at, id), or
 * events_status_ends_idx with `upcoming`; the search has no index (a
 * substring of a folded expression, as for organisers) and filters one
 * status's rows.
 */
export const adminListEvents: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const status = (qs.get("status") ?? "pending_review") as EventStatus;
  if (!EVENT_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of: ${EVENT_STATUSES.join(", ")}`);
  }
  const upcoming = parseBooleanParam(qs, "upcoming") ?? status === "published";
  const platformManaged = parseBooleanParam(qs, "platformManaged");
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const params: unknown[] = [status];
  const where = ["e.status = $1::public.event_status"];
  if (upcoming) where.push("e.ends_at > now()");
  if (platformManaged !== undefined) {
    where.push(platformManaged ? "o.owner_user_id is null" : "o.owner_user_id is not null");
  }
  const q = parseAdminSearch(qs.get("q"), MAX_EVENT_SEARCH_LENGTH);
  if (q) {
    params.push(containsPattern(q));
    const n = `$${params.length}`;
    where.push(`(${ORGANISER_SEARCH_FOLD("e.title")} like ${n} or ${ORGANISER_SEARCH_FOLD("o.display_name")} like ${n})`);
  }
  params.push(limit + 1, offset);

  const rows = await db.query(
    `${ADMIN_EVENT_SELECT} where ${where.join(" and ")}
     order by e.starts_at, e.id limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return okPrivate(toPage(rows.map(toAdminEvent), offset, limit));
};

// ---------------------------------------------------------------------------
// Summary (the admin hub's counts)
// ---------------------------------------------------------------------------

/** "Starts soon" for a pending submission: within this many hours (and not ended). */
export const PENDING_EVENT_SOON_HOURS = 72;
/** The door check-in window: platform-managed events starting within this many hours (and not ended). */
export const DOOR_EVENT_WINDOW_HOURS = 24;

/**
 * GET /api/admin/summary — what's waiting for an admin, as counts (the hub
 * and the admin nav's badges). One read of five aggregates, each over one
 * status of one table and served by an existing index:
 *
 * - reportsOpen: open member reports, and when the oldest was filed
 *   (user_reports_status_created_idx).
 * - eventsPending: events waiting for review; of those not ended, the soonest
 *   start and how many start within PENDING_EVENT_SOON_HOURS
 *   (events_status_starts_idx).
 * - organisersPending: organiser applications waiting for review, and the
 *   oldest one's last update (its submission or resubmission;
 *   organisers_status_updated_idx).
 * - emailsFailed / emailsRetrying: ticket emails (the jobs GET /admin/emails
 *   lists: the ones with an order) that gave up, or are waiting for another
 *   attempt after at least one failed (email_outbox_status_created_idx).
 * - doorEvents: published, Sheltüh-ticketed events of platform-managed
 *   organisers (the ones only admins check in) that haven't ended and start
 *   within DOOR_EVENT_WINDOW_HOURS (events_status_ends_idx).
 *
 * Counts only: no titles, names or addresses.
 */
export const adminSummary: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const [row] = await db.query<{
    reports_open: number;
    reports_oldest_at: Date | string | null;
    events_pending: number;
    events_pending_soonest: Date | string | null;
    events_pending_soon: number;
    organisers_pending: number;
    organisers_pending_oldest_at: Date | string | null;
    emails_failed: number;
    emails_retrying: number;
    door_events: number;
  }>(
    `select r.reports_open, r.reports_oldest_at,
            ev.events_pending, ev.events_pending_soonest, ev.events_pending_soon,
            og.organisers_pending, og.organisers_pending_oldest_at,
            em.emails_failed, em.emails_retrying,
            dr.door_events
       from (select count(*)::int as reports_open, min(created_at) as reports_oldest_at
               from private.user_reports where status = 'open') r,
            (select count(*)::int as events_pending,
                    min(starts_at) filter (where ends_at > now()) as events_pending_soonest,
                    count(*) filter (where ends_at > now() and starts_at <= now() + make_interval(hours => $1::int))::int
                      as events_pending_soon
               from public.events where status = 'pending_review') ev,
            (select count(*)::int as organisers_pending, min(updated_at) as organisers_pending_oldest_at
               from public.organisers where status = 'pending') og,
            (select count(*) filter (where status = 'failed')::int as emails_failed,
                    count(*) filter (where status = 'pending' and attempts > 0)::int as emails_retrying
               from private.email_outbox
              where status in ('failed', 'pending') and order_id is not null) em,
            (select count(*)::int as door_events
               from public.events e join public.organisers o on o.id = e.organiser_id
              where e.status = 'published' and e.ends_at > now()
                and e.starts_at <= now() + make_interval(hours => $2::int)
                and e.ticketing_mode = 'sheltuh' and o.owner_user_id is null) dr`,
    [PENDING_EVENT_SOON_HOURS, DOOR_EVENT_WINDOW_HOURS],
  );
  const at = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
  const summary: AdminSummary = {
    reportsOpen: { count: row.reports_open, oldestAt: at(row.reports_oldest_at) },
    eventsPending: {
      count: row.events_pending,
      soonestStartsAt: at(row.events_pending_soonest),
      startingSoon: row.events_pending_soon,
      startingSoonHours: PENDING_EVENT_SOON_HOURS,
    },
    organisersPending: { count: row.organisers_pending, oldestAt: at(row.organisers_pending_oldest_at) },
    emailsFailed: { count: row.emails_failed },
    emailsRetrying: { count: row.emails_retrying },
    doorEvents: { count: row.door_events, windowHours: DOOR_EVENT_WINDOW_HOURS },
  };
  return okPrivate(summary);
};

interface Moderation {
  from: EventStatus;
  to: EventStatus;
  action: "approved" | "rejected" | "unpublished";
}

async function moderateEvent(
  admin: Caller,
  eventId: string,
  deps: Deps,
  { from, to, action }: Moderation,
  reason: string | null = null,
) {
  await requireEventForAdmin(deps.db, eventId);
  // Publishing needs the organiser to be approved. Its row is share-locked
  // first (private.suspend_organiser locks it for update, then the events),
  // so a takedown and an approval can't interleave: an approval after a
  // takedown is refused here, and a takedown after an approval unpublishes
  // the event. null: the organiser isn't approved.
  const guard =
    to === "published"
      ? `exists (select 1 from public.events e join public.organisers o on o.id = e.organiser_id
                  where e.id = $1 and o.status = 'approved' for share of o)`
      : "true";
  let row: { moved: boolean | null };
  try {
    [row] = await deps.db.query<{ moved: boolean | null }>(
      `select case when ${guard} then
         private.transition_event($1, array[$2::public.event_status], $3::public.event_status,
           $4::public.moderation_action, $5, $6) end as moved`,
      [eventId, from, to, action, admin.userId, reason],
    );
  } catch (err) {
    // Publishing a paid event whose organiser has no payouts (any more):
    // events_paid_tickets_need_payouts.
    payoutsRefused(err, ADMIN_PAYOUTS_REQUIRED);
  }
  if (row.moved === null) {
    throw new HttpError(409, "This event's organiser isn't approved (they may have been suspended), so it can't be published.");
  }
  if (!row.moved) {
    throw new HttpError(409, `This event is no longer ${from.replace("_", " ")} — it may already have been reviewed.`);
  }
  // Published (again): if it has tickets left, its waitlist may have been
  // notified (private.notify_waitlist); the first time, the organiser's
  // followers (private.notify_followers).
  if (to === "published") sendPublishEmailsSoon(deps);
  return okPrivate(await requireEventForAdmin(deps.db, eventId));
}

/** POST /api/admin/events/[eventId]/approve — publishes it. */
export const adminApproveEvent: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  return moderateEvent(admin, eventId, deps, { from: "pending_review", to: "published", action: "approved" });
};

/** POST /api/admin/events/[eventId]/reject — body { reason } */
export const adminRejectEvent: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  const reason = await requireReason(req);
  return moderateEvent(admin, eventId, deps, { from: "pending_review", to: "rejected", action: "rejected" }, reason);
};

/** POST /api/admin/events/[eventId]/unpublish — back to draft, not deleted, so the organiser can resubmit. */
export const adminUnpublishEvent: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  return moderateEvent(admin, eventId, deps, { from: "published", to: "draft", action: "unpublished" });
};

/** Longest reason for an admin's ticketing change (shown in the event's moderation log). */
export const MAX_TICKETING_REASON_LENGTH = 500;

/**
 * PATCH /api/admin/events/[eventId]/ticketing — body {ticketingMode,
 * externalTicketUrl?, externalFree?, reason}; ticketingMode is required
 * here (unlike the organiser's form). Sets the event's ticketing
 * whatever its status (organisers can't once the event has been approved),
 * with the organiser's rules for the fields (lib/server/event-input.ts,
 * parseTicketing). Logged in the moderation log as `ticketing_changed`, with
 * the reason and the old and new value of each field changed
 * (private.admin_set_event_ticketing). 200 with the event (unchanged, and
 * nothing logged, when nothing would change); 400 bad fields or reason; 404
 * unknown event; 409 switching to external an event that has orders.
 */
export const adminSetEventTicketing: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  // An id that can't be an event is a 404 before the body is even read.
  if (!isUuid(eventId)) throw new HttpError(404, "Event not found.");
  const body = await readJson(req);
  const errors: Record<string, string> = {};
  // Required here (the organiser's form defaults it to sheltuh): an admin
  // request without it must never quietly turn an external event back.
  if (body.ticketingMode === undefined || body.ticketingMode === null) {
    errors.ticketingMode = "Choose where tickets are sold.";
  }
  const ticketing = parseTicketing(body, errors);
  const reason = parseMessageText(body.reason, "reason", errors, {
    allowLinks: true,
    label: "Reasons",
    maxLength: MAX_TICKETING_REASON_LENGTH,
  });
  if (Object.keys(errors).length > 0) fail(errors);

  const [row] = await deps.db.query<{ result: "updated" | "unchanged" | "not_found" | "has_orders" }>(
    `select private.admin_set_event_ticketing($1, $2, $3, $4, $5, $6) as result`,
    [eventId, admin.userId, ticketing.ticketingMode, ticketing.externalTicketUrl, ticketing.externalFree, reason],
  );
  if (row.result === "not_found") throw new HttpError(404, "Event not found.");
  if (row.result === "has_orders") {
    throw new HttpError(409, "This event has orders, so its tickets can't move to another site.", {
      ticketingMode: "This event has orders.",
    });
  }
  return okPrivate(await requireEventForAdmin(deps.db, eventId));
};
