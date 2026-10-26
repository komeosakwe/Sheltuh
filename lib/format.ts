import { cachedDateTimeFormat, PLATFORM_TIME_ZONE, wallClockParts, zoneLabel, type StateCode } from "./time-zones";

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
 * Every date/time formatter takes an optional IANA `timeZone`, defaulting to
 * the platform's (Australia/Melbourne, lib/time-zones.ts): the output never
 * depends on the browser's or server's own zone.
 */
interface ZoneFormatters {
  weekday: Intl.DateTimeFormat;
  dayMonth: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
  /** yyyy-mm-dd in the zone, used only to compare two instants' calendar days. */
  dateKey: Intl.DateTimeFormat;
  badgeMonth: Intl.DateTimeFormat;
}

const formattersByZone = new Map<string, ZoneFormatters>();

/** The zone's formatters, built once per zone. Throws RangeError for a zone the runtime doesn't know. */
function formattersFor(timeZone: string): ZoneFormatters {
  let formatters = formattersByZone.get(timeZone);
  if (!formatters) {
    formatters = {
      weekday: cachedDateTimeFormat("en-AU", { timeZone, weekday: "short" }),
      dayMonth: cachedDateTimeFormat("en-AU", { timeZone, day: "numeric", month: "short" }),
      time: cachedDateTimeFormat("en-AU", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }),
      dateKey: cachedDateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }),
      badgeMonth: cachedDateTimeFormat("en-AU", { timeZone, month: "short" }),
    };
    formattersByZone.set(timeZone, formatters);
  }
  return formatters;
}

/** "2026-09-25" in the zone's local time (Melbourne by default) — for date comparisons, not display. */
export function formatEventDateKey(isoLike: string, timeZone: string = PLATFORM_TIME_ZONE): string {
  return formattersFor(timeZone).dateKey.format(new Date(isoLike));
}

/** e.g. "Fri 25 Sep" — in the zone (Melbourne by default), no year, no comma. `isoLike` is a real UTC instant. */
export function formatEventDateShort(isoLike: string, timeZone: string = PLATFORM_TIME_ZONE): string {
  const date = new Date(isoLike);
  const { weekday, dayMonth } = formattersFor(timeZone);
  return `${weekday.format(date)} ${dayMonth.format(date)}`;
}

/** e.g. "8:00 pm" — in the zone (Melbourne by default). */
export function formatEventTime(isoLike: string, timeZone: string = PLATFORM_TIME_ZONE): string {
  return formattersFor(timeZone).time.format(new Date(isoLike)).toLowerCase();
}

/**
 * A day, in the zone (Melbourne by default): "Sat 26 Sep", with the year
 * when it isn't `now`'s year there ("Fri 25 Sep 2025").
 */
export function formatDayWithYear(
  isoLike: string,
  now: Date = new Date(),
  timeZone: string = PLATFORM_TIME_ZONE,
): string {
  const { dateKey } = formattersFor(timeZone);
  const year = dateKey.format(new Date(isoLike)).slice(0, 4);
  const day = formatEventDateShort(isoLike, timeZone);
  return year === dateKey.format(now).slice(0, 4) ? day : `${day} ${year}`;
}

/**
 * A message's (or report's) time, in the zone (Melbourne by default):
 * "8:05 pm" on the same local day as `now`, otherwise "Fri 25 Sep, 8:05 pm",
 * plus the year when it isn't this year ("Fri 25 Sep 2025, 8:05 pm").
 */
export function formatMessageTime(
  isoLike: string,
  now: Date = new Date(),
  timeZone: string = PLATFORM_TIME_ZONE,
): string {
  const { dateKey } = formattersFor(timeZone);
  const sameDay = dateKey.format(new Date(isoLike)) === dateKey.format(now);
  return sameDay ? formatEventTime(isoLike, timeZone) : formatDayTime(isoLike, now, timeZone);
}

/**
 * A day and time, in the zone (Melbourne by default), always with the day:
 * "Fri 25 Sep, 8:05 pm", plus the year when it isn't `now`'s ("Fri 25 Sep
 * 2025, 8:05 pm"). For logs, where "8:05 pm" alone would be ambiguous once
 * the day has passed.
 */
