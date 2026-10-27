import { requireCaller } from "../auth";
import {
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgConstraint,
  pgErrorCode,
  type Db,
} from "../db";
import { REFUND_POLICY_TIGHTENED_CODE } from "@/lib/refund-policy";
import { sendReviewEmailsSoon } from "../email-outbox";
import { parseEventInput, storedPlaceOf, type EventInput, type LocationInput } from "../event-input";
import { created, HttpError, ok, okPrivate, readJson } from "../http";
import { decodeCursor, parseLimit, toPage } from "../pagination";
import {
  ADMIN_PAYOUTS_REQUIRED,
  isPayoutsRefusal,
  PAYOUTS_REQUIRED_CODE,
  PAYOUTS_REQUIRED_TO_SUBMIT,
  payoutsRefused,
  payoutsRequired,
} from "../payouts-refusal";
import { locationRequired } from "../location-refusal";
import { EVENT_SELECT, toEvent } from "../records";
import type { Handler } from "../route";
import type { EventRecord } from "../types";
import { slugify } from "../validation";
import { requireEvent, requireOwnEvent } from "./event-queries";
import { requireApprovedOrganiser } from "./organiser-guard";
import { refuseStaleVenueLocation, verifyVenuePlace } from "./places";

const SLUG_ATTEMPTS = 5;

/** The event's fields as the private.*_event functions read them (p_fields). */
export type EventFields = Omit<EventInput, "ticketTypes" | "location"> & {
  /** Sent only with a location (parseLocation): absent, the stored one is kept (none on create). */
  locationSource?: LocationInput["source"];
  placeId?: string | null;
  pinLat?: number | null;
  pinLng?: number | null;
};

/**
 * Everything but the ticket types, which are stored in their own table, with
 * the location as the database's flat keys (locationSource, placeId, pinLat,
 * pinLng), and only when one was sent.
 */
export function eventFields(input: EventInput): EventFields {
  const fields: Partial<EventInput> = { ...input };
  delete fields.ticketTypes;
  delete fields.location;
  const location = input.location;
  if (!location) return fields as EventFields;
  return {
    ...(fields as EventFields),
    locationSource: location.source,
    placeId: location.placeId,
    pinLat: location.pin?.lat ?? null,
    pinLng: location.pin?.lng ?? null,
  };
}

/** Turns the database's inventory guards into messages an organiser can act on. */
export function ticketTypeConflict(err: unknown): never {
  if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION && pgConstraint(err) === "event_seats_ticket_type_fkey") {
    throw new HttpError(
      409,
      "A ticket type with seats on the seat map can't be removed. Move its seats to another ticket type first.",
      { ticketTypes: "A ticket type with seats on the seat map can't be removed." },
    );
  }
  if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION && pgConstraint(err)?.startsWith("tickets_")) {
    throw new HttpError(409, "A ticket type that has already sold tickets can't be removed.");
  }
  if (pgErrorCode(err) === PG_CHECK_VIOLATION && pgConstraint(err) === "ticket_types_not_oversold") {
    throw new HttpError(409, "A ticket type's quantity can't go below the number already sold.");
  }
  throw err;
}

// The payouts rule's errors live in ../payouts-refusal, which (unlike this
// module) doesn't load the suburb table; re-exported for this module's callers.
export {
  ADMIN_PAYOUTS_REQUIRED,
  isPayoutsRefusal,
  PAYOUTS_REQUIRED_CODE,
  PAYOUTS_REQUIRED_TO_SUBMIT,
  payoutsRefused,
  payoutsRequired,
};

/**
 * A seated tier's capacity is set by the seat map (its unblocked seats; the
 * database's ticket_types_seated_capacity trigger enforces it whatever is
 * sent). An edit's quantity for such a tier is replaced by the stored one,
 * so the editor's stale number neither errors nor shows up as an admin
 * "change".
 */
export function withSeatedCapacity(input: EventInput, current: EventRecord): EventInput {
  const seated = new Map(current.ticketTypes.filter((t) => t.seated).map((t) => [t.id, t.quantityAvailable]));
  if (seated.size === 0) return input;
  return {
    ...input,
    ticketTypes: input.ticketTypes.map((t) => (seated.has(t.id) ? { ...t, quantityAvailable: seated.get(t.id) as number } : t)),
  };
}

/**
 * POST /api/events — creates a draft owned by the caller's organisation. An
 * optional `location` (lib/api/types.ts VenueLocationInput) is checked
 * (parseEventInput; a Google place with Google too, verifyVenuePlace: 400 /
 * 503 fieldErrors.location, 400 fieldErrors.suburb for another state).
 */
export const createEventDraft: Handler = async (req, _params, deps) => {
  const { db, verifyAccessToken } = deps;
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const input = parseEventInput(await readJson(req));
  await verifyVenuePlace(deps, caller, input);

  const id = await withUniqueSlug(input.title, async (slug) => {
    const [row] = await db.query<{ id: string }>(
      `select private.create_event_draft($1, $2, $3::text::jsonb, $4::text::jsonb) as id`,
      [organiser.organiserId, slug, JSON.stringify(eventFields(input)), JSON.stringify(input.ticketTypes)],
    );
    return row.id;
  });
  return created(await requireEvent(db, id));
};

