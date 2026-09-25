import type { Db } from "../db";
import { HttpError } from "../http";
import { isUuid } from "../pagination";
import { EVENT_SELECT, toEvent } from "../records";
import type { EventRecord } from "../types";

export async function findEventById(db: Db, eventId: string): Promise<EventRecord | undefined> {
  if (!isUuid(eventId)) return undefined;
  const [row] = await db.query(`${EVENT_SELECT} where e.id = $1`, [eventId]);
  return row ? toEvent(row) : undefined;
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
