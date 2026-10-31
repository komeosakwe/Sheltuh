import type { SheltuhEvent } from "@/lib/types";

/**
 * How long an event that has ended stays listed (home "Recently on", /events,
 * search), openable but with nothing to buy, so a young marketplace with few
 * events still has a full page. The API's `recent` feed option reads the same
 * number (lib/server/handlers/public-events.ts).
 */
export const RECENT_EVENT_DAYS = 14;
export const RECENT_EVENT_MS = RECENT_EVENT_DAYS * 24 * 60 * 60 * 1000;

/** When the event ended (an event with no end time ends when it starts), in ms. */
export const endedAtMs = (event: SheltuhEvent) => Date.parse(event.endsAt ?? event.startsAt);

/** Ended by `now`, within the last RECENT_EVENT_DAYS days. */
export function isRecentlyEnded(event: SheltuhEvent, now: Date): boolean {
  const ended = endedAtMs(event);
  return ended <= now.getTime() && ended > now.getTime() - RECENT_EVENT_MS;
}

/** Most recently ended first; ties by id, so the order is stable. */
export const byRecentlyEnded = (a: SheltuhEvent, b: SheltuhEvent) => endedAtMs(b) - endedAtMs(a) || a.id.localeCompare(b.id);
