import { describe, expect, it } from "vitest";
import type { TrendingItem } from "@/lib/home-sections";
import { isOnThisMonth, isOnThisWeek, sceneData, sceneGoing, sceneMeta, type SceneSource } from "@/lib/home-scenes";
import { getSampleGoing } from "@/lib/sample-going";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

/** The home's scene cards' data (lib/home-scenes.ts): real counts only, and only whole numbers. */

const HOUR = 3600_000;

function event(id: string, startsAt: string, overrides: Partial<SheltuhEvent> = {}): SheltuhEvent {
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "art",
    suburb: "Fitzroy",
    state: "VIC",
    timeZone: "Australia/Melbourne",
    venueName: "Venue",
    venueAddress: "1 St",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * HOUR).toISOString(),
    organiserId: "org",
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...overrides,
  };
}

// Wed 21 Oct 2026, 12:00 AEDT. This week ends Sun 25 Oct 23:59:59 (Melbourne); this month, Sat 31 Oct.
const NOW = new Date("2026-10-21T01:00:00.000Z");

const source = (overrides: Partial<SceneSource>): SceneSource => ({
  mode: "live",
  events: [],
  complete: true,
  trending: [],
  now: NOW,
  ...overrides,
});
const going = (e: SheltuhEvent, count: number): TrendingItem => ({ event: e, signal: { kind: "going", count } });

describe("isOnThisWeek / isOnThisMonth", () => {
  it("this week runs from now to Sunday 23:59 in the event's own zone; a running event counts", () => {
    expect(isOnThisWeek(event("sun", "2026-10-25T12:00:00.000Z"), NOW)).toBe(true); // Sun 11 pm AEDT
    expect(isOnThisWeek(event("mon", "2026-10-25T13:30:00.000Z"), NOW)).toBe(false); // Mon 00:30 AEDT
    // Sun 10:30 pm in Perth is Mon 1:30 am in Melbourne: still Perth's Sunday.
    expect(isOnThisWeek(event("perth", "2026-10-25T14:30:00.000Z", { state: "WA", timeZone: "Australia/Perth" }), NOW)).toBe(true);
    expect(isOnThisWeek(event("running", "2026-10-20T01:00:00.000Z", { endsAt: "2026-10-30T01:00:00.000Z" }), NOW)).toBe(true);
  });

  it("this month runs to the month's end in the event's own zone, and rolls over the year", () => {
    expect(isOnThisMonth(event("oct31", "2026-10-31T10:00:00.000Z"), NOW)).toBe(true); // Sat 31 Oct, 9 pm AEDT
    expect(isOnThisMonth(event("nov1", "2026-10-31T13:30:00.000Z"), NOW)).toBe(false); // Sun 1 Nov, 00:30 AEDT
    expect(isOnThisMonth(event("perth", "2026-10-31T14:30:00.000Z", { state: "WA", timeZone: "Australia/Perth" }), NOW)).toBe(true);
    const december = new Date("2026-12-20T01:00:00.000Z");
    expect(isOnThisMonth(event("nye", "2026-12-31T10:00:00.000Z"), december)).toBe(true);
    expect(isOnThisMonth(event("jan", "2027-01-02T10:00:00.000Z"), december)).toBe(false);
  });
});

describe("sceneGoing", () => {
  const thisWeek = event("a1", "2026-10-22T08:00:00.000Z");
  const thisWeek2 = event("a2", "2026-10-24T08:00:00.000Z");

  it("live: sums only the server's thresholded counts for the category's events this week, each event once", () => {
    const trending: TrendingItem[] = [
      going(thisWeek, 12),
      going(thisWeek2, 7),
      going(thisWeek, 12), // the same event twice: once
      { event: event("pop", "2026-10-23T08:00:00.000Z"), signal: { kind: "popular" } }, // no count
      going(event("next", "2026-10-27T08:00:00.000Z"), 30), // next week
      going(event("music", "2026-10-22T08:00:00.000Z", { category: "live-music" }), 40), // another category
      going(event("ext", "2026-10-22T08:00:00.000Z", { ticketingMode: "external" }), 50), // no Who's Going
      going(event("low", "2026-10-22T08:00:00.000Z"), 2), // under the threshold
    ];
    expect(sceneGoing("art", source({ trending }))).toEqual({ count: 19, sample: false });
  });

  it("live: never counts loaded events that carry no count (no trending signal)", () => {
    expect(sceneGoing("art", source({ events: [thisWeek, thisWeek2] }))).toBeNull();
  });

  it("demo: sums the sample counts of the category's events this week, flagged sample", () => {
    const events = [thisWeek, thisWeek2, event("next", "2026-10-27T08:00:00.000Z")];
    const expected = getSampleGoing("a1").count + getSampleGoing("a2").count;
    expect(sceneGoing("art", source({ mode: "demo", events }))).toEqual({ count: expected, sample: true });
    expect(sceneGoing("pop-up", source({ mode: "demo", events }))).toBeNull();
  });
});

describe("sceneMeta", () => {
  const events = [
    event("oct", "2026-10-29T08:00:00.000Z"),
    event("nov", "2026-11-05T08:00:00.000Z"),
    event("nov2", "2026-11-12T08:00:00.000Z", { category: "pop-up" }),
  ];
  const meta = (category: EventCategory, complete = true) => sceneMeta(category, source({ events, complete }));

  it("counts this month's events, else the upcoming ones, else says there are none", () => {
    expect(meta("art")).toBe("1 event this month");
    expect(sceneMeta("art", source({ events: [...events, event("oct2", "2026-10-30T08:00:00.000Z")] }))).toBe("2 events this month");
    expect(meta("pop-up")).toBe("1 upcoming");
    expect(meta("live-music")).toBe("No upcoming events");
  });

  it("says nothing when the loaded events may not be all of them", () => {
    expect(meta("art", false)).toBeNull();
    expect(meta("live-music", false)).toBeNull();
  });
});

describe("sceneData", () => {
  it("leads with the category's first event in the home's order, or none", () => {
    const events = [event("m", "2026-10-22T08:00:00.000Z", { category: "live-music" }), event("a", "2026-10-23T08:00:00.000Z"), event("b", "2026-10-22T09:00:00.000Z")];
    expect(sceneData("art", source({ events })).lead?.id).toBe("a");
    expect(sceneData("pop-up", source({ events }))).toEqual({ lead: null, going: null, meta: "No upcoming events" });
  });
});
