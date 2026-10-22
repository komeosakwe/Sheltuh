import { describe, expect, it } from "vitest";
import {
  formatWeekendRange,
  selectHomeSections,
  shownEventIds,
  weekendWindow,
  type TrendingItem,
} from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";

const iso = (ms: number) => new Date(ms).toISOString();
const at = (utc: string) => new Date(utc);

function event(id: string, startsAt: string, opts: Partial<SheltuhEvent> & { priceCents?: number } = {}): SheltuhEvent {
  const { priceCents = 3000, ...rest } = opts;
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "art",
    suburb: "Fitzroy",
    venueName: "Venue",
    venueAddress: "1 St",
    startsAt,
    endsAt: iso(Date.parse(startsAt) + 3 * 3600_000),
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...rest,
  };
}

const trend = (e: SheltuhEvent, count = 20): TrendingItem => ({ event: e, signal: { kind: "going", count } });

// October 2026 in Melbourne is AEDT (UTC+11): daylight saving started Sun 4 Oct 2026.
// This weekend: Fri 23 Oct 17:00 AEDT (06:00Z) to Sun 25 Oct 23:59:59.999 AEDT (12:59:59.999Z).
const FRI_23_1700 = Date.parse("2026-10-23T06:00:00.000Z");
const SUN_25_END = Date.parse("2026-10-25T12:59:59.999Z");

describe("weekendWindow (Australia/Melbourne wall clock)", () => {
  it.each([
    ["Thu 23:59", "2026-10-22T12:59:00.000Z"],
    ["Fri 16:59", "2026-10-23T05:59:00.000Z"],
  ])("%s: the coming Fri 17:00 to Sun 23:59:59.999, not yet during", (_label, now) => {
    expect(weekendWindow(at(now))).toEqual({ start: FRI_23_1700, end: SUN_25_END, during: false });
  });

  it.each([
    ["Fri 17:00", "2026-10-23T06:00:00.000Z"],
    ["Sat noon", "2026-10-24T01:00:00.000Z"],
    ["Sun 23:59", "2026-10-25T12:59:00.000Z"],
  ])("%s: from now to this Sun 23:59:59.999, during", (_label, now) => {
    expect(weekendWindow(at(now))).toEqual({ start: Date.parse(now), end: SUN_25_END, during: true });
  });

  it("Mon 00:00: next week's weekend, across the month end", () => {
    const window = weekendWindow(at("2026-10-25T13:00:00.000Z")); // Mon 26 Oct 00:00 AEDT
    expect(window).toEqual({
      start: Date.parse("2026-10-30T06:00:00.000Z"),
      end: Date.parse("2026-11-01T12:59:59.999Z"),
      during: false,
    });
    expect(formatWeekendRange(window)).toBe("Fri 30 Oct – Sun 1 Nov");
  });

  it("DST starts on the Sunday (4 Oct 2026): Friday is AEST, Sunday night AEDT", () => {
    const window = weekendWindow(at("2026-10-02T00:00:00.000Z")); // Fri 2 Oct 10:00 AEST
    expect(window).toEqual({
      start: Date.parse("2026-10-02T07:00:00.000Z"), // Fri 17:00 AEST (UTC+10)
      end: Date.parse("2026-10-04T12:59:59.999Z"), // Sun 23:59:59.999 AEDT (UTC+11)
      during: false,
    });
    expect(formatWeekendRange(window)).toBe("Fri 2 – Sun 4 Oct");
  });

  it("DST ends on the Sunday (5 Apr 2026): Friday is AEDT, Sunday night AEST", () => {
    const window = weekendWindow(at("2026-04-01T01:00:00.000Z")); // Wed 1 Apr 12:00 AEDT
    expect(window).toEqual({
      start: Date.parse("2026-04-03T06:00:00.000Z"), // Fri 17:00 AEDT (UTC+11)
      end: Date.parse("2026-04-05T13:59:59.999Z"), // Sun 23:59:59.999 AEST (UTC+10)
      during: false,
    });
    // Saturday during that weekend: the end is still Sunday night in AEST.
    expect(weekendWindow(at("2026-04-04T01:00:00.000Z")).end).toBe(Date.parse("2026-04-05T13:59:59.999Z"));
  });
});

describe("formatWeekendRange", () => {
  it("before the weekend: the Friday-to-Sunday range", () => {
    expect(formatWeekendRange(weekendWindow(at("2026-10-21T01:00:00.000Z")))).toBe("Fri 23 – Sun 25 Oct");
  });

  it("during the weekend: until Sunday", () => {
    expect(formatWeekendRange(weekendWindow(at("2026-10-24T01:00:00.000Z")))).toBe("Until Sun 25 Oct");
  });
});

// Wed 21 Oct 2026, 12:00 AEDT.
const NOW = at("2026-10-21T01:00:00.000Z");
const day = (d: number, hourUtc = 8) => `2026-10-${String(d).padStart(2, "0")}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`;

