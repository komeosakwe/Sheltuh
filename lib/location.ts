/**
 * The suburb table's lookups (docs/architecture.md, "Location" and "Events:
 * state and time zone"), for the browser and the server.
 *
 * In the browser, "near you" search: a visitor's suburb (typed, or worked
 * out from the browser's position and then the position dropped) orders
 * /search results by the distance between suburb centres. Nothing here is
 * sent to the API, and no coordinates leave the function that receives them.
 * Distances are approximate: suburb centre to suburb centre, never venue to
 * venue. /map places events at their suburb's centre, and the event editor
 * resolves an organiser's suburb to its state and time zone with it.
 *
 * On the server, the write routes check an event's suburb against its state
 * (lib/server/event-input.ts), and /search resolves `near`.
 *
 * The suburb table (lib/localities.ts: every ABS suburb and locality in
 * Australia) is large, so client components load this module on demand
 * (lib/location-loader.ts) and import only its types statically. The event
 * write routes import it directly; /search (app/search/page.tsx) only when
 * the address has a `near`.
 */
import { distanceKm, MELBOURNE_DEFAULT_CENTER } from "./geo";
import { LOCALITY_DATA, LOCALITY_REACH_KM } from "./localities";
import { parseNearParam } from "./near-storage";
import { placeName, placeQuery, type PlaceFields } from "./place";
import type { StateCode } from "./time-zones";
import type { Coordinates } from "./types";

export type { StateCode };
export { distanceKm, parseNearParam, placeQuery };

/** The table's order. */
const STATE_CODES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT", "OT"] as const satisfies readonly StateCode[];

export interface Locality extends Coordinates {
  /**
   * What the suburb is called here, and text that finds it again: the ABS
   * name alone where that's unambiguous ("Fitzroy", and "Richmond" for
   * Melbourne's), otherwise with its state ("Richmond NSW"), and for a name
   * used twice in one state with the ABS's qualifier ("Richmond (Mackay) QLD").
   */
  name: string;
  state: StateCode;
}

/**
 * Slack, in km, on a locality's reach when placing the browser's position:
 * a coarse fix (Wi-Fi or cell, `enableHighAccuracy: false`) can be a
 * kilometre or two out, which matters on the coast.
 */
export const NEAREST_MARGIN_KM = 2;

// Maps, not object literals: what people type is looked up here, and a plain
// object would answer "constructor" or "__proto__" from its prototype.
const ALIASES: ReadonlyMap<string, string> = new Map([
  ["cbd", "melbourne"],
  ["city", "melbourne"],
  ["melbourne cbd", "melbourne"],
  ["melbourne city", "melbourne"],
  ["melbourne city centre", "melbourne"],
  ["melbourne city center", "melbourne"],
]);

const WORDS: ReadonlyMap<string, string> = new Map([
  ["saint", "st"],
  ["mt", "mount"],
  ["nth", "north"],
  ["sth", "south"],
]);

/** A state written after the suburb: "Richmond NSW", "Richmond, New South Wales", "Richmond (Vic)". */
const STATE_WORDS: ReadonlyMap<string, StateCode> = new Map([
  ["nsw", "NSW"],
  ["new south wales", "NSW"],
  ["vic", "VIC"],
  ["victoria", "VIC"],
  ["qld", "QLD"],
  ["queensland", "QLD"],
  ["sa", "SA"],
  ["south australia", "SA"],
  ["wa", "WA"],
  ["western australia", "WA"],
  ["tas", "TAS"],
  ["tasmania", "TAS"],
  ["nt", "NT"],
  ["northern territory", "NT"],
  ["act", "ACT"],
  ["australian capital territory", "ACT"],
  ["ot", "OT"],
]);

const COUNTRY_WORDS = new Set(["australia", "au"]);

