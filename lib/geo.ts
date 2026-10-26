import { placeQuery } from "./place";
import type { Coordinates, SheltuhEvent } from "./types";

/**
 * Approximate centroid for Melbourne inner-city/inner-north suburbs: hand-
 * entered, with no recorded source. The fallback suburb lookup only (Victorian
 * events), for when the ABS table (lib/localities.ts, every Australian suburb, loaded on
 * demand through lib/location-loader.ts) isn't available: /map places events
 * with that table once it has loaded (components/SceneMap.tsx, through
 * components/search/useLocationModule.ts).
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

/**
 * A suburb's centre from the text that finds it (lib/place.ts placeQuery:
 * "Fitzroy", "Perth WA", "Richmond NSW"), or null when it isn't known.
 */
export type SuburbLookup = (suburb: string) => Coordinates | null;

/**
 * The fallback lookup: SUBURB_COORDINATES, by name, case and outer spaces
 * aside. Victoria only: the 20 are inner-Melbourne suburbs, so a suburb
 * written with another state ("Richmond NSW") isn't one of them.
 */
export const findListedSuburb: SuburbLookup = (suburb) => {
  let key = suburb.trim().toLowerCase();
  const state = /\s(nsw|vic|qld|sa|wa|tas|nt|act|ot)$/.exec(key)?.[1];
  if (state && state !== "vic") return null;
  if (state) key = key.slice(0, -" vic".length).trim();
  // Own keys only: a suburb of "constructor" mustn't find Object's.
  return Object.hasOwn(SUBURB_COORDINATES, key) ? SUBURB_COORDINATES[key] : null;
};

/**
 * Best-effort position for an event: its own geocoded venue coordinates
 * when present, otherwise its suburb's centre (`findSuburb` given
 * placeQuery's "{suburb} {state}": on /map, lib/location.ts `findLocality`
 * over the ABS table), otherwise `null` (the caller should exclude the event
 * from the map rather than guess).
 */
export function resolveEventCoordinates(
  event: SheltuhEvent,
  findSuburb: SuburbLookup = findListedSuburb,
): Coordinates | null {
  if (event.coordinates) return event.coordinates;
  const centre = findSuburb(placeQuery(event));
  return centre ? { lat: centre.lat, lng: centre.lng } : null;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The centre of Melbourne (the Hoddle grid): lib/location.ts prefers same-named places nearest it. */
export const MELBOURNE_DEFAULT_CENTER: Coordinates = { lat: -37.808, lng: 144.965 };

/**
 * Australia with its external territories (Norfolk Island to the east,
 * Christmas and the Cocos (Keeling) Islands to the west, Tasmania's south
 * coast) and a margin: the map can't be panned past it, and an event outside
 * it (a typo'd position overseas) isn't pinned.
 */
export const AUSTRALIA_BOUNDS = { south: -45, west: 95, north: -8, east: 170 } as const;

/**
 * What an empty map shows: the mainland and Tasmania, which fit a 375px
 * phone at AUSTRALIA_MIN_ZOOM.
 */
export const AUSTRALIA_VIEW = { south: -43.7, west: 112.9, north: -10.6, east: 153.7 } as const;

/** The furthest out the map zooms: Australia whole on a phone. */
export const AUSTRALIA_MIN_ZOOM = 3;

export function isInAustralia(coords: Coordinates): boolean {
  const b = AUSTRALIA_BOUNDS;
  return coords.lat >= b.south && coords.lat <= b.north && coords.lng >= b.west && coords.lng <= b.east;
}

/**
 * Where an event goes on the map: its coordinates when they fall inside
 * Australia (AUSTRALIA_BOUNDS), otherwise null. Events outside are not
 * pinned, so the list, Locate and the "can't be placed" count treat them as
 * unplaceable too.
 */
export function resolveMapCoordinates(
  event: SheltuhEvent,
  findSuburb: SuburbLookup = findListedSuburb,
): Coordinates | null {
  const coords = resolveEventCoordinates(event, findSuburb);
  return coords && isInAustralia(coords) ? coords : null;
}
