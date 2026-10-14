import { describe, expect, it } from "vitest";
import { isSinglePoint, layoutMapPoints, padPixelBounds, type MapLayoutItem } from "@/lib/map-layout";

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
