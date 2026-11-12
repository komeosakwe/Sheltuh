import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { getUpcomingEvents, isUpcomingEvent } from "@/lib/data";
import { categoryLabel } from "@/lib/event-card";
import { distanceKm } from "@/lib/geo";
import { bySoonest } from "@/lib/home-sections";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { StateCode } from "@/lib/time-zones";
import type { Coordinates, SheltuhEvent } from "@/lib/types";

/**
 * /community's data (redesign PR 3), from what is real: the upcoming events, and how many of them
 * are in each city. No members, scenes or follows: those wait for Batch 3.
 */

/** Live: the page size (the server's maximum). */
export const COMMUNITY_PAGE_LIMIT = 50;
/** Live: at most this many pages are read, so a busy site can't fan out unbounded. */
export const COMMUNITY_MAX_PAGES = 4;

export interface CommunityFeed {
  /** Upcoming events, soonest first. */
  events: SheltuhEvent[];
  /** Every upcoming event was read (demo: always; live: the last page had no next cursor), so counts are whole. */
  complete: boolean;
}

/**
 * Every upcoming event, soonest first. Live: pages of the public list, following the cursor up to
 * COMMUNITY_MAX_PAGES; demo: the sample events. Events that have ended by `now` are dropped.
 */
export async function loadCommunityEvents(now: Date): Promise<CommunityFeed> {
  const notEnded = (event: SheltuhEvent) => isUpcomingEvent(event, now);
  if (!isApiConfigured) return { events: (await getUpcomingEvents(now)).filter(notEnded).sort(bySoonest), complete: true };
  const byId = new Map<string, SheltuhEvent>();
  let cursor: string | undefined;
  for (let page = 0; page < COMMUNITY_MAX_PAGES; page += 1) {
    const result = await listPublicEvents({ upcoming: true, limit: COMMUNITY_PAGE_LIMIT, cursor });
    for (const item of result.items) if (!byId.has(item.eventId)) byId.set(item.eventId, adaptPublicEvent(item));
    cursor = result.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return { events: [...byId.values()].filter(notEnded).sort(bySoonest), complete: !cursor };
}

export interface CommunityCity {
  /** As shown, and as stored for Nearby ("Melbourne"). */
  name: string;
  state: StateCode;
  /** The city centre (its GPO), for the distance test. */
  centre: Coordinates;
}

/** The proposal's Scenes by city, in its order. */
export const COMMUNITY_CITIES: readonly CommunityCity[] = [
  { name: "Melbourne", state: "VIC", centre: { lat: -37.8136, lng: 144.9631 } },
  { name: "Sydney", state: "NSW", centre: { lat: -33.8688, lng: 151.2093 } },
  { name: "Brisbane", state: "QLD", centre: { lat: -27.4698, lng: 153.0251 } },
  { name: "Perth", state: "WA", centre: { lat: -31.9523, lng: 115.8613 } },
  { name: "Adelaide", state: "SA", centre: { lat: -34.9285, lng: 138.6007 } },
];

/** An event counts towards a city within this distance of its centre (Nearby's default radius). */
export const CITY_RADIUS_KM = 25;
/** A city's line lists at most this many of its categories. */
const CITY_CATEGORIES_MAX = 3;

export interface CityScene {
  city: CommunityCity;
  /** The city's upcoming events, soonest first. */
  events: SheltuhEvent[];
  /** Their categories' labels, most events first (ties: the label), at most three. */
  categories: string[];
}

/**
 * Each city's upcoming events: those whose position (`positionOf`: the venue's pin, else its
 * suburb's centre) is within CITY_RADIUS_KM of the city's centre. An event that can't be placed
 * counts nowhere. Pure.
 */
export function cityScenes(
  events: readonly SheltuhEvent[],
  positionOf: (event: SheltuhEvent) => Coordinates | null,
): CityScene[] {
  const placed = events.map((event) => ({ event, position: positionOf(event) }));
  return COMMUNITY_CITIES.map((city) => {
    const near = placed
      .filter(({ position }) => position !== null && distanceKm(city.centre, position) <= CITY_RADIUS_KM)
      .map(({ event }) => event)
      .sort(bySoonest);
    const tally = new Map<string, number>();
    for (const event of near) tally.set(categoryLabel(event), (tally.get(categoryLabel(event)) ?? 0) + 1);
    const categories = [...tally]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, CITY_CATEGORIES_MAX)
      .map(([label]) => label);
    return { city, events: near, categories };
  });
}
