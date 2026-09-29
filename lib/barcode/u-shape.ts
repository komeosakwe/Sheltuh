/**
 * Lays a barcode's bars around a "U" — the ü in Sheltüh. The bars are the real
 * Code 128 modules of a ticket's code, run along the U's centre-line (down the
 * left arm, round the bottom, up the right arm); each bar is drawn across the
 * path, so they're horizontal on the arms and radial round the curve. Two dots
 * above the arms complete the umlaut.
 *
 * Purely decorative and unique per ticket — the straight barcode beside it is
 * the machine-readable one.
 */

export interface UBarcodeGeometry {
  viewBox: string;
  width: number;
  height: number;
  /** SVG `points` strings, one polygon per dark run. */
  polygons: string[];
  /** The two umlaut dots. */
  dots: { cx: number; cy: number; r: number }[];
}

// Path dimensions, in SVG units.
const R = 50; // centre-line radius of the bottom curve (half the distance between the arms)
const ARM = 90; // length of each straight arm
const THICKNESS = 30; // bar length across the path
const DOT_R = 9;
const DOT_GAP = 14;
const PAD = 5;

const PATH_LENGTH = 2 * ARM + Math.PI * R;

function pointAt(s: number): { x: number; y: number; nx: number; ny: number } {
  if (s <= ARM) return { x: -R, y: s, nx: -1, ny: 0 };
  if (s <= ARM + Math.PI * R) {
    const theta = (s - ARM) / R;
    return { x: -R * Math.cos(theta), y: ARM + R * Math.sin(theta), nx: -Math.cos(theta), ny: Math.sin(theta) };
  }
  return { x: R, y: ARM - (s - ARM - Math.PI * R), nx: 1, ny: 0 };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** `modules` is a string of "1" (bar) and "0" (space), e.g. from encodeCode128B. */
export function uBarcodeGeometry(modules: string): UBarcodeGeometry {
  const moduleLength = PATH_LENGTH / modules.length;
  const polygons: string[] = [];

  for (const run of modules.matchAll(/1+/g)) {
    const start = (run.index ?? 0) * moduleLength;
    const end = start + run[0].length * moduleLength;
    const steps = Math.max(2, Math.ceil((end - start) / 2));
    const outer: string[] = [];
    const inner: string[] = [];
    for (let k = 0; k <= steps; k += 1) {
      const p = pointAt(start + ((end - start) * k) / steps);
      outer.push(`${round(p.x + (p.nx * THICKNESS) / 2)},${round(p.y + (p.ny * THICKNESS) / 2)}`);
      inner.push(`${round(p.x - (p.nx * THICKNESS) / 2)},${round(p.y - (p.ny * THICKNESS) / 2)}`);
    }
    polygons.push([...outer, ...inner.reverse()].join(" "));
  }

  const left = -R - THICKNESS / 2 - PAD;
  const right = R + THICKNESS / 2 + PAD;
  const dotY = -DOT_GAP - DOT_R;
  const top = dotY - DOT_R - PAD;
  const bottom = ARM + R + THICKNESS / 2 + PAD;
  return {
    viewBox: `${left} ${top} ${right - left} ${bottom - top}`,
    width: right - left,
    height: bottom - top,
    polygons,
    dots: [
      { cx: -R, cy: dotY, r: DOT_R },
      { cx: R, cy: dotY, r: DOT_R },
    ],
  };
}
