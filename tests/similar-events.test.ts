import { describe, expect, it } from "vitest";
import { ageTagLabel } from "@/lib/age-tag";
import { EVENT_ROW_MAX, moreFromOrganiser, SIMILAR_RADIUS_KM, similarNearby } from "@/lib/similar-events";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const BASE = sampleEvents.find((e) => e.slug === "neon-static") as SheltuhEvent;

let n = 0;
function ev(extra: Partial<SheltuhEvent>): SheltuhEvent {
  n += 1;
  return { ...BASE, id: `e-${n}`, slug: `e-${n}`, organiserName: `Organiser ${n}`, organiserId: undefined, ...extra };
}

/** A point `km` north of the base event (1° of latitude is about 111.2 km). */
function north(km: number) {
  const origin = BASE.coordinates ?? { lat: 0, lng: 0 };
  return { lat: origin.lat + km / 111.195, lng: origin.lng };
}

describe("similarNearby", () => {
  it("keeps upcoming events of the same category within 25 km, soonest first, and never the event itself", () => {
    const later = ev({ coordinates: north(3), startsAt: "2026-10-05T09:00:00.000Z", endsAt: undefined });
    const sooner = ev({ coordinates: north(10), startsAt: "2026-09-20T09:00:00.000Z", endsAt: undefined });
    const otherCategory = ev({ coordinates: north(1), category: "art" });
    const far = ev({ coordinates: north(40) });
    const ended = ev({ coordinates: north(1), startsAt: "2026-08-01T09:00:00.000Z", endsAt: "2026-08-01T12:00:00.000Z" });
    const result = similarNearby(BASE, [BASE, later, otherCategory, far, ended, sooner], NOW);
    expect(result.map((e) => e.id)).toEqual([sooner.id, later.id]);
  });

  it("counts an event at exactly the radius, and not one just past it", () => {
    const edge = ev({ coordinates: north(SIMILAR_RADIUS_KM - 0.01) });
    const past = ev({ coordinates: north(SIMILAR_RADIUS_KM + 0.5) });
    expect(similarNearby(BASE, [edge, past], NOW).map((e) => e.id)).toEqual([edge.id]);
  });

  it("places an event without coordinates by its suburb's listed centre, and leaves out one it can't place", () => {
    const fitzroy = ev({ coordinates: undefined, suburb: "Fitzroy", state: "VIC" });
    const nowhere = ev({ coordinates: undefined, suburb: "Nowhere In Particular", state: "VIC" });
    expect(similarNearby(BASE, [fitzroy, nowhere], NOW).map((e) => e.id)).toEqual([fitzroy.id]);
  });

  it("finds nothing near an event it can't place", () => {
    const unplaced = { ...BASE, coordinates: undefined, suburb: "Nowhere In Particular" };
    expect(similarNearby(unplaced, [ev({ coordinates: north(1) })], NOW)).toEqual([]);
  });

  it("leaves out the organiser's own events (More from shows those): by id live, by name in the demo", () => {
    const sameName = ev({ coordinates: north(1), organiserName: BASE.organiserName });
    const live = { ...BASE, organiserId: "org-1" };
    const sameId = ev({ coordinates: north(1), organiserId: "org-1", organiserName: "Renamed" });
    const other = ev({ coordinates: north(1), organiserId: "org-2" });
    expect(similarNearby(BASE, [sameName], NOW)).toEqual([]);
    expect(similarNearby(live, [sameId, other], NOW).map((e) => e.id)).toEqual([other.id]);
  });

  it("shows at most one row", () => {
    const many = Array.from({ length: 7 }, () => ev({ coordinates: north(1) }));
    expect(similarNearby(BASE, many, NOW)).toHaveLength(EVENT_ROW_MAX);
  });
});

describe("moreFromOrganiser", () => {
  it("is the organiser's other upcoming events, in their order, at most one row", () => {
    const list = [BASE, ...Array.from({ length: 6 }, () => ev({}))];
    const result = moreFromOrganiser(BASE, list, NOW);
    expect(result).toHaveLength(EVENT_ROW_MAX);
    expect(result.map((e) => e.id)).not.toContain(BASE.id);
    expect(result[0].id).toBe(list[1].id);
  });

  it("is empty when this is their only event", () => {
    expect(moreFromOrganiser(BASE, [BASE], NOW)).toEqual([]);
  });
});

describe("ageTagLabel", () => {
  it.each([
    ["18+. Bar on site, photo ID required.", "18+"],
    ["18+ (the model poses nude for part of the session).", "18+"],
    ["16+.", "16+"],
    ["All ages.", "All ages"],
    ["All ages. Under-16s to be accompanied by an adult.", "All ages"],
    // Advice, not a limit, and long: only in Good to know.
    ["Recommended 15+ for coarse language and mature themes.", null],
    ["", null],
    ["   ", null],
    [undefined, null],
  ])("%j → %j", (input, expected) => {
    expect(ageTagLabel(input)).toBe(expected);
  });
});
