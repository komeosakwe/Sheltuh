import { describe, expect, it } from "vitest";
import {
  isOnDate,
  isThisWeekend,
  isTonight,
  matchesPricing,
  matchesSearch,
  matchesTimeFilter,
  suburbsByState,
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

describe("time filters in each event's own zone", () => {
  const perth = { state: "WA", timeZone: "Australia/Perth" } as const;

  it("tonight: a Perth event is tonight on Perth's date, not Melbourne's", () => {
    // Sat 24 Oct 2026 23:30 AEDT = 20:30 AWST: still Saturday in both.
    const now = new Date("2026-10-24T12:30:00.000Z");
    // 11:30 pm AWST Sat = 2:30 am AEDT Sun: tonight in Perth.
    expect(isTonight(eventAt("2026-10-24T15:30:00.000Z", perth), now)).toBe(true);
    // The same instant in Melbourne is tomorrow.
    expect(isTonight(eventAt("2026-10-24T15:30:00.000Z"), now)).toBe(false);
  });

  it("tonight: after Melbourne's midnight it's still the evening before in Perth", () => {
    // Sun 25 Oct 00:30 AEDT = Sat 24 Oct 21:30 AWST.
    const now = new Date("2026-10-24T13:30:00.000Z");
    expect(isTonight(eventAt("2026-10-24T14:00:00.000Z", perth), now)).toBe(true); // Sat 10 pm AWST
    expect(isTonight(eventAt("2026-10-24T14:00:00.000Z"), now)).toBe(true); // Sun 1 am AEDT
    expect(isTonight(eventAt("2026-10-24T09:00:00.000Z"), now)).toBe(false); // Sat 8 pm AEDT: yesterday in Melbourne
  });

  it("this weekend: a Perth event at 11 pm on Sunday, Perth time, is in it", () => {
    const now = new Date("2026-10-21T01:00:00.000Z"); // Wed
    // Sun 25 Oct 23:00 AWST = Mon 26 Oct 02:00 AEDT.
    expect(isThisWeekend(eventAt("2026-10-25T15:00:00.000Z", perth), now)).toBe(true);
    expect(isThisWeekend(eventAt("2026-10-25T15:00:00.000Z"), now)).toBe(false);
  });

  it("this weekend: counts calendar days across the start of daylight saving", () => {
    // Sat 3 Oct 2026 23:30 AEST; the clocks go forward that night, so Sunday is 23 hours long.
    const now = new Date("2026-10-03T13:30:00.000Z");
    expect(isThisWeekend(eventAt("2026-10-04T08:00:00.000Z"), now)).toBe(true); // Sun 7 pm AEDT
    expect(isThisWeekend(eventAt("2026-10-05T08:00:00.000Z"), now)).toBe(false); // Mon
  });

  it("a date: the event's own local date, as the feed's onOrAfter reads it", () => {
    // 11:30 pm AWST Sat 24 Oct = Sun 25 Oct in Melbourne.
    expect(isOnDate(eventAt("2026-10-24T15:30:00.000Z", perth), "2026-10-24")).toBe(true);
    expect(isOnDate(eventAt("2026-10-24T15:30:00.000Z"), "2026-10-25")).toBe(true);
    expect(matchesTimeFilter(eventAt("2026-10-24T15:30:00.000Z", perth), "date", new Date(), "2026-10-25")).toBe(false);
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

  it("an event with no ticket types yet is neither free nor under A$25 (it has no price)", () => {
    const noTickets = eventAt("2026-09-20T00:00:00Z", { ticketTypes: [] });
    expect(matchesPricing(noTickets, "all")).toBe(true);
    expect(matchesPricing(noTickets, "free")).toBe(false);
    expect(matchesPricing(noTickets, "under25")).toBe(false);
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

describe("suburbsByState (the map's location filter, grouped by state)", () => {
  it("groups the events' suburbs by state, states and suburbs by name, each labelled \"Suburb, STATE\"", () => {
    const at = "2026-11-21T10:00:00.000Z";
    const groups = suburbsByState([
      eventAt(at, { suburb: "Northbridge", state: "WA" }),
      eventAt(at, { suburb: "Fitzroy" }),
      eventAt(at, { suburb: "Richmond NSW", state: "NSW" }),
      eventAt(at, { suburb: "Collingwood", state: "VIC" }),
      eventAt(at, { suburb: "Fitzroy", state: "VIC" }),
      eventAt(at, { suburb: "Newtown", state: "NSW" }),
    ]);
    expect(groups).toEqual([
      {
        state: "NSW",
        label: "New South Wales",
        suburbs: [
          { value: "Newtown", label: "Newtown, NSW" },
          { value: "Richmond NSW", label: "Richmond, NSW" },
        ],
      },
      {
        state: "VIC",
        label: "Victoria",
        suburbs: [
          { value: "Collingwood", label: "Collingwood, VIC" },
          { value: "Fitzroy", label: "Fitzroy, VIC" },
        ],
      },
      { state: "WA", label: "Western Australia", suburbs: [{ value: "Northbridge", label: "Northbridge, WA" }] },
    ]);
  });
});
