"use client";

import { useEffect, useRef, useState } from "react";
import VenuePinMap, { MOVE_PIN_FIRST, PIN_ZOOM_STREET, roundPin } from "@/components/dashboard/VenuePinMap";
import VenuePlaceSearch, { VENUE_PLACE_SEARCH_ID, type PickedPlace } from "@/components/dashboard/VenuePlaceSearch";
import { Button } from "@/components/ui/Button";
import { useIsPhone } from "@/components/ui/useIsPhone";
import type { GetToken } from "@/lib/api/client";
import type { VenueLocation, VenueLocationInput } from "@/lib/api/types";
import { clampToAustralia } from "@/lib/geo";
import { googlePlaceHref } from "@/lib/maps";
import type { StateCode } from "@/lib/time-zones";
import type { Coordinates } from "@/lib/types";

/**
 * The event editor's venue location (docs/architecture.md, "Venue location";
 * owner decisions A-D1 to A-D3, 27 Oct 2026): the venue found on Google Maps
 * (VenuePlaceSearch), or "Can't find it on Google Maps?" and a pin alone;
 * either way the organiser then checks the pin on our own map (VenuePinMap),
 * and only a confirmed pin counts. Publishing needs one (`location_required`).
 *
 * The pin belongs to the suburb it was confirmed for: when the suburb
 * changes to another place, the map starts again at that suburb's centre and
 * the pin needs confirming again (back to the first suburb, the pin is back).
 *
 * "Change" (or "Find it on Google Maps instead") opens the search without
 * losing anything: until another place is picked, what was there is kept,
 * saved as it was, and "Keep …" goes back to it.
 *
 * Each switch moves focus to what replaced the control that was used (WCAG
 * 2.4.3): a place picked, or kept, to "Linked to Google Maps"; Change to the
 * search; a pin alone to "Check the pin".
 */

/** The venue section's id: focused when the location is what stops a publish (or the API refused it). */
export const VENUE_LOCATION_ID = "venue-location";
export const VENUE_LOCATION_ERROR_ID = "location-error";
/** "Linked to Google Maps: …": focused once a place is picked (or kept). */
export const VENUE_LINKED_ID = "venue-linked-place";
/** "Check the pin": focused when it's the pin alone. */
export const VENUE_PIN_HEADING_ID = "venue-pin-heading";

export type VenueLocationMode = "search" | "places" | "manual";

/** A place, as the pin is kept for it: lib/location.ts name and state ("fitzroy|VIC"). */
export function venuePlaceKey(name: string, state: StateCode): string {
  return `${name.trim().toLowerCase()}|${state}`;
}

/** Why it's in manual mode after a 503 places_unavailable (a search, a place's address, or a save). */
export const PLACES_UNAVAILABLE_NOTE = "Google Maps can’t be searched right now, so drop a pin on the map instead.";

interface LocationState {
  mode: VenueLocationMode;
  /** The linked Google place (`places` mode), and what to call it. */
  linked: { placeId: string; label: string } | null;
  /** Why it's in manual mode, when it wasn't the organiser's choice. */
  note: string | null;
  /** The confirmed pin, and the place it was confirmed for (venuePlaceKey). */
  pin: { at: string; pin: Coordinates } | null;
  /** Where the inline map has been moved to since it was (re)mounted (by its key), confirmed or not. */
  moved: { mapKey: string; pin: Coordinates } | null;
  /** Places picked so far: each pick starts the map again. */
  picks: number;
  /**
   * In search mode after Change (or "Find it on Google Maps instead"): the
   * place or pin there was. It's what's saved until another place is picked,
   * and Keep goes back to it.
   */
  kept: { mode: "places" | "manual"; linked: { placeId: string; label: string } | null } | null;
}

export interface VenueLocationInitial {
  location?: VenueLocation;
  venueName: string;
  suburb: string;
  state?: StateCode;
}

function initialState(initial: VenueLocationInitial | undefined): LocationState {
  const location = initial?.location;
  const at = initial ? venuePlaceKey(initial.suburb, initial.state ?? "VIC") : "";
  const pin = location?.pin ? { at, pin: { lat: location.pin.lat, lng: location.pin.lng } } : null;
  if (location?.source === "places" && location.placeId) {
    return {
      mode: "places",
      linked: { placeId: location.placeId, label: initial?.venueName.trim() || "the venue" },
      note: null,
      pin,
      moved: null,
      picks: 0,
      kept: null,
    };
  }
  if (location?.source === "manual_pin") return { mode: "manual", linked: null, note: null, pin, moved: null, picks: 0, kept: null };
  return { mode: "search", linked: null, note: null, pin, moved: null, picks: 0, kept: null };
}

