import { describe, expect, it } from "vitest";
import { eventSpansDays, formatEventEndDateKey } from "@/lib/format";
import { formatTicketTime } from "@/lib/server/ticket-email";
import { ticketStubDate, ticketStubTime, ticketWhenLine, ticketZoneLabel } from "@/lib/ticket-times";

// 14 Nov 2026 is in daylight time (AEDT, UTC+11): 5 pm Melbourne is 06:00Z.
const FIVE = "2026-11-14T06:00:00.000Z";
const NINE = "2026-11-14T10:00:00.000Z";

describe("ticket times (the site's twins of the ticket email's formats)", () => {
  it("TIME: one meridiem when both share it, both when they differ, the start alone without an end", () => {
    expect(ticketStubTime(FIVE, NINE)).toBe("5–9 pm");
    expect(ticketStubTime("2026-11-14T08:30:00.000Z", "2026-11-14T12:00:00.000Z")).toBe("7:30–11 pm");
    expect(ticketStubTime("2026-11-14T00:00:00.000Z", "2026-11-14T03:00:00.000Z")).toBe("11 am–2 pm");
    expect(ticketStubTime(FIVE)).toBe("5 pm");
  });

  it("TIME: overnight keeps both ends; a day or more shows the start alone", () => {
    expect(ticketStubTime("2026-11-14T10:00:00.000Z", "2026-11-14T15:00:00.000Z")).toBe("9 pm–2 am");
    expect(ticketStubTime(FIVE, "2026-11-16T06:00:00.000Z")).toBe("5 pm");
  });

  it("DATE and the zone: Melbourne's abbreviation, any other zone by name; all in the event's own zone", () => {
    expect(ticketStubDate(FIVE)).toBe("Sat 14 Nov");
    expect(ticketZoneLabel(FIVE)).toBe("AEDT");
    expect(ticketZoneLabel("2026-06-14T06:00:00.000Z")).toBe("AEST");
    expect(ticketZoneLabel(FIVE, "Australia/Perth")).toBe("Perth time (AWST)");
    // 06:00Z is 2 pm in Perth.
    expect(ticketStubTime(FIVE, NINE, "Australia/Perth")).toBe("2–6 pm");
  });

  it("the page's date line, as the frames write it", () => {
    expect(ticketWhenLine(FIVE, NINE)).toBe("Sat 14 Nov · 5:00 – 9:00 pm AEDT");
    expect(ticketWhenLine("2026-11-14T00:00:00.000Z", "2026-11-14T03:00:00.000Z")).toBe("Sat 14 Nov · 11:00 am – 2:00 pm AEDT");
    expect(ticketWhenLine(FIVE)).toBe("Sat 14 Nov · 5:00 pm AEDT");
    expect(ticketWhenLine("2026-11-14T10:00:00.000Z", "2026-11-14T15:00:00.000Z")).toBe("Sat 14 Nov, 9:00 pm – Sun 15 Nov, 2:00 am AEDT");
    expect(ticketWhenLine(FIVE, NINE, "Australia/Perth")).toBe("Sat 14 Nov · 2:00 – 6:00 pm Perth time (AWST)");
  });

  it("an end at exactly 12:00 am is the same day, as the ticket email has it", () => {
    // Sat 6 Mar 2027, 8 pm to midnight AEDT (UTC+11): 09:00Z to 13:00Z.
    const EIGHT = "2027-03-06T09:00:00.000Z";
    const MIDNIGHT = "2027-03-06T13:00:00.000Z";
    expect(ticketWhenLine(EIGHT, MIDNIGHT)).toBe("Sat 6 Mar · 8:00 pm – 12:00 am AEDT");
    expect(ticketStubTime(EIGHT, MIDNIGHT)).toBe("8 pm–12 am");
    expect(formatTicketTime(EIGHT, MIDNIGHT)).toBe("8:00 pm – 12:00 am AEDT");
    // A minute past midnight is the next day.
    expect(ticketWhenLine(EIGHT, "2027-03-06T13:01:00.000Z")).toBe("Sat 6 Mar, 8:00 pm – Sun 7 Mar, 12:01 am AEDT");
    // In the event's zone: midnight in Perth (UTC+8) is 16:00Z, still Sat 6 Mar there.
    expect(ticketWhenLine("2027-03-06T12:00:00.000Z", "2027-03-06T16:00:00.000Z", "Australia/Perth")).toBe("Sat 6 Mar · 8:00 pm – 12:00 am Perth time (AWST)");
  });

  it("the shared rule: the end's day, and whether an event spans days", () => {
    expect(formatEventEndDateKey("2027-03-06T13:00:00.000Z")).toBe("2027-03-06");
    expect(formatEventEndDateKey("2027-03-06T13:01:00.000Z")).toBe("2027-03-07");
    expect(eventSpansDays("2027-03-06T09:00:00.000Z", "2027-03-06T13:00:00.000Z")).toBe(false);
    expect(eventSpansDays("2027-03-06T09:00:00.000Z", "2027-03-06T13:01:00.000Z")).toBe(true);
    // Two days later at midnight still spans: Sat 8 pm to Mon 12:00 am closes on Sun.
    expect(eventSpansDays("2027-03-06T09:00:00.000Z", "2027-03-07T13:00:00.000Z")).toBe(true);
    expect(eventSpansDays("2027-03-06T09:00:00.000Z")).toBe(false);
  });
});