describe("selectHomeSections", () => {
  it("drops ended events; there's no Up next claiming the soonest (mobile-redesign.md §6.3.2)", () => {
    const sections = selectHomeSections(
      [
        event("ended", "2026-10-01T08:00:00.000Z"),
        event("exhibition", "2026-10-10T00:00:00.000Z", { endsAt: "2026-11-30T08:00:00.000Z" }),
        event("thu", day(22)),
        event("fri", day(23, 1)),
      ],
      [],
      NOW,
    );
    expect(sections).not.toHaveProperty("upNext");
    expect(sections.anyUpcoming).toBe(true);
    expect(shownEventIds(sections)).not.toContain("ended");
    // The soonest event is in Coming up, like any other.
    expect(sections.comingUp.map((e) => e.id)).toEqual(["thu", "fri"]);
  });

  it("says when nothing at all is upcoming", () => {
    expect(selectHomeSections([event("ended", "2026-10-01T08:00:00.000Z")], [], NOW).anyUpcoming).toBe(false);
    expect(selectHomeSections([], [], NOW).anyUpcoming).toBe(false);
  });

  it("This weekend: anything open in the window; events starting in it first, then those already running (owner decision 5)", () => {
    const events = [
      event("next", day(22)),
      // Fri 14:00–18:00 AEDT overlaps 17:00: open in the window, but already running when it opens.
      event("fri-afternoon", "2026-10-23T03:00:00.000Z", { endsAt: "2026-10-23T07:00:00.000Z" }),
      event("sun", day(25, 2)),
      event("sat", day(24)),
      // Starts exactly at the window's start (Fri 17:00 AEDT): starts inside it.
      event("fri-evening", "2026-10-23T06:00:00.000Z"),
      // A multi-day exhibition open through the weekend: already running, so after every event starting in it.
      event("exhibition", "2026-10-15T00:00:00.000Z", { endsAt: "2026-11-15T08:00:00.000Z" }),
      event("mon", day(26)),
    ];
    const sections = selectHomeSections(events, [], NOW);
    expect(sections.weekend.status).toBe("cards");
    expect(sections.weekend.items.map((e) => e.id)).toEqual([
      // Starting inside the window, by start.
      "fri-evening",
      "sat",
      "sun",
      // Already running when it opens, by start.
      "exhibition",
      "fri-afternoon",
    ]);
  });

  it("This weekend: ties on start are broken by id", () => {
    const sections = selectHomeSections(
      [event("next", day(22)), event("sat-b", day(24)), event("sat-a", day(24))],
      [],
      NOW,
    );
    expect(sections.weekend.items.map((e) => e.id)).toEqual(["sat-a", "sat-b"]);
  });

  it("This weekend: an in-progress event counts during the weekend", () => {
    const sat = at("2026-10-24T01:00:00.000Z");
    const sections = selectHomeSections(
      [
        event("up", "2026-10-24T08:00:00.000Z"),
        event("on-now", "2026-10-23T22:00:00.000Z", { endsAt: "2026-10-24T04:00:00.000Z" }),
      ],
      [],
      sat,
    );
    // Starting inside the window first, then already running.
    expect(sections.weekend.items.map((e) => e.id)).toEqual(["up", "on-now"]);
  });

  it("This weekend: empty state before the weekend, hidden during it", () => {
    const empty = selectHomeSections([event("a", day(28)), event("b", day(29))], [], NOW);
    expect(empty.weekend.status).toBe("empty");
    expect(empty.weekend.items).toEqual([]);

    const during = selectHomeSections([event("a", day(28))], [], at("2026-10-24T01:00:00.000Z"));
    expect(during.weekend.status).toBe("hidden");

    const on = selectHomeSections([event("sat", day(24)), event("b", day(29))], [], NOW);
    expect(on.weekend.status).toBe("cards");
    expect(on.weekend.items.map((e) => e.id)).toEqual(["sat"]);
  });

  it("each priority claims its events: This weekend, Trending, Coming up, Free & low-cost", () => {
    const events = [
      event("next", day(22)),
      event("sat", day(24), { priceCents: 0 }),
      ...[27, 28, 29, 30].map((d) => event(`t${d}`, day(d))),
      ...Array.from({ length: 8 }, (_, i) => event(`c${i}`, `2026-11-0${i + 1}T08:00:00.000Z`)),
      event("free-late", "2026-11-20T08:00:00.000Z", { priceCents: 0 }),
      event("cheap-late", "2026-11-21T08:00:00.000Z", { priceCents: 1000 }),
    ];
    const trending = [events[0], events[1], ...events.slice(2, 6)].map((e) => trend(e));
    const sections = selectHomeSections(events, trending, NOW);

    expect(sections.weekend.items.map((e) => e.id)).toEqual(["sat"]);
    // Trending keeps the server's order, minus what's already shown (the weekend's).
    expect(sections.trending.map(({ event: e }) => e.id)).toEqual(["next", "t27", "t28", "t29", "t30"]);
    expect(sections.comingUp.map((e) => e.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
    // The free Saturday event is already in This weekend, so Free & low-cost takes the later ones.
    expect(sections.lowCost).toEqual([
      { event: events.find((e) => e.id === "free-late"), badge: "free" },
      { event: events.find((e) => e.id === "cheap-late"), badge: "low-cost" },
    ]);

    const ids = shownEventIds(sections);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Trending needs three after de-duplication; when hidden, its events stay available to Coming up", () => {
    // The Saturday event is This weekend's, leaving Trending two.
    const events = [event("sat", day(24)), event("a", day(27)), event("b", day(28)), event("c", day(29))];
    const sections = selectHomeSections(events, [trend(events[0]), trend(events[1]), trend(events[2])], NOW);
    expect(sections.trending).toEqual([]);
    expect(sections.comingUp.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("Trending drops ended events", () => {
    const events = [event("next", day(22)), event("a", day(27)), event("b", day(28))];
    const ended = event("old", "2026-10-01T08:00:00.000Z");
    const sections = selectHomeSections(events, [trend(ended), trend(events[1]), trend(events[2])], NOW);
    expect(sections.trending).toEqual([]);
  });

  it("Coming up and Free & low-cost need two each; a lone one releases its event", () => {
    const sections = selectHomeSections([event("free", day(27), { priceCents: 0 })], [], NOW);
    expect(sections.comingUp).toEqual([]);
    expect(sections.lowCost).toEqual([]);
  });

  it("Free & low-cost: free external events count as free; paid external events never count (no known price)", () => {
    const external = (id: string, d: number, externalFree: boolean) =>
      event(id, day(d), {
        ticketTypes: [],
        ticketingMode: "external",
        externalTicketUrl: "https://events.humanitix.com/x",
        externalFree,
        externalProvider: "Humanitix",
      });
    // Mon 26 Oct: these three are in progress (so Coming up, which is not-yet-started only, skips
    // them) and end before Friday (so This weekend doesn't take them).
    const open = (e: SheltuhEvent): SheltuhEvent => ({ ...e, startsAt: "2026-10-25T22:00:00.000Z", endsAt: "2026-10-28T08:00:00.000Z" });
    const sections = selectHomeSections(
      [event("next", day(27)), open(external("ext-free", 27, true)), open(external("ext-paid", 27, false)), open(event("cheap", day(27), { priceCents: 1500 }))],
      [],
      at("2026-10-26T01:00:00.000Z"),
    );
    expect(sections.lowCost.map(({ event: e, badge }) => [e.id, badge])).toEqual([
      ["cheap", "low-cost"],
      ["ext-free", "free"],
    ]);
  });

  it("caps every section at six", () => {
    const events = [event("next", day(22)), ...Array.from({ length: 10 }, (_, i) => event(`c${i}`, `2026-11-1${i}T08:00:00.000Z`))];
    expect(selectHomeSections(events, [], NOW).comingUp).toHaveLength(6);
  });
});

describe("selectHomeSections: From organisers you follow", () => {
  const NOW = at("2026-10-21T01:00:00.000Z"); // Wed 21 Oct, 12:00 AEDT
  const thursday = event("next", "2026-10-22T08:00:00.000Z");
  const sat = event("sat", "2026-10-24T08:00:00.000Z");
  const later = Array.from({ length: 4 }, (_, i) => event(`l${i}`, `2026-11-0${i + 1}T08:00:00.000Z`));
  const followedOnly = event("followed", "2026-11-10T08:00:00.000Z");

  it("comes after This weekend and before Trending, without repeating what's above, and claims its events", () => {
    const following = [sat, thursday, later[0], followedOnly];
    const trending = [later[0], later[1], later[2], later[3]].map((e) => trend(e));
    const sections = selectHomeSections([thursday, sat, ...later], trending, NOW, following);
    // Soonest first; the weekend's event is already shown above.
    expect(sections.following.map((e) => e.id)).toEqual(["next", "l0", "followed"]);
    // Trending no longer shows l0 (claimed by the rail above it).
    expect(sections.trending.map(({ event }) => event.id)).toEqual(["l1", "l2", "l3"]);
    const ids = shownEventIds(sections);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.indexOf("followed")).toBeLessThan(ids.indexOf("l1"));
    expect(ids.indexOf("sat")).toBeLessThan(ids.indexOf("l0"));
  });

  it("is empty (hidden) with no follows, or when everything is already shown above, and drops ended events", () => {
    expect(selectHomeSections([thursday, sat], [], NOW).following).toEqual([]);
    expect(selectHomeSections([thursday, sat], [], NOW, [sat]).following).toEqual([]);
    const ended = event("old", "2026-10-01T08:00:00.000Z");
    expect(selectHomeSections([thursday], [], NOW, [ended]).following).toEqual([]);
  });

  it("shows even one event (the member asked for them)", () => {
    expect(selectHomeSections([thursday], [], NOW, [followedOnly]).following.map((e) => e.id)).toEqual(["followed"]);
  });
});
