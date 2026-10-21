import { isApiConfigured, type GetToken } from "@/lib/api/client";
import { listFollowingEvents } from "@/lib/api/follows";
import { listPublicEvents } from "@/lib/api/public-events";
import { getTrendingEvents } from "@/lib/api/trending";
import { formatEventDateKey } from "@/lib/format";
import { getUpcomingEvents, isUpcomingEvent } from "@/lib/data";
import { bySoonest, weekendWindow, type TrendingItem } from "@/lib/home-sections";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";

/** Live: one page of upcoming events, enough for every home section (the server caps `limit` at 50). */
export const HOME_EVENT_LIMIT = 40;
/** Live: the weekend top-up's page size. */
export const HOME_WEEKEND_TOP_UP_LIMIT = 20;
/** Live: how many followed organisers' events to ask for (the rail shows at most 6 once de-duplicated). */
export const HOME_FOLLOWING_LIMIT = 12;
/** Demo: how many sample events "trend". */
const DEMO_TRENDING_MAX = 12;

const notEnded = (now: Date) => (event: SheltuhEvent) => isUpcomingEvent(event, now);

/**
 * The home page's events that haven't ended, soonest first (docs/design/home.md
 * §6.1). Live: one request for upcoming events, and at most one more when that
 * page has more and stops short of the weekend's end: from the weekend's first
 * day if the page's last event starts before the weekend does, or the page's
 * next cursor if it starts inside the weekend; merged by id. Demo: the sample
 * events. Either way, events that have ended by `now` are dropped (demo data
 * includes past events, and a tab can stay open for a long time).
 */
export async function loadHomeEvents(now: Date): Promise<SheltuhEvent[]> {
  if (!isApiConfigured) {
    return (await getUpcomingEvents(now)).filter(notEnded(now)).sort(bySoonest);
  }

  const page = await listPublicEvents({ upcoming: true, limit: HOME_EVENT_LIMIT });
  const byId = new Map(page.items.map((item) => [item.eventId, adaptPublicEvent(item)]));
  const last = page.items.at(-1);
  const window = weekendWindow(now);
  const lastStart = last ? Date.parse(last.startsAt) : Infinity;
  // The page already reaches past the weekend (or is everything): nothing more to fetch.
  if (page.nextCursor && lastStart <= window.end) {
    const topUp = await listPublicEvents(
      lastStart < window.start
        ? // The page stops before the weekend: jump to its first day.
          { upcoming: true, onOrAfter: formatEventDateKey(new Date(window.start).toISOString()), limit: HOME_WEEKEND_TOP_UP_LIMIT }
        : // The page stops inside the weekend: carry on from where it ended.
          { upcoming: true, limit: HOME_WEEKEND_TOP_UP_LIMIT, cursor: page.nextCursor },
    );
    for (const item of topUp.items) if (!byId.has(item.eventId)) byId.set(item.eventId, adaptPublicEvent(item));
  }
  return [...byId.values()].filter(notEnded(now)).sort(bySoonest);
}

/**
 * Trending events, in the order to show them. Live: the trending API, in the
 * server's order (empty when fewer than 3 qualify), minus anything that has
 * ended by `now` (the response can be a few minutes old); "going" carries the
 * server's thresholded count, never a raw one. Demo: the sample events with
 * the most people going (ties: soonest first), labelled with their sample count.
 */
export async function loadHomeTrending(now: Date): Promise<TrendingItem[]> {
  if (isApiConfigured) {
    const { items } = await getTrendingEvents();
    return items
      .map((item): TrendingItem => ({
        event: adaptPublicEvent(item.event),
        signal:
          item.label === "going" && typeof item.goingCount === "number"
            ? { kind: "going", count: item.goingCount }
            : item.label === "just-announced"
              ? { kind: "just-announced" }
              : { kind: "popular" },
      }))
      .filter((item) => notEnded(now)(item.event));
  }
  const upcoming = (await getUpcomingEvents(now)).filter(notEnded(now));
  return upcoming
    .map((event) => ({ event, count: getSampleGoing(event.id).count }))
    .sort((a, b) => b.count - a.count || bySoonest(a.event, b.event))
    .slice(0, DEMO_TRENDING_MAX)
    .map(({ event, count }) => ({ event, signal: { kind: "going", count } }));
}

/**
 * A signed-in member's followed organisers' upcoming events, soonest first,
 * for "From organisers you follow" (live only; the demo has no accounts).
 * Events that have ended by `now` are dropped.
 */
export async function loadHomeFollowing(getToken: GetToken, now: Date): Promise<SheltuhEvent[]> {
  const page = await listFollowingEvents(getToken, { limit: HOME_FOLLOWING_LIMIT });
  return page.items.map(adaptPublicEvent).filter(notEnded(now)).sort(bySoonest);
}
