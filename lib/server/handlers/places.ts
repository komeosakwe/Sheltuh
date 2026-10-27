/**
 * The venue search's proxy to Google Places API (New) (lib/server/places.ts;
 * docs/architecture.md, "Venue location"), and the check of a Google place an
 * event is saved with.
 *
 * Both routes are POST (what's typed stays out of URLs and access logs),
 * `private, no-store`, for approved organisers and admins only (401 signed
 * out, 403 anyone else). Every Google request (the two routes, and an event
 * save's check, verifyVenuePlace) first takes the account's hourly and daily
 * allowance (private.take_rate_limit; 429 past either), then the platform's
 * daily cap per Google day (private.take_platform_rate_limit; set below
 * Google Cloud's own daily quotas, so we stop before Google does: 503).
 * Google unreachable, over quota, slow (5 s), not configured
 * (GOOGLE_MAPS_API_KEY unset) or the platform's cap used up: 503 `code:
 * "places_unavailable"`, and the editor offers a manual pin instead. Never
 * logged: the input, the place id, the key, Google's answers.
 *
 * Keep this module light: it must not load ../event-input or ./events (the
 * suburb table, lib/location.ts); only types come from there.
 */
import type { PlaceDetails, PlacesAutocompleteResponse } from "@/lib/api/places";
import type { VenueLocation } from "@/lib/api/types";
import { requireCaller, type Caller } from "../auth";
import type { Deps } from "../deps";
import type { EventInput } from "../event-input";
import { HttpError, okPrivate, readJson } from "../http";
import {
  isAustralianRegion,
  PLACE_ID_PATTERN,
  PLACES_SESSION_TOKEN_PATTERN,
  PlacesUnavailableError,
  type GooglePlace,
  type Places,
} from "../places";
import type { Handler } from "../route";
import { fail } from "../validation";
import { requireApprovedOrganiser } from "./organiser-guard";

/** The error body's `code` when Google can't be asked (lib/api/places.ts isPlacesUnavailableError). */
export const PLACES_UNAVAILABLE_CODE = "places_unavailable";

export const PLACES_UNAVAILABLE = "Google Maps search isn't available right now. Try again, or drop a pin on the map instead.";

/** One private.take_rate_limit allowance. */
export interface PlacesRateLimit {
  bucket: string;
  hits: number;
  window: string;
}

/**
 * Per account (private.take_rate_limit buckets): an hourly and a daily
 * allowance for each kind of Google request. Place Details and an event
 * save's check (verifyVenuePlace) are the same Google request (Place
 * Details), so they share `details`. The daily allowances are well under the
 * platform's caps (PLACES_PLATFORM_DAILY_CAPS), so no one account can use up
 * a day's Google requests for everyone (it takes 4 or more). An organiser
 * listing an event uses a few autocompletes per search, one details and one
 * check.
 */
export const PLACES_RATE_LIMITS = {
  autocomplete: [
    { bucket: "places_autocomplete", hits: 100, window: "1 hour" },
    { bucket: "places_autocomplete_daily", hits: 400, window: "24 hours" },
  ],
  details: [
    { bucket: "places_details", hits: 30, window: "1 hour" },
    { bucket: "places_details_daily", hits: 120, window: "24 hours" },
  ],
} as const satisfies Record<string, readonly [PlacesRateLimit, PlacesRateLimit]>;

/**
 * Platform-wide, per Google day (Google's daily quotas reset at midnight
 * Pacific Time, so the bucket is `<bucket>:<that day's date>`): below the
 * Google Cloud quotas docs/DEPLOYMENT.md asks for (Autocomplete 2,000 and
 * Place Details 500 a day), so the venue search falls back to a manual pin
 * before Google starts refusing. Changing either quota: change these too.
 */
export const PLACES_PLATFORM_DAILY_CAPS = {
  autocomplete: { bucket: "places_autocomplete_day", hits: 1800 },
  details: { bucket: "places_details_day", hits: 450 },
} as const;

/** The time zone Google's daily quotas reset in. */
export const PLACES_QUOTA_TIME_ZONE = "America/Los_Angeles";

type PlacesKind = keyof typeof PLACES_RATE_LIMITS;

/** What's typed: control characters out, whitespace collapsed, 2 to 120 characters. */
export const PLACES_INPUT_MIN = 2;
export const PLACES_INPUT_MAX = 120;

export const PLACE_NOT_FOUND = "We couldn't find that place on Google Maps. Search for the venue again, or drop a pin instead.";
export const PLACE_NOT_IN_AUSTRALIA = "That place isn't in Australia. Search for the venue again, or drop a pin instead.";
const PLACE_STATE_UNKNOWN = "We couldn't tell which state that place is in. Drop a pin on the venue instead.";

function placesUnavailable(fieldErrors?: Record<string, string>): HttpError {
  return new HttpError(503, PLACES_UNAVAILABLE, fieldErrors, { code: PLACES_UNAVAILABLE_CODE });
}

/** Logs why Google couldn't be asked: a fixed reason only, never what was asked. */
function logUnavailable(err: PlacesUnavailableError): void {
  console.warn("Google Places unavailable:", err.reason);
}

