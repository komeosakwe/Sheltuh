import { describe, expect, it } from "vitest";
import {
  formatWeekendRange,
  latestWeekendEnd,
  popularEvents,
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
    // The soonest event is in Coming up (no trending data), like any other.
    expect(sections.popular?.kind).toBe("coming");
    expect(popularEvents(sections.popular).map((e) => e.id)).toEqual(["thu", "fri"]);
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

  it("each priority claims its events: This weekend, then Popular right now in the server's order (mobile-redesign.md §6.3.2)", () => {
    const events = [
      event("next", day(22)),
      event("sat", day(24), { priceCents: 0 }),
      ...[27, 28, 29, 30].map((d) => event(`t${d}`, day(d))),
      ...Array.from({ length: 8 }, (_, i) => event(`c${i}`, `2026-11-0${i + 1}T08:00:00.000Z`)),
    ];
    const trending = [events[0], events[1], ...events.slice(2, 6)].map((e) => trend(e));
    const sections = selectHomeSections(events, trending, NOW);

    expect(sections.weekend.items.map((e) => e.id)).toEqual(["sat"]);
    // Popular keeps the server's order, minus what's already shown (the weekend's), with its signals.
    expect(sections.popular?.kind).toBe("popular");
    if (sections.popular?.kind !== "popular") throw new Error("expected popular");
    expect(sections.popular.items.map(({ event: e }) => e.id)).toEqual(["next", "t27", "t28", "t29", "t30"]);
    expect(sections.popular.items[0].signal).toEqual({ kind: "going", count: 20 });
    // There's no Free & low-cost or separate Coming up on the home any more (§6.3.1).
    expect(sections).not.toHaveProperty("lowCost");
    expect(sections).not.toHaveProperty("comingUp");
    expect(sections).not.toHaveProperty("trending");

    const ids = shownEventIds(sections);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["sat", "next", "t27", "t28", "t29", "t30"]);
  });

  it("Popular needs three after de-duplication; otherwise the slot is Coming up with the soonest not yet started", () => {
    // The Saturday event is This weekend's, leaving trending two.
    const events = [event("sat", day(24)), event("a", day(27)), event("b", day(28)), event("c", day(29))];
    const sections = selectHomeSections(events, [trend(events[0]), trend(events[1]), trend(events[2])], NOW);
    expect(sections.popular).toEqual({ kind: "coming", items: [events[1], events[2], events[3]] });
    // Non-trending events are never labelled popular.
    expect(sections.popular?.kind).not.toBe("popular");
  });

  it("Popular drops ended trending events (then falls back to Coming up)", () => {
    const events = [event("next", day(22)), event("a", day(27)), event("b", day(28))];
    const ended = event("old", "2026-10-01T08:00:00.000Z");
    const sections = selectHomeSections(events, [trend(ended), trend(events[1]), trend(events[2])], NOW);
    expect(sections.popular?.kind).toBe("coming");
    expect(shownEventIds(sections)).not.toContain("old");
  });

  it("Coming up needs two not yet started; with fewer the slot is hidden (null)", () => {
    expect(selectHomeSections([event("only", day(27))], [], NOW).popular).toBeNull();
    // In progress (not yet ended, but started) doesn't count as coming up.
    const running = event("running", "2026-10-20T08:00:00.000Z", { endsAt: "2026-10-29T08:00:00.000Z" });
    expect(selectHomeSections([running, event("only", day(27))], [], at("2026-10-26T01:00:00.000Z")).popular).toBeNull();
  });

  it("caps the slot at six", () => {
    const events = [event("next", day(22)), ...Array.from({ length: 10 }, (_, i) => event(`c${i}`, `2026-11-1${i}T08:00:00.000Z`))];
    expect(popularEvents(selectHomeSections(events, [], NOW).popular)).toHaveLength(6);
    const trending = events.map((e) => trend(e));
    expect(popularEvents(selectHomeSections(events, trending, NOW).popular)).toHaveLength(6);
  });
});

