import { EVENT_CATEGORIES, type EventCategory, type SheltuhEvent } from "./types";
import { sampleEvents } from "./sample-events";

/**
 * Data-access layer over event data. Every function is async and returns
 * plain data so this module can later be swapped for real API calls without
 * touching the screens that consume it.
 */

export async function getEvents(): Promise<SheltuhEvent[]> {
  return sampleEvents;
}

export async function getEventBySlug(slug: string): Promise<SheltuhEvent | undefined> {
  return sampleEvents.find((event) => event.slug === slug);
}

export function getEventCategories(): { value: EventCategory; label: string }[] {
  return EVENT_CATEGORIES;
}

/**
 * Every ticket type is free. An event with no ticket types yet is neither
 * free nor paid (same rule as the API's `pricing` filter).
 */
export function isFreeEvent(event: SheltuhEvent): boolean {
  return event.ticketTypes.length > 0 && event.ticketTypes.every((ticket) => ticket.priceCents === 0);
}

/** At least one ticket type costs money (same rule as the API's `pricing=paid`). */
export function isPaidEvent(event: SheltuhEvent): boolean {
  return event.ticketTypes.some((ticket) => ticket.priceCents > 0);
}

/**
 * Hasn't ended yet (in progress included), the API's `upcoming=1` rule. An
 * event without an end time counts as ended once it starts.
 */
export function isUpcomingEvent(event: SheltuhEvent, now: Date): boolean {
  return Date.parse(event.endsAt ?? event.startsAt) > now.getTime();
}

/** The demo events that haven't ended yet, as `GET /api/events?upcoming=1` would list them. */
export async function getUpcomingEvents(now: Date = new Date()): Promise<SheltuhEvent[]> {
  return (await getEvents()).filter((event) => isUpcomingEvent(event, now));
}
