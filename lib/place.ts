/**
 * An event's place as text: what people read ("Richmond, NSW") and what the
 * suburb table looks up ("Richmond NSW"), for client and server alike.
 *
 * Like lib/time-zones.ts, this module must stay small: it never imports the
 * suburb table (lib/localities.ts, via lib/location.ts). It only reads the
 * state the table writes after a name it shares with another state.
 */
import { STATE_CODES, type StateCode } from "./time-zones";

/** Each state's and territory's name, for a line with room for it ("Richmond, Victoria"). */
export const STATE_NAMES: Readonly<Record<StateCode, string>> = {
  NSW: "New South Wales",
  VIC: "Victoria",
  QLD: "Queensland",
  SA: "South Australia",
  WA: "Western Australia",
  TAS: "Tasmania",
  NT: "Northern Territory",
  ACT: "Australian Capital Territory",
  OT: "Other Territories",
};

/** What a place needs: its suburb as stored, and its state (absent: Victoria, as every earlier event). */
export interface PlaceFields {
  suburb: string;
  state?: StateCode | null;
}

/** The state code a suburb ends with ("Richmond NSW", "Richmond, NSW"), or null ("Fitzroy"). */
export function trailingState(suburb: string): StateCode | null {
  const match = /[\s,]+([A-Za-z]{2,3})$/.exec(suburb.trim());
  if (!match) return null;
  const code = match[1].toUpperCase();
  return (STATE_CODES as readonly string[]).includes(code) ? (code as StateCode) : null;
}

/**
 * The suburb without a trailing state: the suburb table names a place whose
 * name another state shares with its state ("Richmond NSW", "Richmond
 * (Mackay) QLD"), so the state isn't said twice. `state`: strip only that
 * one; absent, any state code.
 */
export function bareSuburb(suburb: string, state?: StateCode | null): string {
  const trimmed = suburb.trim();
  const trailing = trailingState(trimmed);
  if (!trailing || (state && trailing !== state)) return trimmed;
  return trimmed.replace(/[\s,]+[A-Za-z]{2,3}$/, "");
}

/**
 * How a suburb is shown (owner decision D4): "Fitzroy, VIC", "Richmond,
 * NSW" (never "Richmond NSW, NSW"), "Perth, WA". No state: the one the suburb
 * names, else Victoria. Empty for an empty suburb.
 */
export function placeName(suburb: string, state?: StateCode | null): string {
  const parts = placeNameParts(suburb, state);
  return parts ? `${parts.suburb}, ${parts.state}` : "";
}

/**
 * placeName's two parts, for a line that cuts the suburb short but never
 * the state: `{ suburb: "Richmond", state: "NSW" }`. Null for an empty suburb.
 */
export function placeNameParts(suburb: string, state?: StateCode | null): { suburb: string; state: StateCode } | null {
  const trimmed = suburb.trim();
  if (!trimmed) return null;
  const shown = state ?? trailingState(trimmed) ?? "VIC";
  return { suburb: bareSuburb(trimmed, shown), state: shown };
}

/** placeName for an event (or anything with a suburb and a state). */
export function eventPlaceName(place: PlaceFields): string {
  return placeName(place.suburb, place.state);
}

/**
 * The text that finds an event's suburb in the suburb table (lib/location.ts
 * findLocality): the suburb with its state after it ("Perth WA", "Richmond
 * NSW", never "Richmond NSW NSW"). An event without a state (an older one, or
 * a demo sample) is looked up by its suburb alone, which is the Victorian one
 * for a shared name (owner decision D7).
 */
export function placeQuery(place: PlaceFields): string {
  const suburb = place.suburb.trim();
  if (!place.state || !suburb) return suburb;
  return trailingState(suburb) === place.state ? suburb : `${suburb} ${place.state}`;
}

