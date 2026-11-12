import { describe, expect, it } from "vitest";
import {
  FEATURED_MAX,
  formatWeekendRange,
  isOpenThisWeekend,
  latestWeekendEnd,
  popularEvents,
  selectHomeSections,
  shownEventIds,
  swipeFeedEvents,
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

/**
 * Five trending events in December: they fill the carousel, which claims first, so a test about
 * This weekend (or following) sees its own events there. Their trending items come first, so the
 * carousel takes them and nothing else.
 */
const DECOYS = Array.from({ length: FEATURED_MAX }, (_, i) => event(`dec-${i}`, `2026-12-${String(i + 10)}T08:00:00.000Z`));
const withCarouselFull = (
  events: SheltuhEvent[],
  trending: TrendingItem[],
  now: Date,
  ...rest: [SheltuhEvent[]?, ("VIC" | "WA" | "NSW" | null)?]
) => selectHomeSections([...events, ...DECOYS], [...DECOYS.map((e) => trend(e)), ...trending], now, rest[0] ?? [], rest[1] ?? null);

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
    // No trending data: the carousel is Coming up, the soonest (not yet started, then any still
    // running), claimed first, so This weekend has nothing left.
    expect(sections.popular?.kind).toBe("coming");
    expect(popularEvents(sections.popular).map((e) => e.id)).toEqual(["thu", "fri", "exhibition"]);
    expect(sections.weekend.status).toBe("hidden");
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
    const sections = withCarouselFull(events, [], NOW);
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

  it("This weekend's edges: a Friday-morning start isn't in it, a Sunday 11:30 pm one is, Monday's isn't", () => {
    const events = [
      // Fri 23 Oct 09:00–11:00 AEDT: over before the weekend opens at 17:00.
      event("fri-morning", "2026-10-22T22:00:00.000Z", { endsAt: "2026-10-23T00:00:00.000Z" }),
      // Fri 23 Oct 17:00 AEDT exactly.
      event("fri-1700", "2026-10-23T06:00:00.000Z"),
      // Sun 25 Oct 23:30 AEDT: the last half hour of the window.
      event("sun-late", "2026-10-25T12:30:00.000Z"),
      // Mon 26 Oct 00:00 AEDT: next week.
      event("mon-midnight", "2026-10-25T13:00:00.000Z"),
    ];
    expect(withCarouselFull(events, [], NOW).weekend.items.map((e) => e.id)).toEqual(["fri-1700", "sun-late"]);

    // On the Friday morning itself, the weekend hasn't started: the same window, not yet during.
    const friMorning = at("2026-10-22T21:30:00.000Z"); // Fri 23 Oct 08:30 AEDT
    const early = withCarouselFull(events, [], friMorning);
    expect(early.weekend.window.during).toBe(false);
    expect(formatWeekendRange(early.weekend.window)).toBe("Fri 23 – Sun 25 Oct");
    expect(early.weekend.items.map((e) => e.id)).toEqual(["fri-1700", "sun-late"]);

    // Late on the Sunday night it's still this weekend, until midnight.
    const sunNight = at("2026-10-25T12:45:00.000Z"); // Sun 25 Oct 23:45 AEDT
    const late = withCarouselFull(events, [], sunNight);
    expect(late.weekend.window.during).toBe(true);
    expect(formatWeekendRange(late.weekend.window)).toBe("Until Sun 25 Oct");
    // The 11:30 pm start is under way (it runs to 2:30 am), so it's still on.
    expect(late.weekend.items.map((e) => e.id)).toEqual(["sun-late"]);

    // From Monday 00:00 it's next weekend's window, and Sunday's events have gone from it.
    const monday = withCarouselFull(events, [], at("2026-10-25T13:00:00.000Z"));
    expect(formatWeekendRange(monday.weekend.window)).toBe("Fri 30 Oct – Sun 1 Nov");
    expect(monday.weekend.items).toEqual([]);
  });

  it("This weekend carries the server's going counts for its trending events, and only those", () => {
    const sat = event("sat", day(24));
    const sun = event("sun", day(25, 2));
    const later = event("later", day(28));
    const popular: TrendingItem = { event: sun, signal: { kind: "popular" } };
    const sections = withCarouselFull([sat, sun, later], [trend(sat, 42), popular, trend(later, 18)], NOW);
    expect(sections.weekend.items.map((e) => e.id)).toEqual(["sat", "sun"]);
    // Sun is trending without a count; "later" isn't this weekend's.
    expect(sections.weekend.going).toEqual({ sat: 42 });
    expect(withCarouselFull([sat, sun], [], NOW).weekend.going).toEqual({});
  });

  it("This weekend: ties on start are broken by id", () => {
    const sections = withCarouselFull(
      [event("next", day(22)), event("sat-b", day(24)), event("sat-a", day(24))],
      [],
      NOW,
    );
    expect(sections.weekend.items.map((e) => e.id)).toEqual(["sat-a", "sat-b"]);
  });

  it("This weekend: an in-progress event counts during the weekend", () => {
    const sat = at("2026-10-24T01:00:00.000Z");
    const sections = withCarouselFull(
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

  it("This weekend: hidden with nothing on, before or during it", () => {
    const empty = withCarouselFull([event("a", day(28)), event("b", day(29))], [], NOW);
    expect(empty.weekend.status).toBe("hidden");
    expect(empty.weekend.items).toEqual([]);

    const during = withCarouselFull([event("a", day(28))], [], at("2026-10-24T01:00:00.000Z"));
    expect(during.weekend.status).toBe("hidden");

    const on = withCarouselFull([event("sat", day(24)), event("b", day(29))], [], NOW);
    expect(on.weekend.status).toBe("cards");
    expect(on.weekend.items.map((e) => e.id)).toEqual(["sat"]);
  });

  it("each priority claims its events: the carousel first (Popular right now in the server's order), then This weekend", () => {
    const events = [
      event("next", day(22)),
      event("sat", day(24), { priceCents: 0 }),
      event("sun", day(25)),
      ...[27, 28, 29, 30].map((d) => event(`t${d}`, day(d))),
      ...Array.from({ length: 8 }, (_, i) => event(`c${i}`, `2026-11-0${i + 1}T08:00:00.000Z`)),
    ];
    const trending = [events[0], events[1], ...events.slice(3, 7)].map((e) => trend(e));
    const sections = selectHomeSections(events, trending, NOW);

    // The carousel: trending in the server's order, at most FEATURED_MAX, with its signals.
    expect(sections.popular?.kind).toBe("popular");
    if (sections.popular?.kind !== "popular") throw new Error("expected popular");
    expect(sections.popular.items.map(({ event: e }) => e.id)).toEqual(["next", "sat", "t27", "t28", "t29"]);
    expect(sections.popular.items[0].signal).toEqual({ kind: "going", count: 20 });
    // This weekend takes what's left of the weekend: Saturday's is already in the carousel.
    expect(sections.weekend.items.map((e) => e.id)).toEqual(["sun"]);
    expect(sections).not.toHaveProperty("lowCost");
    expect(sections).not.toHaveProperty("comingUp");
    expect(sections).not.toHaveProperty("recent");

    const ids = shownEventIds(sections);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["next", "sat", "t27", "t28", "t29", "sun"]);
  });

  it("Popular needs three upcoming trending events; otherwise the carousel is Coming up with the soonest", () => {
    const events = [event("sat", day(24)), event("a", day(27)), event("b", day(28)), event("c", day(29))];
    const sections = selectHomeSections(events, [trend(events[0]), trend(events[1])], NOW);
    expect(sections.popular).toEqual({ kind: "coming", items: events, acrossAustralia: false });
    // Non-trending events are never labelled popular.
    expect(sections.popular?.kind).not.toBe("popular");
    // The carousel always shows when anything is upcoming.
    expect(selectHomeSections([event("x", day(27))], [], NOW).popular).not.toBeNull();
  });

  it("Popular drops ended trending events (then falls back to Coming up)", () => {
    const events = [event("next", day(22)), event("a", day(27)), event("b", day(28))];
    const ended = event("old", "2026-10-01T08:00:00.000Z");
    const sections = selectHomeSections(events, [trend(ended), trend(events[1]), trend(events[2])], NOW);
    expect(sections.popular?.kind).toBe("coming");
    expect(shownEventIds(sections)).not.toContain("old");
  });

  it("Coming up shows even one event; null only when nothing is left", () => {
    expect(popularEvents(selectHomeSections([event("only", day(27))], [], NOW).popular).map((e) => e.id)).toEqual(["only"]);
    expect(selectHomeSections([], [], NOW).popular).toBeNull();
    // Not yet started first, then any still running (not ended, never hidden).
    const running = event("running", "2026-10-20T08:00:00.000Z", { endsAt: "2026-10-29T08:00:00.000Z" });
    const later = at("2026-10-26T01:00:00.000Z");
    expect(popularEvents(selectHomeSections([running, event("only", day(27))], [], later).popular).map((e) => e.id)).toEqual([
      "only",
      "running",
    ]);
    // A lone running event that ends before the weekend still shows.
    const ends = event("ends", "2026-10-20T08:00:00.000Z", { endsAt: "2026-10-22T08:00:00.000Z" });
    const sections = selectHomeSections([ends], [], NOW);
    expect(sections.weekend.status).toBe("hidden");
    expect(popularEvents(sections.popular).map((e) => e.id)).toEqual(["ends"]);
  });

  it("Coming up is Australia-wide when a state is saved and none of its events is in it", () => {
    const vic = event("vic", day(27));
    const wa = { ...event("wa", day(28)), state: "WA" as const };
    const wide = (state: "VIC" | "WA" | "NSW" | null, events = [vic, wa]) => selectHomeSections(events, [], NOW, [], state).popular;
    expect(wide(null)).toMatchObject({ kind: "coming", acrossAustralia: false });
    expect(wide("WA")).toMatchObject({ acrossAustralia: false });
    expect(wide("NSW")).toMatchObject({ acrossAustralia: true });
    expect(popularEvents(wide("NSW")).map((e) => e.id)).toEqual(["vic", "wa"]);
  });

  it(`caps the carousel at ${FEATURED_MAX}: it claims no more than it shows`, () => {
    const events = [event("next", day(22)), ...Array.from({ length: 10 }, (_, i) => event(`c${i}`, `2026-11-1${i}T08:00:00.000Z`))];
    expect(popularEvents(selectHomeSections(events, [], NOW).popular)).toHaveLength(FEATURED_MAX);
    const trending = events.map((e) => trend(e));
    expect(popularEvents(selectHomeSections(events, trending, NOW).popular)).toHaveLength(FEATURED_MAX);
  });
});

describe("selectHomeSections: From organisers you follow", () => {
  const NOW = at("2026-10-21T01:00:00.000Z"); // Wed 21 Oct, 12:00 AEDT
  const thursday = event("next", "2026-10-22T08:00:00.000Z");
  const sat = event("sat", "2026-10-24T08:00:00.000Z");
  const later = Array.from({ length: 4 }, (_, i) => event(`l${i}`, `2026-11-0${i + 1}T08:00:00.000Z`));
  const followedOnly = event("followed", "2026-11-10T08:00:00.000Z");

  it("comes after the carousel and This weekend, without repeating what's above", () => {
    const following = [sat, thursday, later[0], followedOnly];
    const trending = [later[0], later[1], later[2], later[3]].map((e) => trend(e));
    const sections = selectHomeSections([thursday, sat, ...later], trending, NOW, following);
    // The carousel claims the trending four, This weekend Saturday's: what's left, soonest first.
    expect(popularEvents(sections.popular).map((event) => event.id)).toEqual(["l0", "l1", "l2", "l3"]);
    expect(sections.weekend.items.map((e) => e.id)).toEqual(["sat"]);
    expect(sections.following.map((e) => e.id)).toEqual(["next", "followed"]);
    const ids = shownEventIds(sections);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["l0", "l1", "l2", "l3", "sat", "next", "followed"]);
  });

  it("is empty (hidden) with no follows, or when everything is already shown above, and drops ended events", () => {
    expect(selectHomeSections([thursday, sat], [], NOW).following).toEqual([]);
    // Saturday's is in the carousel (Coming up) already.
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
    const sections = withCarouselFull([perthSunday, melbourneMonday, event("mon", day(26))], [], NOW);
    expect(sections.weekend.items.map((e) => e.id)).toEqual(["perth-sun"]);
    // The heading stays Melbourne's.
    expect(formatWeekendRange(sections.weekend.window)).toBe("Fri 23 – Sun 25 Oct");
  });

  it("a Perth event at 4 pm on Friday, Perth time (7 pm in Melbourne), isn't: Perth's weekend starts at 5 pm there", () => {
    const perthFriday = event("perth-fri", "2026-10-23T08:00:00.000Z", { ...PERTH, endsAt: "2026-10-23T08:30:00.000Z" });
    const melbourneFriday = event("melb-fri", "2026-10-23T08:00:00.000Z", { endsAt: "2026-10-23T08:30:00.000Z" });
    const sections = withCarouselFull([perthFriday, melbourneFriday], [], NOW);
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
    expect(withCarouselFull([running], [], lateSunday).weekend.items).toEqual([]);
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
    expect(withCarouselFull(events, [], now).weekend.items.map((e) => e.id)).toEqual(["vic-1", "wa-1", "vic-2", "wa-2"]);
    expect(withCarouselFull(events, [], now, [], null).weekend.items.map((e) => e.id)).toEqual([
      "vic-1",
      "wa-1",
      "vic-2",
      "wa-2",
    ]);
  });

  it("with Western Australia: its events first, each part still soonest first (a stable reorder)", () => {
    expect(withCarouselFull(events, [], now, [], "WA").weekend.items.map((e) => e.id)).toEqual([
      "wa-1",
      "wa-2",
      "vic-1",
      "vic-2",
    ]);
  });

  it("an event without a state counts as Victorian", () => {
    expect(withCarouselFull(events, [], now, [], "VIC").weekend.items.map((e) => e.id)).toEqual([
      "vic-1",
      "vic-2",
      "wa-1",
      "wa-2",
    ]);
  });

  it("applies to every section before it takes its share: following, Popular and Coming up", () => {
    const later = (id: string, day: number, state?: "WA") =>
      event(id, `2026-11-${String(day).padStart(2, "0")}T09:00:00.000Z`, state ? { state, timeZone: "Australia/Perth" } : {});
    const vics = [1, 2, 3, 4, 5, 6].map((day) => later(`v${day}`, day));
    const perth = later("p7", 7, "WA");
    const coming = selectHomeSections([...vics, perth], [], now, [], "WA").popular;
    expect(coming?.kind).toBe("coming");
    // Seventh soonest, but first: it isn't cut off by the ones before it.
    expect(popularEvents(coming).map((e) => e.id)).toEqual(["p7", "v1", "v2", "v3", "v4"]);

    const popular = selectHomeSections([], [...vics, perth].map((e) => trend(e)), now, [], "WA").popular;
    expect(popular?.kind).toBe("popular");
    expect(popularEvents(popular)[0].id).toBe("p7");

    const following = selectHomeSections(DECOYS, DECOYS.map((e) => trend(e)), now, [...vics, perth], "WA").following;
    expect(following.map((e) => e.id)).toEqual(["p7", "v1", "v2", "v3", "v4", "v5"]);
  });
});