/** Lower case, no accents or punctuation, no postcodes, St/Mt/Nth/Sth spelt one way. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word && !/^\d{4}$/.test(word))
    .map((word) => WORDS.get(word) ?? word);
}

/** The CBD's many names are Melbourne's (Melbourne-first), unless another state is named. */
function alias(key: string, state: StateCode | null): string {
  return state === null || state === "VIC" ? (ALIASES.get(key) ?? key) : key;
}

/**
 * One spelling per suburb name, for comparing what people type: case,
 * accents, punctuation, spacing, postcodes, St/Saint, Mt/Mount, Nth/Sth and
 * the CBD's many names. A state stays in ("richmond nsw"): findLocality
 * reads it. Exported for its tests only: lookups go through findLocality.
 */
export function normaliseSuburb(text: string): string {
  return alias(words(text).join(" "), null);
}

interface Reading {
  key: string;
  state: StateCode | null;
}

/**
 * The ways to read what was typed, most literal first: all of it (there are
 * places called Mount Victoria and Port Victoria), then without a trailing
 * country, then without a trailing state, which narrows the search ("Fitzroy,
 * VIC 3065, Australia" is Fitzroy in Victoria).
 */
function readings(text: string): Reading[] {
  let rest = words(text);
  const found: Reading[] = [{ key: alias(rest.join(" "), null), state: null }];
  for (;;) {
    for (const size of [3, 2, 1]) {
      const state = rest.length > size ? STATE_WORDS.get(rest.slice(-size).join(" ")) : undefined;
      if (state) {
        found.push({ key: alias(rest.slice(0, -size).join(" "), state), state });
        return found;
      }
    }
    if (rest.length < 2 || !COUNTRY_WORDS.has(rest[rest.length - 1])) return found;
    rest = rest.slice(0, -1);
    found.push({ key: alias(rest.join(" "), null), state: null });
  }
}

/**
 * The table, decoded into columns (one entry per locality, by state then
 * name): no object per row until one is asked for, so loading stays quick.
 */
const BASE: string[] = []; // The ABS name without its bracket ("Richmond").
const KEY: string[] = []; // BASE, normalised (without the CBD aliases: the ACT has a suburb called City).
const QUALIFIER: string[] = []; // The ABS's in-state qualifier ("Mackay" for "Richmond (Mackay - Qld)"), or "".
const STATE: StateCode[] = [];
const LAT: number[] = [];
const LNG: number[] = [];
const REACH_KM: number[] = []; // How far the boundary goes from the centre, rounded up.
const MELBOURNE_KM: number[] = []; // From the centre of Melbourne: same-named places are preferred nearest first.

/** An ABS name's key: the names are plain ASCII, so this is `words(name)` without the Unicode steps. */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(saint|mt|nth|sth)\b/g, (word) => WORDS.get(word) ?? word);
}

// lib/localities.ts, row by row: name[~qualifier], then base-36 latitude (3), longitude (4) and reach (1).
for (const state of STATE_CODES) {
  for (const item of LOCALITY_DATA[state].split("|")) {
    const end = item.length - 8;
    const tilde = item.indexOf("~");
    const base = item.slice(0, tilde < 0 ? end : tilde);
    BASE.push(base);
    KEY.push(nameKey(base));
    QUALIFIER.push(tilde < 0 ? "" : item.slice(tilde + 1, end));
    STATE.push(state);
    const lat = -(8000 + parseInt(item.slice(end, end + 3), 36)) / 1000;
    const lng = (95000 + parseInt(item.slice(end + 3, end + 7), 36)) / 1000;
    const reach = LOCALITY_REACH_KM[parseInt(item.slice(end + 7), 36)];
    // A row that doesn't decode is a broken table: fail loudly rather than place people wrongly.
    if (!base || !Number.isFinite(lat) || !Number.isFinite(lng) || reach === undefined) {
      throw new Error(`lib/localities.ts: can't read the row "${item}"`);
    }
    LAT.push(lat);
    LNG.push(lng);
    REACH_KM.push(reach);
    MELBOURNE_KM.push(distanceKm(MELBOURNE_DEFAULT_CENTER, { lat, lng }));
  }
}

