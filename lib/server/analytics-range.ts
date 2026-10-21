import type { DateRange } from "@/lib/api/types";
import { fail } from "./validation";

/**
 * Analytics date ranges: inclusive Australia/Melbourne calendar dates,
 * "YYYY-MM-DD". Validated at the boundary and capped, so no query ever spans
 * more than MAX_RANGE_DAYS.
 */

/** Two years (one of them a leap year) of days. */
export const MAX_RANGE_DAYS = 731;
/** The overview's default: the last 30 days, today included. */
export const DEFAULT_RANGE_DAYS = 30;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const melbourneDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Melbourne",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Melbourne calendar date of an instant (default: now). */
export function melbourneDateOf(instant: Date | string = new Date()): string {
  return melbourneDate.format(typeof instant === "string" ? new Date(instant) : instant);
}

/** Days since 1970-01-01 for a valid "YYYY-MM-DD", else null (rejects 2026-02-30 and the like). */
function dayNumber(date: string): number | null {
  const m = DATE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

/** A date the API accepts: valid, and between 2000 and 2100. */
function acceptable(date: string): boolean {
  return dayNumber(date) !== null && date >= "2000-01-01" && date <= "2100-12-31";
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const n = dayNumber(date);
  if (n === null) throw new RangeError(`Invalid date: ${date}`);
  return fromDayNumber(n + days);
}

/** Days in an inclusive range. */
export function rangeLength(range: DateRange): number {
  return (dayNumber(range.to) as number) - (dayNumber(range.from) as number) + 1;
}

/** Every date in the range, oldest first. */
export function eachDay(range: DateRange): string[] {
  const start = dayNumber(range.from) as number;
  return Array.from({ length: rangeLength(range) }, (_, i) => fromDayNumber(start + i));
}

/** The period of the same length that ends the day before `range` starts. */
export function previousPeriod(range: DateRange): DateRange {
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(rangeLength(range) - 1)), to };
}

/**
 * Reads `from`, `to` and `compare` from the query string. A missing `from`
 * is `defaultFrom` (pulled forward if needed so the range fits the cap); a
 * missing `to` is today (Melbourne). 400 with fieldErrors for a malformed or
 * impossible date, `from` after `to`, a range over MAX_RANGE_DAYS, or an
 * unknown `compare`.
 */
export function parseAnalyticsQuery(
  qs: URLSearchParams,
  defaults: { from: string; today: string },
): { range: DateRange; compare: boolean } {
  const errors: Record<string, string> = {};
  const rawFrom = qs.get("from");
  const rawTo = qs.get("to");

  const to = rawTo ?? defaults.today;
  if (!acceptable(to)) errors.to = "Enter a valid date (YYYY-MM-DD).";

  let from = rawFrom ?? defaults.from;
  if (!acceptable(from)) {
    errors.from = "Enter a valid date (YYYY-MM-DD).";
  } else if (rawFrom === null && !errors.to) {
    // A default start never makes an invalid range on its own.
    const earliest = addDays(to, -(MAX_RANGE_DAYS - 1));
    if (from < earliest) from = earliest;
    if (from > to) from = to;
  }

  if (!errors.from && !errors.to) {
    if (from > to) errors.to = "Choose an end date on or after the start date.";
    else if (rangeLength({ from, to }) > MAX_RANGE_DAYS) {
      errors.from = `Choose a range of at most ${MAX_RANGE_DAYS} days (two years).`;
    }
  }

  const compare = qs.get("compare");
  if (compare !== null && compare !== "prevPeriod") errors.compare = "compare must be 'prevPeriod'.";

  if (Object.keys(errors).length > 0) fail(errors);
  return { range: { from, to }, compare: compare === "prevPeriod" };
}
