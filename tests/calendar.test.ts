import { describe, expect, it } from "vitest";
import {
  buildIcs,
  calendarTimes,
  escapeIcsText,
  firstSentence,
  foldIcsLine,
  googleCalendarUrl,
  icsFilename,
  toIcsUtc,
  type CalendarEvent,
} from "@/lib/calendar";
import { publicEventUrl } from "@/lib/event-url";
import { melbourneLocalToUtcIso } from "@/lib/server/melbourne-time";

const NOW = new Date("2026-10-21T01:02:03.456Z");
const URL = "https://sheltuh.com.au/events/thornbury-dub-session";

/** Instants made the way the API stores them: from Melbourne wall-clock time, DST included. */
function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-thornbury-dub-session",
    slug: "thornbury-dub-session",
    title: "Thornbury Dub Session",
    description: "A long night of dub and roots, on a hand-built sound system. Tickets are on Humanitix.",
    venueName: "The Bluestone Hall",
    venueAddress: "800 High Street, Thornbury VIC 3071",
    // Sat 7 Nov 2026, 7:30 pm to midnight, Melbourne summer time (AEDT, UTC+11).
    startsAt: melbourneLocalToUtcIso("2026-11-07", "19:30"),
    endsAt: melbourneLocalToUtcIso("2026-11-08", "00:00"),
    ...overrides,
  };
}