/** Google's answer, or a 503 (logged by reason) when it can't be had; anything else is rethrown. */
async function askGoogle<T>(ask: () => Promise<T>, fieldErrors?: Record<string, string>): Promise<T> {
  try {
    return await ask();
  } catch (err) {
    if (err instanceof PlacesUnavailableError) {
      logUnavailable(err);
      throw placesUnavailable(fieldErrors);
    }
    throw err;
  }
}

/** An admin, or the owner of an approved organiser (403 otherwise). */
async function requirePlacesCaller(req: Request, deps: Deps): Promise<Caller> {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  if (!caller.isAdmin) await requireApprovedOrganiser(deps.db, caller);
  return caller;
}

function requirePlaces(deps: Deps): Places {
  const places = deps.places();
  if (!places) throw placesUnavailable();
  return places;
}

export const PLACES_TOO_MANY = "Too many venue searches. Try again later, or drop a pin on the map instead.";

/**
 * Takes one Google request of `kind` for the caller: the account's hourly,
 * then daily allowance, then the platform's cap for today (Google's day). In
 * one statement, in that order, stopping at the first refusal (CASE runs its
 * branches in order, so a refused account takes no platform slot). 429 past
 * the account's allowance; 503 places_unavailable (logged `daily_cap`) past
 * the platform's cap; either with the message under fieldErrors[`field`]
 * when given.
 */
async function takeLimit(deps: Deps, caller: Caller, kind: PlacesKind, field?: "location"): Promise<void> {
  const [hourly, daily] = PLACES_RATE_LIMITS[kind];
  const platform = PLACES_PLATFORM_DAILY_CAPS[kind];
  const [{ outcome }] = await deps.db.query<{ outcome: "ok" | "account" | "platform" }>(
    `select case
              when not private.take_rate_limit($1, $2, $3, $4::interval) then 'account'
              when not private.take_rate_limit($1, $5, $6, $7::interval) then 'account'
              when not private.take_platform_rate_limit(
                     $8::text || ':' || to_char(now() at time zone $10, 'YYYY-MM-DD'), $9, interval '25 hours') then 'platform'
              else 'ok'
            end as outcome`,
    [caller.userId, hourly.bucket, hourly.hits, hourly.window, daily.bucket, daily.hits, daily.window, platform.bucket, platform.hits, PLACES_QUOTA_TIME_ZONE],
  );
  if (outcome === "account") {
    throw new HttpError(429, PLACES_TOO_MANY, field ? { [field]: PLACES_TOO_MANY } : undefined);
  }
  if (outcome === "platform") {
    logUnavailable(new PlacesUnavailableError("daily_cap"));
    throw placesUnavailable(field ? { [field]: PLACES_UNAVAILABLE } : undefined);
  }
}

function parseSessionToken(value: unknown, errors: Record<string, string>): string {
  if (typeof value !== "string" || !PLACES_SESSION_TOKEN_PATTERN.test(value)) {
    errors.sessionToken = "Start a new venue search.";
    return "";
  }
  return value;
}

/** What's typed, cleaned (control characters out, whitespace collapsed); an error unless it's 2 to 120 characters. */
export function parsePlacesInput(value: unknown, errors: Record<string, string>): string {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim() : "";
  if (text.length < PLACES_INPUT_MIN || text.length > PLACES_INPUT_MAX) {
    errors.input = `Type ${PLACES_INPUT_MIN} to ${PLACES_INPUT_MAX} characters of the venue's name or address.`;
    return "";
  }
  return text;
}

/**
 * POST /api/places/autocomplete — body `{input, sessionToken}`. 200
 * `{suggestions: [{placeId, primaryText, secondaryText}]}` (at most 5, places
 * in Australia, Christmas Island, the Cocos (Keeling) Islands and Norfolk
 * Island). 400 fieldErrors (input, sessionToken); 401; 403; 429 (100 an hour,
 * 400 a day per account); 503 `code: "places_unavailable"` (also once the
 * platform's 1,800 for Google's day are used).
 */
export const placesAutocomplete: Handler = async (req, _params, deps) => {
  const caller = await requirePlacesCaller(req, deps);
  const body = await readJson(req, 4096);
  const errors: Record<string, string> = {};
  const input = parsePlacesInput(body.input, errors);
  const sessionToken = parseSessionToken(body.sessionToken, errors);
  if (Object.keys(errors).length > 0) fail(errors);
  const places = requirePlaces(deps);
  await takeLimit(deps, caller, "autocomplete");
  const suggestions = await askGoogle(() => places.autocomplete(input, sessionToken));
  const response: PlacesAutocompleteResponse = { suggestions };
  return okPrivate(response);
};

