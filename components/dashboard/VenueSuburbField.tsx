"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useLocationModule } from "@/components/search/useLocationModule";
import { fieldClass } from "@/components/ui/Field";
import { loadLocation, type LocationModule } from "@/lib/location-loader";
import { bareSuburb, placeName, placeQuery, STATE_NAMES } from "@/lib/place";
import {
  defaultTimeZone,
  zoneLabel,
  zoneShortLabel,
  ZONES_BY_STATE,
  type AustralianTimeZone,
  type StateCode,
} from "@/lib/time-zones";

/**
 * The event editor's venue suburb (owner plan S8): one "Suburb or town"
 * field, checked against the ABS suburb table (lib/location.ts, loaded on
 * demand through lib/location-loader.ts, as the search bar's location picker
 * loads it), which gives the event's state and, from it, its time zone
 * (lib/time-zones.ts defaultTimeZone). Only New South Wales, Western
 * Australia and the other territories have more than one zone: there, a
 * choice of zone appears (VenueZoneField, a row of its own). A bare name
 * shared across states is the Victorian one (owner decision D7), and the
 * hint says where else it is; "Richmond, NSW" picks the state. A city
 * centre's name alone ("CBD", "City") isn't taken as Melbourne's here: it
 * asks which city.
 *
 * A saved event's own suburb, unchanged, is its saved place: known without
 * the table (so it saves even if the table can't load), and looked up with
 * its saved state once the table is there.
 */

/** Where the event is, as the editor sends it: the suburb's display name, its state and the zone its times are in. */
export interface VenuePlace {
  /** lib/location.ts `Locality.name` ("Fitzroy", "Richmond NSW"): what the API stores. */
  name: string;
  state: StateCode;
  timeZone: AustralianTimeZone;
}

/** What the suburb as typed comes to when saving. */
export type VenueResolution =
  | { kind: "empty" }
  | { kind: "found"; place: VenuePlace }
  /**
   * Not a suburb the table knows (or a city centre without its city): `message` says so;
   * `suggestion`, a place to fill the field with ("Fremantle, WA"), when there's a near one.
   */
  | { kind: "unknown"; message: string; suggestion?: string }
  /** The table couldn't load, so the suburb couldn't be checked. */
  | { kind: "unavailable"; message: string };

/** The editor's starting place: a saved event's suburb, state and zone. */
export interface VenueInitial {
  suburb: string;
  state?: StateCode;
  timeZone?: AustralianTimeZone;
}

/** A zone picked for one place ("Broken Hill NSW" on Sydney time): kept only while that place is the one typed. */
interface ZoneChoice {
  key: string;
  zone: AustralianTimeZone;
}

/** The saved event's place, while its suburb is the one typed. */
interface SavedPlace {
  suburb: string;
  state: StateCode;
  zone: AustralianTimeZone;
}

const placeKey = (name: string, state: StateCode) => `${name.trim().toLowerCase()}|${state}`;

/** The zone chosen for this place, else the saved event's own (for its own place), else the state's default for it. */
function zoneFor(name: string, state: StateCode, choice: ZoneChoice | null, savedZone?: AustralianTimeZone): AustralianTimeZone {
  const zones: readonly AustralianTimeZone[] = ZONES_BY_STATE[state];
  if (choice && choice.key === placeKey(name, state) && zones.includes(choice.zone)) return choice.zone;
  if (savedZone && zones.includes(savedZone)) return savedZone;
  return defaultTimeZone(state, name);
}

const CITY_CENTRE =
  "Which city’s centre? Add the city or its state (“Sydney CBD”, “CBD, NSW”).";

