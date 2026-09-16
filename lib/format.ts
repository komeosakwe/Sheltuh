/**
 * Formats integer cents as an Australian dollar amount, e.g. 3200 -> "A$32",
 * 150 -> "A$1.50". Whole-dollar amounts drop the decimals.
 */
export function formatAud(cents: number): string {
  const dollars = cents / 100;
  const formatted = Number.isInteger(dollars) ? dollars.toString() : dollars.toFixed(2);
  return `A$${formatted}`;
}

/**
 * Sample event dates are naive "Australia/Melbourne" wall-clock timestamps
 * with no UTC offset (see lib/sample-events.ts). Parsing them as UTC and then
 * formatting in the UTC timezone renders the original wall-clock values
 * unchanged, regardless of the host server's local timezone.
 */
function parseMelbourneNaive(isoLike: string): Date {
  return new Date(`${isoLike}Z`);
}

const weekdayFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: "UTC",
  weekday: "short",
});

const dayMonthFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** e.g. "Fri 25 Sep" — Australia/Melbourne, no year, no comma. */
export function formatEventDateShort(isoLike: string): string {
  const date = parseMelbourneNaive(isoLike);
  return `${weekdayFormatter.format(date)} ${dayMonthFormatter.format(date)}`;
}

/** e.g. "8:00 pm" — Australia/Melbourne. */
export function formatEventTime(isoLike: string): string {
  return timeFormatter.format(parseMelbourneNaive(isoLike)).toLowerCase();
}

/**
 * "Fri 25 Sep, 8:00 pm" for a single instant, or a range when `endIsoLike`
 * is given: same-day events collapse to "Fri 25 Sep, 8:00 pm – 11:00 pm";
 * events crossing midnight spell out the end date too, e.g.
 * "Fri 25 Sep, 8:00 pm – Sat 26 Sep, 12:00 am".
 */
export function formatEventDateTimeRange(isoLike: string, endIsoLike?: string): string {
  const startLabel = `${formatEventDateShort(isoLike)}, ${formatEventTime(isoLike)}`;
  if (!endIsoLike) return startLabel;

  const sameDay = isoLike.slice(0, 10) === endIsoLike.slice(0, 10);
  if (sameDay) {
    return `${startLabel} – ${formatEventTime(endIsoLike)}`;
  }
  return `${startLabel} – ${formatEventDateShort(endIsoLike)}, ${formatEventTime(endIsoLike)}`;
}
