import { formatEventDateKey } from "./format";
import { getMinBuyerTotalCents } from "./pricing";
import { isFreeEvent } from "./data";
import type { SheltuhEvent } from "./types";

export type TimeFilter = "all" | "tonight" | "weekend" | "date";
export type ScenePricingFilter = "all" | "free" | "under25";

const UNDER_PRICE_CENTS = 2500;

const weekdayFormatter = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short" });
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function melbourneDateKeyPlusDays(base: Date, days: number): string {
  const shifted = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return formatEventDateKey(shifted.toISOString());
}

/** Same Melbourne calendar date as `now`. */
export function isTonight(event: SheltuhEvent, now: Date): boolean {
  return formatEventDateKey(event.startsAt) === formatEventDateKey(now.toISOString());
}

/**
 * The nearest upcoming Saturday–Sunday, Melbourne calendar time. If `now`
 * falls on a Saturday or Sunday, that weekend (today onward) counts —
 * otherwise it's the coming one.
 */
export function isThisWeekend(event: SheltuhEvent, now: Date): boolean {
  const dayIndex = WEEKDAY_INDEX[weekdayFormatter.format(now)] ?? 0;
  let startOffset: number;
  let endOffset: number;
  if (dayIndex === 0) {
    startOffset = 0;
    endOffset = 0;
  } else if (dayIndex === 6) {
    startOffset = 0;
    endOffset = 1;
  } else {
    startOffset = 6 - dayIndex;
    endOffset = startOffset + 1;
  }
  const startKey = melbourneDateKeyPlusDays(now, startOffset);
  const endKey = melbourneDateKeyPlusDays(now, endOffset);
  const eventKey = formatEventDateKey(event.startsAt);
  return eventKey >= startKey && eventKey <= endKey;
}

/** `dateKey` is a Melbourne-local yyyy-mm-dd, as produced by an `<input type="date">`. */
export function isOnDate(event: SheltuhEvent, dateKey: string): boolean {
  return formatEventDateKey(event.startsAt) === dateKey;
}

export function matchesTimeFilter(event: SheltuhEvent, filter: TimeFilter, now: Date, specificDate: string): boolean {
  if (filter === "all") return true;
  if (filter === "tonight") return isTonight(event, now);
  if (filter === "weekend") return isThisWeekend(event, now);
  return specificDate === "" || isOnDate(event, specificDate);
}

export function matchesPricing(event: SheltuhEvent, filter: ScenePricingFilter): boolean {
  if (filter === "all") return true;
  if (filter === "free") return isFreeEvent(event);
  return getMinBuyerTotalCents(event) < UNDER_PRICE_CENTS;
}

/** Matches a free-text search against the event's name, venue and suburb. */
export function matchesSearch(event: SheltuhEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    event.title.toLowerCase().includes(q) ||
    event.venueName.toLowerCase().includes(q) ||
    event.suburb.toLowerCase().includes(q)
  );
}

/** Distinct suburbs actually present in a list of events, alphabetised. */
export function distinctSuburbs(events: SheltuhEvent[]): string[] {
  return Array.from(new Set(events.map((event) => event.suburb))).sort((a, b) => a.localeCompare(b));
}
