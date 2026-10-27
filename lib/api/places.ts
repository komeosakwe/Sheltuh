/**
 * The event editor's venue search (docs/architecture.md, "Venue location"):
 * Google Places through our own routes, POST /api/places/autocomplete and
 * POST /api/places/details (approved organisers and admins). Show Google Maps
 * attribution beside the suggestions.
 *
 * One search is one session: make a token with newPlacesSessionToken() when
 * the search starts, send it with every autocomplete request and with the one
 * details request for the place picked (which ends the session), then make a
 * new one for the next search.
 *
 * Nothing here is a position: Google's coordinates are never requested. The
 * pin is the organiser's own (VenuePinMap), sent with the event as
 * `location.pin`.
 */
import type { StateCode } from "@/lib/time-zones";
import { ApiError, apiFetch, type GetToken } from "./client";

/** One suggestion: the place's name (or street address), and the rest of its address. */
export interface PlaceSuggestion {
  /** Send as `location.placeId` with the event, and to getPlaceDetails. */
  placeId: string;
  primaryText: string;
  /** May be empty. */
  secondaryText: string;
}

export interface PlacesAutocompleteResponse {
  /** At most 5, in Australia, Christmas Island, the Cocos (Keeling) Islands or Norfolk Island. May be empty. */
  suggestions: PlaceSuggestion[];
}

/**
 * The picked place's address, to prefill the editor's fields (the organiser
 * can edit each; what they confirm is saved, never these as such).
 */
export interface PlaceDetails {
  placeId: string;
  /** Google's one-line address ("71 Johnston St, Collingwood VIC 3066"). */
  formattedAddress: string;
  /** The street number and street ("71 Johnston St"), or null without a street. */
  streetAddress: string | null;
  /** The suburb or town, or null. Check it with lib/location.ts like any typed suburb. */
  locality: string | null;
  /** The state or territory (OT for the external territories and Jervis Bay), or null when Google gave none. */
  state: StateCode | null;
  postcode: string | null;
  /** Google Maps' page for the place ("Check on Google Maps"). */
  googleMapsUrl: string;
}

/** The error body's `code` when Google can't be asked: offer the manual pin instead. */
export const PLACES_UNAVAILABLE_CODE = "places_unavailable";

/** Whether `err` is the 503 with `code: "places_unavailable"` (from these routes, or saving an event with a new place). */
export function isPlacesUnavailableError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 503 && err.body?.code === PLACES_UNAVAILABLE_CODE;
}

/** A new search's session token (a UUID: what the routes take, `^[A-Za-z0-9_-]{8,36}$`). */
export function newPlacesSessionToken(): string {
  return crypto.randomUUID();
}

/**
 * Suggestions for what's typed (2 to 120 characters; debounce, and send from
 * 3). ApiError 400 fieldErrors.input / .sessionToken, 401, 403 (not an
 * approved organiser or admin), 429 (too many searches this hour), 503
 * isPlacesUnavailableError.
 */
export async function autocompletePlaces(
  input: string,
  sessionToken: string,
  getToken: GetToken,
  signal?: AbortSignal,
): Promise<PlacesAutocompleteResponse> {
  const token = await getToken();
  return apiFetch<PlacesAutocompleteResponse>("/places/autocomplete", {
    method: "POST",
    body: { input, sessionToken },
    token,
    signal,
  });
}

/**
 * The picked place's address (ends the session: start a new token after).
 * ApiError 400 fieldErrors.placeId (unknown, or not in Australia), 401, 403,
 * 429, 503 isPlacesUnavailableError.
 */
export async function getPlaceDetails(
  placeId: string,
  sessionToken: string,
  getToken: GetToken,
  signal?: AbortSignal,
): Promise<PlaceDetails> {
  const token = await getToken();
  return apiFetch<PlaceDetails>("/places/details", { method: "POST", body: { placeId, sessionToken }, token, signal });
}
