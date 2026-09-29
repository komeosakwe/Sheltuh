import { describe, expect, it } from "vitest";
import { encodeCode128B } from "@/lib/barcode/code128";
import { uBarcodeGeometry } from "@/lib/barcode/u-shape";

function bounds(points: string) {
  const xy = points.split(" ").map((p) => p.split(",").map(Number));
  return { xs: xy.map(([x]) => x), ys: xy.map(([, y]) => y) };
}

describe("uBarcodeGeometry", () => {
  const modules = encodeCode128B("ABCD-EFGH");
  const geometry = uBarcodeGeometry(modules);

  it("draws one polygon per dark run and two umlaut dots", () => {
    expect(geometry.polygons).toHaveLength(modules.match(/1+/g)?.length ?? -1);
    expect(geometry.dots).toHaveLength(2);
  });

  it("keeps every bar inside the view box", () => {
    const [minX, minY, width, height] = geometry.viewBox.split(" ").map(Number);
    for (const polygon of geometry.polygons) {
      const { xs, ys } = bounds(polygon);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(minX);
      expect(Math.max(...xs)).toBeLessThanOrEqual(minX + width);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(minY);
      expect(Math.max(...ys)).toBeLessThanOrEqual(minY + height);
    }
  });

  it("is deterministic, and different tickets get different shapes", () => {
    expect(uBarcodeGeometry(modules)).toEqual(geometry);
    expect(uBarcodeGeometry(encodeCode128B("K7M2-QW3R")).polygons).not.toEqual(geometry.polygons);
  });

  it("puts the umlaut dots above the bars", () => {
    const [, minY] = geometry.viewBox.split(" ").map(Number);
    const barTop = Math.min(...geometry.polygons.flatMap((p) => bounds(p).ys));
    for (const dot of geometry.dots) {
      expect(dot.cy + dot.r).toBeLessThan(barTop);
      expect(dot.cy - dot.r).toBeGreaterThanOrEqual(minY);
    }
  });
});