export function formatDayTime(isoLike: string, now: Date = new Date(), timeZone: string = PLATFORM_TIME_ZONE): string {
  return `${formatDayWithYear(isoLike, now, timeZone)}, ${formatEventTime(isoLike, timeZone)}`;
}

/**
 * Splits a UTC instant into the {date, time} shape needed for
 * <input type="date">/<input type="time"> values, in `timeZone`'s local
 * time — never the browser's own zone. This is the frontend counterpart of
 * the backend's localToUtcIso: editing and re-saving an event unchanged must
 * round-trip through the same zone on both ends, or the stored instant
 * silently shifts by the difference between the two zones' offsets.
 */
export function toDateTimeInputParts(isoLike: string, timeZone: string): { date: string; time: string } {
  return wallClockParts(isoLike, timeZone);
}

/** toDateTimeInputParts in Australia/Melbourne, the counterpart of melbourneLocalToUtcIso. */
export function toMelbourneDateTimeInputParts(isoLike: string): { date: string; time: string } {
  return toDateTimeInputParts(isoLike, PLATFORM_TIME_ZONE);
}

/**
 * "Fri 25 Sep, 8:00 pm" for a single instant, or a range when `endIsoLike`
 * is given: same-day events collapse to "Fri 25 Sep, 8:00 pm – 11:00 pm";
 * events crossing midnight (in the zone's local time, Melbourne by default —
 * a UTC day boundary can fall on a different local date) spell out the end
 * date too, e.g. "Fri 25 Sep, 8:00 pm – Sat 26 Sep, 12:00 am".
 */
export function formatEventDateTimeRange(
  isoLike: string,
  endIsoLike?: string,
  timeZone: string = PLATFORM_TIME_ZONE,
): string {
  const startLabel = `${formatEventDateShort(isoLike, timeZone)}, ${formatEventTime(isoLike, timeZone)}`;
  if (!endIsoLike) return startLabel;

  const { dateKey } = formattersFor(timeZone);
  const sameDay = dateKey.format(new Date(isoLike)) === dateKey.format(new Date(endIsoLike));
  if (sameDay) {
    return `${startLabel} – ${formatEventTime(endIsoLike, timeZone)}`;
  }
  return `${startLabel} – ${formatEventDateShort(endIsoLike, timeZone)}, ${formatEventTime(endIsoLike, timeZone)}`;
}

/**
 * The home's date badge, in the zone's local time (Melbourne by default):
 * `{ range: "3", month: "OCT" }` for one day (an end on the same local date
 * counts as one day), `{ range: "19–25", month: "OCT" }` for a span within a
 * month, and `{ range: "30 OCT–2", month: "NOV" }` for a span across months.
 */
export function formatDateBadge(
  isoLike: string,
  endIsoLike?: string,
  timeZone: string = PLATFORM_TIME_ZONE,
): { range: string; month: string } {
  const { dateKey, badgeMonth } = formattersFor(timeZone);
  const start = new Date(isoLike);
  const startKey = dateKey.format(start);
  const startDay = String(Number(startKey.slice(8, 10)));
  const startMonth = badgeMonth.format(start).toUpperCase();
  if (!endIsoLike) return { range: startDay, month: startMonth };

  const end = new Date(endIsoLike);
  const endKey = dateKey.format(end);
  if (endKey <= startKey) return { range: startDay, month: startMonth };
  const endDay = String(Number(endKey.slice(8, 10)));
  if (endKey.slice(0, 7) === startKey.slice(0, 7)) return { range: `${startDay}–${endDay}`, month: startMonth };
  return { range: `${startDay} ${startMonth}–${endDay}`, month: badgeMonth.format(end).toUpperCase() };
}

/**
 * The event page's time zone label (docs/design/mobile-redesign.md §6.5),
 * whichever is in effect at the start: "Melbourne time (AEDT)" or "(AEST)"
 * by default, "Perth time (AWST)", or a UTC offset where the abbreviation
 * isn't a familiar one ("Lord Howe Island time (UTC+11:00)"). Pass the
 * state for the ACT's "Canberra time". See zoneLabel in lib/time-zones.ts.
 */
export function formatTimeZoneLabel(
  isoLike: string,
  timeZone: string = PLATFORM_TIME_ZONE,
  state?: StateCode | null,
): string {
  return zoneLabel(timeZone, isoLike, state);
}
