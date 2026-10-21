import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { formatEventDateKey } from "@/lib/format";
import { getUpcomingEvents } from "@/lib/data";
import { weekendWindow, type TrendingItem } from "@/lib/home-sections";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";

/** Live: one page of upcoming events, enough for every home section (the server caps `limit` at 50). */
export const HOME_EVENT_LIMIT = 40;
/** Live: the weekend top-up's page size. */
export const HOME_WEEKEND_TOP_UP_LIMIT = 20;
/** Demo: how many sample events "trend". */
const DEMO_TRENDING_MAX = 12;

const bySoonest = (a: SheltuhEvent, b: SheltuhEvent) => a.startsAt.localeCompare(b.startsAt);
const notEnded = (now: Date) => (event: SheltuhEvent) => Date.parse(event.endsAt ?? event.startsAt) > now.getTime();

/**
 * The home page's events that haven't ended, soonest first (docs/design/home.md
 * §6.1). Live: one request for upcoming events; if that page stops before the
 * weekend is over, one more from the weekend's first day, merged by id. Demo:
 * the sample events. Either way, events that have ended by `now` are dropped
 * (demo data includes past events, and a tab can stay open for a long time).
 */
export async function loadHomeEvents(now: Date): Promise<SheltuhEvent[]> {
  if (!isApiConfigured) {
    return (await getUpcomingEvents(now)).filter(notEnded(now)).sort(bySoonest);
  }

  const page = await listPublicEvents({ upcoming: true, limit: HOME_EVENT_LIMIT });
  const byId = new Map(page.items.map((item) => [item.eventId, adaptPublicEvent(item)]));
  const last = page.items.at(-1);
  const window = weekendWindow(now);
  if (page.nextCursor && last && Date.parse(last.startsAt) < window.end) {
    const topUp = await listPublicEvents({
      upcoming: true,
      onOrAfter: formatEventDateKey(new Date(window.start).toISOString()),
      limit: HOME_WEEKEND_TOP_UP_LIMIT,
    });
    for (const item of topUp.items) if (!byId.has(item.eventId)) byId.set(item.eventId, adaptPublicEvent(item));
  }
  return [...byId.values()].filter(notEnded(now)).sort(bySoonest);
}

/**
 * Trending events, in the order to show them. Live: none yet. There's no
 * trending API (B4 in docs/design/home.md §9), so the section stays hidden;
 * it's never filled with made-up data. Demo: the sample events with the most
 * people going (ties: soonest first), labelled with their sample count.
 */
export async function loadHomeTrending(now: Date): Promise<TrendingItem[]> {
  if (isApiConfigured) return [];
  const upcoming = (await getUpcomingEvents(now)).filter(notEnded(now));
  return upcoming
    .map((event) => ({ event, count: getSampleGoing(event.id).count }))
    .sort((a, b) => b.count - a.count || bySoonest(a.event, b.event))
    .slice(0, DEMO_TRENDING_MAX)
    .map(({ event, count }) => ({ event, signal: { kind: "going", count } }));
}
