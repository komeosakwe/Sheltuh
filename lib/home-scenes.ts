import { cardGoing, GOING_COUNT_MIN, type CardGoing } from "./event-card";
import { eventZone } from "./format";
import { openDuring, weekendWindow, type TrendingItem } from "./home-sections";
import { localToUtcIso, PLATFORM_TIME_ZONE, wallClockParts } from "./time-zones";
import type { EventCategory, SheltuhEvent } from "./types";

/**
 * The home's scene cards (Find your people, components/home/CommunitySection.tsx), from what the
 * home has already loaded and nothing else: a category's lead event (for its photo), its going
 * count this week, and how many of its events there are. No members, friends or follows: there's
 * no data behind them. Pure.
 */

/** Whether `event` is on at any time from `now` to the end of this week (Sunday 23:59:59 in its own zone). */
export function isOnThisWeek(event: SheltuhEvent, now: Date): boolean {
  const nowMs = now.getTime();
  return openDuring(event, { start: nowMs, end: weekendWindow(now, eventZone(event.timeZone)).end, during: true });
}

/** The first day of next month (yyyy-mm-dd) in the platform's calendar. */
function nextMonthStart(now: Date): string {
  const [year, month] = wallClockParts(now, PLATFORM_TIME_ZONE).date.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** Whether `event` is on at any time from `now` to the end of this month (the platform's month, in the event's own zone). */
export function isOnThisMonth(event: SheltuhEvent, now: Date): boolean {
  const end = Date.parse(localToUtcIso(nextMonthStart(now), "00:00", eventZone(event.timeZone))) - 1;
  return openDuring(event, { start: now.getTime(), end, during: true });
}

/** What the scenes are drawn from: the home's loaded state (HomeEventsProvider's `ready`). */
export interface SceneSource {
  mode: "demo" | "live";
  /** Every loaded upcoming event, in the home's order (soonest first, the saved suburb's state first). */
  events: readonly SheltuhEvent[];
  /** `events` is every upcoming event there is. */
  complete: boolean;
  /** The loaded trending list (live: the server's thresholded going counts). */
  trending: readonly TrendingItem[];
  now: Date;
}

export interface SceneData {
  /** The category's first upcoming event in the home's order, whose image (or poster) the card shows; null for none. */
  lead: SheltuhEvent | null;
  /** How many are going to the category's events this week, or null when there's no count to show. */
  going: CardGoing | null;
  /** The card's mono line ("3 events this month", "5 upcoming", "No upcoming events"); null when the count may be partial. */
  meta: string | null;
}

/**
 * The going count for a category this week: the sum of its events' counts (cardGoing, so never
 * an external event's and never one under GOING_COUNT_MIN), each event once. Live: only the
 * server's thresholded counts, which only trending events carry. Demo: every sample event's sample
 * count, flagged `sample`. Null below GOING_COUNT_MIN. A member going to two events counts twice:
 * it's going, not people.
 */
export function sceneGoing(category: EventCategory, source: SceneSource): CardGoing | null {
  const counts = new Map<string, number>();
  const candidates =
    source.mode === "demo"
      ? source.events.map((event) => ({ event, signal: undefined }))
      : source.trending.map(({ event, signal }) => ({ event, signal }));
  for (const { event, signal } of candidates) {
    if (event.category !== category || counts.has(event.id) || !isOnThisWeek(event, source.now)) continue;
    const going = cardGoing(event, source.mode, signal);
    if (going) counts.set(event.id, going.count);
  }
  const count = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return count >= GOING_COUNT_MIN ? { count, sample: source.mode === "demo" } : null;
}

/**
 * The card's mono line, only when the loaded events are all of them (`complete`), so the number
 * is the whole one: how many of the category's events are on this month, else how many are
 * upcoming at all, else "No upcoming events". Null when the list may be partial.
 */
export function sceneMeta(category: EventCategory, source: SceneSource): string | null {
  if (!source.complete) return null;
  const upcoming = source.events.filter((event) => event.category === category);
  const month = upcoming.filter((event) => isOnThisMonth(event, source.now)).length;
  if (month > 0) return `${month} ${month === 1 ? "event" : "events"} this month`;
  if (upcoming.length > 0) return `${upcoming.length} upcoming`;
  return "No upcoming events";
}

/** A scene card's data from the home's loaded events. */
export function sceneData(category: EventCategory, source: SceneSource): SceneData {
  return {
    lead: source.events.find((event) => event.category === category) ?? null,
    going: sceneGoing(category, source),
    meta: sceneMeta(category, source),
  };
}
