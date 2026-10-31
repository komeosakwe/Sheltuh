import { isUpcomingEvent } from "@/lib/data";
import { eventZone } from "@/lib/format";
import { byRecentlyEnded, isRecentlyEnded } from "@/lib/recent-events";
import {
  cachedDateTimeFormat,
  localToUtcIso,
  PLATFORM_TIME_ZONE,
  wallClockParts,
  ZONES_BY_STATE,
  type StateCode,
} from "@/lib/time-zones";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The home page's sections (docs/design/mobile-redesign.md §6.3): which
 * events each section shows, so that every event appears at most once on the
 * page.
 */

/** Cards per section at most (grids fill 3×2 or 2×3). */
const SECTION_MAX = 6;
/** "Popular right now" shows only with at least this many trending events left after de-duplication. */
export const TRENDING_MIN = 3;

/** Why an event is trending. Never a raw view count, and a going count only when the server sends one. */
export type TrendingSignal = { kind: "going"; count: number } | { kind: "just-announced" } | { kind: "popular" };

export interface TrendingItem {
  event: SheltuhEvent;
  signal: TrendingSignal;
}

/**
 * The home's third slot (mobile-redesign.md §6.3.1): "Popular right now" from
 * real trending data, or, when that's too thin, "Coming up" with the soonest
 * events left (even one: a young marketplace has few). Events that aren't trending are never called popular.
 */
export type PopularSection =
  | { kind: "popular"; items: TrendingItem[] }
  /** `acrossAustralia`: a state was chosen and none of these is in it. */
  | { kind: "coming"; items: SheltuhEvent[]; acrossAustralia: boolean };

/**
 * A weekend in one zone's wall clock, as UTC instants (ms): the platform's
 * (Australia/Melbourne) for the heading, or an event's own (weekendWindow).
 */
export interface WeekendWindow {
  start: number;
  end: number;
  /** It's already the weekend (Fri 17:00 or later): the window starts now. */
  during: boolean;
}