/**
 * Runs `insert` with a globally unique slug: the title's, or with a short
 * random suffix when that's taken (events_slug_key). 500 after
 * SLUG_ATTEMPTS collisions.
 */
export async function withUniqueSlug<T>(title: string, insert: (slug: string) => Promise<T>): Promise<T> {
  const base = slugify(title) || "event";
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 6)}`;
    try {
      return await insert(slug);
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION && pgConstraint(err) === "events_slug_key") continue;
      throw err;
    }
  }
  throw new HttpError(500, "Could not allocate a unique event URL — try a different title.");
}

/**
 * An edit that doesn't send `ticketingMode` keeps the event's stored
 * ticketing: its mode, and its link and free flag unless those are sent.
 * So a client that predates external ticketing can never turn an external
 * event into a Sheltüh-ticketed one (or trip the freeze) by leaving the
 * field out; sending ticket types for an external event is still a 400.
 */
function withStoredTicketing(body: Record<string, unknown>, current: EventRecord): Record<string, unknown> {
  if (body.ticketingMode !== undefined && body.ticketingMode !== null) return body;
  return {
    ...body,
    ticketingMode: current.ticketingMode ?? "sheltuh",
    externalTicketUrl: body.externalTicketUrl === undefined ? (current.externalTicketUrl ?? null) : body.externalTicketUrl,
    externalFree: body.externalFree === undefined ? current.externalFree === true : body.externalFree,
  };
}

/**
 * An edit that would make the refund policy of an event with paid orders, or
 * pending ones that can still be paid (private.event_has_payable_orders), less
 * generous (private.refund_policy_tightens): buyers keep the terms they bought
 * under. Loosening is always allowed.
 */
export const REFUND_POLICY_TIGHTENED =
  "This event already has orders, so its refund policy can only become more generous: people who bought tickets keep the refunds they were offered.";

/** The 409 for a refused tightening: `code: "refund_policy_tightened"`, fieldErrors.refundPolicy. */
export function refundPolicyTightened(): HttpError {
  return new HttpError(409, REFUND_POLICY_TIGHTENED, { refundPolicy: REFUND_POLICY_TIGHTENED }, {
    code: REFUND_POLICY_TIGHTENED_CODE,
  });
}

/** Shown when an organiser tries to change an approved event's ticketing. */
export const TICKETING_FROZEN =
  "This event's ticketing was approved, so where tickets are sold and the ticket link can't be changed here. Contact Sheltüh to change them.";

/**
 * PATCH /api/events/[eventId] — only while the event is a draft or rejected
 * (409 otherwise). Once the event has ever been approved, its ticketing mode
 * and ticket link are frozen: a change to either is a 409 with fieldErrors
 * (only an admin can change them: PATCH /api/admin/events/[eventId]/ticketing).
 * The free flag of an external event, and everything else, stay editable.
 * Without `ticketingMode`, the stored ticketing is kept (withStoredTicketing);
 * without `refundPolicy`, the stored refund policy. A draft that has orders
 * (it was published, then unpublished) can't have its refund policy made less
 * generous: 409 `code: "refund_policy_tightened"` (refundPolicyTightened).
 * Without `state` and `timeZone`, the stored place is kept and the times are
 * read in the stored zone (parseEventInput), so a client that predates them
 * re-saves an event outside Melbourne unchanged. Without `location`, the
 * stored venue location is kept, unless the suburb or state changes while
 * a pin or Google place is stored: 400 fieldErrors.location
 * (refuseStaleVenueLocation: check the pin again). A new or changed Google
 * place is checked with Google, and so is a kept one when the suburb or state
 * changes (400 fieldErrors.location if it's in another state) (verifyVenuePlace;
 * 429 / 503 fieldErrors.location past the Places allowances).
 */
export const updateEventDraft: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { db, verifyAccessToken } = deps;
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const current = await requireOwnEvent(db, organiser.organiserId, eventId);
  const body = withStoredTicketing(await readJson(req), current);
  const input = withSeatedCapacity(parseEventInput(body, { storedPlace: storedPlaceOf(current) }), current);
  // Not for an event the edit can't change (private.edit_event_draft answers not_editable).
  if (current.status === "draft" || current.status === "rejected") {
    refuseStaleVenueLocation(input, current);
    await verifyVenuePlace(deps, caller, input, current);
  }

  let result: string;
  try {
    const [row] = await db.query<{
      result: "updated" | "not_found" | "not_editable" | "ticketing_frozen" | "refund_policy_tightened";
    }>(
      `select private.edit_event_draft($1, $2, $3::text::jsonb, $4::text::jsonb) as result`,
      [eventId, organiser.organiserId, JSON.stringify(eventFields(input)), JSON.stringify(input.ticketTypes)],
    );
    result = row.result;
  } catch (err) {
    ticketTypeConflict(err);
  }
  if (result === "not_found") throw new HttpError(404, "Event not found.");
  if (result === "not_editable") {
    throw new HttpError(409, "This event can't be edited while it's pending review or published.");
  }
  if (result === "ticketing_frozen") {
    const fieldErrors: Record<string, string> = {};
    if ((current.ticketingMode ?? "sheltuh") !== input.ticketingMode) fieldErrors.ticketingMode = TICKETING_FROZEN;
    if ((current.externalTicketUrl ?? null) !== input.externalTicketUrl) fieldErrors.externalTicketUrl = TICKETING_FROZEN;
    throw new HttpError(409, TICKETING_FROZEN, fieldErrors);
  }
  if (result === "refund_policy_tightened") throw refundPolicyTightened();
  return ok(await requireEvent(db, eventId));
};

/**
 * POST /api/events/[eventId]/submit — draft or rejected → pending review. The
 * admins' "event to review" email is queued by the database in the same
 * transaction (private.queue_review_email: at most one waiting per event, an
 * hour apart) and sent straight after the response. An event with a paid
 * Sheltüh ticket type needs the organiser's payouts set up first
 * (private.submit_event): 409 `code: "payouts_required"` otherwise. Free and
 * external events never need payouts. Every event needs a confirmed venue
 * location (the organiser's pin): 409 `code: "location_required"` otherwise,
 * checked here (refuseSubmitWithoutPin), not by private.submit_event, so the
 * previous app version's submit keeps working against the database
 * (20261111000400_submit_event_location_in_app.sql).
 */
export const submitEventForReview: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  await requireOwnEvent(deps.db, organiser.organiserId, eventId);
  await refuseSubmitWithoutPin(deps.db, organiser.organiserId, eventId);

  let result: "submitted" | "not_found" | "not_submittable" | "payouts_required" | "location_required";
  try {
    const [row] = await deps.db.query<{ result: typeof result }>(`select private.submit_event($1, $2, $3) as result`, [
      eventId,
      organiser.organiserId,
      caller.userId,
    ]);
    result = row.result;
  } catch (err) {
    // Belt and braces: the events trigger (events_paid_tickets_need_payouts) behind private.submit_event's own check.
    payoutsRefused(err, PAYOUTS_REQUIRED_TO_SUBMIT);
  }
  if (result === "not_found") throw new HttpError(404, "Event not found.");
  if (result === "not_submittable") throw new HttpError(409, "Only a draft or rejected event can be submitted for review.");
  if (result === "payouts_required") throw payoutsRequired(PAYOUTS_REQUIRED_TO_SUBMIT);
  if (result === "location_required") throw locationRequired();
  sendReviewEmailsSoon(deps, "event_review");
  return ok(await requireEvent(deps.db, eventId));
};

/**
 * The organiser's submit needs their pin on the event (events.venue_lat: a
 * Google place with its pin checked, or a manual pin): 409 `code:
 * "location_required"`, nothing written. In the order private.submit_event
 * refuses, so an event it would refuse first (not a draft or rejected, then
 * a paid Sheltüh ticket without payouts) gets that answer from it instead.
 * Not in the same transaction as the submit: an edit clearing the pin in
 * between (the organiser's own, from another tab) still submits, and an
 * admin reviews it (admins never needed a pin). One row by primary key.
 */
async function refuseSubmitWithoutPin(db: Db, organiserId: string, eventId: string): Promise<void> {
  const [row] = await db.query<{ pinned: boolean; refused_earlier: boolean }>(
    `select e.venue_lat is not null as pinned,
            (e.status not in ('draft', 'rejected')
              or (not o.payouts_enabled and e.ticketing_mode = 'sheltuh'
                  and exists (select 1 from public.ticket_types t where t.event_id = e.id and t.price_cents > 0))) as refused_earlier
       from public.events e join public.organisers o on o.id = e.organiser_id
      where e.id = $1 and e.organiser_id = $2`,
    [eventId, organiserId],
  );
  // No row: gone since requireOwnEvent read it; private.submit_event answers not_found.
  if (row && !row.pinned && !row.refused_earlier) throw locationRequired();
}

/** GET /api/organisers/me/events — newest first; the organiser's own records (`private, no-store`). */
export const listMyEvents: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const offset = decodeCursor(url.searchParams.get("cursor"));

  const rows = await db.query(
    `${EVENT_SELECT} where e.organiser_id = $1 order by e.created_at desc, e.id desc limit $2 offset $3`,
    [organiser.organiserId, limit + 1, offset],
  );
  return okPrivate(toPage(rows.map(toEvent), offset, limit));
};

/** GET /api/organisers/me/events/[eventId] — for the edit form (`private, no-store`). */
export const getMyEvent: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  return okPrivate(await requireOwnEvent(db, organiser.organiserId, eventId));
};
