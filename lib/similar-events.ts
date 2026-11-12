import { distanceKm, findListedSuburb, resolveEventCoordinates, type SuburbLookup } from "./geo";
import type { SheltuhEvent } from "./types";

/** "Similar nearby" on an event page: events of the same category within this many kilometres of it. */
export const SIMILAR_RADIUS_KM = 25;

/** An event page's rows ("More from {organiser}", "Similar nearby") show at most this many cards: one row of four on desktop. */
export const EVENT_ROW_MAX = 4;

/** Whether two events are by the same organiser: the id when both have one (live), else the name (the demo's samples). */
function sameOrganiser(a: SheltuhEvent, b: SheltuhEvent): boolean {
  if (a.organiserId && b.organiserId) return a.organiserId === b.organiserId;
  return a.organiserName.trim().toLowerCase() === b.organiserName.trim().toLowerCase();
}

/** Not ended by `now` (an event with no end ends when it starts). */
function upcoming(event: SheltuhEvent, now: Date): boolean {
  return Date.parse(event.endsAt ?? event.startsAt) > now.getTime();
}

/**
 * "Similar nearby" for `current`: other upcoming events in its category within SIMILAR_RADIUS_KM, soonest
 * first, at most EVENT_ROW_MAX. Positions are an event's own coordinates, else its suburb's centre from the
 * hand-entered Melbourne list (lib/geo.ts `findListedSuburb`), so the page never loads the Australia-wide
 * suburb table for this. An event that can't be placed is left out; if `current` itself can't be placed,
 * nothing is near it. Events by the same organiser are left out too: "More from {organiser}" shows those.
 * Pure: doesn't change `candidates`.
 */
export function similarNearby(
  current: SheltuhEvent,
  candidates: readonly SheltuhEvent[],
  now: Date,
  findSuburb: SuburbLookup = findListedSuburb,
): SheltuhEvent[] {
  const origin = resolveEventCoordinates(current, findSuburb);
  if (!origin) return [];
  const seen = new Set<string>([current.id]);
  const near: SheltuhEvent[] = [];
  for (const event of candidates) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.category !== current.category || sameOrganiser(event, current) || !upcoming(event, now)) continue;
    const position = resolveEventCoordinates(event, findSuburb);
    if (position && distanceKm(origin, position) <= SIMILAR_RADIUS_KM) near.push(event);
  }
  return near.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, EVENT_ROW_MAX);
}

/**
 * "More from {organiser}": the organiser's other upcoming events (their profile's list, soonest first),
 * without `current`, at most EVENT_ROW_MAX.
 */
export function moreFromOrganiser(current: Pick<SheltuhEvent, "id">, upcomingEvents: readonly SheltuhEvent[], now: Date): SheltuhEvent[] {
  return upcomingEvents.filter((event) => event.id !== current.id && upcoming(event, now)).slice(0, EVENT_ROW_MAX);
}