function samePin(a: Coordinates | null | undefined, b: Coordinates | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
}

/**
 * The event body's `location` for what's on screen against what's saved
 * (`stored`): undefined when they're the same (absent keeps it), null when
 * there's no location on screen but one is saved (the organiser removed it),
 * otherwise the location.
 */
export function locationChange(
  next: VenueLocationInput | null,
  stored: VenueLocation | undefined,
): VenueLocationInput | null | undefined {
  if (!next) return stored ? null : undefined;
  if (
    stored &&
    stored.source === next.source &&
    (stored.placeId ?? null) === (next.source === "places" ? next.placeId : null) &&
    samePin(stored.pin, next.pin)
  ) {
    return undefined;
  }
  return next;
}

/** What's on screen as the API takes it: a linked place (with the pin, once confirmed), or a confirmed pin alone. */
function inputFor(
  mode: VenueLocationMode,
  linked: LocationState["linked"],
  pin: Coordinates | null,
): VenueLocationInput | null {
  if (mode === "places" && linked) return { source: "places", placeId: linked.placeId, ...(pin ? { pin } : {}) };
  if (mode === "manual" && pin) return { source: "manual_pin", pin };
  return null;
}

/** Where focus goes after a switch, once it's on screen (an element id). */
type FocusTarget = typeof VENUE_LINKED_ID | typeof VENUE_PLACE_SEARCH_ID | typeof VENUE_PIN_HEADING_ID;

/**
 * The venue location's state for the editor. `placeKey`: the suburb's place
 * now (venuePlaceKey), null while it isn't known; the pin counts only for
 * the place it was confirmed for.
 */
export function useVenueLocation(initial: VenueLocationInitial | undefined, placeKey: string | null) {
  const [state, setState] = useState<LocationState>(() => initialState(initial));
  const pin = state.pin && placeKey !== null && state.pin.at === placeKey ? state.pin.pin : null;
  const mapKey = `${placeKey ?? ""}|${state.picks}`;
  const movedPin = state.moved && state.moved.mapKey === mapKey ? state.moved.pin : null;
  // Set by a switch; focused once the new control is rendered.
  const focusNext = useRef<FocusTarget | null>(null);

  useEffect(() => {
    if (!focusNext.current) return;
    const element = document.getElementById(focusNext.current);
    if (!element) return; // Not rendered yet.
    focusNext.current = null;
    element.focus();
  });

  // While searching after Change, what was there is still what's saved.
  const input =
    state.mode === "search"
      ? state.kept
        ? inputFor(state.kept.mode, state.kept.linked, pin)
        : null
      : inputFor(state.mode, state.linked, pin);

  return {
    mode: state.mode,
    linked: state.linked,
    note: state.note,
    /** In search mode after Change: the place (or pin) Keep goes back to, else null. */
    kept: state.kept,
    /** The confirmed pin for the suburb on screen, or null. */
    pin,
    mapKey,
    movedPin,
    /** What's to be saved, as the API takes it (before comparing it with what's saved: locationChange). */
    input,
    /** A pin will be saved with the event (or stays saved): what publishing needs. */
    hasPin: Boolean(input?.pin),
    /** A Google place was picked: linked, and the pin starts again. */
    link(placeId: string, label: string) {
      focusNext.current = VENUE_LINKED_ID;
      setState((s) => ({
        ...s,
        mode: "places",
        linked: { placeId, label },
        note: null,
        pin: null,
        moved: null,
        picks: s.picks + 1,
        kept: null,
      }));
    },
    /** "Change": back to the search. What was there is kept (and saved) until a place is picked. */
    change() {
      focusNext.current = VENUE_PLACE_SEARCH_ID;
      setState((s) => ({
        ...s,
        mode: "search",
        linked: null,
        note: null,
        kept: s.mode === "search" ? s.kept : { mode: s.mode, linked: s.linked },
      }));
    },
    /** "Keep …": back to the place (or pin) there was before Change. */
    keep() {
      if (!state.kept) return;
      focusNext.current = state.kept.mode === "places" ? VENUE_LINKED_ID : VENUE_PIN_HEADING_ID;
      setState((s) => (s.kept ? { ...s, mode: s.kept.mode, linked: s.kept.linked, note: null, kept: null } : s));
    },
    /**
     * A pin alone: chosen, or because Google can't be asked (`note` says so).
     * `focus`: the organiser was in the search, which is gone: on to Check the pin.
     */
    manual(note: string | null, focus = false) {
      if (focus) focusNext.current = VENUE_PIN_HEADING_ID;
      setState((s) => ({ ...s, mode: "manual", linked: null, note, kept: null }));
    },
    /** The confirmed pin (Done on a phone, "This is the right spot" inline). */
    confirm(next: Coordinates) {
      if (placeKey === null) return;
      setState((s) => ({ ...s, pin: { at: placeKey, pin: next } }));
    },
    /** The inline map moved: the confirmed pin moves with it, once there is one. */
    move(next: Coordinates) {
      setState((s) => {
        const confirmed = s.pin && placeKey !== null && s.pin.at === placeKey;
        return { ...s, moved: { mapKey, pin: next }, pin: confirmed && placeKey !== null ? { at: placeKey, pin: next } : s.pin };
      });
    },
  };
}