/**
 * Same-named places, preferred first: Victoria's (Melbourne-first), then the
 * more compact (a city suburb rather than a rural locality: Perth WA over
 * Perth TAS, the town of Dunolly over the farmland around it), then the one
 * nearest Melbourne.
 */
function preferred(a: number, b: number): number {
  return (
    Number(STATE[a] !== "VIC") - Number(STATE[b] !== "VIC") ||
    REACH_KM[a] - REACH_KM[b] ||
    MELBOURNE_KM[a] - MELBOURNE_KM[b]
  );
}

/** Normalised name → the rows it could mean, preferred first. */
const BY_KEY = new Map<string, number[]>();
function addKey(key: string, row: number) {
  const list = BY_KEY.get(key);
  if (list) list.push(row);
  else BY_KEY.set(key, [row]);
}
for (let row = 0; row < BASE.length; row++) {
  addKey(KEY[row], row);
  // "Richmond (Mackay) QLD" reads as "richmond mackay", in Queensland.
  if (QUALIFIER[row]) addKey(`${KEY[row]} ${nameKey(QUALIFIER[row])}`, row);
}
for (const list of BY_KEY.values()) if (list.length > 1) list.sort(preferred);

/**
 * Cities people name by a word the ABS doesn't use for any one locality:
 * "Brisbane" is Brisbane City, "Canberra" is the ACT's City, "Gold Coast"
 * is Surfers Paradise. Tried only when the words name no locality as they
 * are (Bendigo, Geelong, Hobart and Perth do).
 */
/** Each state's capital's centre, by its key (Victoria's is "melbourne"; the other territories have none). */
const CAPITALS: { readonly [S in StateCode]?: { name: string; key: string } } = {
  NSW: { name: "sydney", key: "sydney" },
  VIC: { name: "melbourne", key: "melbourne" },
  QLD: { name: "brisbane", key: "brisbane city" },
  SA: { name: "adelaide", key: "adelaide" },
  WA: { name: "perth", key: "perth" },
  TAS: { name: "hobart", key: "hobart" },
  NT: { name: "darwin", key: "darwin city" },
  ACT: { name: "canberra", key: "city" },
};

/** What people call a city's centre: alone ("CBD", which state's?), or after the city ("Sydney CBD"). */
const CENTRE_WORDS: ReadonlySet<string> = new Set(["cbd", "city", "city centre", "city center"]);

const CITY_NAMES: ReadonlyMap<string, { key: string; state: StateCode }> = new Map([
  ["brisbane", { key: "brisbane city", state: "QLD" }],
  ["darwin", { key: "darwin city", state: "NT" }],
  ["canberra", { key: "city", state: "ACT" }],
  ["cairns", { key: "cairns city", state: "QLD" }],
  ["townsville", { key: "townsville city", state: "QLD" }],
  ["toowoomba", { key: "toowoomba city", state: "QLD" }],
  ["gold coast", { key: "surfers paradise", state: "QLD" }],
  ["sunshine coast", { key: "maroochydore", state: "QLD" }],
  ["ballarat", { key: "ballarat central", state: "VIC" }],
  // A capital's centre by its other names: "Sydney CBD", "Perth City", "Canberra city centre"
  // (Melbourne's are aliases, above; "Brisbane City" and "Darwin City" are localities already).
  ...(Object.entries(CAPITALS) as [StateCode, { name: string; key: string }][]).flatMap(([state, capital]) =>
    [...CENTRE_WORDS].map((word): [string, { key: string; state: StateCode }] => [`${capital.name} ${word}`, { key: capital.key, state }]),
  ),
]);

function rowFor(key: string, state: StateCode | null): number | null {
  return BY_KEY.get(key)?.find((row) => state === null || STATE[row] === state) ?? null;
}

