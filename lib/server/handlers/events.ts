import { requireCaller } from "../auth";
import {
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgConstraint,
  pgErrorCode,
} from "../db";
import { parseEventInput, type EventInput } from "../event-input";
import { created, HttpError, ok, readJson } from "../http";
import { decodeCursor, parseLimit, toPage } from "../pagination";
import { EVENT_SELECT, toEvent } from "../records";
import type { Handler } from "../route";
import type { EventRecord } from "../types";
import { slugify } from "../validation";
import { requireEvent, requireOwnEvent } from "./event-queries";
import { requireApprovedOrganiser } from "./organiser-guard";

const SLUG_ATTEMPTS = 5;

/** Everything but the ticket types, which are stored in their own table. */
export function eventFields(input: EventInput): Omit<EventInput, "ticketTypes"> {
  const fields: Partial<EventInput> = { ...input };
  delete fields.ticketTypes;
  return fields as Omit<EventInput, "ticketTypes">;
}

/** Turns the database's inventory guards into messages an organiser can act on. */
export function ticketTypeConflict(err: unknown): never {
  if (pgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION && pgConstraint(err)?.startsWith("tickets_")) {
    throw new HttpError(409, "A ticket type that has already sold tickets can't be removed.");
  }
  if (pgErrorCode(err) === PG_CHECK_VIOLATION && pgConstraint(err) === "ticket_types_not_oversold") {
    throw new HttpError(409, "A ticket type's quantity can't go below the number already sold.");
  }
  throw err;
}

/** POST /api/events — creates a draft owned by the caller's organisation. */
export const createEventDraft: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const input = parseEventInput(await readJson(req));

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

/** Shown when an organiser tries to change an approved event's ticketing. */
export const TICKETING_FROZEN =
  "This event's ticketing was approved, so where tickets are sold and the ticket link can't be changed here. Contact Sheltüh to change them.";

/**
 * PATCH /api/events/[eventId] — only while the event is a draft or rejected
 * (409 otherwise). Once the event has ever been approved, its ticketing mode
 * and ticket link are frozen: a change to either is a 409 with fieldErrors
 * (only an admin can change them: PATCH /api/admin/events/[eventId]/ticketing).
 * The free flag of an external event, and everything else, stay editable.
 * Without `ticketingMode`, the stored ticketing is kept (withStoredTicketing).
 */
export const updateEventDraft: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const current = await requireOwnEvent(db, organiser.organiserId, eventId);
  const input = parseEventInput(withStoredTicketing(await readJson(req), current));

  let result: string;
  try {
    const [row] = await db.query<{ result: "updated" | "not_found" | "not_editable" | "ticketing_frozen" }>(
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
  return ok(await requireEvent(db, eventId));
};

/** POST /api/events/[eventId]/submit — draft or rejected → pending review. */
export const submitEventForReview: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  await requireOwnEvent(deps.db, organiser.organiserId, eventId);

  const [row] = await deps.db.query<{ moved: boolean }>(
    `select private.transition_event($1, array['draft', 'rejected']::public.event_status[], 'pending_review',
       'submitted', $2, null, $3) as moved`,
    [eventId, caller.userId, organiser.organiserId],
  );
  if (!row.moved) throw new HttpError(409, "Only a draft or rejected event can be submitted for review.");
  return ok(await requireEvent(deps.db, eventId));
};

/** GET /api/organisers/me/events — newest first. */
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
  return ok(toPage(rows.map(toEvent), offset, limit));
};

/** GET /api/organisers/me/events/[eventId] — for the edit form. */
export const getMyEvent: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  return ok(await requireOwnEvent(db, organiser.organiserId, eventId));
};
