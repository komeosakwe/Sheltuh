import { formatEventDateKey } from "./format";
import type { SheltuhEvent } from "./types";

export type TimeFilter = "all" | "tonight" | "week";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Same Melbourne calendar date as `now`. */
export function isTonight(event: SheltuhEvent, now: Date): boolean {
  return formatEventDateKey(event.startsAt) === formatEventDateKey(now.toISOString());
}

/** Starts within the next 7 days (rolling window, not a calendar week). */
export function isWithinWeek(event: SheltuhEvent, now: Date): boolean {
  const startsAtMs = new Date(event.startsAt).getTime();
  return startsAtMs >= now.getTime() && startsAtMs <= now.getTime() + WEEK_MS;
}

export function matchesTimeFilter(event: SheltuhEvent, filter: TimeFilter, now: Date): boolean {
  if (filter === "all") return true;
  if (filter === "tonight") return isTonight(event, now);
  return isWithinWeek(event, now);
}

/** Distinct suburbs actually present in a list of events, alphabetised. */
export function distinctSuburbs(events: SheltuhEvent[]): string[] {
  return Array.from(new Set(events.map((event) => event.suburb))).sort((a, b) => a.localeCompare(b));
}