/** How `text` was found: the row, and whether the text named its state ("Richmond, NSW"). */
function findMatch(text: string): { row: number; stateNamed: boolean } | null {
  const all = readings(text);
  for (const { key, state } of all) {
    const found = rowFor(key, state);
    if (found !== null) return { row: found, stateNamed: state !== null };
  }
  for (const { key, state } of all) {
    const city = CITY_NAMES.get(key);
    if (city && (state === null || state === city.state)) {
      const found = rowFor(city.key, city.state);
      return found === null ? null : { row: found, stateNamed: true };
    }
  }
  // "CBD, NSW", "City (Tas)": that state's capital.
  for (const { key, state } of all) {
    const capital = state ? CAPITALS[state] : undefined;
    if (capital && CENTRE_WORDS.has(key)) {
      const found = rowFor(capital.key, state);
      return found === null ? null : { row: found, stateNamed: true };
    }
  }
  return null;
}

function findRow(text: string): number | null {
  return findMatch(text)?.row ?? null;
}

/**
 * The first of "Richmond", "Richmond NSW", "Richmond (Mackay) QLD" that finds
 * this row again. The ABS has two pairs with one name in one state and no
 * qualifier, a town and the locality around it ("Dunolly" and "Dunolly
 * (Vic)"): the surrounds take the town's name, and are found as the town.
 */
function nameFor(row: number): string {
  const base = BASE[row];
  if (BY_KEY.get(KEY[row])?.[0] === row && !ALIASES.has(KEY[row])) return base;
  const names = [base, `${base} ${STATE[row]}`];
  if (QUALIFIER[row]) names.push(`${base} (${QUALIFIER[row]}) ${STATE[row]}`);
  const name = names.find((candidate) => findRow(candidate) === row);
  if (name) return name;
  const town = findRow(`${base} ${STATE[row]}`);
  return town !== null && town !== row ? nameFor(town) : names[names.length - 1];
}

const PLACES: (Locality | undefined)[] = [];

/** Row `row` as a Locality: made the first time it's asked for, then the same object every time. */
function placeAt(row: number): Locality {
  return (PLACES[row] ??= Object.freeze({ name: nameFor(row), state: STATE[row], lat: LAT[row], lng: LNG[row] }));
}

/** How many suburbs and localities the table has. */
export const LOCALITY_COUNT = BASE.length;

/** Every suburb and locality in Australia, by state then name (lib/localities.ts). */
export function allLocalities(): Locality[] {
  return BASE.map((_, row) => placeAt(row));
}

/**
 * The suburb `text` names, or null. A name in more than one state is
 * Victoria's unless a state is given ("Richmond" is Melbourne's; "Richmond
 * NSW", "Richmond, NSW" and "Richmond (NSW)" are the one near Sydney); with
 * no Victorian one, the more compact, then the one nearest Melbourne.
 */
export function findLocality(text: string): Locality | null {
  const row = findRow(text);
  return row === null ? null : placeAt(row);
}

/**
 * Whether `text` is a city centre's name without the city or a state ("CBD",
 * "City", "city centre"). findLocality reads it as Melbourne's
 * (Melbourne-first, for "near you"); the event editor asks which city
 * instead, since an event's state and time zone follow from it.
 */
export function isBareCityCentre(text: string): boolean {
  return CENTRE_WORDS.has(words(text).join(" "));
}

/**
 * The other states with a suburb of the name `text` found, when `text`
 * didn't say which state ("Newtown" is Victoria's, and there are Newtowns in
 * NSW, QLD and TAS: ["NSW", "QLD", "TAS"]), in the table's state order.
 * Empty when the text named a state ("Newtown, NSW"), names a city
 * ("Brisbane"), or names nothing.
 */
export function sameNameElsewhere(text: string): StateCode[] {
  const match = findMatch(text);
  if (!match || match.stateNamed) return [];
  const others = new Set((BY_KEY.get(KEY[match.row]) ?? []).map((row) => STATE[row]));
  others.delete(STATE[match.row]);
  return STATE_CODES.filter((state) => others.has(state));
}

