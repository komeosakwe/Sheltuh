/**
 * Number and date formatting for organiser analytics
 * (docs/design/favourites-analytics.md §5.8). Reports read like a statement:
 * money always shows cents, counts are never abbreviated, and "no data" is
 * never shown as 0 (callers render `null` as "—" with "No data" for screen
 * readers).
 *
 * Dates here are Australia/Melbourne calendar days as the API sends them
 * ("2026-10-03"), so they're formatted as plain dates (UTC midnight, UTC
 * formatter): no timezone shift can move them to another day.
 */

import { formatEventDateKey } from "@/lib/format";

const countFormatter = new Intl.NumberFormat("en-AU");
const moneyFormatter = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 1204 → "1,204". */
export function formatCount(n: number): string {
  return countFormatter.format(n);
}

/** Cents → "A$1,204.50", always two decimals; negatives use a real minus: "−A$12.00". */
export function formatAudExact(cents: number): string {
  const amount = `A$${moneyFormatter.format(Math.abs(cents) / 100)}`;
  return cents < 0 ? `−${amount}` : amount;
}

/**
 * A conversion rate (orders ÷ views, unrounded) → "3.4%", "<0.1%" when it's
 * above 0 but would round to 0.0%. Null (no views, or views not counted for
 * part of the period) → null: show "—".
 */
export function formatConversion(rate: number | null | undefined): string | null {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return null;
  const pct = rate * 100;
  if (pct > 0 && pct < 0.05) return "<0.1%";
  return `${percentFormatter.format(pct)}%`;
}

/**
 * The change line under a stat, in words (no arrows, no colour): "Up 12% vs
 * previous 30 days", "Down 8% …", "No change …" (under 0.5%), "New this
 * period" (the previous value was 0), "No earlier data" (it wasn't counted),
 * "Up more than 999% …". Undefined when there's nothing to compare.
 */
export function formatChange(
  current: number | null,
  previous: number | null | undefined,
  days: number,
): string | undefined {
  if (previous === undefined || current === null) return undefined;
  if (previous === null) return "No earlier data";
  const suffix = ` vs previous ${days === 1 ? "day" : `${formatCount(days)} days`}`;
  if (previous === 0) return current === 0 ? `No change${suffix}` : "New this period";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.5) return `No change${suffix}`;
  if (pct > 999) return `Up more than 999%${suffix}`;
  return `${pct > 0 ? "Up" : "Down"} ${Math.round(Math.abs(pct))}%${suffix}`;
}

// ---------------------------------------------------------------------------
// Calendar dates ("YYYY-MM-DD", Melbourne days)
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

/** A real calendar date in YYYY-MM-DD form. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = asDate(value);
  return !Number.isNaN(date.getTime()) && toDay(date) === value;
}

export function addDays(day: string, n: number): string {
  const date = asDate(day);
  date.setUTCDate(date.getUTCDate() + n);
  return toDay(date);
}

/** Days from `from` to `to`, both included. */
export function daysInRange(from: string, to: string): number {
  return Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000) + 1;
}

/** Today's date in Melbourne. */
export function melbourneToday(now: Date = new Date()): string {
  return formatEventDateKey(now.toISOString());
}

/** The Monday on or before `day`. */
export function weekStart(day: string): string {
  const offset = (asDate(day).getUTCDay() + 6) % 7;
  return addDays(day, -offset);
}

const dayShort = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" });
const dayLong = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const dayMonthLong = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "long" });
const monthYear = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "short", year: "numeric" });
const monthYearLong = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long", year: "numeric" });
const yearOnly = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", year: "numeric" });
const dayNumber = (day: string) => String(Number(day.slice(8, 10)));

/** "3 Oct". */
export function formatDay(day: string): string {
  return dayShort.format(asDate(day));
}

/** "3 October 2026". */
export function formatDayLong(day: string): string {
  return dayLong.format(asDate(day));
}

/** "Oct 2026". */
export function formatMonth(day: string): string {
  return monthYear.format(asDate(day));
}

/** "October 2026". */
export function formatMonthLong(day: string): string {
  return monthYearLong.format(asDate(day));
}

/** "1–30 Oct 2026", "15 Sep – 14 Oct 2026", "15 Dec 2025 – 14 Jan 2026", or "3 Oct 2026". */
export function formatDateRange(from: string, to: string): string {
  const year = yearOnly.format(asDate(to));
  if (from === to) return `${formatDay(from)} ${year}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dayNumber(from)}–${formatDay(to)} ${year}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${formatDay(from)} – ${formatDay(to)} ${year}`;
  return `${formatDay(from)} ${yearOnly.format(asDate(from))} – ${formatDay(to)} ${year}`;
}

/** The same range in words for screen readers: "1 to 30 October 2026". */
export function formatDateRangeLong(from: string, to: string): string {
  if (from === to) return formatDayLong(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dayNumber(from)} to ${formatDayLong(to)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${dayMonthLong.format(asDate(from))} to ${formatDayLong(to)}`;
  return `${formatDayLong(from)} to ${formatDayLong(to)}`;
}
