import { isApiConfigured, type GetToken } from "@/lib/api/client";
import { listFollowingEvents } from "@/lib/api/follows";
import { listPublicEvents } from "@/lib/api/public-events";
import { getTrendingEvents } from "@/lib/api/trending";
import { getEvents, getUpcomingEvents, isUpcomingEvent } from "@/lib/data";
import { bySoonest, latestWeekendEnd, type TrendingItem } from "@/lib/home-sections";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { byRecentlyEnded, isRecentlyEnded } from "@/lib/recent-events";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";

/** Live: one page of upcoming events, enough for every home section (the server caps `limit` at 50). */
export const HOME_EVENT_LIMIT = 40;
/** Live: the weekend top-up's page size (the server's maximum). */
export const HOME_WEEKEND_TOP_UP_LIMIT = 50;
/** Live: at most this many top-up requests after the first page, so a very busy week can't fan out unbounded. */
export const HOME_WEEKEND_TOP_UP_MAX_PAGES = 4;
/** Live: how many followed organisers' events to ask for (the rail shows at most 6 once de-duplicated). */
export const HOME_FOLLOWING_LIMIT = 12;
/** Demo: how many sample events "trend". */
const DEMO_TRENDING_MAX = 12;

const notEnded = (now: Date) => (event: SheltuhEvent) => isUpcomingEvent(event, now);

/**
 * The home page's events that haven't ended, soonest first (docs/design/home.md
 * §6.1). Live: one request for upcoming events; then, while the last loaded
 * event starts no later than the weekend's end (the latest in any zone: each
 * event's weekend is its own, latestWeekendEnd) and there's a next cursor,
 * follow that cursor page by page (at most HOME_WEEKEND_TOP_UP_MAX_PAGES more
 * requests), merged by id. Following the cursor rather than jumping to the
 * weekend's first day keeps events that start before the weekend but are
 * still running over it ("This weekend" includes multi-week events). Demo:
 * the sample events. Either way, events that have ended by `now` are dropped
 * (demo data includes past events, and a tab can stay open for a long time).
 */
export async function loadHomeEvents(now: Date): Promise<SheltuhEvent[]> {
  if (!isApiConfigured) {
    return (await getUpcomingEvents(now)).filter(notEnded(now)).sort(bySoonest);
  }

  const weekendEnd = latestWeekendEnd(now);
  const byId = new Map<string, SheltuhEvent>();
  let page = await listPublicEvents({ upcoming: true, limit: HOME_EVENT_LIMIT });
  for (let topUps = 0; ; topUps += 1) {
    for (const item of page.items) if (!byId.has(item.eventId)) byId.set(item.eventId, adaptPublicEvent(item));
    const last = page.items.at(-1);
    const lastStart = last ? Date.parse(last.startsAt) : Infinity;
    // Past the weekend's end, or everything is loaded, or the cap is reached: stop.
    if (!page.nextCursor || lastStart > weekendEnd || topUps >= HOME_WEEKEND_TOP_UP_MAX_PAGES) break;
    page = await listPublicEvents({ upcoming: true, limit: HOME_WEEKEND_TOP_UP_LIMIT, cursor: page.nextCursor });
  }
  return [...byId.values()].filter(notEnded(now)).sort(bySoonest);
}

/** "Recently on" shows at most this many (the rail's size); the server is asked for just them. */
export const HOME_RECENT_LIMIT = 6;

/**
 * Events that ended within the last 14 days (RECENT_EVENT_DAYS), most recently
 * ended first, for "Recently on" (the API's `recent=only`; demo: the sample
 * events). Those that fell outside the window by `now` are dropped.
 */
export async function loadHomeRecent(now: Date): Promise<SheltuhEvent[]> {
  const recent = (event: SheltuhEvent) => isRecentlyEnded(event, now);
  if (!isApiConfigured) return (await getEvents()).filter(recent).sort(byRecentlyEnded);
  const page = await listPublicEvents({ upcoming: true, recent: "only", limit: HOME_RECENT_LIMIT });
  return page.items.map(adaptPublicEvent).filter(recent).sort(byRecentlyEnded);
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
