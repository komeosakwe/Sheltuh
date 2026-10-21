/**
 * Admin event authoring (docs/architecture.md, "Admin authoring";
 * supabase/migrations/20261022000100_admin_event_authoring.sql): admins
 * create platform-managed organisers, and create or edit any organiser's
 * events, photos included. Every route is admin only (401 signed out, 403
 * anyone else).
 */
import { requireAdmin } from "../auth";
import { PG_CHECK_VIOLATION, pgConstraint, pgErrorCode, type Db } from "../db";
import { sendWaitlistEmailsSoon } from "../email-outbox";
import { parseEventInput, type EventInput } from "../event-input";
import { createdPrivate, HttpError, okPrivate, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { isUuid } from "../pagination";
import { ADMIN_EVENT_SELECT, ADMIN_ORGANISER_SELECT, toAdminEvent, toAdminOrganiser } from "../records";
import type { Handler } from "../route";
import type { AdminEventRecord } from "../types";
import { fail } from "../validation";
import { MAX_TICKETING_REASON_LENGTH } from "./admin";
import { readEventImage } from "./event-images";
import { eventFields, ticketTypeConflict, withUniqueSlug } from "./events";
import { parseApplication } from "./organisers";

/** Shown when a platform-managed organiser's event would have a paid Sheltüh ticket. */
export const PLATFORM_PAID_REFUSED =
  "A platform-managed organiser can only have free Sheltüh tickets, or link to tickets sold on another site.";

/** Shown when the event changed since the admin opened it (PATCH, expectedUpdatedAt). */
export const EVENT_EDIT_CONFLICT =
  "Someone else changed this event since you opened it, so your changes weren't saved. Reload it to see the latest version, then make your changes again.";

const EVENT_NOT_FOUND = "Event not found.";

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function findAdminEvent(db: Db, eventId: string): Promise<AdminEventRecord | undefined> {
  if (!isUuid(eventId)) return undefined;
  const [row] = await db.query(`${ADMIN_EVENT_SELECT} where e.id = $1`, [eventId]);
  return row ? toAdminEvent(row) : undefined;
}

async function requireAdminEvent(db: Db, eventId: string): Promise<AdminEventRecord> {
  const event = await findAdminEvent(db, eventId);
  if (!event) throw new HttpError(404, EVENT_NOT_FOUND);
  return event;
}

/** GET /api/admin/events/[eventId] — any event, any status, for the admin editor. */
export const adminGetEvent: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  return okPrivate(await requireAdminEvent(db, eventId));
};

// ---------------------------------------------------------------------------
// Organisers
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/organisers — a platform-managed organiser: no owner
 * account, approved straight away (reviewed by this admin). The body and its
 * rules are an organiser application's (displayName, contactEmail,
 * description, categories, websiteUrl, social handles). 201 with the
 * AdminOrganiserRecord; 400 fieldErrors.
 */
export const adminCreateOrganiser: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  const input = parseApplication(await readJson(req));
  const [row] = await db.query<{ id: string }>(
    `insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, website_url,
                                    instagram_handle, tiktok_handle, facebook_page, x_handle,
                                    status, reviewed_by, reviewed_at)
     values (null, $1, $2, $3, array(select jsonb_array_elements_text($4::text::jsonb))::public.event_category[], $5,
             $6, $7, $8, $9, 'approved', $10, now())
     returning id`,
    [
      input.displayName,
      input.contactEmail,
      input.description,
      JSON.stringify(input.categories),
      input.websiteUrl,
      input.handles.instagramHandle ?? null,
      input.handles.tiktokHandle ?? null,
      input.handles.facebookPage ?? null,
      input.handles.xHandle ?? null,
      admin.userId,
    ],
  );
  const [record] = await db.query(`${ADMIN_ORGANISER_SELECT} where o.id = $1`, [row.id]);
  return createdPrivate(toAdminOrganiser(record));
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

type Errors = Record<string, string>;

/**
 * The event body (lib/server/event-input.ts, the organiser's rules) plus the
 * admin route's own fields, with every field error reported together.
 */
function parseAdminEventBody<T>(body: Record<string, unknown>, parseExtra: (errors: Errors) => T) {
  const errors: Errors = {};
  const extra = parseExtra(errors);
  let input: EventInput | undefined;
  try {
    input = parseEventInput(body);
  } catch (err) {
    if (!(err instanceof HttpError) || err.statusCode !== 400 || !err.fieldErrors) throw err;
    Object.assign(errors, err.fieldErrors);
  }
  if (Object.keys(errors).length > 0 || !input) fail(errors);
  return { input, extra };
}

