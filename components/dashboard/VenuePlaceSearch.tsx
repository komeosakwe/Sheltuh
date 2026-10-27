"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { fieldClass } from "@/components/ui/Field";
import { isApiConfigured, type GetToken } from "@/lib/api/client";
import {
  autocompletePlaces,
  getPlaceDetails,
  isPlacesUnavailableError,
  newPlacesSessionToken,
  type PlaceDetails,
  type PlaceSuggestion,
} from "@/lib/api/places";

/** Typing pauses this long before a search is sent. */
export const PLACE_SEARCH_DEBOUNCE_MS = 300;
/** Nothing is searched for under this many characters. */
export const PLACE_SEARCH_MIN_CHARS = 3;
/** At most this many suggestions are shown (the API sends at most 5 too). */
export const PLACE_SEARCH_MAX_SUGGESTIONS = 5;

/** The search field's id: the editor focuses it, and labels errors by it. */
export const VENUE_PLACE_SEARCH_ID = "venue-place-search";

export interface PickedPlace {
  suggestion: PlaceSuggestion;
  details: PlaceDetails;
}

export interface VenuePlaceSearchProps {
  getToken: GetToken;
  /** A place was picked and its address fetched (which ends the search's session). */
  onPick: (picked: PickedPlace) => void;
  /**
   * Switch to dropping a pin instead: "Can't find it on Google Maps?"
   * (`chosen`), or Google can't be asked (`unavailable`: a 503
   * places_unavailable, from a search or from fetching a place).
   */
  onManual: (why: "chosen" | "unavailable") => void;
  /** An error for the venue's location (the editor's, or the API's fieldErrors.location), read with the field. */
  error?: string;
  errorId?: string;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong.";
}

/**
 * Finding the venue on Google Maps (docs/architecture.md, "Venue location"):
 * a combobox (WAI-ARIA APG, list autocomplete) over POST
 * /api/places/autocomplete. From 3 characters, 300 ms after typing stops, an
 * earlier search still running is cancelled. Up and Down move through the
 * suggestions, Enter picks one, Escape closes them (and, once closed, clears
 * the text). "Powered by Google" is shown beside the suggestions.
 *
 * Picking a place fetches its address (POST /api/places/details, which ends
 * the search's billing session; the next search starts a new one). Google's
 * coordinates are never asked for: the organiser checks the pin on our own
 * map after this.
 */
