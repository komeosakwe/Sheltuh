import type { Coordinates, SheltuhEvent } from "./types";

/**
 * Approximate centroid for Melbourne inner-city/inner-north suburbs: hand-
 * entered, with no recorded source. The fallback suburb lookup only, for
 * when the ABS table (lib/localities.ts, every Australian suburb, loaded on
 * demand through lib/location-loader.ts) isn't available: /map places events
 * with that table once it has loaded (components/map/useSuburbLookup.ts).
 */
export const SUBURB_COORDINATES: Readonly<Record<string, Coordinates>> = {
  "melbourne cbd": { lat: -37.8136, lng: 144.9631 },
  fitzroy: { lat: -37.7997, lng: 144.9784 },
  "fitzroy north": { lat: -37.7838, lng: 144.9784 },
  collingwood: { lat: -37.8033, lng: 144.9888 },
  brunswick: { lat: -37.7663, lng: 144.9591 },
  "brunswick east": { lat: -37.7658, lng: 144.9755 },
  northcote: { lat: -37.7699, lng: 144.9997 },
  footscray: { lat: -37.7996, lng: 144.9007 },
  southbank: { lat: -37.8226, lng: 144.9648 },
  "st kilda": { lat: -37.8677, lng: 144.9811 },
  abbotsford: { lat: -37.8034, lng: 145.0135 },
  richmond: { lat: -37.823, lng: 144.998 },
  carlton: { lat: -37.7998, lng: 144.9668 },
  "south yarra": { lat: -37.839, lng: 144.993 },
  prahran: { lat: -37.8497, lng: 144.9902 },
  coburg: { lat: -37.7443, lng: 144.9631 },
  preston: { lat: -37.7411, lng: 144.9998 },
  "west melbourne": { lat: -37.8083, lng: 144.9463 },
  windsor: { lat: -37.8556, lng: 144.9915 },
  thornbury: { lat: -37.7568, lng: 145.0058 },
};

/** A suburb's centre from its name as written on an event, or null when it isn't known. */
export type SuburbLookup = (suburb: string) => Coordinates | null;

/** The fallback lookup: SUBURB_COORDINATES, by name, case and outer spaces aside. */
export const findListedSuburb: SuburbLookup = (suburb) => {
  const key = suburb.trim().toLowerCase();
  // Own keys only: a suburb of "constructor" mustn't find Object's.
  return Object.hasOwn(SUBURB_COORDINATES, key) ? SUBURB_COORDINATES[key] : null;
};

/**
 * Best-effort position for an event: its own geocoded venue coordinates
 * when present, otherwise its suburb's centre (from `findSuburb`: on /map,
 * lib/location.ts `findLocality` over the ABS table), otherwise `null` (the
 * caller should exclude the event from the map rather than guess).
 */
export function resolveEventCoordinates(
  event: SheltuhEvent,
  findSuburb: SuburbLookup = findListedSuburb,
): Coordinates | null {
  if (event.coordinates) return event.coordinates;
  const centre = findSuburb(event.suburb);
  return centre ? { lat: centre.lat, lng: centre.lng } : null;
}

/** Roughly bounds inner Melbourne — used as the map's default view. */
export const MELBOURNE_DEFAULT_CENTER: Coordinates = { lat: -37.808, lng: 144.965 };
export const MELBOURNE_DEFAULT_ZOOM = 12;

/**
 * Greater Melbourne with a margin (Mornington Peninsula, Yarra Valley, Geelong's
 * edge, Macedon Ranges). The map is kept inside this box so it always reads as
 * a Melbourne map: it can't be panned or zoomed out to the world, and a stray
 * event outside it is not pinned (it would stretch the view away from the city).
 */
export const MELBOURNE_METRO_BOUNDS = { south: -38.55, west: 144.2, north: -37.35, east: 145.95 } as const;
export const MELBOURNE_MIN_ZOOM = 9;

export function isInMelbourneMetro(coords: Coordinates): boolean {
  const b = MELBOURNE_METRO_BOUNDS;
  return coords.lat >= b.south && coords.lat <= b.north && coords.lng >= b.west && coords.lng <= b.east;
}

/**
 * Where an event goes on the map: its coordinates when they fall inside
 * Greater Melbourne, otherwise null. Events outside are not pinned, so the
 * list, Locate and the "can't be placed" count treat them as unplaceable too.
 */
export function resolveMapCoordinates(
  event: SheltuhEvent,
  findSuburb: SuburbLookup = findListedSuburb,
): Coordinates | null {
  const coords = resolveEventCoordinates(event, findSuburb);
  return coords && isInMelbourneMetro(coords) ? coords : null;
}
