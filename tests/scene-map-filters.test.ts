import { describe, expect, it } from "vitest";
import {
  distinctSuburbs,
  isOnDate,
  isThisWeekend,
  isTonight,
  matchesPricing,
  matchesSearch,
  matchesTimeFilter,
} from "../lib/scene-map-filters";
import type { SheltuhEvent } from "../lib/types";

function eventAt(isoStartsAt: string, overrides: Partial<SheltuhEvent> = {}): SheltuhEvent {
  return {
    id: "evt-1",
    slug: "evt-1",
    title: "Test event",
    description: "",
    category: "art",
    suburb: "Fitzroy",
    venueName: "Test venue",
    venueAddress: "1 Test Street, Fitzroy VIC 3065",
    startsAt: isoStartsAt,
    organiserName: "Test organiser",
    poster: { pattern: "grid", background: "#000", primary: "#fff", secondary: "#fff" },
    ticketTypes: [{ id: "t1", name: "Entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...overrides,
  };
}

describe("isTonight", () => {
  it("is true for an event starting later the same Melbourne calendar day", () => {
    // 2026-09-20 09:00 UTC = 2026-09-20 ~19:00 AEST (Melbourne) — same day as `now`.
    const now = new Date("2026-09-20T01:00:00.000Z");
    expect(isTonight(eventAt("2026-09-20T09:00:00.000Z"), now)).toBe(true);
  });

  it("is false for an event starting the next Melbourne calendar day", () => {
    const now = new Date("2026-09-20T01:00:00.000Z");
    expect(isTonight(eventAt("2026-09-21T09:00:00.000Z"), now)).toBe(false);
  });
});

describe("isThisWeekend", () => {
  it("from a Friday, includes the coming Saturday and Sunday", () => {
    const now = new Date("2026-09-18T01:00:00.000Z"); // Friday, Melbourne time
    expect(isThisWeekend(eventAt("2026-09-19T05:00:00.000Z"), now)).toBe(true); // Sat
    expect(isThisWeekend(eventAt("2026-09-20T05:00:00.000Z"), now)).toBe(true); // Sun
  });

  it("from a Friday, excludes the Friday itself and the following Monday", () => {
    const now = new Date("2026-09-18T01:00:00.000Z");
    expect(isThisWeekend(eventAt("2026-09-18T05:00:00.000Z"), now)).toBe(false); // Fri
    expect(isThisWeekend(eventAt("2026-09-21T05:00:00.000Z"), now)).toBe(false); // Mon
  });

  it("from a Sunday, only today counts — Saturday has already passed", () => {
    const now = new Date("2026-09-20T01:00:00.000Z"); // Sunday
    expect(isThisWeekend(eventAt("2026-09-20T09:00:00.000Z"), now)).toBe(true);
    expect(isThisWeekend(eventAt("2026-09-19T09:00:00.000Z"), now)).toBe(false);
  });
});

describe("isOnDate", () => {
  it("matches an event's Melbourne calendar date against a date-input value", () => {
    expect(isOnDate(eventAt("2026-09-20T09:00:00.000Z"), "2026-09-20")).toBe(true);
    expect(isOnDate(eventAt("2026-09-20T09:00:00.000Z"), "2026-09-21")).toBe(false);
  });
});

describe("matchesTimeFilter", () => {
  const now = new Date("2026-09-18T01:00:00.000Z");

  it("'all' matches everything", () => {
    expect(matchesTimeFilter(eventAt("2099-01-01T00:00:00.000Z"), "all", now, "")).toBe(true);
  });

  it("'date' matches only the given date", () => {
    expect(matchesTimeFilter(eventAt("2026-09-25T09:00:00.000Z"), "date", now, "2026-09-25")).toBe(true);
    expect(matchesTimeFilter(eventAt("2026-09-26T09:00:00.000Z"), "date", now, "2026-09-25")).toBe(false);
  });
});

describe("matchesPricing", () => {
  const free = eventAt("2026-09-20T00:00:00Z", {
    ticketTypes: [{ id: "t", name: "Entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
  });
  const cheap = eventAt("2026-09-20T00:00:00Z", {
    ticketTypes: [{ id: "t", name: "Entry", priceCents: 1500, feePolicy: "buyer-pays", quantityAvailable: 5 }],
  });
  const pricey = eventAt("2026-09-20T00:00:00Z", {
    ticketTypes: [{ id: "t", name: "Entry", priceCents: 5000, feePolicy: "buyer-pays", quantityAvailable: 5 }],
  });

  it("'all' matches everything", () => {
    expect(matchesPricing(free, "all")).toBe(true);
    expect(matchesPricing(pricey, "all")).toBe(true);
  });

  it("'free' matches only free events", () => {
    expect(matchesPricing(free, "free")).toBe(true);
    expect(matchesPricing(cheap, "free")).toBe(false);
  });

  it("'under25' matches free and cheap paid events, not expensive ones", () => {
    expect(matchesPricing(free, "under25")).toBe(true);
    expect(matchesPricing(cheap, "under25")).toBe(true);
    expect(matchesPricing(pricey, "under25")).toBe(false);
  });
});

describe("matchesSearch", () => {
  const event = eventAt("2026-09-20T00:00:00Z", {
    title: "Neon Static",
    venueName: "Warehouse 9",
    suburb: "Collingwood",
  });

  it("matches by title, venue or suburb, case-insensitively", () => {
    expect(matchesSearch(event, "neon")).toBe(true);
    expect(matchesSearch(event, "WAREHOUSE")).toBe(true);
    expect(matchesSearch(event, "collingwood")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesSearch(event, "ceramics")).toBe(false);
  });

  it("empty query matches everything", () => {
    expect(matchesSearch(event, "")).toBe(true);
  });
});

describe("distinctSuburbs", () => {
  it("dedupes and sorts alphabetically", () => {
    const events = [eventAt("2026-01-01T00:00:00Z"), eventAt("2026-01-01T00:00:00Z", { suburb: "Brunswick" })];
    expect(distinctSuburbs(events)).toEqual(["Brunswick", "Fitzroy"]);
  });
});
