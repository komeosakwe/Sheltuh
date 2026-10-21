import { isUpcomingEvent } from "@/lib/data";
import { getMinBuyerTotalCents } from "@/lib/pricing";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The home page's sections (docs/design/home.md §6): which events each
 * section shows, so that every event appears at most once on the page.
 */

/** Cards per section at most (grids fill 3×2 or 2×3). */
const SECTION_MAX = 6;
/** "Free & low-cost": the cheapest all-inclusive ticket is at most this (A$20). */
export const LOW_COST_MAX_CENTS = 2000;
/** Trending shows only with at least this many events left after de-duplication. */
export const TRENDING_MIN = 3;
/** Coming up and Free & low-cost show only with at least this many events. */
const RAIL_MIN = 2;

/** Why an event is trending. Never a raw view count, and a going count only when the server sends one. */
export type TrendingSignal = { kind: "going"; count: number } | { kind: "just-announced" } | { kind: "popular" };

export interface TrendingItem {
  event: SheltuhEvent;
  signal: TrendingSignal;
}

export interface LowCostItem {
  event: SheltuhEvent;
  badge: "free" | "low-cost";
}

/** Australia/Melbourne wall-clock weekend, as UTC instants (ms). */
export interface WeekendWindow {
  start: number;
  end: number;
  /** It's already the weekend (Fri 17:00 or later): the window starts now. */
  during: boolean;
}

export interface HomeSections {
  /** "Up next": the soonest event that hasn't started, else the soonest in progress. */
  upNext?: SheltuhEvent;
  weekend: {
    window: WeekendWindow;
    /** `cards`: show them. `empty`: the heading and "Nothing listed" (before the weekend only). `hidden`: render nothing. */
    status: "cards" | "empty" | "hidden";
    items: SheltuhEvent[];
  };
  /** Empty when hidden (fewer than three after de-duplication). */
  trending: TrendingItem[];
  /** Empty when hidden (fewer than two). */
  comingUp: SheltuhEvent[];
  /** Empty when hidden (fewer than two). */
  lowCost: LowCostItem[];
}

const MELBOURNE_TZ = "Australia/Melbourne";
const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MELBOURNE_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface WallClock {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

/** `instant`'s Melbourne wall-clock time. */
function melbourneWallClock(instant: number): WallClock {
  const parts = Object.fromEntries(partsFormatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY[parts.weekday] ?? 0,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * The UTC instant of a Melbourne wall-clock time, DST-safe: the offset is
 * read at a first guess and re-read at the result, which settles across a
 * change of offset. (The times used here, Fri 17:00 and Sun 23:59, are never
 * in the hour a clock change skips or repeats: those are Sunday 2–3 am.)
 */
function melbourneToUtc(year: number, month: number, day: number, hour: number, minute: number, ms: number): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute) + ms;
  // Melbourne's offset from UTC at an instant (whole seconds: the wall clock has no milliseconds).
  const offsetAt = (instant: number) => {
    const c = melbourneWallClock(instant);
    return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - Math.floor(instant / 1000) * 1000;
  };
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

/** The calendar date `days` after a Melbourne date (calendar arithmetic, no clock involved). */
function addDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * "This weekend" in Melbourne (docs/design/home.md §6.3). Monday 00:00 to
 * Friday 16:59:59: this week's Friday 17:00 to Sunday 23:59:59.999. From
 * Friday 17:00 to Sunday night: now until Sunday 23:59:59.999.
 */
export function weekendWindow(now: Date): WeekendWindow {
  const nowMs = now.getTime();
  const c = melbourneWallClock(nowMs);
  const during = c.weekday === 6 || c.weekday === 0 || (c.weekday === 5 && c.hour >= 17);
  // Days from today to this weekend's Sunday (Sunday itself is the end of the weekend that's on).
  const toSunday = c.weekday === 0 ? 0 : 7 - c.weekday;
  const sunday = addDays(c.year, c.month, c.day, toSunday);
  const end = melbourneToUtc(sunday.year, sunday.month, sunday.day, 23, 59, 59_999);
  if (during) return { start: nowMs, end, during };
  const friday = addDays(sunday.year, sunday.month, sunday.day, -2);
  return { start: melbourneToUtc(friday.year, friday.month, friday.day, 17, 0, 0), end, during };
}

const dayFormatter = new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE_TZ, weekday: "short", day: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE_TZ, month: "short" });
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
 * Splits the home page's events into its sections (docs/design/home.md §6.2).
 * Ended events are dropped first. Sections then claim events in priority
 * order (Up next, This weekend, Trending, Coming up, Free & low-cost), and a
 * later section never shows an event an earlier one did. A section that's
 * hidden for having too few events claims nothing, so its events stay
 * available to the sections after it.
 */
