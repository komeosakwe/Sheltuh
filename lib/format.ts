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

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatEventDate(isoLike: string): string {
  return dateFormatter.format(parseMelbourneNaive(isoLike));
}

export function formatEventTime(isoLike: string): string {
  return timeFormatter.format(parseMelbourneNaive(isoLike)).toLowerCase();
}

export function formatEventDateTime(isoLike: string): string {
  return `${formatEventDate(isoLike)}, ${formatEventTime(isoLike)}`;
}