/** Street types as Google and organisers write them, each to one short form, so "Street" and "St" compare equal. */
const STREET_TYPES: Readonly<Record<string, string>> = {
  street: "st",
  st: "st",
  road: "rd",
  rd: "rd",
  avenue: "ave",
  ave: "ave",
  av: "ave",
  boulevard: "blvd",
  blvd: "blvd",
  drive: "dr",
  dr: "dr",
  lane: "ln",
  ln: "ln",
  place: "pl",
  pl: "pl",
  parade: "pde",
  pde: "pde",
  terrace: "tce",
  tce: "tce",
  crescent: "cres",
  cres: "cres",
  court: "ct",
  ct: "ct",
  highway: "hwy",
  hwy: "hwy",
  square: "sq",
  sq: "sq",
  esplanade: "esp",
  esp: "esp",
  grove: "gr",
  gr: "gr",
  close: "cl",
  cl: "cl",
  circuit: "cct",
  cct: "cct",
};

/** One comma-separated part of an address, compared loosely: lower case, no punctuation, street types shortened. */
function streetKey(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => (i > 0 ? (STREET_TYPES[word] ?? word) : word))
    .join(" ");
}

/**
 * Whether `name` is just the street line of `address` ("170 Russell Street" and "170 Russell St", or "170 Russell
 * St, Melbourne VIC 3000"): what a Google *address* pick puts in the venue name. Only the whole first part of each
 * is compared (lower case, no punctuation, street types shortened), never a part of a word or of a name, so "Brunswick
 * Street Print Hall" never matches "Brunswick St". False when either is empty.
 */
export function sameStreetLine(name: string, address: string): boolean {
  const a = streetKey(name.split(",")[0] ?? "");
  const b = streetKey(address.split(",")[0] ?? "");
  return a !== "" && a === b;
}

/** What venueLines needs: the venue's name and street address as entered, and its place. */
export interface VenueFields extends PlaceFields {
  venueName: string;
  venueAddress: string;
}

/**
 * The venue as two lines (the event page's Where group, Round 2): its name, then its street address (or, without
 * one, "Suburb, STATE"). With no real name (none, or the name is only the street line, "170 Russell Street" over
 * "170 Russell St") the address leads instead, then "Suburb, STATE" unless the address already names the suburb
 * as one of its comma-separated parts with the same state (addressNamesPlace), so the address is never said twice.
 * `second` is empty when there's nothing more to say; `named`: `first` is the
 * venue's name.
 */
export function venueLines(venue: VenueFields): { first: string; second: string; named: boolean } {
  const name = venue.venueName.trim();
  const address = venue.venueAddress.trim();
  const place = placeName(venue.suburb, venue.state);
  if (name && !(address && sameStreetLine(name, address))) return { first: name, second: address || place, named: true };
  if (!address) return { first: place, second: "", named: false };
  return { first: address, second: addressNamesPlace(address, venue.suburb, venue.state) ? "" : place, named: false };
}

/** Each state's code and name, lower case, to its code: the words a part of an address may end with after its suburb. */
const STATE_WORDS: ReadonlyArray<readonly [string, StateCode]> = STATE_CODES.flatMap((code) => [
  [code.toLowerCase(), code] as const,
  [STATE_NAMES[code].toLowerCase(), code] as const,
]);

/**
 * Whether `address` names the place (placeNameParts: its suburb and state) as one of its comma-separated parts, the
 * suburb alone or followed by a state and/or postcode ("71 Johnston St, Collingwood VIC 3066"). A part that names a
 * state names the place only with the place's own state ("Richmond VIC 3121" isn't Richmond, NSW). Never a part of a
 * word or a street ("5 Kewney Ave" doesn't name Kew; "12 Carlton St" doesn't name Carlton). False for an empty suburb.
 */
export function addressNamesPlace(address: string, suburb: string, state?: StateCode | null): boolean {
  const place = placeNameParts(suburb, state);
  if (!place) return false;
  const wanted = place.suburb.replace(/\s+/g, " ").toLowerCase();
  return address.split(",").some((part) => {
    let words = part.trim().replace(/\s+/g, " ").toLowerCase();
    words = words.replace(/\s*\b\d{4}$/, "");
    const named = STATE_WORDS.find(([word]) => words.endsWith(` ${word}`));
    if (named) {
      if (named[1] !== place.state) return false;
      words = words.slice(0, -(named[0].length + 1));
    }
    return words === wanted;
  });
}
