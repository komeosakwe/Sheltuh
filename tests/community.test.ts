import { describe, expect, it } from "vitest";
import { cityScenes, COMMUNITY_CITIES } from "@/lib/community";
import { NEAR_FRAME_RADIUS_KM } from "@/lib/map-near";
import { matchesHomeFilters, NO_HOME_FILTERS, hasHomeFilters } from "@/lib/home-filters";
import type { Coordinates, SheltuhEvent } from "@/lib/types";

function event(id: string, category: SheltuhEvent["category"], coordinates?: Coordinates, startsAt = "2026-11-01T08:00:00.000Z"): SheltuhEvent {
  return {
    id,
    slug: id,
    title: id,
    description: "d",
    category,
    suburb: "Somewhere",
    venueName: "Venue",
    venueAddress: "1 St",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...(coordinates ? { coordinates } : {}),
  };
}

const FITZROY = { lat: -37.7997, lng: 144.9784 };
const GEELONG = { lat: -38.1499, lng: 144.3617 }; // ~65 km from Melbourne's GPO
const NEWTOWN = { lat: -33.8978, lng: 151.1795 };

describe("cityScenes (/community's Scenes by city)", () => {
  it("lists the proposal's five cities, in its order", () => {
    expect(COMMUNITY_CITIES.map((c) => c.name)).toEqual(["Melbourne", "Sydney", "Brisbane", "Perth", "Adelaide"]);
    // Nearby's own radius around a place.
    expect(NEAR_FRAME_RADIUS_KM).toBe(25);
  });

  it("counts each city's events within 25 km of its centre, soonest first; the categories by how many, at most three", () => {
    const events = [
      event("late-art", "art", FITZROY, "2026-12-01T08:00:00.000Z"),
      event("gig", "live-music", FITZROY),
      event("gig2", "live-music", FITZROY),
      event("geelong", "theatre", GEELONG),
      event("sydney", "workshop", NEWTOWN),
      event("unplaced", "pop-up"),
    ];
    const { scenes, allPlaced } = cityScenes(events, (e) => e.coordinates ?? null);
    // One event couldn't be placed: the counts aren't whole.
    expect(allPlaced).toBe(false);
    expect(cityScenes(events.slice(0, 5), (e) => e.coordinates ?? null).allPlaced).toBe(true);
    const melbourne = scenes[0];
    expect(melbourne.city.name).toBe("Melbourne");
    expect(melbourne.events.map((e) => e.id)).toEqual(["gig", "gig2", "late-art"]);
    expect(melbourne.categories).toEqual(["Live music", "Art"]);
    expect(scenes[1].events.map((e) => e.id)).toEqual(["sydney"]);
    // Geelong is outside Melbourne's 25 km, and an event that can't be placed counts nowhere.
    for (const scene of scenes) expect(scene.events.map((e) => e.id)).not.toContain("geelong");
    expect(scenes.flatMap((s) => s.events).map((e) => e.id)).not.toContain("unplaced");
    expect(scenes.slice(2).every((s) => s.events.length === 0 && s.categories.length === 0)).toBe(true);
  });
});

describe("the home's filters", () => {
  const NOW = new Date("2026-10-21T01:00:00.000Z");
  const free = { ...event("free", "art"), ticketTypes: [{ id: "f", name: "Entry", priceCents: 0, feePolicy: "buyer-pays" as const, quantityAvailable: 5 }] };

  it("none set: everything passes", () => {
    expect(hasHomeFilters(NO_HOME_FILTERS)).toBe(false);
    expect(matchesHomeFilters(free, NO_HOME_FILTERS, NOW)).toBe(true);
  });

  it("category, price and date each narrow it", () => {
    expect(matchesHomeFilters(free, { ...NO_HOME_FILTERS, category: "theatre" }, NOW)).toBe(false);
    expect(matchesHomeFilters(free, { ...NO_HOME_FILTERS, price: "free" }, NOW)).toBe(true);
    expect(matchesHomeFilters(event("paid", "art"), { ...NO_HOME_FILTERS, price: "free" }, NOW)).toBe(false);
    // 1 Nov is neither tonight nor this weekend (Sat 24 – Sun 25 Oct).
    expect(matchesHomeFilters(free, { ...NO_HOME_FILTERS, date: "weekend" }, NOW)).toBe(false);
    expect(hasHomeFilters({ ...NO_HOME_FILTERS, date: "tonight" })).toBe(true);
  });
});