function parseOrganiserId(value: unknown, errors: Errors): string {
  if (typeof value !== "string" || !isUuid(value)) {
    errors.organiserId = "Choose an organiser.";
    return "";
  }
  return value;
}

function parsePublish(value: unknown, errors: Errors): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") {
    errors.publish = "Must be true or false.";
    return false;
  }
  return value;
}

/** An ISO 8601 instant with a zone, as EventRecord.updatedAt is sent. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function parseExpectedUpdatedAt(value: unknown, errors: Errors): string {
  if (typeof value !== "string" || !ISO_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) {
    errors.expectedUpdatedAt = "Send the updatedAt of the version you're editing.";
    return "";
  }
  return value;
}

/** Optional (absent, null or blank: none); otherwise cleaned like any reason, at most 500 characters. */
function parseOptionalReason(value: unknown, errors: Errors): string | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  const reason = parseMessageText(value, "reason", errors, {
    allowLinks: true,
    label: "Reasons",
    maxLength: MAX_TICKETING_REASON_LENGTH,
  });
  return reason || null;
}

/** The database refused a write: a paid ticket for a platform-managed organiser, or an inventory guard. */
function writeRefused(err: unknown): never {
  if (pgErrorCode(err) === PG_CHECK_VIOLATION && pgConstraint(err) === "ticket_types_platform_free_only") {
    throw new HttpError(400, PLATFORM_PAID_REFUSED, { ticketTypes: PLATFORM_PAID_REFUSED });
  }
  return ticketTypeConflict(err);
}

/**
 * private.admin_create_event's row: a refusal has no event id; "created" and
 * "published" always have one.
 */
type AdminCreateEventOutcome =
  | { result: "organiser_not_found" | "organiser_not_approved" | "platform_paid"; new_event_id: null }
  | { result: "created" | "published"; new_event_id: string };

/**
 * POST /api/admin/events — body: the organiser's event fields (same rules,
 * external ticketing included) plus `organiserId` (any approved organiser,
 * platform-managed or not) and optional `publish`. Creates the event, logged
 * `created`, and with `publish: true` publishes it in the same step
 * (`approved`, through private.transition_event). 201 with the
 * AdminEventRecord; 400 fieldErrors (organiserId unknown; a paid ticket type
 * for a platform-managed organiser: ticketTypes); 409 organiser not approved.
 */
export const adminCreateEvent: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  const body = await readJson(req);
  const { input, extra } = parseAdminEventBody(body, (errors) => ({
    organiserId: parseOrganiserId(body.organiserId, errors),
    publish: parsePublish(body.publish, errors),
  }));

  let outcome: AdminCreateEventOutcome;
  try {
    outcome = await withUniqueSlug(input.title, async (slug) => {
      const [row] = await db.query<AdminCreateEventOutcome>(
        `select result, new_event_id
           from private.admin_create_event($1, $2, $3, $4::text::jsonb, $5::text::jsonb, $6)`,
        [
          extra.organiserId,
          admin.userId,
          slug,
          JSON.stringify(eventFields(input)),
          JSON.stringify(input.ticketTypes),
          extra.publish,
        ],
      );
      return row;
    });
  } catch (err) {
    writeRefused(err);
  }

  switch (outcome.result) {
    case "organiser_not_found":
      throw new HttpError(400, "Please fix the highlighted fields.", { organiserId: "No such organiser." });
    case "organiser_not_approved":
      throw new HttpError(409, "This organiser isn't approved, so events can't be created for them.", {
        organiserId: "This organiser isn't approved.",
      });
    case "platform_paid":
      throw new HttpError(400, PLATFORM_PAID_REFUSED, { ticketTypes: PLATFORM_PAID_REFUSED });
  }
  // Only "created" and "published" are left, and both carry the new event's id.
  return createdPrivate(await requireAdminEvent(db, outcome.new_event_id));
};

/**
 * PATCH /api/admin/events/[eventId] — the whole event, as POST (without
 * organiserId: an event stays with its organiser), whatever its status, plus:
 * `ticketingMode` (required here), `expectedUpdatedAt` (the version's
 * `updatedAt`, required), optional `publish` and optional `reason` (at most
 * 500 characters; required to change the mode or link of an event that has
 * been approved before). One step (private.admin_edit_event): ticketing
 * changes as PATCH …/ticketing does (logged `ticketing_changed`), every other
 * change one `edited` entry with old and new values, then the publish. 200
 * with the AdminEventRecord (unchanged, nothing logged, if nothing would
 * change). 400 fieldErrors; 404; 409 stale (fieldErrors.expectedUpdatedAt),
 * switching to external an event with orders, removing a sold ticket type or
 * cutting it below what's sold, or publishing for an organiser who isn't
 * approved.
 */