describe("swipeFeedEvents", () => {
  const sat = event("sat", day(24));
  const followed = event("followed", day(30));
  const later = Array.from({ length: 3 }, (_, i) => event(`l${i}`, `2026-11-0${i + 1}T08:00:00.000Z`));

  it("is the carousel's Popular or Coming up, then This weekend, then followed organisers, in the home's order, each event once", () => {
    const trending: TrendingItem[] = later.map((e) => ({ event: e, signal: { kind: "popular" } }));
    const sections = selectHomeSections([sat, followed, ...later], trending, NOW, [followed, sat]);
    expect(swipeFeedEvents(sections).map(({ event }) => event.id)).toEqual(["l0", "l1", "l2", "sat", "followed"]);
  });

  it("names each event's section as the home titles it", () => {
    const trending: TrendingItem[] = later.map((e) => ({ event: e, signal: { kind: "popular" } }));
    const popular = selectHomeSections([sat, followed, ...later], trending, NOW, [followed, sat]);
    expect(swipeFeedEvents(popular).map(({ section }) => section)).toEqual([
      "Popular right now",
      "Popular right now",
      "Popular right now",
      "This weekend",
      "From organisers you follow",
    ]);
    const coming = selectHomeSections([sat, ...later], [], NOW, []);
    expect(swipeFeedEvents(coming).map(({ section }) => section)).toEqual(["Coming up", "Coming up", "Coming up", "Coming up"]);
  });

  it("leaves out ended events", () => {
    const sections = selectHomeSections([event("ended", "2026-10-01T08:00:00.000Z"), ...later], [], NOW);
    expect(swipeFeedEvents(sections).map(({ event }) => event.id)).toEqual(["l0", "l1", "l2"]);
  });

  it("is empty when nothing is upcoming", () => {
    expect(swipeFeedEvents(selectHomeSections([], [], NOW))).toEqual([]);
  });
});

describe("isOpenThisWeekend: This weekend's rule, shared by the section and the home's date filter", () => {
  it("is exactly the section's membership for one set of events", () => {
    const events = [
      event("fri-morning", "2026-10-22T22:00:00.000Z", { endsAt: "2026-10-23T00:00:00.000Z" }),
      event("fri-1700", "2026-10-23T06:00:00.000Z"),
      event("sun-late", "2026-10-25T12:30:00.000Z"),
      event("mon-midnight", "2026-10-25T13:00:00.000Z"),
      event("perth-sun", "2026-10-25T15:00:00.000Z", { state: "WA", timeZone: "Australia/Perth", endsAt: "2026-10-25T15:45:00.000Z" }),
      event("exhibition", "2026-10-15T00:00:00.000Z", { endsAt: "2026-11-15T08:00:00.000Z" }),
    ];
    const section = withCarouselFull(events, [], NOW).weekend.items.map((e) => e.id).sort();
    expect(events.filter((e) => isOpenThisWeekend(e, NOW)).map((e) => e.id).sort()).toEqual(section);
    expect(section).toEqual(["exhibition", "fri-1700", "perth-sun", "sun-late"]);
  });
});
