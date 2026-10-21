import { requireAdmin, type Caller } from "../auth";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { parseTicketing } from "../event-input";
import { HttpError, ok, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { ADMIN_ORGANISER_SELECT, EVENT_SELECT, toAdminOrganiser, toEvent } from "../records";
import type { Handler } from "../route";
import type { AdminOrganiserRecord, EventStatus, OrganiserStatus, SuspendOrganiserResult } from "../types";
import { fail, requireString } from "../validation";
import { requireEvent } from "./event-queries";

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

/**
 * GET /api/admin/organisers?status=pending — most recently updated first.
 * Each item is an AdminOrganiserRecord: the full record (social handles
 * included) plus its newest 20 profile-edit and takedown log entries.
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

  const rows = await db.query(
    `${ADMIN_ORGANISER_SELECT} where o.status = $1::public.organiser_status
     order by o.updated_at desc, o.id limit $2 offset $3`,
    [status, limit + 1, offset],
  );
  return ok(toPage(rows.map(toAdminOrganiser), offset, limit));
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
  return ok(await findAdminOrganiser(deps.db, organiserId));
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
  return ok(result);
};

// ---------------------------------------------------------------------------
// Event submissions
// ---------------------------------------------------------------------------

/** GET /api/admin/events?status=pending_review — soonest first. */
export const adminListEvents: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const status = (qs.get("status") ?? "pending_review") as EventStatus;
  if (!EVENT_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of: ${EVENT_STATUSES.join(", ")}`);
  }
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const rows = await db.query(
    `${EVENT_SELECT} where e.status = $1::public.event_status
     order by e.starts_at, e.id limit $2 offset $3`,
    [status, limit + 1, offset],
  );
  return ok(toPage(rows.map(toEvent), offset, limit));
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
  await requireEvent(deps.db, eventId);
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
  const [row] = await deps.db.query<{ moved: boolean | null }>(
    `select case when ${guard} then
       private.transition_event($1, array[$2::public.event_status], $3::public.event_status,
         $4::public.moderation_action, $5, $6) end as moved`,
    [eventId, from, to, action, admin.userId, reason],
  );
  if (row.moved === null) {
    throw new HttpError(409, "This event's organiser isn't approved (they may have been suspended), so it can't be published.");
  }
  if (!row.moved) {
    throw new HttpError(409, `This event is no longer ${from.replace("_", " ")} — it may already have been reviewed.`);
  }
  return ok(await requireEvent(deps.db, eventId));
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
  if (!isUuid(eventId)) throw new HttpError(404, "Event not found.");

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
  return ok(await requireEvent(deps.db, eventId));
};
