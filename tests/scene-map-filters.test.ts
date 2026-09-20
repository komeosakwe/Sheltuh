import { describe, expect, it } from "vitest";
import { distinctSuburbs, isTonight, isWithinWeek, matchesTimeFilter } from "../lib/scene-map-filters";
import type { SheltuhEvent } from "../lib/types";

function eventAt(isoStartsAt: string): SheltuhEvent {
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
    ticketTypes: [],
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

describe("isWithinWeek", () => {
  const now = new Date("2026-09-20T01:00:00.000Z");

  it("includes an event 3 days out", () => {
    expect(isWithinWeek(eventAt("2026-09-23T01:00:00.000Z"), now)).toBe(true);
  });

  it("excludes an event 10 days out", () => {
    expect(isWithinWeek(eventAt("2026-09-30T01:00:00.000Z"), now)).toBe(false);
  });

  it("excludes an event that already started", () => {
    expect(isWithinWeek(eventAt("2026-09-19T01:00:00.000Z"), now)).toBe(false);
  });
});

describe("matchesTimeFilter", () => {
  const now = new Date("2026-09-20T01:00:00.000Z");

  it("'all' matches everything", () => {
    expect(matchesTimeFilter(eventAt("2099-01-01T00:00:00.000Z"), "all", now)).toBe(true);
  });
});

describe("distinctSuburbs", () => {
  it("dedupes and sorts alphabetically", () => {
    const events = [eventAt("2026-01-01T00:00:00Z"), { ...eventAt("2026-01-01T00:00:00Z"), suburb: "Brunswick" }];
    expect(distinctSuburbs(events)).toEqual(["Brunswick", "Fitzroy"]);
  });
});
