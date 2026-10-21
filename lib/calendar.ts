/**
 * "Add to calendar" for an event (docs/design/brand-direction-one.md §6.7): an
 * RFC 5545 `.ics` file and a Google Calendar link, both built in the browser
 * from the event's own data. Times are the event's real instants (stored in
 * UTC from the organiser's Australia/Melbourne wall-clock time, daylight
 * saving included) written as UTC with a `Z`, so every calendar app shows them
 * at the right local time without needing a VTIMEZONE block.
 */

/** What a calendar entry needs from an event. */
export interface CalendarEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  venueName: string;
  venueAddress: string;
  /** ISO 8601 instant. */
  startsAt: string;
  /** ISO 8601 instant; without one the entry lasts DEFAULT_DURATION_MS. */
  endsAt?: string;
}

/** An event with no end time is put in the calendar as two hours long. */
export const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

const ICS_UID_DOMAIN = "sheltuh.com.au";
const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;

function validDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The entry's start and end. Null when the start can't be read (nothing to
 * put in a calendar). A missing, unreadable or not-after-start end becomes
 * start + 2 hours.
 */
export function calendarTimes(event: Pick<CalendarEvent, "startsAt" | "endsAt">): { start: Date; end: Date } | null {
  const start = validDate(event.startsAt);
  if (!start) return null;
  const end = validDate(event.endsAt);
  return {
    start,
    end: end && end.getTime() > start.getTime() ? end : new Date(start.getTime() + DEFAULT_DURATION_MS),
  };
}

/** An instant as an iCalendar UTC date-time: `20261107T083000Z`. */
export function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, and newlines as `\n`. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * RFC 5545 §3.1 line folding: no line longer than 75 octets (UTF-8 bytes,
 * not characters), each continuation starting with one space. A multi-byte
 * character is never split.
 */
export function foldIcsLine(line: string): string {
  const lines: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > MAX_LINE_OCTETS) {
      lines.push(current);
      current = ` ${char}`;
      octets = 1 + size;
    } else {
      current += char;
      octets += size;
    }
  }
  lines.push(current);
  return lines.join(CRLF);
}

/** The description's first sentence (or all of it, if it has no sentence break), trimmed. */
export function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const match = /^.*?[.!?](?=\s|$)/.exec(trimmed);
  return (match ? match[0] : trimmed).trim();
}

function location(event: Pick<CalendarEvent, "venueName" | "venueAddress">): string {
  return [event.venueName, event.venueAddress].filter((part) => part.trim()).join(", ");
}

function details(event: Pick<CalendarEvent, "description">, url: string): string {
  const sentence = firstSentence(event.description);
  return sentence ? `${sentence}\n\n${url}` : url;
}

/** `{slug}.ics`, the downloaded file's name. */
export function icsFilename(event: Pick<CalendarEvent, "slug">): string {
  return `${event.slug || "event"}.ics`;
}

/**
 * The event as an iCalendar file (one VEVENT), with CRLF line endings and
 * folded lines. `url` is the event page's public address (no tracking
 * query); `now` stamps DTSTAMP. The UID is the same every time for the
 * same event, so importing it twice updates the entry instead of adding one.
 * Null when the event's start can't be read.
 */
export function buildIcs(event: CalendarEvent, { url, now = new Date() }: { url: string; now?: Date }): string | null {
  const times = calendarTimes(event);
  if (!times) return null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sheltuh//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.id)}@${ICS_UID_DOMAIN}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(times.start)}`,
    `DTEND:${toIcsUtc(times.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `LOCATION:${escapeIcsText(location(event))}`,
    // A URI value, not TEXT: it isn't escaped (a URL never has a raw newline).
    `URL:${url}`,
    `DESCRIPTION:${escapeIcsText(details(event, url))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/**
 * Google Calendar's "add event" page, prefilled. Null when the event's start
 * can't be read.
 */
export function googleCalendarUrl(event: CalendarEvent, url: string): string | null {
  const times = calendarTimes(event);
  if (!times) return null;
  const params = [
    ["action", "TEMPLATE"],
    ["text", event.title],
    ["dates", `${toIcsUtc(times.start)}/${toIcsUtc(times.end)}`],
    ["details", details(event, url)],
    ["location", location(event)],
  ];
  // Encoded by hand: URLSearchParams writes spaces as "+", and the dates' "/" must stay a "/"
  // (they're only digits, T, Z and the slash, so they need no encoding).
  const query = params
    .map(([key, value]) => `${key}=${key === "dates" ? value : encodeURIComponent(value)}`)
    .join("&");
  return `https://calendar.google.com/calendar/render?${query}`;
}
