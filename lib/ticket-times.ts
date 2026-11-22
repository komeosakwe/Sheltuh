import { eventSpansDays, eventZone, formatEventDateShort, formatEventDateTimeRange, formatEventTime, formatTimeZoneLabel } from "@/lib/format";
import { PLATFORM_TIME_ZONE, type StateCode } from "@/lib/time-zones";

/*
 * Dates and times as the tickets write them, for the site's ticket surfaces
 * (components/tickets/). The ticket email has the same formats on the server
 * (lib/server/ticket-email.ts: formatStubTime, formatInfoTime); these are
 * their browser-safe twins, built on lib/format.ts so they share its zone
 * handling. Everything is in the event's own zone (Melbourne when it has none).
 */

interface Clock {
  hour: string;
  minute: string;
  meridiem: string;
}

/** "7:30 pm" in the zone, as its parts (the whole string as `hour` if it isn't a clock time). */
function clock(iso: string, timeZone: string): Clock {
  const shown = formatEventTime(iso, timeZone);
  const match = /^(\d{1,2}):(\d{2})[\s  ]*([ap]m)$/.exec(shown);
  return match ? { hour: match[1], minute: match[2], meridiem: match[3] } : { hour: shown, minute: "", meridiem: "" };
}

/** "5" for 5:00, "7:30" for 7:30. */
const compact = (c: Clock) => (c.minute === "00" || c.minute === "" ? c.hour : `${c.hour}:${c.minute}`);

const DAY_MS = 24 * 60 * 60 * 1000;

/** One day in the zone, as the ticket email judges it (lib/format.ts eventSpansDays): an end at exactly 12:00 am closes the start's day. */
const sameDay = (startIso: string, endIso: string, timeZone: string) => !eventSpansDays(startIso, endIso, timeZone);

/**
 * The ticket's TIME: "5–9 pm" (one meridiem), "7:30–11 pm", "11 am–2 pm",
 * "5 pm" (no end), "9 pm–2 am" (overnight: the day is in DATE). No spaces
 * round the en dash; one before am / pm. An event that runs a day or more
 * shows its start alone.
 */
export function ticketStubTime(startIso: string, endIso?: string, timeZone?: string | null): string {
  const zone = eventZone(timeZone);
  const start = clock(startIso, zone);
  const alone = `${compact(start)} ${start.meridiem}`.trim();
  if (!endIso) return alone;
  const overnight = !sameDay(startIso, endIso, zone);
  if (overnight && Date.parse(endIso) - Date.parse(startIso) >= DAY_MS) return alone;
  const end = clock(endIso, zone);
  if (!overnight && start.meridiem === end.meridiem) return `${compact(start)}–${compact(end)} ${end.meridiem}`;
  return `${alone}–${compact(end)} ${end.meridiem}`;
}

/** The ticket's DATE: "Sat 14 Nov". */
export function ticketStubDate(startIso: string, timeZone?: string | null): string {
  return formatEventDateShort(startIso, eventZone(timeZone));
}

/**
 * The zone after a time: its abbreviation for an event on Melbourne's clock
 * ("AEDT", "AEST"), and the named zone anywhere else ("Perth time (AWST)"),
 * as the ticket email does.
 */
export function ticketZoneLabel(startIso: string, timeZone?: string | null, state?: StateCode | null): string {
  const zone = eventZone(timeZone);
  const label = formatTimeZoneLabel(startIso, zone, state);
  if (zone !== PLATFORM_TIME_ZONE) return label;
  return /\(([^)]+)\)\s*$/.exec(label)?.[1] ?? label;
}

/**
 * The My ticket page's date line: "Sat 14 Nov · 5:00 – 9:00 pm AEDT" when
 * both times share a meridiem on the same day (the first one dropped),
 * "Sat 14 Nov · 11:00 am – 2:00 pm AEDT" otherwise, "Sat 14 Nov · 5:00 pm
 * AEDT" with no end, and for an event that crosses midnight both days in
 * full ("Fri 25 Sep, 9:00 pm – Sat 26 Sep, 2:00 am AEST"). An end at exactly
 * 12:00 am is the same day: "Sat 6 Mar · 8:00 pm – 12:00 am AEDT".
 */
export function ticketWhenLine(startIso: string, endIso?: string, timeZone?: string | null, state?: StateCode | null): string {
  const zone = eventZone(timeZone);
  const label = ticketZoneLabel(startIso, timeZone, state);
  const day = formatEventDateShort(startIso, zone);
  if (!endIso) return `${day} · ${formatEventTime(startIso, zone)} ${label}`;
  if (!sameDay(startIso, endIso, zone)) return `${formatEventDateTimeRange(startIso, endIso, zone)} ${label}`;
  const start = clock(startIso, zone);
  const end = clock(endIso, zone);
  if (start.minute && start.meridiem === end.meridiem) return `${day} · ${start.hour}:${start.minute} – ${end.hour}:${end.minute} ${end.meridiem} ${label}`;
  return `${day} · ${formatEventTime(startIso, zone)} – ${formatEventTime(endIso, zone)} ${label}`;
}
