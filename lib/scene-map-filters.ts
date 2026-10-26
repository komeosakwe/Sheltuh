import { cachedDateTimeFormat } from "./time-zones";
import { eventZone, formatEventDateKey } from "./format";
import { getMinBuyerTotalCents } from "./pricing";
import { isFreeEvent } from "./data";
import { placeName, STATE_NAMES } from "./place";
import type { StateCode } from "./time-zones";
import type { SheltuhEvent } from "./types";

export type TimeFilter = "all" | "tonight" | "weekend" | "date";
export type ScenePricingFilter = "all" | "free" | "under25";

const UNDER_PRICE_CENTS = 2500;

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The calendar date `days` after a yyyy-mm-dd (calendar arithmetic: a daylight-saving day is still one day). */
function dateKeyPlusDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Same calendar date as `now`, in the event's own zone: tonight in Perth is
 * Perth's today, which can be a different date from Melbourne's.
 */
export function isTonight(event: SheltuhEvent, now: Date): boolean {
  const zone = eventZone(event.timeZone);
  return formatEventDateKey(event.startsAt, zone) === formatEventDateKey(now.toISOString(), zone);
}

/**
 * The nearest upcoming Saturday–Sunday, in the event's own zone's calendar.
 * If `now` falls on a Saturday or Sunday there, that weekend (today onward)
 * counts — otherwise it's the coming one.
 */
export function isThisWeekend(event: SheltuhEvent, now: Date): boolean {
  const zone = eventZone(event.timeZone);
  const weekday = cachedDateTimeFormat("en-AU", { timeZone: zone, weekday: "short" }).format(now);
  const dayIndex = WEEKDAY_INDEX[weekday] ?? 0;
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
  const todayKey = formatEventDateKey(now.toISOString(), zone);
  const startKey = dateKeyPlusDays(todayKey, startOffset);
  const endKey = dateKeyPlusDays(todayKey, endOffset);
  const eventKey = formatEventDateKey(event.startsAt, zone);
  return eventKey >= startKey && eventKey <= endKey;
}

/**
 * `dateKey` is a yyyy-mm-dd, as produced by an `<input type="date">`, matched
 * against the event's start date in its own zone (as the feed's `onOrAfter`).
 */
export function isOnDate(event: SheltuhEvent, dateKey: string): boolean {
  return formatEventDateKey(event.startsAt, eventZone(event.timeZone)) === dateKey;
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
  // No ticket types yet: no price, so not "under" anything.
  const minTotalCents = getMinBuyerTotalCents(event);
  return minTotalCents !== null && minTotalCents < UNDER_PRICE_CENTS;
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

/** One state's suburbs in the map's location filter. */
export interface SuburbGroup {
  state: StateCode;
  /** The state's name, the group's label ("Victoria"). */
  label: string;
  /**
   * `value`: the suburb as stored (the filter matches it); `label`: "Suburb, STATE" (owner decision
   * D4), so the closed select still says which state ("Richmond, NSW", never "Richmond NSW, NSW").
   */
  suburbs: { value: string; label: string }[];
}

/**
 * The suburbs present in `events`, grouped by state (an event without one
 * is Victorian), states by name and suburbs alphabetised: the map's location
 * filter, as <optgroup>s.
 */
export function suburbsByState(events: SheltuhEvent[]): SuburbGroup[] {
  const byState = new Map<StateCode, Map<string, string>>();
  for (const event of events) {
    const state = event.state ?? "VIC";
    let suburbs = byState.get(state);
    if (!suburbs) byState.set(state, (suburbs = new Map()));
    if (!suburbs.has(event.suburb)) suburbs.set(event.suburb, placeName(event.suburb, state));
  }
  return [...byState]
    .map(([state, suburbs]) => ({
      state,
      label: STATE_NAMES[state],
      suburbs: [...suburbs]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
