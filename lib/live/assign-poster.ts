import type { EventPoster, PosterPattern } from "@/lib/types";

/**
 * Live events from the backend have no artwork field yet (image uploads are
 * a later milestone — see docs/architecture.md). This deterministically
 * assigns one of the same eight local poster looks used by the demo sample
 * data, keyed off the event's slug so it's stable across reloads without
 * needing to store anything.
 */
const PATTERNS: PosterPattern[] = ["burst", "rings", "grid", "stripes", "waves", "confetti", "curtain", "halftone"];

const PALETTES: [background: string, primary: string, secondary: string][] = [
  ["#0a0a12", "#1e3fe0", "#ff2f6e"],
  ["#141414", "#d98a3d", "#2f5bf6"],
  ["#050507", "#2451f5", "#f5f4f0"],
  ["#000000", "#1633a8", "#34e2c4"],
  ["#0b0b0f", "#3b5bff", "#ffcf4d"],
  ["#111116", "#274bdb", "#ff6b3d"],
  ["#08080c", "#152e8a", "#c81d4f"],
  ["#101014", "#0c2fb0", "#2fd0c8"],
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