function resolve(
  location: LocationModule,
  typed: string,
  choice: ZoneChoice | null,
  saved: SavedPlace | null,
): VenueResolution {
  const text = typed.trim();
  if (!text) return { kind: "empty" };
  // The saved event's own suburb, unchanged: found with its saved state (an older "Newtown" saved in
  // NSW stays in NSW), never moved to the state the bare name would pick. One the table doesn't
  // know in that state stays as saved: the API checks it again.
  if (saved) {
    const locality = location.findLocality(placeQuery({ suburb: saved.suburb, state: saved.state }));
    const name = locality && locality.state === saved.state ? locality.name : saved.suburb;
    return { kind: "found", place: { name, state: saved.state, timeZone: zoneFor(name, saved.state, choice, saved.zone) } };
  }
  // "CBD" or "City" alone would be Melbourne's (lib/location.ts): an event's state and zone follow
  // from it, so ask which city rather than guess.
  if (location.isBareCityCentre(text)) {
    return { kind: "unknown", message: `${CITY_CENTRE} Did you mean Melbourne, VIC?`, suggestion: "Melbourne, VIC" };
  }
  const locality = location.findLocality(text);
  if (locality) {
    return {
      kind: "found",
      place: { name: locality.name, state: locality.state, timeZone: zoneFor(locality.name, locality.state, choice) },
    };
  }
  const near = location.didYouMean(text);
  if (!near) {
    return {
      kind: "unknown",
      message: "We couldn’t find that suburb or town. Check the spelling, or add its state (“Richmond, NSW”).",
    };
  }
  const suggestion = placeName(near.name, near.state);
  return { kind: "unknown", message: `We couldn’t find that suburb or town. Did you mean ${suggestion}?`, suggestion };
}

const UNAVAILABLE =
  "Couldn’t check the suburb: the list of suburbs didn’t load. Save again to try again, or reload the page if it keeps happening.";

/**
 * The venue suburb's state for the editor: what's typed, the zone choice,
 * and what they resolve to. `place` is null until the table has loaded
 * (except for a saved event's own suburb, known already) and while the
 * suburb isn't one it knows. `resolveForSave` loads the table if it hasn't
 * loaded yet (not for the saved event's own suburb, unchanged). Changing the
 * suburb or the zone never touches the date and time inputs: their
 * wall-clock times stay as typed, read in the new zone.
 */
export function useVenuePlace(initial?: VenueInitial) {
  const [suburb, setSuburb] = useState(initial?.suburb ?? "");
  // A saved event's place (absent: Victoria, on Melbourne time, as every earlier event).
  const savedState: StateCode = initial?.state ?? "VIC";
  const savedZone: AustralianTimeZone = initial?.timeZone ?? ZONES_BY_STATE.VIC[0];
  const [choice, setChoice] = useState<ZoneChoice | null>(null);
  // The table loads once the field is used, or at once for a saved event (its hint names the place).
  const [wanted, setWanted] = useState(Boolean(initial?.suburb.trim()));
  const { module: location, failed, retry } = useLocationModule(wanted);

  // The saved event's own suburb, while it's the one typed.
  const unchanged = Boolean(initial && suburb.trim() && suburb.trim() === initial.suburb.trim());
  const saved = useMemo<SavedPlace | null>(
    () => (unchanged && initial ? { suburb: initial.suburb.trim(), state: savedState, zone: savedZone } : null),
    [unchanged, initial, savedState, savedZone],
  );

  const resolution = useMemo<VenueResolution | null>(
    () => (location ? resolve(location, suburb, choice, saved) : null),
    [location, suburb, choice, saved],
  );

  // Before the table loads (or if it can't), a saved event's own suburb is already known.
  const savedPlace = useMemo<VenuePlace | null>(
    () =>
      saved ? { name: saved.suburb, state: saved.state, timeZone: zoneFor(saved.suburb, saved.state, choice, saved.zone) } : null,
    [saved, choice],
  );
  const place = resolution ? (resolution.kind === "found" ? resolution.place : null) : savedPlace;

  // Where else the typed name is, when it didn't say (D7 picks Victoria's): for the hint.
  const elsewhere = location && place && !saved ? location.sameNameElsewhere(suburb) : [];

  const chooseZone = useCallback(
    (zone: AustralianTimeZone) => {
      if (place) setChoice({ key: placeKey(place.name, place.state), zone });
    },
    [place],
  );

  const resolveForSave = useCallback(async (): Promise<VenueResolution> => {
    if (!suburb.trim()) return { kind: "empty" };
    // The saved place needs no table: it was checked when it was saved.
    if (!location && savedPlace && initial?.state) return { kind: "found", place: savedPlace };
    try {
      const loaded = location ?? (await loadLocation());
      // The field's own copy of the table failed earlier: have it pick this one up.
      if (failed) retry();
      return resolve(loaded, suburb, choice, saved);
    } catch {
      return { kind: "unavailable", message: UNAVAILABLE };
    }
  }, [location, suburb, choice, saved, savedPlace, initial?.state, failed, retry]);

  return {
    suburb,
    setSuburb,
    place,
    /** Other states with a place of the typed name, when the text named no state (["NSW", "QLD"]). */
    elsewhere,
    /** A near place to fill the field with ("Fremantle, WA"), while the typed suburb isn't one. */
    suggestion: resolution?.kind === "unknown" ? (resolution.suggestion ?? null) : null,
    /** The suburb table once it has loaded (for the suggestions), else null. */
    location,
    loading: wanted && !location && !failed,
    /** The table didn't load (the field is being used): the suburb can't be checked until it does. */
    failed: wanted && failed,
    chooseZone,
    resolveForSave,
    /** Load the table (the field is being used); after a failed load, try again. */
    requestTable: () => {
      setWanted(true);
      if (failed) retry();
    },
  };
}

