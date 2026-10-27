/**
 * The venue search's proxy to Google Places API (New) (lib/server/places.ts;
 * docs/architecture.md, "Venue location"), and the check of a Google place an
 * event is saved with.
 *
 * Both routes are POST (what's typed stays out of URLs and access logs),
 * `private, no-store`, for approved organisers and admins only (401 signed
 * out, 403 anyone else), and rate-limited per account (private.take_rate_limit).
 * Google unreachable, over quota, slow (5 s) or not configured
 * (GOOGLE_MAPS_API_KEY unset): 503 `code: "places_unavailable"`, and the editor
 * offers a manual pin instead. Never logged: the input, the place id, the key,
 * Google's answers.
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

/** Per account (private.take_rate_limit buckets). The platform-wide cap is Google Cloud's own daily quota. */
export const PLACES_RATE_LIMITS = {
  autocomplete: { bucket: "places_autocomplete", hits: 200, window: "1 hour" },
  details: { bucket: "places_details", hits: 60, window: "1 hour" },
} as const;

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

async function takeLimit(deps: Deps, caller: Caller, limit: (typeof PLACES_RATE_LIMITS)[keyof typeof PLACES_RATE_LIMITS]) {
  const [{ allowed }] = await deps.db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, $2, $3, $4::interval) as allowed`,
    [caller.userId, limit.bucket, limit.hits, limit.window],
  );
  if (!allowed) throw new HttpError(429, "Too many venue searches. Try again later, or drop a pin on the map instead.");
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
 * Island). 400 fieldErrors (input, sessionToken); 401; 403; 429 (200 an hour
 * per account); 503 `code: "places_unavailable"`.
 */
export const placesAutocomplete: Handler = async (req, _params, deps) => {
  const caller = await requirePlacesCaller(req, deps);
  const body = await readJson(req, 4096);
  const errors: Record<string, string> = {};
  const input = parsePlacesInput(body.input, errors);
  const sessionToken = parseSessionToken(body.sessionToken, errors);
  if (Object.keys(errors).length > 0) fail(errors);
  const places = requirePlaces(deps);
  await takeLimit(deps, caller, PLACES_RATE_LIMITS.autocomplete);
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
 * 401; 403; 429 (60 an hour per account); 503 `code: "places_unavailable"`.
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
  await takeLimit(deps, caller, PLACES_RATE_LIMITS.details);
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
 * 400 fieldErrors.location (unknown place, not in Australia, no state);
 * 400 fieldErrors.suburb (another state); 503 fieldErrors.location with
 * `code: "places_unavailable"` (Google unreachable, or not configured).
 */
export async function verifyVenuePlace(
  deps: Deps,
  input: Pick<EventInput, "location" | "state" | "suburb">,
  stored?: VenueLocation,
): Promise<void> {
  const location = input.location;
  if (location?.source !== "places" || !location.placeId) return;
  if (stored?.source === "places" && stored.placeId === location.placeId) return;
  const unavailable = { location: PLACES_UNAVAILABLE };
  const places = deps.places();
  if (!places) throw placesUnavailable(unavailable);
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
