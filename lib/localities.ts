/**
 * The suburbs "near you" search knows (components/search/LocationPicker.tsx,
 * lib/location.ts): one centre point per suburb, in Greater Melbourne.
 *
 * INTERIM TABLE (24 Oct 2026). The planned source is a CC BY 4.0 table of
 * Greater Melbourne suburb centres (ABS ASGS 2021 "Suburbs and Localities",
 * or Geoscience Australia's Gazetteer of Australia), generated once and
 * written here with its source, licence, date and row count, plus a credit
 * line on /about. The download was blocked from the build environment, so
 * until that table lands this reuses the 20 inner-suburb centres already in
 * lib/geo.ts (hand-entered approximations with no recorded source, also used
 * by /map) rather than inventing coordinates. Events in suburbs outside it
 * (Yarraville, Docklands, ...) are listed under "Location not on file".
 *
 * Rows: 20 (the lib/geo.ts table). No CC BY credit is owed for it.
 */
import { SUBURB_COORDINATES } from "./geo";
import type { Coordinates } from "./types";

export interface Locality extends Coordinates {
  /** The suburb's name as people write it ("St Kilda", "Melbourne CBD"). */
  name: string;
}

/** "fitzroy north" → "Fitzroy North"; "melbourne cbd" → "Melbourne CBD". */
function displayName(key: string): string {
  return key
    .split(" ")
    .map((word) => (word === "cbd" ? "CBD" : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** Alphabetical, for the suburb suggestions. */
export const MELBOURNE_LOCALITIES: readonly Locality[] = Object.entries(SUBURB_COORDINATES)
  .map(([key, { lat, lng }]) => ({ name: displayName(key), lat, lng }))
  .sort((a, b) => a.name.localeCompare(b.name));