export type VenuePlaceState = ReturnType<typeof useVenuePlace>;

/** The zone's city for the date legends: "Perth time", or "local time" while the place isn't known. */
export function venueZoneName(place: VenuePlace | null): string {
  return place ? zoneShortLabel(place.timeZone, place.state) : "local time";
}

/** Whether the place's state has more than one zone, so VenueZoneField shows a choice. */
export function hasZoneChoice(place: VenuePlace | null): boolean {
  return place !== null && ZONES_BY_STATE[place.state].length > 1;
}

/** The field's id (the editor focuses it for a suburb or state error, and a zone error with no choice shown). */
export const VENUE_SUBURB_ID = "suburb";
/** The zone choice's id (the editor focuses it for a zone error while it's shown). */
export const VENUE_TIME_ZONE_ID = "timeZone";

interface VenueSuburbFieldProps {
  venue: VenuePlaceState;
  /** Errors to show: the suburb's (this form's or the API's fieldErrors.suburb / .state) and the zone's. */
  suburbError?: string;
  timeZoneError?: string;
  /** The event's start, for the zone's abbreviation then (AEDT or AEST); now while there's none. */
  startsAt?: string;
  /** The suburb was edited (typed, or a suggestion taken): its errors no longer apply. */
  onSuburbEdit?: () => void;
}

/**
 * The field: "Suburb or town", its suggestions ("Richmond, VIC", "Richmond,
 * NSW"), a polite line under it naming the place and its zone ("Richmond,
 * Victoria · Melbourne time (AEDT)"), and where else a bare name is. A zone
 * error goes here only when there's no zone choice to show it by.
 */
