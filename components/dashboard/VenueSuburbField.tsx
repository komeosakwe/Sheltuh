"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useLocationModule } from "@/components/search/useLocationModule";
import { fieldClass } from "@/components/ui/Field";
import { loadLocation, type LocationModule } from "@/lib/location-loader";
import { bareSuburb, placeName, STATE_NAMES } from "@/lib/place";
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
 * choice of zone appears. A bare name shared across states is the Victorian
 * one (owner decision D7); "Richmond, NSW" picks the state.
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
  /** Not a suburb the table knows: `message` says so, with a near spelling when there's one. */
  | { kind: "unknown"; message: string }
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

const placeKey = (name: string, state: StateCode) => `${name.trim().toLowerCase()}|${state}`;

function zoneFor(name: string, state: StateCode, choice: ZoneChoice | null): AustralianTimeZone {
  const zones: readonly AustralianTimeZone[] = ZONES_BY_STATE[state];
  if (choice && choice.key === placeKey(name, state) && zones.includes(choice.zone)) return choice.zone;
  return defaultTimeZone(state, name);
}

function resolve(
  location: LocationModule,
  typed: string,
  choice: ZoneChoice | null,
): VenueResolution {
  const text = typed.trim();
  if (!text) return { kind: "empty" };
  const locality = location.findLocality(text);
  if (locality) {
    return {
      kind: "found",
      place: { name: locality.name, state: locality.state, timeZone: zoneFor(locality.name, locality.state, choice) },
    };
  }
  const near = location.didYouMean(text);
  return {
    kind: "unknown",
    message: near
      ? `We couldn’t find that suburb or town. Did you mean ${placeName(near.name, near.state)}?`
      : "We couldn’t find that suburb or town. Check the spelling, or add its state (“Richmond, NSW”).",
  };
}

const UNAVAILABLE = "Couldn’t check the suburb: the list of suburbs didn’t load. Check your connection and save again.";

/**
 * The venue suburb's state for the editor: what's typed, the zone choice,
 * and what they resolve to. `place` is null until the table has loaded
 * (except for a saved event's own suburb, known already) and while the
 * suburb isn't one it knows. `resolveForSave` loads the table if it hasn't
 * loaded yet. Changing the suburb or the zone never touches the date and
 * time inputs: their wall-clock times stay as typed, read in the new zone.
 */