export default function VenuePlaceSearch({ getToken, onPick, onManual, error, errorId }: VenuePlaceSearchProps) {
  const listId = useId();
  const statusId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  // The search the suggestions are for (so a suggestion list for older text is never shown as current).
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [fetchingPlace, setFetchingPlace] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const detailsAbort = useRef<AbortController | null>(null);
  // The latest props, for the effects (they mustn't re-run because the editor re-rendered).
  const latest = useRef({ getToken, onManual });
  useEffect(() => {
    latest.current = { getToken, onManual };
  }, [getToken, onManual]);

  const text = query.trim();
  const longEnough = text.length >= PLACE_SEARCH_MIN_CHARS;

  useEffect(() => {
    searchAbort.current?.abort();
    searchAbort.current = null;
    if (text.length < PLACE_SEARCH_MIN_CHARS) return;
    const timer = setTimeout(() => {
      // Demo mode (no API here): there's nothing to search, so it's the pin.
      if (!isApiConfigured) {
        latest.current.onManual("unavailable");
        return;
      }
      const controller = new AbortController();
      searchAbort.current = controller;
      session.current ??= newPlacesSessionToken();
      setSearching(true);
      autocompletePlaces(text, session.current, latest.current.getToken, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return;
          setSuggestions(response.suggestions.slice(0, PLACE_SEARCH_MAX_SUGGESTIONS));
          setResultsFor(text);
          setActive(-1);
          setProblem(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || isAbort(err)) return;
          if (isPlacesUnavailableError(err)) {
            latest.current.onManual("unavailable");
            return;
          }
          setSuggestions([]);
          setResultsFor(null);
          setProblem(`Couldn’t search Google Maps: ${errorText(err)}`);
        })
        .finally(() => {
          if (searchAbort.current === controller) {
            searchAbort.current = null;
            setSearching(false);
          }
        });
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // Nothing left running once the field goes (a place picked, or manual mode).
  useEffect(
    () => () => {
      searchAbort.current?.abort();
      detailsAbort.current?.abort();
    },
    [],
  );

  const shown = longEnough && resultsFor === text ? suggestions : [];
  const expanded = open && shown.length > 0;

  async function pick(suggestion: PlaceSuggestion) {
    if (fetchingPlace) return;
    searchAbort.current?.abort();
    detailsAbort.current?.abort();
    const controller = new AbortController();
    detailsAbort.current = controller;
    const token = session.current ?? newPlacesSessionToken();
    // The details request ends this session: the next search is a new one.
    session.current = null;
    setOpen(false);
    setActive(-1);
    setProblem(null);
    setFetchingPlace(true);
    try {
      const details = await getPlaceDetails(suggestion.placeId, token, getToken, controller.signal);
      if (controller.signal.aborted) return;
      onPick({ suggestion, details });
    } catch (err) {
      if (controller.signal.aborted || isAbort(err)) return;
      if (isPlacesUnavailableError(err)) {
        onManual("unavailable");
        return;
      }
      setProblem(`Couldn’t get that place’s address: ${errorText(err)}`);
    } finally {
      if (detailsAbort.current === controller) {
        detailsAbort.current = null;
        setFetchingPlace(false);
      }
    }
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (shown.length === 0) return;
      event.preventDefault();
      const down = event.key === "ArrowDown";
      if (!open) {
        setOpen(true);
        setActive(down ? 0 : shown.length - 1);
        return;
      }
      setActive((current) => {
        if (current < 0) return down ? 0 : shown.length - 1;
        return (current + (down ? 1 : -1) + shown.length) % shown.length;
      });
    } else if (event.key === "Enter") {
      // Enter here never saves the form.
      event.preventDefault();
      if (expanded && active >= 0 && active < shown.length) void pick(shown[active]);
    } else if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (query) {
        event.preventDefault();
        setQuery("");
      }
    }
  }

  // Read politely as it changes: how the search is going.
  let status = "";
  if (fetchingPlace) status = "Getting the address…";
  else if (problem) status = problem;
  else if (longEnough && searching && resultsFor !== text) status = "Searching Google Maps…";
  else if (longEnough && resultsFor === text) {
    status =
      shown.length === 0
        ? "No places found on Google Maps. Try other words, or drop a pin instead."
        : `${shown.length} ${shown.length === 1 ? "place" : "places"} found. Use the up and down arrows to choose.`;
  }

  const describedBy = [statusId, error && errorId ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-2" data-venue-place-search="">
      <label htmlFor={VENUE_PLACE_SEARCH_ID} className="eyebrow text-muted">
        Find the venue on Google Maps
      </label>
      <div className="relative">
        <input
          id={VENUE_PLACE_SEARCH_ID}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          placeholder="Venue name or address"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
            setProblem(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={handleKey}
          className={fieldClass}
        />
        {/* Always there, for aria-controls; hidden while collapsed. */}
        <div
          hidden={!expanded}
          className="absolute inset-x-0 top-full z-20 mt-1 flex flex-col border border-surface-border bg-card shadow-lg"
        >
          <ul id={listId} role="listbox" aria-label="Places on Google Maps" className="flex flex-col py-1">
            {shown.map((suggestion, index) => (
              <li
                key={suggestion.placeId}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                // Keeps focus in the field (a click would blur it first, closing the list).
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void pick(suggestion)}
                onMouseMove={() => setActive(index)}
                className={`flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2 text-sm ${
                  index === active ? "bg-surface" : ""
                }`}
              >
                <span className="font-medium break-words text-foreground">{suggestion.primaryText}</span>
                {suggestion.secondaryText && <span className="break-words text-muted">{suggestion.secondaryText}</span>}
              </li>
            ))}
          </ul>
          {/* Google's attribution, beside the results (Google Maps Platform terms). */}
          <p className="border-t border-surface-border px-3 py-1.5 text-right text-xs text-muted" data-attribution="">
            Powered by Google
          </p>
        </div>
      </div>
      <p id={statusId} aria-live="polite" className="text-sm text-muted empty:sr-only">
        {status}
      </p>
      {error && errorId && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => onManual("chosen")}
        className="inline-flex min-h-11 items-center self-start text-sm font-semibold underline underline-offset-4 sm:min-h-6"
      >
        Can&rsquo;t find it on Google Maps?
      </button>
    </div>
  );
}
