/**
 * Formats integer cents as an Australian dollar amount, e.g. 3200 -> "A$32",
 * 150 -> "A$1.50". Whole-dollar amounts drop the decimals.
 */
export function formatAud(cents: number): string {
  const dollars = cents / 100;
  const formatted = Number.isInteger(dollars) ? dollars.toString() : dollars.toFixed(2);
  return `A$${formatted}`;
}

const MELBOURNE_TZ = "Australia/Melbourne";

const weekdayFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: MELBOURNE_TZ,
  weekday: "short",
});

const dayMonthFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: MELBOURNE_TZ,
  day: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: MELBOURNE_TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** yyyy-mm-dd in Melbourne local time, used only to compare two instants' calendar days. */
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MELBOURNE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "2026-09-25" in Melbourne local time — for date comparisons, not display. */
export function formatEventDateKey(isoLike: string): string {
  return dateKeyFormatter.format(new Date(isoLike));
}

/** e.g. "Fri 25 Sep" — Australia/Melbourne, no year, no comma. `isoLike` is a real UTC instant. */
export function formatEventDateShort(isoLike: string): string {
  const date = new Date(isoLike);
  return `${weekdayFormatter.format(date)} ${dayMonthFormatter.format(date)}`;
}

/** e.g. "8:00 pm" — Australia/Melbourne. */
export function formatEventTime(isoLike: string): string {
  return timeFormatter.format(new Date(isoLike)).toLowerCase();
}

/**
 * "Fri 25 Sep, 8:00 pm" for a single instant, or a range when `endIsoLike`
 * is given: same-day events collapse to "Fri 25 Sep, 8:00 pm – 11:00 pm";
 * events crossing midnight (in Melbourne local time — a UTC day boundary
 * can fall on a different local date under AEST/AEDT) spell out the end
 * date too, e.g. "Fri 25 Sep, 8:00 pm – Sat 26 Sep, 12:00 am".
 */
export function formatEventDateTimeRange(isoLike: string, endIsoLike?: string): string {
  const startLabel = `${formatEventDateShort(isoLike)}, ${formatEventTime(isoLike)}`;
  if (!endIsoLike) return startLabel;

  const sameDay = dateKeyFormatter.format(new Date(isoLike)) === dateKeyFormatter.format(new Date(endIsoLike));
  if (sameDay) {
    return `${startLabel} – ${formatEventTime(endIsoLike)}`;
  }
  return `${startLabel} – ${formatEventDateShort(endIsoLike)}, ${formatEventTime(endIsoLike)}`;
}