export function selectHomeSections(events: SheltuhEvent[], trending: TrendingItem[], now: Date): HomeSections {
  const nowMs = now.getTime();
  const upcoming = events.filter((event) => isUpcomingEvent(event, now)).sort(bySoonest);
  const notStarted = upcoming.filter((event) => startMs(event) > nowMs);

  const claimed = new Set<string>();
  const unclaimed = (event: SheltuhEvent) => !claimed.has(event.id);
  const claim = (list: SheltuhEvent[]) => list.forEach((event) => claimed.add(event.id));

  // 1. Up next: not yet started first, so a long-running exhibition doesn't win it for weeks.
  const upNext = notStarted[0] ?? upcoming[0];
  if (upNext) claim([upNext]);

  // 2. This weekend: anything open during the window (owner decision 5). Events starting inside
  // it come first, by start; then events already running when it opens (exhibitions), by start.
  const window = weekendWindow(now);
  const overlapping = upcoming.filter((event) => startMs(event) <= window.end && endMs(event) >= window.start);
  const alreadyRunning = (event: SheltuhEvent) => (startMs(event) < window.start ? 1 : 0);
  const weekendItems = overlapping
    .filter(unclaimed)
    .sort((a, b) => alreadyRunning(a) - alreadyRunning(b) || bySoonest(a, b))
    .slice(0, SECTION_MAX);
  // All of the weekend already in Up next: it's on screen above, so hide. Nothing on and the
  // weekend has started: hide (Coming up shows what's next). Nothing on yet: say so.
  const weekendStatus = weekendItems.length > 0 ? "cards" : overlapping.length > 0 || window.during ? "hidden" : "empty";
  claim(weekendItems);

  // 3. Trending, in the server's order.
  const trendingLeft = trending
    .filter(({ event }) => isUpcomingEvent(event, now) && unclaimed(event))
    .slice(0, SECTION_MAX);
  const trendingItems = trendingLeft.length >= TRENDING_MIN ? trendingLeft : [];
  claim(trendingItems.map(({ event }) => event));

  // 4. Coming up: not yet started, soonest first.
  const comingLeft = notStarted.filter(unclaimed).slice(0, SECTION_MAX);
  const comingUp = comingLeft.length >= RAIL_MIN ? comingLeft : [];
  claim(comingUp);

  // 5. Free & low-cost: an all-inclusive A$20 or less, or an external event its organiser says is
  // free. An external paid event has no price we can vouch for, so it's never "low-cost".
  const lowLeft = upcoming
    .filter(unclaimed)
    .flatMap((event): LowCostItem[] => {
      if (event.ticketingMode === "external") return event.externalFree ? [{ event, badge: "free" }] : [];
      const cents = getMinBuyerTotalCents(event);
      if (cents === null || cents > LOW_COST_MAX_CENTS) return [];
      return [{ event, badge: cents === 0 ? "free" : "low-cost" }];
    })
    .slice(0, SECTION_MAX);
  const lowCost = lowLeft.length >= RAIL_MIN ? lowLeft : [];

  return {
    upNext,
    weekend: { window, status: weekendStatus, items: weekendItems },
    trending: trendingItems,
    comingUp,
    lowCost,
  };
}

/** Every event id the sections show, in page order (for checks that nothing repeats). */
export function shownEventIds(sections: HomeSections): string[] {
  return [
    ...(sections.upNext ? [sections.upNext.id] : []),
    ...sections.weekend.items.map((event) => event.id),
    ...sections.trending.map(({ event }) => event.id),
    ...sections.comingUp.map((event) => event.id),
    ...sections.lowCost.map(({ event }) => event.id),
  ];
}

/** The wide card's one-line description: up to the first sentence break. */
export function firstSentence(description: string): string {
  const end = description.indexOf(". ");
  return end === -1 ? description : description.slice(0, end + 1);
}
