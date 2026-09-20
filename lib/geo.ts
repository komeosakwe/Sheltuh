import type { Coordinates, SheltuhEvent } from "./types";

/**
 * Approximate centroid for Melbourne inner-city/inner-north suburbs, used
 * only as a fallback when an event has no geocoded `coordinates` of its
 * own (e.g. every event from the live API today — see adaptPublicEvent,
 * which doesn't carry a venue location yet). These are suburb-level
 * approximations, not surveyed venue positions.
 */
const SUBURB_COORDINATES: Record<string, Coordinates> = {
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
 * Best-effort position for an event: its own geocoded venue coordinates
 * when present, otherwise its suburb's centroid, otherwise `null` (the
 * caller should exclude the event from the map rather than guess).
 */
export function resolveEventCoordinates(event: SheltuhEvent): Coordinates | null {
  if (event.coordinates) return event.coordinates;
  return SUBURB_COORDINATES[event.suburb.trim().toLowerCase()] ?? null;
}

/** Roughly bounds inner Melbourne — used as the map's default view. */
export const MELBOURNE_DEFAULT_CENTER: Coordinates = { lat: -37.808, lng: 144.965 };
export const MELBOURNE_DEFAULT_ZOOM = 12;
