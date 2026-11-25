import { describe, expect, it } from "vitest";
import { formatLongWeekdayDate } from "@/lib/format";
import {
  deltaPill,
  eventCount,
  eventMeta,
  formatDashMoney,
  formatWeekCount,
  highlightLine,
  performanceAmount,
  salesLine,
} from "@/lib/organiser-dashboard";

const NOW = new Date("2026-11-17T01:00:00.000Z"); // Tue 17 Nov, midday in Melbourne

describe("organiser dashboard words", () => {
  it("money: whole dollars as drawn, cents only when there are some", () => {
    expect(formatDashMoney(223_000)).toBe("A$2,230");
    expect(formatDashMoney(0)).toBe("A$0");
    expect(formatDashMoney(123_456)).toBe("A$1,234.56");
    expect(formatDashMoney(105)).toBe("A$1.05");
    expect(formatDashMoney(-1_200)).toBe("−A$12");
  });

  it("a week's count: + when there's any, 0 otherwise", () => {
    expect(formatWeekCount(86)).toBe("+86");
    expect(formatWeekCount(1204)).toBe("+1,204");
    expect(formatWeekCount(0)).toBe("0");
  });

  it("an event card's sales line: paid, free, nothing yet, sold elsewhere", () => {
    const base = { ticketingMode: "sheltuh" as const, ticketsSold: 86, capacity: 120, grossCents: 223_000, free: false };
    expect(salesLine(base)).toBe("86 / 120 sold · A$2,230");
    expect(salesLine({ ...base, free: true, ticketsSold: 12, capacity: 40, grossCents: 0 })).toBe("12 / 40 sold · Free");
    expect(salesLine({ ...base, ticketsSold: 0, capacity: 80, grossCents: 0 })).toBe("0 / 80 sold · —");
    expect(salesLine({ ...base, ticketingMode: "external" })).toBe("Tickets sold elsewhere");
    expect(salesLine({ ...base, ticketingMode: "external", free: true })).toBe("Free entry");
    expect(performanceAmount({ free: true, grossCents: 0 })).toBe("A$0 · free");
  });

  it("date and place, in the event's zone, with the year when it isn't this year", () => {
    const event = { startsAt: "2026-11-21T06:00:00.000Z", timeZone: "Australia/Melbourne" as const, venueName: "Interconnect Studio", suburb: "Collingwood" };
    expect(eventMeta(event, NOW)).toBe("Sat 21 Nov · Interconnect Studio");
    expect(eventMeta({ ...event, venueName: " " }, NOW)).toBe("Sat 21 Nov · Collingwood");
    expect(eventMeta({ ...event, startsAt: "2027-01-09T06:00:00.000Z" }, NOW)).toBe("Sat 9 Jan 2027 · Interconnect Studio");
    // Perth: its own calendar day.
    expect(eventMeta({ ...event, startsAt: "2026-11-21T15:30:00.000Z", timeZone: "Australia/Perth" }, NOW)).toBe("Sat 21 Nov · Interconnect Studio");
  });

  it("the banner's line: rounded percentage (never 100% with some left), tickets left, and the day", () => {
    const event = { title: "Here & Now", ticketsSold: 86, capacity: 120, startsAt: "2026-11-21T06:00:00.000Z", timeZone: "Australia/Melbourne" as const };
    expect(highlightLine(event, NOW)).toBe("Here & Now is 72% sold — 34 tickets left before Saturday.");
    expect(highlightLine({ ...event, ticketsSold: 119 }, NOW)).toBe("Here & Now is 99% sold — 1 ticket left before Saturday.");
    expect(highlightLine({ ...event, ticketsSold: 1, capacity: 1000 }, NOW)).toBe("Here & Now is 1% sold — 999 tickets left before Saturday.");
    expect(highlightLine({ ...event, startsAt: "2026-11-17T09:00:00.000Z" }, NOW)).toMatch(/left before it starts today\.$/);
    expect(highlightLine({ ...event, startsAt: "2026-11-18T09:00:00.000Z" }, NOW)).toMatch(/left before tomorrow\.$/);
    expect(highlightLine({ ...event, startsAt: "2026-12-12T09:00:00.000Z" }, NOW)).toMatch(/left before Sat 12 Dec\.$/);
  });

  it("the week-on-week pill: up, down, flat; none without a week before", () => {
    expect(deltaPill(15)).toEqual({ direction: "up", text: "↑ 15%", srText: "Up 15% on the week before" });
    expect(deltaPill(-10)).toEqual({ direction: "down", text: "↓ 10%", srText: "Down 10% on the week before" });
    expect(deltaPill(0)).toEqual({ direction: "flat", text: "0%", srText: "No change on the week before" });
    expect(deltaPill(1250)?.text).toBe("↑ 1,250%");
    expect(deltaPill(null)).toBeNull();
  });

  it("counts of events, and today's date in words", () => {
    expect(eventCount(1)).toBe("1 event");
    expect(eventCount(2)).toBe("2 events");
    expect(formatLongWeekdayDate(NOW)).toBe("Tuesday, 17 November");
    // 11:30 pm UTC on the 16th is already the 17th in Melbourne.
    expect(formatLongWeekdayDate(new Date("2026-11-16T23:30:00.000Z"))).toBe("Tuesday, 17 November");
  });
});