/** Unfolds and splits an .ics file into its logical lines. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

describe("buildIcs (golden)", () => {
  it("writes an RFC 5545 VEVENT with Melbourne times as UTC, escaped text, CRLF and a stable UID", () => {
    const ics = buildIcs(event(), { url: URL, now: NOW });
    expect(ics).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Sheltuh//Events//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        "UID:evt-thornbury-dub-session@sheltuh.com.au",
        "DTSTAMP:20261021T010203Z",
        // 7:30 pm AEDT is 08:30 UTC; midnight AEDT is 13:00 UTC the day before.
        "DTSTART:20261107T083000Z",
        "DTEND:20261107T130000Z",
        "SUMMARY:Thornbury Dub Session",
        "LOCATION:The Bluestone Hall\\, 800 High Street\\, Thornbury VIC 3071",
        "URL:https://sheltuh.com.au/events/thornbury-dub-session",
        // 75 octets, then a CRLF and a space: the line is folded.
        "DESCRIPTION:A long night of dub and roots\\, on a hand-built sound system.\\n",
        " \\nhttps://sheltuh.com.au/events/thornbury-dub-session",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  it("uses UTC+10 in Melbourne winter (AEST) and UTC+11 in summer (AEDT)", () => {
    const winter = buildIcs(
      event({ startsAt: melbourneLocalToUtcIso("2026-07-10", "19:00"), endsAt: melbourneLocalToUtcIso("2026-07-10", "22:00") }),
      { url: URL, now: NOW },
    );
    const summer = buildIcs(
      event({ startsAt: melbourneLocalToUtcIso("2026-01-10", "19:00"), endsAt: melbourneLocalToUtcIso("2026-01-10", "22:00") }),
      { url: URL, now: NOW },
    );
    expect(unfold(winter ?? "")).toEqual(expect.arrayContaining(["DTSTART:20260710T090000Z", "DTEND:20260710T120000Z"]));
    expect(unfold(summer ?? "")).toEqual(expect.arrayContaining(["DTSTART:20260110T080000Z", "DTEND:20260110T110000Z"]));
  });

  it("spans the October daylight-saving change correctly (clocks go forward at 2 am on 4 Oct 2026)", () => {
    // 10 pm Saturday AEST to 4 am Sunday AEDT: six hours on the wall clock, five in real time.
    const ics = buildIcs(
      event({ startsAt: melbourneLocalToUtcIso("2026-10-03", "22:00"), endsAt: melbourneLocalToUtcIso("2026-10-04", "04:00") }),
      { url: URL, now: NOW },
    );
    expect(unfold(ics ?? "")).toEqual(expect.arrayContaining(["DTSTART:20261003T120000Z", "DTEND:20261003T170000Z"]));
  });

  it("gives the same UID every time, so importing twice updates the entry", () => {
    const a = unfold(buildIcs(event(), { url: URL, now: NOW }) ?? "");
    const b = unfold(buildIcs(event({ title: "Renamed" }), { url: URL, now: new Date() }) ?? "");
    expect(a.find((l) => l.startsWith("UID:"))).toBe(b.find((l) => l.startsWith("UID:")));
  });

  it("lasts two hours when there's no end, or the end isn't after the start", () => {
    for (const endsAt of [undefined, "not a date", "2026-11-07T08:30:00.000Z"]) {
      const lines = unfold(buildIcs(event({ startsAt: "2026-11-07T08:30:00.000Z", endsAt }), { url: URL, now: NOW }) ?? "");
      expect(lines).toContain("DTEND:20261107T103000Z");
    }
  });

  it("is null when the start can't be read", () => {
    expect(buildIcs(event({ startsAt: "soon" }), { url: URL, now: NOW })).toBeNull();
    expect(googleCalendarUrl(event({ startsAt: "" }), URL)).toBeNull();
    expect(calendarTimes({ startsAt: "nope" })).toBeNull();
  });

  it("escapes semicolons, commas, backslashes and newlines in the title and place", () => {
    const lines = unfold(
      buildIcs(event({ title: "Dub; Roots, \\ More\nLate", venueName: "Hall; B", venueAddress: "" }), { url: URL, now: NOW }) ??
        "",
    );
    expect(lines).toContain("SUMMARY:Dub\\; Roots\\, \\\\ More\\nLate");
    expect(lines).toContain("LOCATION:Hall\\; B");
  });

  it("keeps every physical line to 75 octets", () => {
    const ics = buildIcs(event({ title: "Ü".repeat(120), description: "Long ".repeat(60) }), { url: URL, now: NOW }) ?? "";
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain(`SUMMARY:${"Ü".repeat(120)}`);
  });
});

describe("calendar helpers", () => {
  it("toIcsUtc", () => {
    expect(toIcsUtc(new Date("2026-11-07T08:30:00.000Z"))).toBe("20261107T083000Z");
  });

  it("escapeIcsText", () => {
    expect(escapeIcsText("a\\b;c,d\r\ne\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });

  it("foldIcsLine never splits a multi-byte character", () => {
    const line = `SUMMARY:${"é".repeat(40)}`; // 8 + 80 octets
    const folded = foldIcsLine(line).split("\r\n");
    expect(folded).toHaveLength(2);
    expect(new TextEncoder().encode(folded[0]).length).toBe(74); // 75 would split an "é"
    expect(folded[1].startsWith(" é")).toBe(true);
    expect(folded.join("").replace(/^(.*?) /, "$1")).toBe(line);
  });

  it("firstSentence", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("No full stop")).toBe("No full stop");
    expect(firstSentence("  Wow!  More. ")).toBe("Wow!");
    expect(firstSentence("A$3.50 entry. Then more.")).toBe("A$3.50 entry.");
  });

  it("icsFilename", () => {
    expect(icsFilename({ slug: "neon-static" })).toBe("neon-static.ics");
  });

  it("googleCalendarUrl prefills title, UTC dates, details and place", () => {
    const url = new globalThis.URL(googleCalendarUrl(event(), URL) ?? "");
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Thornbury Dub Session");
    expect(url.searchParams.get("dates")).toBe("20261107T083000Z/20261107T130000Z");
    expect(url.searchParams.get("details")).toBe(`A long night of dub and roots, on a hand-built sound system.\n\n${URL}`);
    expect(url.searchParams.get("location")).toBe("The Bluestone Hall, 800 High Street, Thornbury VIC 3071");
    // The dates' slash is literal, not %2F.
    expect(url.search).toContain("dates=20261107T083000Z/20261107T130000Z");
  });
});

describe("publicEventUrl", () => {
  it("is the origin and the event path only: no query or fragment", () => {
    expect(publicEventUrl("neon-static", "https://sheltuh.com.au")).toBe("https://sheltuh.com.au/events/neon-static");
    expect(publicEventUrl("a b", "http://localhost:3000/")).toBe("http://localhost:3000/events/a%20b");
  });
});
