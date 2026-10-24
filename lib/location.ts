/**
 * "Near you" search, in the browser only (docs/architecture.md, "Location"):
 * a visitor's suburb (typed, or worked out from the browser's position and
 * then the position dropped) orders /search results by the distance between
 * suburb centres. Nothing here is sent to the API, and no coordinates leave
 * the function that receives them. Distances are approximate: suburb centre
 * to suburb centre, never venue to venue.
 */
import { isInMelbourneMetro } from "./geo";
import { MELBOURNE_LOCALITIES, type Locality } from "./localities";
import { NEAR_MAX_LENGTH } from "./near-storage";
import type { Coordinates } from "./types";

export { MELBOURNE_LOCALITIES, type Locality } from "./localities";

/**
 * How far the browser's position may be from the nearest known suburb centre
 * and still be called that suburb. Beyond it the visitor is asked to type
 * their suburb rather than being told they're somewhere they're not.
 */
export const NEAREST_MAX_KM = 5;

const ALIASES: Record<string, string> = {
  cbd: "melbourne",
  city: "melbourne",
  "melbourne cbd": "melbourne",
  "melbourne city": "melbourne",
  "melbourne city centre": "melbourne",
  "melbourne city center": "melbourne",
};

const WORDS: Record<string, string> = {
  saint: "st",
  mt: "mount",
  nth: "north",
  sth: "south",
};

/** Words that say where a suburb is, not which one: "Fitzroy, VIC 3065" is Fitzroy. */
const PLACE_WORDS = new Set(["vic", "victoria", "australia", "au"]);

/**
 * One spelling per suburb, for comparing what people type: case, accents,
 * punctuation, spacing, "VIC" and postcodes, St/Saint, Mt/Mount, Nth/Sth,
 * and the CBD's many names.
 */
export function normaliseSuburb(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word && !PLACE_WORDS.has(word) && !/^\d{4}$/.test(word))
    .map((word) => WORDS[word] ?? word);
  const joined = words.join(" ");
  return ALIASES[joined] ?? joined;
}

const BY_NAME = new Map<string, Locality>(MELBOURNE_LOCALITIES.map((locality) => [normaliseSuburb(locality.name), locality]));

/** The known suburb `text` names, or null. */
export function findLocality(text: string): Locality | null {
  const key = normaliseSuburb(text);
  return key ? (BY_NAME.get(key) ?? null) : null;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type NearestResult =
  | { kind: "found"; locality: Locality }
  /** Outside Greater Melbourne. */
  | { kind: "outside" }
  /** In Greater Melbourne, but no known suburb centre within NEAREST_MAX_KM. */
  | { kind: "unmatched" };

/**
 * The suburb a position is in, as near as the table can say. The caller
 * keeps only the result's name and drops the position.
 */
export function nearestLocality(position: Coordinates, maxKm = NEAREST_MAX_KM): NearestResult {
  if (!isInMelbourneMetro(position)) return { kind: "outside" };
  let best: Locality | null = null;
  let bestKm = Infinity;
  for (const locality of MELBOURNE_LOCALITIES) {
    const km = distanceKm(position, locality);
    if (km < bestKm) {
      best = locality;
      bestKm = km;
    }
  }
  return best && bestKm <= maxKm ? { kind: "found", locality: best } : { kind: "unmatched" };
}

/** Bands, nearest first (owner decision D4, 24 Oct 2026: bands, then soonest within each). */
export const NEARNESS_BANDS = ["here", "near", "mid", "far", "unknown"] as const;
export type NearnessBand = (typeof NEARNESS_BANDS)[number];

/** Where `suburb` sits from `origin`. An unknown suburb is "unknown", never dropped. */
export function nearnessBand(origin: Locality, suburb: string): NearnessBand {
  const place = findLocality(suburb);
  if (!place) return "unknown";
  if (place.name === origin.name) return "here";
  const km = distanceKm(origin, place);
  if (km <= 5) return "near";
  if (km <= 15) return "mid";
  return "far";
}

export function nearnessBandLabel(band: NearnessBand, origin: Locality): string {
  switch (band) {
    case "here":
      return `In ${origin.name}`;
    case "near":
      return "Within 5 km";
    case "mid":
      return "5–15 km";
    case "far":
      return "Further away";
    case "unknown":
      return "Location not on file";
  }
}

export interface NearnessGroup<T> {
  band: NearnessBand;
  label: string;
  items: T[];
}

/**
 * `items` in bands (nearest first, empty bands left out), soonest first
 * within each band, then by id so equal times keep a stable order.
 */
export function orderByNearness<T extends { suburb: string; startsAt: string; id: string }>(
  items: readonly T[],
  origin: Locality,
): NearnessGroup<T>[] {
  const byBand = new Map<NearnessBand, T[]>(NEARNESS_BANDS.map((band) => [band, []]));
  for (const item of items) byBand.get(nearnessBand(origin, item.suburb))?.push(item);
  return NEARNESS_BANDS.flatMap((band) => {
    const bandItems = byBand.get(band) ?? [];
    if (bandItems.length === 0) return [];
    bandItems.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
    return [{ band, label: nearnessBandLabel(band, origin), items: bandItems }];
  });
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * A known suburb one or two letters away from `text` ("Brunswik" →
 * Brunswick), or null: none close, more than one equally close, or `text`
 * already names one.
 */
export function didYouMean(text: string): Locality | null {
  const key = normaliseSuburb(text);
  if (!key || BY_NAME.has(key)) return null;
  const allowed = key.length >= 6 ? 2 : 1;
  let best: Locality | null = null;
  let bestDistance = allowed + 1;
  let tie = false;
  for (const [name, locality] of BY_NAME) {
    const d = editDistance(key, name);
    if (d < bestDistance) {
      best = locality;
      bestDistance = d;
      tie = false;
    } else if (d === bestDistance) {
      tie = true;
    }
  }
  return best && !tie ? best : null;
}

/** The `near` search parameter: its first value, trimmed, at most NEAR_MAX_LENGTH characters. */
export function parseNearParam(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim().slice(0, NEAR_MAX_LENGTH).trim();
}