export default function VenueSuburbField({ venue, suburbError, timeZoneError, startsAt, onSuburbEdit }: VenueSuburbFieldProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = `${VENUE_SUBURB_ID}-hint`;
  const errorId = `${VENUE_SUBURB_ID}-error`;
  const { place, suburb, location } = venue;
  const instant = startsAt ?? new Date().toISOString();
  // The zone's error goes by its choice when there is one, else by the suburb (the zone comes from it).
  const fieldError = suburbError ?? (!hasZoneChoice(place) ? timeZoneError : undefined);

  const suggestions = location
    ? location.suggestLocalities(suburb).map((locality) => placeName(locality.name, locality.state))
    : [];

  const hint = place
    ? `${bareSuburb(place.name, place.state)}, ${STATE_NAMES[place.state]} · ${zoneLabel(place.timeZone, instant, place.state)}`
    : venue.loading && suburb.trim()
      ? "Checking the suburb…"
      : venue.failed
        ? "Couldn’t load the list of suburbs, so this can’t be checked yet. We’ll try again when you save."
        : "";
  const elsewhere =
    place && venue.elsewhere.length > 0
      ? `Also in ${venue.elsewhere.join(", ")}. Add the state (“${bareSuburb(place.name, place.state)}, ${venue.elsewhere[0]}”) or pick it from the list.`
      : "";

  function edit(value: string) {
    venue.requestTable();
    venue.setSuburb(value);
    onSuburbEdit?.();
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={VENUE_SUBURB_ID} className="eyebrow text-muted">
        Suburb or town
      </label>
      <input
        ref={inputRef}
        id={VENUE_SUBURB_ID}
        value={suburb}
        onFocus={venue.requestTable}
        onChange={(event) => edit(event.target.value)}
        list={listId}
        autoComplete="off"
        maxLength={100}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={[hint ? hintId : null, fieldError ? errorId : null].filter(Boolean).join(" ") || undefined}
        // Chrome draws a black arrow for the suggestions that no other field has.
        className={`${fieldClass} [&::-webkit-calendar-picker-indicator]:opacity-0`}
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <p id={hintId} aria-live="polite" className="text-sm text-muted">
        {hint}
        {elsewhere && (
          <>
            {" "}
            <span className="block">{elsewhere}</span>
          </>
        )}
      </p>
      {venue.failed && !place && (
        <button
          type="button"
          onClick={venue.requestTable}
          className="inline-flex min-h-11 items-center self-start text-sm font-semibold underline underline-offset-4 sm:min-h-6"
        >
          Try again
        </button>
      )}
      {fieldError && (
        <p id={errorId} className="text-sm text-danger">
          {fieldError}
        </p>
      )}
      {fieldError && venue.suggestion && (
        <button
          type="button"
          onClick={() => {
            if (!venue.suggestion) return;
            edit(venue.suggestion);
            inputRef.current?.focus();
          }}
          className="inline-flex min-h-11 items-center self-start text-sm font-semibold underline underline-offset-4 sm:min-h-6"
        >
          Use {venue.suggestion}
        </button>
      )}
    </div>
  );
}

/** Why the zone is a choice, under it: most of the state keeps one zone. */
function zoneHelp(state: StateCode): string {
  const zones = ZONES_BY_STATE[state];
  if (state === "OT") return "Each of the other territories keeps its own time: check this is the venue’s.";
  const others = zones.slice(1).map((zone) => zoneShortLabel(zone, state));
  return `Most of ${STATE_NAMES[state]} is on ${zoneShortLabel(zones[0], state)}. Change this only if the venue keeps ${others.join(" or ")}.`;
}

interface VenueZoneFieldProps {
  venue: VenuePlaceState;
  timeZoneError?: string;
  /** The zone was changed: its error no longer applies. */
  onZoneEdit?: () => void;
}

/**
 * The zone choice, where the suburb's state has more than one (a row of its
 * own under the venue, so the names have room): "Sydney time", "Broken Hill
 * time", "Lord Howe Island time". The hint by the suburb gives the one
 * chosen with its abbreviation or offset. Nothing elsewhere.
 */
export function VenueZoneField({ venue, timeZoneError, onZoneEdit }: VenueZoneFieldProps) {
  const { place } = venue;
  if (!place || !hasZoneChoice(place)) return null;
  const zones: readonly AustralianTimeZone[] = ZONES_BY_STATE[place.state];
  const helpId = `${VENUE_TIME_ZONE_ID}-help`;
  const errorId = `${VENUE_TIME_ZONE_ID}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={VENUE_TIME_ZONE_ID} className="eyebrow text-muted">
        Time zone
      </label>
      <select
        id={VENUE_TIME_ZONE_ID}
        value={place.timeZone}
        onChange={(event) => {
          const zone = zones.find((candidate) => candidate === event.target.value);
          if (zone) venue.chooseZone(zone);
          onZoneEdit?.();
        }}
        aria-invalid={timeZoneError ? true : undefined}
        aria-describedby={timeZoneError ? `${errorId} ${helpId}` : helpId}
        className={`${fieldClass} sm:max-w-sm`}
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zoneShortLabel(zone, place.state)}
          </option>
        ))}
      </select>
      {timeZoneError && (
        <p id={errorId} className="text-sm text-danger">
          {timeZoneError}
        </p>
      )}
      <p id={helpId} className="text-sm text-muted">
        {zoneHelp(place.state)}
      </p>
    </div>
  );
}
