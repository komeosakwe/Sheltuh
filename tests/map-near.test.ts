import { describe, expect, it } from "vitest";
import {
  NEAR_FRAME_EVENTS,
  NEAR_FRAME_FALLBACK_KM,
  NEAR_FRAME_RADIUS_KM,
  DEFAULT_NEARBY_RADIUS,
  NEARBY_RADII_KM,
  formatDistanceKm,
  nearestPlaceNames,
  nearestToFrame,
  parseNearbyRadius,
  splitByRadius,
  nearestWithin,
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

describe("nearestWithin", () => {
  const at = (id: string, km: number | null, startsAt = "2026-11-01T00:00:00Z") => ({ id, km, startsAt });
  const positionOf = (item: { km: number | null }) => (item.km === null ? null : north(item.km));

  it("is the nearest event, with its distance, ignoring unplaced ones", () => {
    const nearest = nearestWithin([at("far", 40), at("nowhere", null), at("near", 3)], CBD, positionOf);
    expect(nearest?.item.id).toBe("near");
    expect(nearest?.km).toBeCloseTo(3, 1);
  });

  it("is null when the nearest is beyond the fallback reach, or nothing can be placed", () => {
    expect(nearestWithin([at("sydney", 700)], CBD, positionOf)).toBeNull();
    expect(nearestWithin([at("nowhere", null)], CBD, positionOf)).toBeNull();
    expect(nearestWithin([], CBD, positionOf)).toBeNull();
    expect(nearestWithin([at("edge", NEAR_FRAME_FALLBACK_KM + 1)], CBD, positionOf)).toBeNull();
  });

  it("breaks ties by the soonest", () => {
    const nearest = nearestWithin([at("late", 5, "2026-11-09T00:00:00Z"), at("soon", 5, "2026-11-02T00:00:00Z")], CBD, positionOf);
    expect(nearest?.item.id).toBe("soon");
  });
});

describe("Nearby's radius", () => {
  const at = (id: string, km: number | null, startsAt = "2026-11-01T00:00:00Z", suburb = id) => ({ id, km, startsAt, suburb });
  const positionOf = (item: { km: number | null }) => (item.km === null ? null : north(item.km));

  it("offers 5, 10, 25 and 50 km, 25 by default; the address's within= is read safely", () => {
    expect(NEARBY_RADII_KM).toEqual([5, 10, 25, 50]);
    expect(DEFAULT_NEARBY_RADIUS).toBe(25);
    expect(parseNearbyRadius("10")).toBe(10);
    expect(parseNearbyRadius("all")).toBe("all");
    expect(parseNearbyRadius(null)).toBe(25);
    expect(parseNearbyRadius("7")).toBe(25);
    expect(parseNearbyRadius("25km")).toBe(25);
  });

  it("splits nearest-first entries at the radius, the edge inside, keeping the order; unplaced apart", () => {
    const sorted = [at("near", 2), at("edge", 25), at("just-out", 25.2), at("far", 700), at("nowhere", null)].map((item) => ({
      item,
      km: item.km,
    }));
    const split = splitByRadius(sorted, 25);
    expect(split.inside.map((entry) => entry.item.id)).toEqual(["near", "edge"]);
    expect(split.outside.map((entry) => entry.item.id)).toEqual(["just-out", "far"]);
    expect(split.unplaced.map((entry) => entry.item.id)).toEqual(["nowhere"]);
    // Doesn't change its input.
    expect(sorted.map((entry) => entry.item.id)).toEqual(["near", "edge", "just-out", "far", "nowhere"]);
  });

  it("works on sortNearestFirst's output: measured distances, nearest first", () => {
    const split = splitByRadius(sortNearestFirst([at("far", 700), at("nowhere", null), at("near", 2)], CBD, positionOf), 25);
    expect(split.inside.map((entry) => entry.item.id)).toEqual(["near"]);
    expect(split.outside.map((entry) => entry.item.id)).toEqual(["far"]);
    expect(split.unplaced.map((entry) => entry.item.id)).toEqual(["nowhere"]);
  });

  it("names the first few different places, nearest first, case-insensitively, skipping empty names", () => {
    const entries = [
      at("a", 30, undefined, "Frankston"),
      at("b", 31, undefined, "frankston"),
      at("c", 700, undefined, "Surry Hills"),
      at("d", 800, undefined, " "),
      at("e", 1376, undefined, "Fortitude Valley"),
      at("f", 2700, undefined, "Northbridge"),
    ].map((item) => ({ item, km: item.km }));
    expect(nearestPlaceNames(entries, (item) => item.suburb)).toEqual(["Frankston", "Surry Hills", "Fortitude Valley"]);
    expect(nearestPlaceNames(entries, (item) => item.suburb, 1)).toEqual(["Frankston"]);
    expect(nearestPlaceNames([], (item: { suburb: string }) => item.suburb)).toEqual([]);
  });
});
