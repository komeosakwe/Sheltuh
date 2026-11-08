/**
 * "Near me" on /map: which events are nearest the visitor, in what order to list them, and what the
 * map should frame. Pure, and browser-only like everything that touches the visitor's position
 * (docs/architecture.md, "Location (near you)"): nothing here stores or sends a coordinate.
 * Distances are great-circle, from the visitor (or their saved suburb's centre) to the event's pin,
 * or to its suburb's centre when it has no pin of its own: approximate, like /search's.
 */
import { distanceKm } from "./geo";
import type { Coordinates } from "./types";

/** How many of the nearest events the map frames with the visitor. */
export const NEAR_FRAME_EVENTS = 4;
/** Events further than this from the visitor aren't framed with them, so the map stays local (about zoom 10). */
export const NEAR_FRAME_RADIUS_KM = 25;
/** With none inside that radius, the single nearest event is still framed if it's within this (about zoom 8). */
export const NEAR_FRAME_FALLBACK_KM = 100;

export interface DistanceEntry<T> {
  item: T;
  /** Kilometres from the origin; null for an event that isn't on the map (no position to measure). */
  km: number | null;
}

/**
 * `items` nearest the origin first, each with its distance. Ties (events stacked on one suburb
 * centre, or within 100 m of each other) keep soonest first, and events that can't be placed go
 * last, soonest first. Doesn't change the input.
 */
export function sortNearestFirst<T extends { startsAt: string }>(
  items: readonly T[],
  origin: Coordinates,
  positionOf: (item: T) => Coordinates | null,
): DistanceEntry<T>[] {
  const entries = items.map((item): DistanceEntry<T> => {
    const position = positionOf(item);
    return { item, km: position ? distanceKm(origin, position) : null };
  });
  const bucket = (km: number) => Math.round(km * 10);
  return entries.sort((a, b) => {
    if (a.km === null || b.km === null) {
      if (a.km !== null) return -1;
      if (b.km !== null) return 1;
    } else if (bucket(a.km) !== bucket(b.km)) {
      return bucket(a.km) - bucket(b.km);
    }
    return a.item.startsAt.localeCompare(b.item.startsAt);
  });
}

/**
 * The one event Near me opens: the nearest to the origin, with its distance, or null when none can
 * be placed within `maxKm` (NEAR_FRAME_FALLBACK_KM by default: the same reach as the map's framing,
 * so an event too far to frame is not opened either). Ties go to the soonest, as in the list.
 */
export function nearestWithin<T extends { startsAt: string }>(
  items: readonly T[],
  origin: Coordinates,
  positionOf: (item: T) => Coordinates | null,
  maxKm: number = NEAR_FRAME_FALLBACK_KM,
): DistanceEntry<T> | null {
  const [first] = sortNearestFirst(items, origin, positionOf);
  return first && first.km !== null && first.km <= maxKm ? first : null;
}

/**
 * A short, approximate distance: "< 1 km", "2.3 km", "14 km", "2,700 km". (Suburb-centre pins and
 * a coarse browser position make anything finer a false precision.)
 */
export function formatDistanceKm(km: number): string {
  if (km < 1) return "< 1 km";
  if (km < 10) return `${Math.round(km * 10) / 10} km`;
  return `${Math.round(km).toLocaleString("en-AU")} km`;
}

/**
 * What the map frames for "near the visitor": the nearest `NEAR_FRAME_EVENTS` positions inside
 * `NEAR_FRAME_RADIUS_KM` of the origin (else the single nearest inside `NEAR_FRAME_FALLBACK_KM`).
 * Empty: nothing is near enough to frame, and the caller centres on the origin at MAP_NEAR_ZOOM (lib/map-layout.ts)
 * (or, for a filter change, fits the events instead).
 */
export function nearestToFrame(origin: Coordinates, positions: readonly Coordinates[]): Coordinates[] {
  const ranked = positions
    .map((position) => ({ position, km: distanceKm(origin, position) }))
    .sort((a, b) => a.km - b.km);
  const close = ranked.filter((entry) => entry.km <= NEAR_FRAME_RADIUS_KM).slice(0, NEAR_FRAME_EVENTS);
  const chosen = close.length > 0 ? close : ranked.filter((entry) => entry.km <= NEAR_FRAME_FALLBACK_KM).slice(0, 1);
  return chosen.map((entry) => entry.position);
}