describe("selectHomeSections: From organisers you follow", () => {
  const NOW = at("2026-10-21T01:00:00.000Z"); // Wed 21 Oct, 12:00 AEDT
  const thursday = event("next", "2026-10-22T08:00:00.000Z");
  const sat = event("sat", "2026-10-24T08:00:00.000Z");
  const later = Array.from({ length: 4 }, (_, i) => event(`l${i}`, `2026-11-0${i + 1}T08:00:00.000Z`));
  const followedOnly = event("followed", "2026-11-10T08:00:00.000Z");

  it("comes after This weekend and before Popular right now, without repeating what's above, and claims its events", () => {
    const following = [sat, thursday, later[0], followedOnly];
    const trending = [later[0], later[1], later[2], later[3]].map((e) => trend(e));
    const sections = selectHomeSections([thursday, sat, ...later], trending, NOW, following);
    // Soonest first; the weekend's event is already shown above.
    expect(sections.following.map((e) => e.id)).toEqual(["next", "l0", "followed"]);
    // Popular no longer shows l0 (claimed by the rail above it).
    expect(sections.popular?.kind).toBe("popular");
    expect(popularEvents(sections.popular).map((event) => event.id)).toEqual(["l1", "l2", "l3"]);
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

describe("This weekend in each event's own zone (owner plan S6)", () => {
  const PERTH = { state: "WA", timeZone: "Australia/Perth" } as const;

  it("weekendWindow(now, zone): the heading's weekend, Fri 17:00 to Sun 23:59:59.999 on the zone's clock", () => {
    // Perth is AWST (UTC+8) all year: Fri 23 Oct 17:00 AWST = 09:00Z; Sun 25 Oct 23:59:59.999 AWST = 15:59:59.999Z.
    expect(weekendWindow(NOW, "Australia/Perth")).toEqual({
      start: Date.parse("2026-10-23T09:00:00.000Z"),
      end: Date.parse("2026-10-25T15:59:59.999Z"),
      during: false,
    });
    // Fri 18:00 AEDT is 15:00 AWST: Melbourne's weekend is on, Perth's starts at 17:00 there.
    const friEvening = at("2026-10-23T07:00:00.000Z");
    expect(weekendWindow(friEvening).during).toBe(true);
    expect(weekendWindow(friEvening, "Australia/Perth")).toMatchObject({ start: Date.parse("2026-10-23T09:00:00.000Z"), during: false });
    // The default zone is Melbourne's.
    expect(weekendWindow(NOW, "Australia/Melbourne")).toEqual(weekendWindow(NOW));
  });

  it("a Perth event at 11 pm on Sunday, Perth time (Monday 2 am in Melbourne), is this weekend", () => {
    // Sun 25 Oct 23:00 AWST = 15:00Z = Mon 26 Oct 02:00 AEDT.
    const perthSunday = event("perth-sun", "2026-10-25T15:00:00.000Z", { ...PERTH, endsAt: "2026-10-25T15:45:00.000Z" });
    // The same instant in Melbourne is Monday: not this weekend.
    const melbourneMonday = event("melb-mon", "2026-10-25T15:00:00.000Z");
    const sections = selectHomeSections([perthSunday, melbourneMonday, event("mon", day(26))], [], NOW);
    expect(sections.weekend.items.map((e) => e.id)).toEqual(["perth-sun"]);
    // The heading stays Melbourne's.
    expect(formatWeekendRange(sections.weekend.window)).toBe("Fri 23 – Sun 25 Oct");
  });

  it("a Perth event at 4 pm on Friday, Perth time (7 pm in Melbourne), isn't: Perth's weekend starts at 5 pm there", () => {
    const perthFriday = event("perth-fri", "2026-10-23T08:00:00.000Z", { ...PERTH, endsAt: "2026-10-23T08:30:00.000Z" });
    const melbourneFriday = event("melb-fri", "2026-10-23T08:00:00.000Z", { endsAt: "2026-10-23T08:30:00.000Z" });
    const sections = selectHomeSections([perthFriday, melbourneFriday], [], NOW);
    expect(sections.weekend.items.map((e) => e.id)).toEqual(["melb-fri"]);
  });

  it("an event where the weekend is already over isn't in it (Norfolk Island, late on a Melbourne Sunday)", () => {
    // Sun 25 Oct 23:30 AEDT = Mon 26 Oct 00:30 on Norfolk Island (UTC+12 in daylight saving).
    const lateSunday = at("2026-10-25T12:30:00.000Z");
    const norfolk = weekendWindow(lateSunday, "Pacific/Norfolk");
    expect(norfolk.start).toBeGreaterThan(norfolk.end);
    const running = event("norfolk-run", "2026-10-20T00:00:00.000Z", {
      state: "OT",
      timeZone: "Pacific/Norfolk",
      endsAt: "2026-11-20T00:00:00.000Z",
    });
    expect(selectHomeSections([running], [], lateSunday).weekend.items).toEqual([]);
  });

  it("latestWeekendEnd: the Cocos (Keeling) Islands' Sunday midnight, the last in any zone", () => {
    // Sun 25 Oct 23:59:59.999 at UTC+6:30 = 17:29:59.999Z.
    expect(latestWeekendEnd(NOW)).toBe(Date.parse("2026-10-25T17:29:59.999Z"));
    expect(latestWeekendEnd(NOW)).toBeGreaterThan(weekendWindow(NOW, "Australia/Perth").end);
  });
});

describe("selectHomeSections: the saved suburb's state first (owner decision D5)", () => {
  // Thu 22 Oct 2026, noon AEDT: before the weekend.
  const now = at("2026-10-22T01:00:00.000Z");
  const sat = (hourUtc: number) => `2026-10-24T${String(hourUtc).padStart(2, "0")}:00:00.000Z`;
  const vic1 = event("vic-1", sat(1));
  const wa1 = event("wa-1", sat(2), { state: "WA", timeZone: "Australia/Perth", suburb: "Northbridge" });
  const vic2 = event("vic-2", sat(3), { state: "VIC" });
  const wa2 = event("wa-2", sat(4), { state: "WA", timeZone: "Australia/Perth", suburb: "Perth" });
  const events = [vic1, wa1, vic2, wa2];

  it("without one: Australia-wide, soonest first", () => {
    expect(selectHomeSections(events, [], now).weekend.items.map((e) => e.id)).toEqual(["vic-1", "wa-1", "vic-2", "wa-2"]);
    expect(selectHomeSections(events, [], now, [], null).weekend.items.map((e) => e.id)).toEqual([
      "vic-1",
      "wa-1",
      "vic-2",
      "wa-2",
    ]);
  });

  it("with Western Australia: its events first, each part still soonest first (a stable reorder)", () => {
    expect(selectHomeSections(events, [], now, [], "WA").weekend.items.map((e) => e.id)).toEqual([
      "wa-1",
      "wa-2",
      "vic-1",
      "vic-2",
    ]);
  });

  it("an event without a state counts as Victorian", () => {
    expect(selectHomeSections(events, [], now, [], "VIC").weekend.items.map((e) => e.id)).toEqual([
      "vic-1",
      "vic-2",
      "wa-1",
      "wa-2",
    ]);
  });

  it("applies to every section before it takes its six: following, Popular and Coming up", () => {
    const later = (id: string, day: number, state?: "WA") =>
      event(id, `2026-11-${String(day).padStart(2, "0")}T09:00:00.000Z`, state ? { state, timeZone: "Australia/Perth" } : {});
    const vics = [1, 2, 3, 4, 5, 6].map((day) => later(`v${day}`, day));
    const perth = later("p7", 7, "WA");
    const coming = selectHomeSections([...vics, perth], [], now, [], "WA").popular;
    expect(coming?.kind).toBe("coming");
    // Seventh soonest, but first: it isn't cut off by the six before it.
    expect(popularEvents(coming).map((e) => e.id)).toEqual(["p7", "v1", "v2", "v3", "v4", "v5"]);

    const popular = selectHomeSections([], [...vics, perth].map((e) => trend(e)), now, [], "WA").popular;
    expect(popular?.kind).toBe("popular");
    expect(popularEvents(popular)[0].id).toBe("p7");

    const following = selectHomeSections([], [], now, [...vics, perth], "WA").following;
    expect(following.map((e) => e.id)).toEqual(["p7", "v1", "v2", "v3", "v4", "v5"]);
  });
});