export const adminUpdateEvent: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { db, verifyAccessToken } = deps;
  const admin = await requireAdmin(req, verifyAccessToken);
  // An id that can't be an event is a 404 before the body is even read.
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const body = await readJson(req);
  const { input, extra } = parseAdminEventBody(body, (errors) => {
    // Required here (the organiser's form defaults it to sheltuh): an admin
    // edit without it must never quietly turn an external event back.
    if (body.ticketingMode === undefined || body.ticketingMode === null) {
      errors.ticketingMode = "Choose where tickets are sold.";
    }
    return {
      expectedUpdatedAt: parseExpectedUpdatedAt(body.expectedUpdatedAt, errors),
      publish: parsePublish(body.publish, errors),
      reason: parseOptionalReason(body.reason, errors),
    };
  });

  let result: string;
  try {
    const [row] = await db.query<{ result: string }>(
      `select private.admin_edit_event($1, $2, $3::timestamptz, $4::text::jsonb, $5::text::jsonb, $6, $7) as result`,
      [
        eventId,
        admin.userId,
        extra.expectedUpdatedAt,
        JSON.stringify(eventFields(input)),
        JSON.stringify(input.ticketTypes),
        extra.publish,
        extra.reason,
      ],
    );
    result = row.result;
  } catch (err) {
    writeRefused(err);
  }

  switch (result) {
    case "not_found":
      throw new HttpError(404, EVENT_NOT_FOUND);
    case "stale":
      throw new HttpError(409, EVENT_EDIT_CONFLICT, { expectedUpdatedAt: EVENT_EDIT_CONFLICT });
    case "has_orders":
      throw new HttpError(409, "This event has orders, so its tickets can't move to another site.", {
        ticketingMode: "This event has orders.",
      });
    case "platform_paid":
      throw new HttpError(400, PLATFORM_PAID_REFUSED, { ticketTypes: PLATFORM_PAID_REFUSED });
    case "reason_required":
      throw new HttpError(400, "Please fix the highlighted fields.", {
        reason: "Give a reason for changing where an approved event's tickets are sold.",
      });
    case "organiser_not_approved":
      throw new HttpError(409, "This event's organiser isn't approved (they may have been suspended), so it can't be published.");
  }
  // More tickets, a new ticket type or a publish may have notified the event's waitlist (private.notify_waitlist).
  sendWaitlistEmailsSoon(deps);
  return okPrivate(await requireAdminEvent(db, eventId));
};

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

async function requireEventExists(db: Db, eventId: string): Promise<void> {
  const rows = isUuid(eventId) ? await db.query(`select 1 from public.events where id = $1`, [eventId]) : [];
  if (rows.length === 0) throw new HttpError(404, EVENT_NOT_FOUND);
}

/**
 * PUT /api/admin/events/[eventId]/image — raw image bytes, any status. The
 * organiser upload's rules (at most 2 MB, 413; JPEG, PNG or WebP by its own
 * bytes, 400), logged `edited` (`changes.image`). 200 with the event; 404.
 */
export const adminPutEventImage: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  // Before the body is read: an unknown event isn't worth reading 2 MB for.
  await requireEventExists(db, eventId);
  const { bytes, contentType } = await readEventImage(req);
  const [row] = await db.query<{ result: "updated" | "not_found" }>(
    `select private.admin_put_event_image($1, $2, $3, $4::bytea) as result`,
    [eventId, admin.userId, contentType, bytes],
  );
  if (row.result === "not_found") throw new HttpError(404, EVENT_NOT_FOUND);
  return okPrivate(await requireAdminEvent(db, eventId));
};

/** DELETE /api/admin/events/[eventId]/image — any status; logged `edited` when there was a photo. 200 with the event; 404. */
export const adminDeleteEventImage: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const [row] = await db.query<{ result: "deleted" | "unchanged" | "not_found" }>(
    `select private.admin_delete_event_image($1, $2) as result`,
    [eventId, admin.userId],
  );
  if (row.result === "not_found") throw new HttpError(404, EVENT_NOT_FOUND);
  return okPrivate(await requireAdminEvent(db, eventId));
};