/**
 * Up to `limit` suburbs whose name starts with what's been typed (at least
 * two letters), for the location field's suggestions: an exact name first,
 * then as preferred for a shared name (Victoria's, the more compact, nearest
 * Melbourne). "Richmond n" finds Richmond NSW.
 */
export function suggestLocalities(text: string, limit = 8): Locality[] {
  const typed = words(text).join(" ");
  if (typed.length < 2) return [];
  const matches: number[] = [];
  for (let row = 0; row < KEY.length; row++) {
    const key = KEY[row];
    if (key.startsWith(typed) || (typed.startsWith(key) && `${key} ${STATE[row].toLowerCase()}`.startsWith(typed))) {
      matches.push(row);
    }
  }
  // "Canb" offers the ACT's City, "Gold" Surfers Paradise.
  const cities: number[] = [];
  for (const [name, city] of CITY_NAMES) {
    const row = name.startsWith(typed) ? rowFor(city.key, city.state) : null;
    if (row !== null) cities.push(row);
  }
  const ordered = [
    ...cities,
    ...matches.sort((a, b) => Number(KEY[b] === typed) - Number(KEY[a] === typed) || preferred(a, b)),
  ];
  // One per name: a town and the locality around it share one ("Dunolly").
  const byName = new Map<string, Locality>();
  for (const row of ordered) {
    const place = placeAt(row);
    if (!byName.has(place.name)) byName.set(place.name, place);
    if (byName.size === limit) break;
  }
  return [...byName.values()];
}

export type NearestResult =
  | { kind: "found"; locality: Locality }
  /** Not in (nor within NEAREST_MARGIN_KM of) any Australian locality: overseas or out at sea. */
  | { kind: "outside" };

/**
 * The suburb a position is in, as near as the table can say: of the
 * localities whose boundary could reach it (centre to furthest boundary
 * point, plus NEAREST_MARGIN_KM), the one with the nearest centre. The
 * caller keeps only the result's name and drops the position.
 *
 * Near a border it can name the neighbour: the table keeps one centre per
 * locality, not its boundary, so a position closer to the next suburb's
 * centre than its own gets the next suburb. Checked against the ABS
 * polygons (Oct 2026, random points inside each locality, which favours
 * border areas in big ones): about 80% name the locality the point is in,
 * in Greater Melbourne and nationally, and the rest a neighbour (Southern
 * Cross Station, inside Docklands' boundary, comes out as South Wharf).
 * Centres the city's own landmarks are near are right (Bourke St Mall,
 * Melbourne Central and Flagstaff are Melbourne).
 */
export function nearestLocality(position: Coordinates): NearestResult {
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return { kind: "outside" };
  let best: number | null = null;
  let bestKm = Infinity;
  for (let row = 0; row < LAT.length; row++) {
    const reach = REACH_KM[row] + NEAREST_MARGIN_KM;
    // A degree of latitude is about 111 km: skip the far ones before the trigonometry.
    if (Math.abs(LAT[row] - position.lat) * 111 > Math.min(reach, bestKm)) continue;
    const km = distanceKm(position, { lat: LAT[row], lng: LNG[row] });
    if (km <= reach && km < bestKm) {
      best = row;
      bestKm = km;
    }
  }
  return best === null ? { kind: "outside" } : { kind: "found", locality: placeAt(best) };
}

/**
 * Bands, nearest first (owner decision D4, 24 Oct 2026: bands, then soonest
 * within each; "Over 100 km" since events are Australia-wide, owner decision
 * D8, 26 Oct 2026).
 */
export const NEARNESS_BANDS = ["here", "near", "mid", "far", "distant", "unknown"] as const;
export type NearnessBand = (typeof NEARNESS_BANDS)[number];

/**
 * Where `suburb` (the text that finds it: placeQuery's "Perth WA", or a
 * name alone) sits from `origin`. An unknown suburb is "unknown", never
 * dropped.
 */
