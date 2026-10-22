import type { Db } from "../db";
import { HttpError } from "../http";
import { isUuid } from "../pagination";
import { EVENT_SELECT, toEvent, toEventForAdmin } from "../records";
import type { EventRecord } from "../types";

/** The event as its organiser sees it (an admin's log entries show the Sheltüh team, not the admin). */
export async function findEventById(db: Db, eventId: string): Promise<EventRecord | undefined> {
  if (!isUuid(eventId)) return undefined;
  const [row] = await db.query(`${EVENT_SELECT} where e.id = $1`, [eventId]);
  return row ? toEvent(row) : undefined;
}

/** The event for an admin route: log entries keep every actor's account id. 404 if there's none. */
export async function requireEventForAdmin(db: Db, eventId: string): Promise<EventRecord> {
  const [row] = isUuid(eventId) ? await db.query(`${EVENT_SELECT} where e.id = $1`, [eventId]) : [];
  if (!row) throw new HttpError(404, "Event not found.");
  return toEventForAdmin(row);
}

export async function requireEvent(db: Db, eventId: string): Promise<EventRecord> {
  const event = await findEventById(db, eventId);
  if (!event) throw new HttpError(404, "Event not found.");
  return event;
}

/** An event belonging to organiserId. Someone else's event is a 404, not a 403 — its existence isn't theirs to know. */
export async function requireOwnEvent(db: Db, organiserId: string, eventId: string): Promise<EventRecord> {
  const event = await findEventById(db, eventId);
  if (!event || event.organiserId !== organiserId) throw new HttpError(404, "Event not found.");
  return event;
}

/** The checkout's and free-ticket confirmation's refusal for an event that has ended (409). */
export const EVENT_ENDED = "This event has ended.";

/**
 * No new orders or seat holds once an event has ended: `ends_at <= now`, the
 * definition the database uses everywhere (the orders_not_ended trigger and
 * private.confirm_free_order are the binding checks; this is the early 409).
 * A payment for an order made before the end is still fulfilled.
 */
export function refuseEndedEvent(event: Pick<EventRecord, "endsAt">, now = Date.now()): void {
  if (Date.parse(event.endsAt) <= now) throw new HttpError(409, EVENT_ENDED);
}
