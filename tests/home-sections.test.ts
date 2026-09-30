import { describe, expect, it } from "vitest";
import { firstSentence, selectHomeSections } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";

function event(id: string, startsAt: string, priceCents = 3000, endsAt?: string): SheltuhEvent {
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "First sentence. Second sentence.",
    category: "art",
    suburb: "Fitzroy",
    venueName: "Venue",
    venueAddress: "1 Street",
    startsAt,
    endsAt,
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000", primary: "#fff", secondary: "#f00" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

// Noon on Wed 30 Sep 2026 in Melbourne (AEST, +10).
const NOW = new Date("2026-09-30T02:00:00.000Z");

describe("selectHomeSections", () => {
  it("drops events that have ended (by end time, else start time) before choosing anything", () => {
    const sections = selectHomeSections(
      [
        event("ended", "2026-09-29T08:00:00.000Z", 0, "2026-09-29T11:00:00.000Z"),
        event("ended-no-end", "2026-09-30T01:00:00.000Z"),
        event("running", "2026-09-29T23:00:00.000Z", 3000, "2026-09-30T06:00:00.000Z"),
        event("later", "2026-10-02T08:00:00.000Z"),
      ],
      NOW,
    );
    expect(sections.featured?.id).toBe("running");
    expect(sections.comingUp).toEqual([]);
  });

  it("features the soonest event and puts the next six in Coming up", () => {
    const events = Array.from({ length: 10 }, (_, i) => event(`e${i}`, `2026-10-${String(10 + i)}T08:00:00.000Z`)).reverse();
    const sections = selectHomeSections(events, NOW);
    expect(sections.featured?.id).toBe("e0");
    expect(sections.comingUp.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
  });

  it("hides Coming up with fewer than two events", () => {
    const sections = selectHomeSections([event("a", "2026-10-01T08:00:00.000Z"), event("b", "2026-10-02T08:00:00.000Z")], NOW);
    expect(sections.featured?.id).toBe("a");
    expect(sections.comingUp).toEqual([]);
  });

  it("fills What's on with this month's events that aren't featured or in Coming up", () => {
    const events = [
      ...Array.from({ length: 7 }, (_, i) => event(`sep${i}`, `2026-09-30T0${3 + i}:00:00.000Z`)),
      event("sep-late-1", "2026-09-30T11:00:00.000Z"),
      event("sep-late-2", "2026-09-30T12:00:00.000Z"),
    ];
    const sections = selectHomeSections(events, NOW);
    expect(sections.month.title).toBe("What’s on this month");
    expect(sections.month.items.map((e) => e.id)).toEqual(["sep-late-1", "sep-late-2"]);
  });

  it("falls back to next month, named, when this month has fewer than two left", () => {
    const events = [
      event("a", "2026-10-01T08:00:00.000Z"),
      ...Array.from({ length: 6 }, (_, i) => event(`c${i}`, `2026-10-0${2 + i}T08:00:00.000Z`)),
      event("oct-1", "2026-10-20T08:00:00.000Z"),
      event("oct-2", "2026-10-21T08:00:00.000Z"),
      event("nov", "2026-11-21T08:00:00.000Z"),
    ];
    const sections = selectHomeSections(events, NOW);
    expect(sections.month.title).toBe("What’s on in October");
    expect(sections.month.items.map((e) => e.id)).toEqual(["oct-1", "oct-2"]);
  });

  it("hides What's on when neither month has two events", () => {
    const sections = selectHomeSections([event("a", "2026-10-01T08:00:00.000Z"), event("b", "2026-12-01T08:00:00.000Z")], NOW);
    expect(sections.month.items).toEqual([]);
  });

  it("puts events whose all-inclusive price is A$20 or less in Free & low-cost, not counting the featured one", () => {
    const events = [
      event("featured-free", "2026-10-01T08:00:00.000Z", 0),
      event("free", "2026-10-02T08:00:00.000Z", 0),
      // A$18 + 4% + A$0.50 = A$19.22: under A$20 all-in.
      event("cheap", "2026-10-03T08:00:00.000Z", 1800),
      // A$19.50 face value is A$20.78 all-in, so it's out even though the ticket price is under A$20.
      event("fee-pushes-over", "2026-10-04T08:00:00.000Z", 1950),
      event("dear", "2026-10-05T08:00:00.000Z", 5000),
    ];
    const sections = selectHomeSections(events, NOW);
    expect(sections.lowCost.map(({ event: e, badge }) => [e.id, badge])).toEqual([
      ["free", "free"],
      ["cheap", "low-cost"],
    ]);
  });

  it("hides Free & low-cost with fewer than two", () => {
    const sections = selectHomeSections(
      [event("a", "2026-10-01T08:00:00.000Z"), event("free", "2026-10-02T08:00:00.000Z", 0), event("c", "2026-10-03T08:00:00.000Z")],
      NOW,
    );
    expect(sections.lowCost).toEqual([]);
  });

  it("has no featured event when nothing is upcoming", () => {
    const sections = selectHomeSections([event("old", "2026-09-01T08:00:00.000Z")], NOW);
    expect(sections.featured).toBeUndefined();
    expect(sections.comingUp).toEqual([]);
    expect(sections.lowCost).toEqual([]);
  });
});

describe("firstSentence", () => {
  it("cuts at the first sentence break and keeps text without one", () => {
    expect(firstSentence("Acoustic sets. Bring a chair.")).toBe("Acoustic sets.");
    expect(firstSentence("Just one line")).toBe("Just one line");
  });
});
