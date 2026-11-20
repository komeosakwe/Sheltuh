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

/**
 * One comma-separated part of an address, compared loosely: composed (NFC, so "Café" and "Cafe\u0301" are one word,
 * accent kept), lower case, no punctuation, street types shortened.
 */
function streetKey(part: string): string {
  return part
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => (i > 0 ? (STREET_TYPES[word] ?? word) : word))
    .join(" ");
}

/**
 * Whether `name` is just the street line of `address` ("170 Russell Street" and "170 Russell St"): what a Google
 * *address* pick puts in the venue name. The first comma-separated part of each is compared whole (lower case, no
 * punctuation, street types shortened), never a part of a word or of a name, so "Brunswick Street Print Hall" never
 * matches "Brunswick St". Anything after a comma in the name must be only `place`, the event's locality ("170 Russell
 * Street, Melbourne VIC 3000" for Melbourne, VIC: localityOnly); anything else is the organiser's own qualifier
 * ("170 Russell Street, Rooftop"), so the name is a real one. False when either is empty.
 */
export function sameStreetLine(name: string, address: string, place?: PlaceFields): boolean {
  const [street = "", ...rest] = name.split(",");
  const a = streetKey(street);
  const b = streetKey(address.split(",")[0] ?? "");
  if (a === "" || a !== b) return false;
  const suffix = rest.join(",").trim();
  return suffix === "" || (place !== undefined && localityOnly(suffix, place.suburb, place.state));
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
  if (name && !(address && sameStreetLine(name, address, venue))) return { first: name, second: address || place, named: true };
  if (!address) return { first: place, second: "", named: false };
  return { first: address, second: addressNamesPlace(address, venue.suburb, venue.state) ? "" : place, named: false };
}

/** Each state's code and name, lower case, to its code: the words a part of an address may end with after its suburb. */
const STATE_WORDS: ReadonlyArray<readonly [string, StateCode]> = STATE_CODES.flatMap((code) => [
  [code.toLowerCase(), code] as const,
  [STATE_NAMES[code].toLowerCase(), code] as const,
]);

/** One comma-separated part of an address, loosely: its words before any state (and postcode), and that state. */
interface AddressPart {
  words: string;
  state: StateCode | null;
}

/** "Collingwood VIC 3066" → { words: "collingwood", state: "VIC" }; "VIC 3121" → { words: "", state: "VIC" }; "3121" → { words: "", state: null }. */
function addressPart(part: string): AddressPart {
  const words = part.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase().replace(/\s*\b\d{4}$/, "");
  const named = STATE_WORDS.find(([word]) => words === word || words.endsWith(` ${word}`));
  if (!named) return { words, state: null };
  return { words: words.slice(0, -named[0].length).trim(), state: named[1] };
}

/**
 * How `parts[i]` names the place: the suburb, then (in that part or, for a bare suburb, in the next part, "1 Swan
 * St, Richmond, VIC 3121") the place's own state (`stated`) or no state. Null when it doesn't (another suburb, or
 * another state).
 */
function partNaming(parts: readonly AddressPart[], i: number, place: { suburb: string; state: StateCode }): { stated: boolean } | null {
  const part = parts[i];
  if (part.words !== place.suburb.normalize("NFC").replace(/\s+/g, " ").toLowerCase()) return null;
  const next = parts[i + 1];
  const state = part.state ?? (next && next.words === "" ? next.state : null);
  if (state && state !== place.state) return null;
  return { stated: state !== null };
}

const partNamesPlace = (parts: readonly AddressPart[], i: number, place: { suburb: string; state: StateCode }) =>
  partNaming(parts, i, place) !== null;

/**
 * Whether `address` names the place (placeNameParts: its suburb and state) as one of its comma-separated parts, the
 * suburb alone or followed by a state and/or postcode ("71 Johnston St, Collingwood VIC 3066"). A state after the
 * suburb, in its part or as the next part on its own, names the place only if it's the place's own state ("Richmond
 * VIC 3121" and "Richmond, VIC 3121" aren't Richmond, NSW). Never a part of a word or a street ("5 Kewney Ave" doesn't
 * name Kew; "12 Carlton St" doesn't name Carlton). False for an empty suburb.
 */
export function addressNamesPlace(address: string, suburb: string, state?: StateCode | null): boolean {
  return addressPlace(address, suburb, state) !== null;
}

/**
 * How `address` names the place (addressNamesPlace): `stated` when it says the state too ("Richmond NSW 2753",
 * "Richmond, NSW"), not for the suburb alone ("Richmond", "Richmond 2753"). Null when it doesn't name it. For a map
 * query, which needs the state where the event page doesn't.
 */
export function addressPlace(address: string, suburb: string, state?: StateCode | null): { stated: boolean } | null {
  const place = placeNameParts(suburb, state);
  if (!place) return null;
  const parts = address.split(",").map(addressPart);
  let bare: { stated: boolean } | null = null;
  for (let i = 0; i < parts.length; i++) {
    const naming = partNaming(parts, i, place);
    if (naming?.stated) return naming;
    bare ??= naming;
  }
  return bare;
}

/**
 * Whether `text` is only the place (comma-separated parts that name it, as addressNamesPlace, or are only its state,
 * a postcode or "Australia"), and names it: "Melbourne VIC 3000", "Melbourne, Victoria, Australia" for Melbourne,
 * VIC; never "Rooftop" or "Rooftop, Melbourne".
 */
function localityOnly(text: string, suburb: string, state?: StateCode | null): boolean {
  const place = placeNameParts(suburb, state);
  if (!place) return false;
  const parts = text.split(",").map(addressPart);
  const extra = (part: AddressPart) => (part.words === "" && (!part.state || part.state === place.state)) || (!part.state && part.words === "australia");
  return parts.some((_, i) => partNamesPlace(parts, i, place)) && parts.every((part, i) => extra(part) || partNamesPlace(parts, i, place));
}
