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
