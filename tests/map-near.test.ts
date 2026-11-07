import { describe, expect, it } from "vitest";
import {
  NEAR_FRAME_EVENTS,
  NEAR_FRAME_FALLBACK_KM,
  NEAR_FRAME_RADIUS_KM,
  formatDistanceKm,
  nearestToFrame,
  sortNearestFirst,
} from "@/lib/map-near";

const CBD = { lat: -37.8136, lng: 144.9631 };
/** A point `km` due north of the CBD (a degree of latitude is about 111.2 km). */
const north = (km: number) => ({ lat: CBD.lat + km / 111.2, lng: CBD.lng });

describe("sortNearestFirst", () => {
  const at = (id: string, km: number | null, startsAt: string) => ({ id, km, startsAt });
  const positionOf = (item: { km: number | null }) => (item.km === null ? null : north(item.km));

  it("orders by distance, then soonest, with unplaced events last", () => {
    const items = [
      at("sydney", 700, "2026-11-01T00:00:00Z"),
      at("nowhere", null, "2026-11-02T00:00:00Z"),
      at("far-soon", 9, "2026-11-03T00:00:00Z"),
      at("near", 2, "2026-11-09T00:00:00Z"),
      at("same-spot-late", 9, "2026-11-08T00:00:00Z"),
      at("also-nowhere", null, "2026-11-01T00:00:00Z"),
    ];
    const sorted = sortNearestFirst(items, CBD, positionOf);
    expect(sorted.map((entry) => entry.item.id)).toEqual(["near", "far-soon", "same-spot-late", "sydney", "also-nowhere", "nowhere"]);
    expect(sorted[0].km).toBeCloseTo(2, 1);
    expect(sorted[4].km).toBeNull();
  });

  it("leaves the input as it was", () => {
    const items = [at("b", 5, "2026-11-02T00:00:00Z"), at("a", 1, "2026-11-01T00:00:00Z")];
    sortNearestFirst(items, CBD, positionOf);
    expect(items.map((item) => item.id)).toEqual(["b", "a"]);
  });
});

describe("formatDistanceKm", () => {
  it.each([
    [0.2, "< 1 km"],
    [0.99, "< 1 km"],
    [1, "1 km"],
    [2.34, "2.3 km"],
    [9.96, "10 km"],
    [14.4, "14 km"],
    [712.6, "713 km"],
    [2712, "2,712 km"],
  ])("%s km is %s", (km, text) => {
    expect(formatDistanceKm(km)).toBe(text);
  });
});

describe("nearestToFrame", () => {
  it("takes the nearest few inside the local radius, and nothing further out", () => {
    const places = [north(30), north(1), north(5), north(24), north(2), north(3), north(0.5), north(700)];
    const framed = nearestToFrame(CBD, places);
    expect(framed).toEqual([north(0.5), north(1), north(2), north(3)]);
    expect(framed).toHaveLength(NEAR_FRAME_EVENTS);
    expect(NEAR_FRAME_RADIUS_KM).toBe(25);
  });

  it("with none inside the radius, takes the single nearest inside the fallback", () => {
    expect(nearestToFrame(CBD, [north(60), north(38), north(700)])).toEqual([north(38)]);
    expect(NEAR_FRAME_FALLBACK_KM).toBe(100);
  });

  it("with nothing within the fallback, or no events at all, frames nothing", () => {
    expect(nearestToFrame(CBD, [north(180), north(700)])).toEqual([]);
    expect(nearestToFrame(CBD, [])).toEqual([]);
  });
});