/** Google's search link for the place (its id, with the address as the query Google requires). */
function googleMapsUrl(place: GooglePlace): string {
  const query = place.formattedAddress ?? place.locality ?? "Australia";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${encodeURIComponent(place.placeId)}`;
}

/**
 * POST /api/places/details — body `{placeId, sessionToken}` (the search's
 * token: this ends its billing session). 200 PlaceDetails: the address parts
 * to prefill (never a position). 400 fieldErrors (placeId: malformed, unknown
 * to Google, or not in Australia or its external territories; sessionToken);
 * 401; 403; 429 (30 an hour, 120 a day per account, shared with an event
 * save's check); 503 `code: "places_unavailable"` (also once the platform's
 * 450 for Google's day, shared with the checks, are used).
 */
export const placesDetails: Handler = async (req, _params, deps) => {
  const caller = await requirePlacesCaller(req, deps);
  const body = await readJson(req, 4096);
  const errors: Record<string, string> = {};
  const placeId = typeof body.placeId === "string" && PLACE_ID_PATTERN.test(body.placeId) ? body.placeId : "";
  if (!placeId) errors.placeId = PLACE_NOT_FOUND;
  const sessionToken = parseSessionToken(body.sessionToken, errors);
  if (Object.keys(errors).length > 0) fail(errors);
  const places = requirePlaces(deps);
  await takeLimit(deps, caller, "details");
  const place = await askGoogle(() => places.details(placeId, sessionToken));
  if (!place) fail({ placeId: PLACE_NOT_FOUND });
  if (!isAustralianRegion(place.regionCode)) fail({ placeId: PLACE_NOT_IN_AUSTRALIA });
  const response: PlaceDetails = {
    placeId: place.placeId,
    formattedAddress: place.formattedAddress ?? "",
    streetAddress: place.streetAddress,
    locality: place.locality,
    state: place.state,
    postcode: place.postcode,
    googleMapsUrl: googleMapsUrl(place),
  };
  return okPrivate(response);
};

/**
 * Checks with Google an event's new or changed Google place before it's saved
 * (POST and PATCH /events, POST and PATCH /admin/events): it must exist, be in
 * Australia (or its external territories), and be in the event's state. Not
 * asked when the body sent no place, or the same place id the event already
 * has (`stored`: checked when it was saved). "Verify, don't store": nothing
 * Google says is written; the suburb, state and zone stay the organiser's.
 *
 * Takes the caller's `details` allowance and the platform's cap first, as
 * POST /api/places/details does (takeLimit).
 *
 * 400 fieldErrors.location (unknown place, not in Australia, no state);
 * 400 fieldErrors.suburb (another state); 429 fieldErrors.location (the
 * account's allowance used); 503 fieldErrors.location with `code:
 * "places_unavailable"` (Google unreachable, not configured, or the
 * platform's daily cap used).
 */
export async function verifyVenuePlace(
  deps: Deps,
  caller: Caller,
  input: Pick<EventInput, "location" | "state" | "suburb">,
  stored?: VenueLocation,
): Promise<void> {
  const location = input.location;
  if (location?.source !== "places" || !location.placeId) return;
  if (stored?.source === "places" && stored.placeId === location.placeId) return;
  const unavailable = { location: PLACES_UNAVAILABLE };
  const places = deps.places();
  if (!places) throw placesUnavailable(unavailable);
  await takeLimit(deps, caller, "details", "location");
  const placeId = location.placeId;
  const place = await askGoogle(() => places.verify(placeId), unavailable);
  if (!place) fail({ location: PLACE_NOT_FOUND });
  if (!isAustralianRegion(place.regionCode)) fail({ location: PLACE_NOT_IN_AUSTRALIA });
  if (!place.state) fail({ location: PLACE_STATE_UNKNOWN });
  if (place.state !== input.state) {
    fail({
      suburb: `That Google Maps place is in ${place.state}, but ${input.suburb} is in ${input.state}. Check the suburb, or search for the venue again.`,
    });
  }
}

export const PIN_RECHECK = "Check the pin again for the new suburb.";

/** A suburb as compared for a change: case, spacing and surrounding space ignored. */
function suburbKey(suburb: string): string {
  return suburb.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * An edit (PATCH /events/{id}, PATCH /admin/events/{id}) that moves the event
 * to another suburb or state without sending `location`, while a pin or a
 * Google place is stored: refused, 400 fieldErrors.location (PIN_RECHECK).
 * The stored pin and place were checked against the old suburb and state
 * (the pin's reach, the place's state), and an absent `location` keeps them,
 * so they'd point somewhere the listing no longer says. The editor always
 * resends the location when the suburb or state changes (the pin belongs to
 * the suburb it was confirmed for), so only a hand-made request gets here.
 * `input.suburb` is the parsed (canonical) suburb; `current` the stored event.
 */
export function refuseStaleVenueLocation(
  input: Pick<EventInput, "location" | "state" | "suburb">,
  current: { suburb: string; state?: string; location?: VenueLocation },
): void {
  if (input.location !== undefined) return;
  const stored = current.location;
  if (!stored || (!stored.pin && !stored.placeId)) return;
  const suburbChanged = suburbKey(input.suburb) !== suburbKey(current.suburb);
  const stateChanged = current.state !== undefined && current.state !== input.state;
  if (suburbChanged || stateChanged) fail({ location: PIN_RECHECK });
}
