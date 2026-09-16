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

export function isFreeEvent(event: SheltuhEvent): boolean {
  return event.ticketTypes.every((ticket) => ticket.priceCents === 0);
}