export interface HomeSections {
  /** Any event at all hasn't ended (false: the site has nothing upcoming, so the page says so). */
  anyUpcoming: boolean;
  weekend: {
    window: WeekendWindow;
    /** `cards`: show them. `hidden`: render nothing (Coming up shows what's next). */
    status: "cards" | "hidden";
    items: SheltuhEvent[];
  };
  /**
   * "From organisers you follow" (signed-in members who follow someone):
   * upcoming events of followed organisers not already above. Empty when
   * there are none (hidden).
   */
  following: SheltuhEvent[];
  /** Popular right now, or its Coming up fallback; null when nothing is left to show. */
  popular: PopularSection | null;
  /**
   * "Recently on": events that ended within the last 14 days (RECENT_EVENT_DAYS), most
   * recently ended first, after every other section and not repeated from one. Still
   * openable; nothing to buy. Empty when there are none (hidden).
   */
  recent: SheltuhEvent[];
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The calendar date `days` after a yyyy-mm-dd (calendar arithmetic, no clock involved). */
function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The Sunday (yyyy-mm-dd) that ends this weekend in the platform's calendar:
 * today on a Sunday, otherwise the coming one. From Monday 00:00 it's next
 * week's.
 */
function platformSunday(nowMs: number): string {
  const weekday = WEEKDAY[cachedDateTimeFormat("en-US", { timeZone: PLATFORM_TIME_ZONE, weekday: "short" }).format(nowMs)] ?? 0;
  return addDays(wallClockParts(new Date(nowMs), PLATFORM_TIME_ZONE).date, weekday === 0 ? 0 : 7 - weekday);
}

/**
 * The instant `time` ("HH:mm") on `date` shows in `timeZone`, plus `ms`.
 * DST-safe (localToUtcIso); Fri 17:00 and Sun 23:59 are never in an hour a
 * clock change skips or repeats in an Australian zone (those are 2–3 am).
 */
function zonedInstant(date: string, time: string, timeZone: string, ms = 0): number {
  return Date.parse(localToUtcIso(date, time, timeZone)) + ms;
}

/**
 * "This weekend" (docs/design/home.md §6.3) in `timeZone`'s wall clock
 * (the platform's, Melbourne, by default): the weekend the home's heading
 * names (Melbourne's dates), from that Friday 17:00 to Sunday 23:59:59.999
 * local to the zone. Before Friday 17:00 there: not yet `during`. From
 * then: `during`, starting now. A Perth event's weekend runs to Sunday
 * midnight in Perth, three hours after Melbourne's in summer.
 *
 * The dates are always the platform's, so every zone's window is the same
 * weekend as the heading: where the zone's Sunday ends before now (Norfolk
 * Island, an hour ahead, late on a Melbourne Sunday) the window is empty
 * (`start` after `end`).
 */
export function weekendWindow(now: Date, timeZone: string = PLATFORM_TIME_ZONE): WeekendWindow {
  const nowMs = now.getTime();
  const sunday = platformSunday(nowMs);
  const end = zonedInstant(sunday, "23:59", timeZone, 59_999);
  const fridayEvening = zonedInstant(addDays(sunday, -2), "17:00", timeZone);
  const during = nowMs >= fridayEvening;
  return { start: during ? nowMs : fridayEvening, end, during };
}

/** Every zone an Australian event may use (lib/time-zones.ts ZONES_BY_STATE), once each. */
const ALL_ZONES: readonly string[] = [...new Set<string>(Object.values(ZONES_BY_STATE).flat())];

/**
 * The latest end of this weekend in any zone an event may use: the Cocos
 * (Keeling) Islands' Sunday midnight, 4½ hours after Melbourne's in summer.
 * Loading events up to it reaches every event's own weekend.
 */
export function latestWeekendEnd(now: Date): number {
  return Math.max(...ALL_ZONES.map((zone) => weekendWindow(now, zone).end));
}

/** Whether `event` is open at any time during `window`: never for an empty window (its weekend is over there). */
function openDuring(event: SheltuhEvent, window: WeekendWindow): boolean {
  return window.start <= window.end && startMs(event) <= window.end && endMs(event) >= window.start;
}

const dayFormatter = cachedDateTimeFormat("en-AU", { timeZone: PLATFORM_TIME_ZONE, weekday: "short", day: "numeric" });
const monthFormatter = cachedDateTimeFormat("en-AU", { timeZone: PLATFORM_TIME_ZONE, month: "short" });
const parts = (instant: number) => {
  const date = new Date(instant);
  const dp = Object.fromEntries(dayFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${dp.weekday} ${dp.day}`, month: monthFormatter.format(date) };
};

/**
 * This weekend's note: "Fri 23 – Sun 25 Oct", "Fri 30 Oct – Sun 1 Nov"
 * across months, and "Until Sun 25 Oct" once the weekend has started.
 */
export function formatWeekendRange(window: WeekendWindow): string {
  const end = parts(window.end);
  if (window.during) return `Until ${end.day} ${end.month}`;
  // The window starts at Friday 17:00, so its start is always the Friday.
  const start = parts(window.start);
  return start.month === end.month
    ? `${start.day} – ${end.day} ${end.month}`
    : `${start.day} ${start.month} – ${end.day} ${end.month}`;
}

const startMs = (event: SheltuhEvent) => Date.parse(event.startsAt);
const endMs = (event: SheltuhEvent) => Date.parse(event.endsAt ?? event.startsAt);

/** Soonest start first; ties by id, so the order is stable. The home's one event order. */
export const bySoonest = (a: SheltuhEvent, b: SheltuhEvent) => startMs(a) - startMs(b) || a.id.localeCompare(b.id);

/**
 * `items` with those whose event is in `state` first, each part in its own
 * order (a stable reorder; an event without a state is Victorian). No state:
 * `items` as they are. Owner decision D5: the visitor's saved suburb's state
 * first, worked out in the browser only.
 */
export function preferState<T>(items: T[], state: StateCode | null | undefined, eventOf: (item: T) => SheltuhEvent): T[] {
  if (!state) return items;
  const inState = (item: T) => (eventOf(item).state ?? "VIC") === state;
  return [...items.filter(inState), ...items.filter((item) => !inState(item))];
}

const itself = (event: SheltuhEvent) => event;

/**
 * Splits the home page's events into its sections (docs/design/home.md §6.2,
 * docs/design/mobile-redesign.md §6.3.2). Ended events are dropped first.
 * Sections then claim events in priority order (This weekend, From
 * organisers you follow, then Popular right now or its Coming up fallback),
 * and a later section never shows an event an earlier one did. A section
 * that's hidden for having too few events claims nothing. `following`: the
 * signed-in member's followed organisers' upcoming events (empty otherwise).
 * `preferredState`: the state of the visitor's saved suburb, whose events
 * come first in every section (preferState), before each section takes its
 * share; absent, Australia-wide soonest first (owner decision D5).
 * `recent`: events that have ended, for the last section ("Recently on"):
 * only those ended within RECENT_EVENT_DAYS are kept, and never one a
 * section above shows. Ended events never enter any other section.
 */
export function selectHomeSections(
  events: SheltuhEvent[],
  trending: TrendingItem[],
  now: Date,
  following: SheltuhEvent[] = [],
  preferredState: StateCode | null = null,
  recent: SheltuhEvent[] = [],
): HomeSections {
  const nowMs = now.getTime();
  const upcoming = events.filter((event) => isUpcomingEvent(event, now)).sort(bySoonest);
  const notStarted = upcoming.filter((event) => startMs(event) > nowMs);

  const claimed = new Set<string>();
  const unclaimed = (event: SheltuhEvent) => !claimed.has(event.id);
  const claim = (list: SheltuhEvent[]) => list.forEach((event) => claimed.add(event.id));

  // 1. This weekend: anything open during the window (owner decision 5), each event's in its own
  // zone (a Perth gig at 11 pm on Sunday is this weekend). Events starting inside it come first, by
  // start; then events already running when it opens (exhibitions), by start. The heading, and
  // whether the weekend is on (`during`), are the platform's.
  const window = weekendWindow(now);
  const windows = new Map<string, WeekendWindow>([[PLATFORM_TIME_ZONE, window]]);
  const windowOf = (event: SheltuhEvent): WeekendWindow => {
    const zone = eventZone(event.timeZone);
    let zoneWindow = windows.get(zone);
    if (!zoneWindow) {
      zoneWindow = weekendWindow(now, zone);
      windows.set(zone, zoneWindow);
    }
    return zoneWindow;
  };
  const overlapping = upcoming.filter((event) => openDuring(event, windowOf(event)));
  const alreadyRunning = (event: SheltuhEvent) => (startMs(event) < windowOf(event).start ? 1 : 0);
  const weekendItems = preferState(
    overlapping.filter(unclaimed).sort((a, b) => alreadyRunning(a) - alreadyRunning(b) || bySoonest(a, b)),
    preferredState,
    itself,
  ).slice(0, SECTION_MAX);
  // Nothing on: hide (Coming up shows what's next).
  const weekendStatus = weekendItems.length > 0 ? "cards" : "hidden";
  claim(weekendItems);

  // 1b. From organisers you follow: soonest first, shown with even one event (the member asked for them).
  const followingItems = preferState(
    following
      .filter((event) => isUpcomingEvent(event, now) && unclaimed(event))
      .sort(bySoonest)
      .filter((event, index, list) => list.findIndex((other) => other.id === event.id) === index),
    preferredState,
    itself,
  ).slice(0, SECTION_MAX);
  claim(followingItems);

  // 2. Popular right now: trending, in the server's order, with three or more left. Otherwise the
  // same slot is "Coming up": soonest first (not yet started, then any still running), with even one.
  const trendingLeft = preferState(
    trending.filter(({ event }) => isUpcomingEvent(event, now) && unclaimed(event)),
    preferredState,
    (item) => item.event,
  ).slice(0, SECTION_MAX);
  const running = upcoming.filter((event) => startMs(event) <= nowMs);
  const comingLeft = preferState([...notStarted, ...running].filter(unclaimed), preferredState, itself).slice(0, SECTION_MAX);
  const popular: PopularSection | null =
    trendingLeft.length >= TRENDING_MIN
      ? { kind: "popular", items: trendingLeft }
      : comingLeft.length > 0
        ? {
            kind: "coming",
            items: comingLeft,
            acrossAustralia: preferredState !== null && comingLeft.every((event) => (event.state ?? "VIC") !== preferredState),
          }
        : null;

  claim(popularEvents(popular));

  // 3. Recently on: ended in the last 14 days, most recently ended first; last, after everything upcoming.
  const recentItems = preferState(
    recent
      .filter((event) => isRecentlyEnded(event, now) && unclaimed(event))
      .sort(byRecentlyEnded)
      .filter((event, index, list) => list.findIndex((other) => other.id === event.id) === index),
    preferredState,
    itself,
  ).slice(0, SECTION_MAX);

  return {
    anyUpcoming: upcoming.length > 0,
    weekend: { window, status: weekendStatus, items: weekendItems },
    following: followingItems,
    popular,
    recent: recentItems,
  };
}

/** Every event id the sections show, in page order (for checks that nothing repeats). */
export function shownEventIds(sections: HomeSections): string[] {
  return [
    ...sections.weekend.items.map((event) => event.id),
    ...sections.following.map((event) => event.id),
    ...popularEvents(sections.popular).map((event) => event.id),
    ...sections.recent.map((event) => event.id),
  ];
}

/** The events in the popular slot, whichever kind it is. */
export function popularEvents(popular: PopularSection | null): SheltuhEvent[] {
  if (!popular) return [];
  return popular.kind === "popular" ? popular.items.map(({ event }) => event) : popular.items;
}