export function useVenuePlace(initial?: VenueInitial) {
  const [suburb, setSuburb] = useState(initial?.suburb ?? "");
  // A saved event's place (absent: Victoria, on Melbourne time, as every earlier event).
  const savedState: StateCode = initial?.state ?? "VIC";
  const savedZone: AustralianTimeZone = initial?.timeZone ?? ZONES_BY_STATE.VIC[0];
  const [choice, setChoice] = useState<ZoneChoice | null>(() =>
    initial ? { key: placeKey(initial.suburb, savedState), zone: savedZone } : null,
  );
  // The table loads once the field is used, or at once for a saved event (its hint names the place).
  const [wanted, setWanted] = useState(Boolean(initial?.suburb.trim()));
  const { module: location, failed, retry } = useLocationModule(wanted);

  const resolution = useMemo<VenueResolution | null>(
    () => (location ? resolve(location, suburb, choice) : null),
    [location, suburb, choice],
  );

  // Before the table loads, a saved event's own suburb is already known.
  const savedPlace: VenuePlace | null =
    initial && suburb.trim() && suburb.trim() === initial.suburb.trim()
      ? { name: initial.suburb.trim(), state: savedState, timeZone: zoneFor(initial.suburb, savedState, choice) }
      : null;
  const place = resolution ? (resolution.kind === "found" ? resolution.place : null) : savedPlace;

  const chooseZone = useCallback(
    (zone: AustralianTimeZone) => {
      if (place) setChoice({ key: placeKey(place.name, place.state), zone });
    },
    [place],
  );

  const resolveForSave = useCallback(async (): Promise<VenueResolution> => {
    if (!suburb.trim()) return { kind: "empty" };
    try {
      return resolve(location ?? (await loadLocation()), suburb, choice);
    } catch {
      return { kind: "unavailable", message: UNAVAILABLE };
    }
  }, [location, suburb, choice]);

  return {
    suburb,
    setSuburb,
    place,
    /** The suburb table once it has loaded (for the suggestions), else null. */
    location,
    loading: wanted && !location && !failed,
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

interface VenueSuburbFieldProps {
  venue: VenuePlaceState;
  /** Errors to show: the suburb's (this form's or the API's fieldErrors.suburb / .state) and the zone's. */
  suburbError?: string;
  timeZoneError?: string;
  /** The event's start, for the zone's abbreviation then (AEDT or AEST); now while there's none. */
  startsAt?: string;
}

/** The field's id (the editor focuses it for a suburb, state or zone error) and the zone choice's. */
export const VENUE_SUBURB_ID = "suburb";
const VENUE_TIME_ZONE_ID = "timeZone";

/**
 * The field: "Suburb or town", its suggestions ("Richmond, VIC", "Richmond,
 * NSW"), a polite line under it naming the place and its zone ("Richmond,
 * Victoria · Melbourne time (AEDT)"), and the zone choice where the state
 * has more than one.
 */
export default function VenueSuburbField({ venue, suburbError, timeZoneError, startsAt }: VenueSuburbFieldProps) {
  const listId = useId();
  const hintId = `${VENUE_SUBURB_ID}-hint`;
  const errorId = `${VENUE_SUBURB_ID}-error`;
  const zoneErrorId = `${VENUE_TIME_ZONE_ID}-error`;
  const { place, suburb, location } = venue;
  const instant = startsAt ?? new Date().toISOString();
  const zones: readonly AustralianTimeZone[] = place ? ZONES_BY_STATE[place.state] : [];
  const zoneChoice = zones.length > 1;
  // The zone's error goes by its choice when there is one, else by the suburb (the zone comes from it).
  const fieldError = suburbError ?? (!zoneChoice ? timeZoneError : undefined);

  const suggestions = location
    ? location.suggestLocalities(suburb).map((locality) => placeName(locality.name, locality.state))
    : [];

  const hint = place
    ? `${bareSuburb(place.name, place.state)}, ${STATE_NAMES[place.state]} · ${zoneLabel(place.timeZone, instant, place.state)}`
    : venue.loading && suburb.trim()
      ? "Checking the suburb…"
      : "";

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={VENUE_SUBURB_ID} className="eyebrow text-muted">
        Suburb or town
      </label>
      <input
        id={VENUE_SUBURB_ID}
        value={suburb}
        onFocus={venue.requestTable}
        onChange={(event) => {
          venue.requestTable();
          venue.setSuburb(event.target.value);
        }}
        list={listId}
        autoComplete="off"
        maxLength={100}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={[hint ? hintId : null, fieldError ? errorId : null].filter(Boolean).join(" ") || undefined}
        className={fieldClass}
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <p id={hintId} aria-live="polite" className="text-sm text-muted">
        {hint}
      </p>
      {fieldError && (
        <p id={errorId} className="text-sm text-danger">
          {fieldError}
        </p>
      )}
      {place && zoneChoice && (
        <div className="mt-2 flex flex-col gap-1">
          <label htmlFor={VENUE_TIME_ZONE_ID} className="eyebrow text-muted">
            Time zone
          </label>
          <select
            id={VENUE_TIME_ZONE_ID}
            value={place.timeZone}
            onChange={(event) => {
              const zone = zones.find((candidate) => candidate === event.target.value);
              if (zone) venue.chooseZone(zone);
            }}
            aria-invalid={timeZoneError ? true : undefined}
            aria-describedby={timeZoneError ? zoneErrorId : undefined}
            className={fieldClass}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabel(zone, instant, place.state)}
              </option>
            ))}
          </select>
          {timeZoneError && (
            <p id={zoneErrorId} className="text-sm text-danger">
              {timeZoneError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
