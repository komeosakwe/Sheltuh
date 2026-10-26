import { describe, expect, it } from "vitest";
import {
  framingTargets,
  isSinglePoint,
  layoutMapPoints,
  NEAR_FRAME_KM,
  padPixelBounds,
  type MapLayoutItem,
} from "@/lib/map-layout";

const singles = (items: MapLayoutItem[]) => items.filter((i) => i.kind === "single").map((i) => (i.kind === "single" ? i.id : ""));
const clusters = (items: MapLayoutItem[]) => items.flatMap((i) => (i.kind === "cluster" ? [i.ids] : []));

describe("layoutMapPoints", () => {
  it("keeps far-apart points as their own markers", () => {
    const { items, hiddenCount } = layoutMapPoints(
      [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 200, y: 0 },
      ],
      { radius: 52, maxItems: 100 },
    );
    expect(singles(items)).toEqual(["a", "b"]);
    expect(hiddenCount).toBe(0);
  });

  it("merges overlapping points into one cluster, led by the first (soonest) point, centred on its members", () => {
    const { items } = layoutMapPoints(
      [
        { id: "soonest", x: 100, y: 100 },
        { id: "far", x: 400, y: 400 },
        { id: "close", x: 120, y: 100 },
      ],
      { radius: 52, maxItems: 100 },
    );
    expect(clusters(items)).toEqual([["soonest", "close"]]);
    expect(items[0]).toMatchObject({ kind: "cluster", x: 110, y: 100 });
    expect(singles(items)).toEqual(["far"]);
  });

  it("never clusters or culls the pinned (selected) point, and renders it first", () => {
    const { items } = layoutMapPoints(
      [
        { id: "a", x: 100, y: 100 },
        { id: "selected", x: 101, y: 100 },
        { id: "offscreen-selected-neighbour", x: 5000, y: 5000 },
      ],
      { radius: 52, maxItems: 100, pinnedId: "selected", viewport: { minX: 0, minY: 0, maxX: 300, maxY: 300 } },
    );
    expect(items[0]).toEqual({ kind: "single", id: "selected" });
    expect(singles(items)).toEqual(["selected", "a"]);
  });

  it("culls points outside the viewport", () => {
    const { items, hiddenCount } = layoutMapPoints(
      [
        { id: "in", x: 10, y: 10 },
        { id: "out", x: 900, y: 10 },
      ],
      { radius: 52, maxItems: 100, viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
    );
    expect(singles(items)).toEqual(["in"]);
    expect(hiddenCount).toBe(0); // culled, not "hidden by the cap"
  });

  it("caps rendered markers and counts what the cap hid", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, x: i * 100, y: 0 }));
    const { items, hiddenCount } = layoutMapPoints(points, { radius: 52, maxItems: 4 });
    expect(items).toHaveLength(4);
    expect(singles(items)).toEqual(["e0", "e1", "e2", "e3"]);
    expect(hiddenCount).toBe(6);
  });

  it("handles hundreds of points stacked on the same spot as one cluster", () => {
    const points = Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, x: 50, y: 50 }));
    const { items } = layoutMapPoints(points, { radius: 52, maxItems: 150 });
    expect(items).toHaveLength(1);
    expect(clusters(items)[0]).toHaveLength(300);
  });
});

describe("padPixelBounds", () => {
  it("grows the bounds on every side by a fraction of their size", () => {
    expect(padPixelBounds({ minX: 0, minY: 0, maxX: 100, maxY: 200 }, 0.25)).toEqual({
      minX: -25,
      minY: -50,
      maxX: 125,
      maxY: 250,
    });
  });
});

describe("isSinglePoint", () => {
  it("is true for events sharing one position (e.g. a suburb centre) and false otherwise", () => {
    expect(isSinglePoint([{ lat: -37.8, lng: 144.9 }, { lat: -37.8, lng: 144.9 }])).toBe(true);
    expect(isSinglePoint([{ lat: -37.8, lng: 144.9 }, { lat: -37.801, lng: 144.9 }])).toBe(false);
  });
});

import {
  AUSTRALIA_BOUNDS,
  AUSTRALIA_VIEW,
  isInAustralia,
  MELBOURNE_DEFAULT_CENTER,
} from "@/lib/geo";

describe("Australia-wide map (owner plan S9)", () => {
  it("treats Australia and its external territories as in, and elsewhere as out", () => {
    expect(isInAustralia(MELBOURNE_DEFAULT_CENTER)).toBe(true);
    expect(isInAustralia({ lat: -33.87, lng: 151.21 })).toBe(true); // Sydney
    expect(isInAustralia({ lat: -31.95, lng: 115.86 })).toBe(true); // Perth
    expect(isInAustralia({ lat: -12.46, lng: 130.84 })).toBe(true); // Darwin
    expect(isInAustralia({ lat: -42.88, lng: 147.33 })).toBe(true); // Hobart
    expect(isInAustralia({ lat: -29.04, lng: 167.95 })).toBe(true); // Norfolk Island
    expect(isInAustralia({ lat: -10.49, lng: 105.62 })).toBe(true); // Christmas Island
    expect(isInAustralia({ lat: -12.19, lng: 96.83 })).toBe(true); // Cocos (Keeling) Islands
    expect(isInAustralia({ lat: -36.85, lng: 174.76 })).toBe(false); // Auckland
    expect(isInAustralia({ lat: 51.5, lng: -0.12 })).toBe(false); // London
    expect(isInAustralia({ lat: 0, lng: 0 })).toBe(false);
  });

  it("keeps the empty map's view (mainland and Tasmania) inside the bounds", () => {
    expect(AUSTRALIA_VIEW.south).toBeGreaterThan(AUSTRALIA_BOUNDS.south);
    expect(AUSTRALIA_VIEW.north).toBeLessThan(AUSTRALIA_BOUNDS.north);
    expect(AUSTRALIA_VIEW.west).toBeGreaterThan(AUSTRALIA_BOUNDS.west);
    expect(AUSTRALIA_VIEW.east).toBeLessThan(AUSTRALIA_BOUNDS.east);
  });
});

describe("framingTargets (/map's first view, owner decision D5)", () => {
  const fitzroy = { id: "fitzroy", lat: -37.7997, lng: 144.9784 };
  const frankston = { id: "frankston", lat: -38.1425, lng: 145.1257 }; // about 40 km away
  const geelong = { id: "geelong", lat: -38.1499, lng: 144.3617 }; // about 65 km away
  const perth = { id: "perth", lat: -31.9523, lng: 115.8613 };
  const markers = [fitzroy, frankston, geelong, perth];

  it("opens on the markers within 50 km of the saved suburb", () => {
    expect(NEAR_FRAME_KM).toBe(50);
    expect(framingTargets(markers, { lat: -37.8, lng: 144.97 }, true).map((m) => m.id)).toEqual(["fitzroy", "frankston"]);
  });

  it("fits every marker when none is near the saved suburb, without one, and after the first framing", () => {
    expect(framingTargets(markers, { lat: -27.47, lng: 153.03 }, true)).toEqual(markers); // Brisbane
    expect(framingTargets(markers, null, true)).toEqual(markers);
    expect(framingTargets(markers, { lat: -37.8, lng: 144.97 }, false)).toEqual(markers);
  });
});