export type VenueLocationState = ReturnType<typeof useVenueLocation>;

interface VenuePlaceLinkProps {
  location: VenueLocationState;
  getToken: GetToken;
  onPicked: (picked: PickedPlace) => void;
  /** The fields as on screen, for the "Check on Google Maps" link. */
  venueName: string;
  venueAddress: string;
  suburb: string;
  error?: string;
}

/**
 * The top of the venue section: the search (with "Keep …" after Change); or
 * "Linked to Google Maps: …" with a link to check it and Change; or, in
 * manual mode, why and the way back to the search.
 */
export function VenuePlaceLink(props: VenuePlaceLinkProps) {
  const { location } = props;
  const note =
    location.mode === "manual"
      ? (location.note ?? "Not on Google Maps: put the pin on the venue below, and type its address.")
      : "";
  return (
    <div className="flex flex-col gap-1">
      {/* Always rendered, so the switch to a pin alone is said (Google unavailable: the search is gone). */}
      <p aria-live="polite" className="text-sm text-foreground empty:sr-only">
        {note}
      </p>
      <VenuePlaceLinkBody {...props} />
    </div>
  );
}

function VenuePlaceLinkBody({ location, getToken, onPicked, venueName, venueAddress, suburb, error }: VenuePlaceLinkProps) {
  const errorId = error ? VENUE_LOCATION_ERROR_ID : undefined;
  if (location.mode === "search") {
    const kept = location.kept;
    return (
      <>
        <VenuePlaceSearch
          getToken={getToken}
          onPick={onPicked}
          onManual={(why) => location.manual(why === "unavailable" ? PLACES_UNAVAILABLE_NOTE : null, true)}
          error={error}
          errorId={errorId}
        />
        {kept && (
          <button
            type="button"
            onClick={location.keep}
            className="inline-flex min-h-11 items-center self-start text-left text-sm font-semibold break-words underline underline-offset-4 sm:min-h-6"
          >
            {kept.mode === "places" && kept.linked ? `Keep ${kept.linked.label}` : "Keep the pin you dropped"}
          </button>
        )}
      </>
    );
  }
  if (location.mode === "places" && location.linked) {
    const { label, placeId } = location.linked;
    const href = googlePlaceHref({ venueName, venueAddress, suburb, venuePlaceId: placeId });
    const labelId = `${VENUE_LINKED_ID}-label`;
    return (
      <div
        id={VENUE_LINKED_ID}
        tabIndex={-1}
        role="group"
        aria-labelledby={labelId}
        className="flex flex-col gap-1 bg-surface p-3 text-sm text-foreground outline-offset-2"
        data-linked-place={placeId}
      >
        <p id={labelId} className="break-words">
          <span className="font-semibold">Linked to Google Maps:</span> {label}
        </p>
        <div className="flex flex-wrap items-center gap-x-4">
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Check on Google Maps: ${label} (opens in a new tab)`}
              className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-6"
            >
              Check on Google Maps<span aria-hidden="true">&nbsp;↗</span>
            </a>
          )}
          <button
            type="button"
            onClick={location.change}
            aria-label={`Change the Google Maps place (${label})`}
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 sm:min-h-6"
          >
            Change
          </button>
        </div>
        {error && (
          <p id={errorId} className="text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
  // Manual: the pin alone (the note above says why).
  // After a 503, searching again would only fail again: until the page is reloaded, it's the pin.
  const canSearch = location.note !== PLACES_UNAVAILABLE_NOTE;
  if (!canSearch && !error) return null;
  return (
    <div className="flex flex-col gap-1 text-sm text-foreground" data-manual-location="">
      {canSearch && (
        <button
          type="button"
          onClick={location.change}
          className="inline-flex min-h-11 items-center self-start font-semibold underline underline-offset-4 sm:min-h-6"
        >
          Find it on Google Maps instead
        </button>
      )}
      {error && (
        <p id={errorId} className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface VenuePinStepProps {
  location: VenueLocationState;
  /** The suburb's centre from the ABS table (the map starts there without a pin); null while unknown. */
  suburbCentre: Coordinates | null;
  /** A suburb is typed, and the suburb table is loading (its centre is about to be known). */
  waiting: boolean;
  /** Something is typed in the suburb field (without a centre, it isn't one the table knows). */
  suburbTyped: boolean;
  /** "Fitzroy, VIC", for the phone dialog's heading. */
  suburbLabel: string;
  /** Something changed the location: its old error no longer applies. */
  onEdit: () => void;
}

/**
 * "Check the pin" (required): the map starts at the confirmed pin, else the
 * suburb's centre. Inline, the pin counts once "This is the right spot" is
 * pressed, and moving the map after that moves it. On phones, Done in the
 * map's dialog confirms it.
 *
 * From the suburb's centre, the map has to be moved (or zoomed in to street
 * level) before the pin can be confirmed: the centre is rarely the venue. A
 * confirmed pin can be confirmed again as it is.
 */
export function VenuePinStep({ location, suburbCentre, waiting, suburbTyped, suburbLabel, onEdit }: VenuePinStepProps) {
  // As VenuePinMap decides: on a phone the map is a dialog whose Done confirms; otherwise it's inline.
  const phone = useIsPhone();
  const statusId = "venue-pin-status";
  const confirmed = location.pin !== null;
  const start = location.pin ?? suburbCentre;
  // The inline map (by its key) zoomed in to street level, and "This is the right spot" pressed too soon.
  const [streetLevel, setStreetLevel] = useState<string | null>(null);
  const [nudged, setNudged] = useState<string | null>(null);
  const placed = confirmed || location.movedPin !== null || streetLevel === location.mapKey;
  const nudge = nudged === location.mapKey && !placed;

  let status: string;
  if (!start && waiting) status = "Loading the map…";
  else if (!start && suburbTyped) status = "Check the venue’s suburb or town above: the map starts there.";
  else if (!start) status = "Enter the venue’s suburb or town first: the map starts there.";
  else if (confirmed) status = phone ? "Pin confirmed." : "Pin confirmed. Moving the map moves the pin.";
  else if (nudge) status = MOVE_PIN_FIRST;
  else if (phone) status = "Not checked yet: select Check the pin, put the pin on the venue, then select Done.";
  else status = "Not confirmed yet: move the map until the pin is on the venue, then select This is the right spot.";

  return (
    <div className="flex flex-col gap-2" data-pin-step="" data-pin-confirmed={String(confirmed)}>
      <h3 id={VENUE_PIN_HEADING_ID} tabIndex={-1} className="eyebrow text-muted outline-offset-2">
        Check the pin
      </h3>
      <p className="text-sm text-muted">This pin is shown publicly on your event page and map.</p>
      <p id={statusId} aria-live="polite" className={`text-sm ${nudge ? "text-danger" : confirmed ? "text-foreground" : "text-muted"}`}>
        {confirmed && <span aria-hidden="true">✓ </span>}
        {status}
      </p>
      {start && (
        <VenuePinMap
          key={location.mapKey}
          initialCentre={start}
          pinned={confirmed}
          suburbLabel={suburbLabel}
          onChange={(pin) => {
            if (phone) location.confirm(pin);
            else location.move(pin);
            onEdit();
          }}
          onZoom={(zoom) => {
            if (zoom >= PIN_ZOOM_STREET) setStreetLevel(location.mapKey);
          }}
        />
      )}
      {start && !phone && (
        <Button
          variant={confirmed ? "outline" : "solid"}
          onClick={() => {
            if (!placed) {
              setNudged(location.mapKey);
              return;
            }
            location.confirm(location.movedPin ?? roundPin(clampToAustralia(start)));
            onEdit();
          }}
          aria-describedby={statusId}
          className="min-h-11 w-fit"
        >
          This is the right spot
        </Button>
      )}
    </div>
  );
}
