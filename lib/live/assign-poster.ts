import type { EventPoster, PosterPattern } from "@/lib/types";

/**
 * Live events from the backend have no artwork field yet (image uploads are
 * a later milestone — see docs/architecture.md). This deterministically
 * assigns one of the same eight local poster looks used by the demo sample
 * data, keyed off the event's slug so it's stable across reloads without
 * needing to store anything.
 */
const PATTERNS: PosterPattern[] = ["burst", "rings", "grid", "stripes", "waves", "confetti", "curtain", "halftone"];

/** Brand colourways per pattern (docs/design/brand-direction-one.md §8.2): black, Signal Orange and cream only. */
const PALETTES: [background: string, primary: string, secondary: string][] = [
  ["#000000", "#ff4800", "#fffae7"],
  ["#ff4800", "#000000", "#fffae7"],
  ["#fffae7", "#000000", "#ff4800"],
  ["#000000", "#fffae7", "#ff4800"],
  ["#ff4800", "#fffae7", "#000000"],
  ["#fffae7", "#ff4800", "#000000"],
  ["#000000", "#ff4800", "#000000"],
  ["#ff4800", "#000000", "#000000"],
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function assignPoster(slug: string): EventPoster {
  const index = hashString(slug) % PATTERNS.length;
  const [background, primary, secondary] = PALETTES[index];
  return { pattern: PATTERNS[index], background, primary, secondary };
}