export function nearnessBand(origin: Locality, suburb: string): NearnessBand {
  const place = findLocality(suburb);
  if (!place) return "unknown";
  if (place.name === origin.name) return "here";
  const km = distanceKm(origin, place);
  if (km <= 5) return "near";
  if (km <= 15) return "mid";
  if (km <= 100) return "far";
  return "distant";
}

export function nearnessBandLabel(band: NearnessBand, origin: Locality): string {
  switch (band) {
    case "here":
      return `In ${placeName(origin.name, origin.state)}`;
    case "near":
      return "Within 5 km";
    case "mid":
      return "5–15 km";
    case "far":
      return "15–100 km";
    case "distant":
      return "Over 100 km";
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
 * within each band, then by id so equal times keep a stable order. Each
 * item's suburb is looked up with its state (placeQuery).
 */
export function orderByNearness<T extends PlaceFields & { startsAt: string; id: string }>(
  items: readonly T[],
  origin: Locality,
): NearnessGroup<T>[] {
  const byBand = new Map<NearnessBand, T[]>(NEARNESS_BANDS.map((band) => [band, []]));
  for (const item of items) byBand.get(nearnessBand(origin, placeQuery(item)))?.push(item);
  return NEARNESS_BANDS.flatMap((band) => {
    const bandItems = byBand.get(band) ?? [];
    if (bandItems.length === 0) return [];
    bandItems.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
    return [{ band, label: nearnessBandLabel(band, origin), items: bandItems }];
  });
}

/** Edit distance from `a` to `b`, or `limit + 1` once it's sure to be more than `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/** Each normalised name, by its distinct two-letter pieces: built the first time didYouMean needs it. */
let pieceIndex: { names: string[]; byPiece: Map<string, number[]> } | null = null;

function pieces(text: string): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i + 1 < text.length; i++) found.add(text.slice(i, i + 2));
  return found;
}

function namesToCompare(key: string, allowed: number): string[] {
  if (!pieceIndex) {
    const names = [...BY_KEY.keys()];
    const byPiece = new Map<string, number[]>();
    names.forEach((name, index) => {
      for (const piece of pieces(name)) {
        const list = byPiece.get(piece);
        if (list) list.push(index);
        else byPiece.set(piece, [index]);
      }
    });
    pieceIndex = { names, byPiece };
  }
  const { names, byPiece } = pieceIndex;
  // Each edit can break at most two of the typed text's distinct pieces, so a name within
  // `allowed` edits shares at least this many of them. Too few to filter on: compare them all.
  const own = pieces(key);
  const needed = own.size - 2 * allowed;
  if (needed <= 0) return names.filter((name) => Math.abs(name.length - key.length) <= allowed);
  const shared = new Map<number, number>();
  for (const piece of own) for (const index of byPiece.get(piece) ?? []) shared.set(index, (shared.get(index) ?? 0) + 1);
  const close: string[] = [];
  for (const [index, count] of shared) {
    const name = names[index];
    if (count >= needed && Math.abs(name.length - key.length) <= allowed) close.push(name);
  }
  return close;
}

/**
 * A known suburb one or two letters away from `text` ("Brunswik" →
 * Brunswick), in the state given if there is one ("Brunswik WA"), or null:
 * none close, more than one equally close, or `text` already names one.
 */
export function didYouMean(text: string): Locality | null {
  if (findRow(text) !== null) return null;
  for (const { key, state } of readings(text)) {
    if (!key) continue;
    const allowed = key.length >= 6 ? 2 : 1;
    let best: number | null = null;
    let bestDistance = allowed + 1;
    let tie = false;
    for (const name of namesToCompare(key, allowed)) {
      const row = rowFor(name, state);
      if (row === null) continue;
      const d = editDistance(key, name, allowed);
      if (d < bestDistance) {
        best = row;
        bestDistance = d;
        tie = false;
      } else if (d === bestDistance && row !== best) {
        tie = true;
      }
    }
    if (best !== null && !tie) return placeAt(best);
  }
  return null;
}

