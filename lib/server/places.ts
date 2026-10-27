/**
 * Google Places API (New), server side only (docs/architecture.md, "Venue
 * location"): the organiser's venue search (Autocomplete), the picked place's
 * address (Place Details), and the check of a place id an event is saved with.
 * The browser never calls Google: it calls our routes (app/api/places/*),
 * which call this with GOOGLE_MAPS_API_KEY in a header (never in a URL, so it
 * can't end up in a log line).
 *
 * Google's terms (Places API Service Specific Terms §14, Maps Platform ToS
 * §3.2.3) forbid caching Places coordinates for more than 30 days, and using
 * Places content on a non-Google map. So the field masks below never ask for
 * `location`, `viewport` or any other position, and the parsers only ever
 * copy the named fields they need: whatever else Google might send is
 * dropped. The only Places value stored is the place id (cacheable without
 * limit). Coordinates on our maps are the organiser's own pin.
 *
 * Never log what's searched for (an organiser's typing), the key, or Google's
 * error bodies: errors carry a fixed reason only (PlacesUnavailableError).
 */
import type { StateCode } from "@/lib/time-zones";

/** A Google place id as we accept and store it (events_venue_place_id_shape mirrors it). */
export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * An Autocomplete session token as the browser makes it (a UUID, or any
 * URL-safe base64 string Google takes): one per venue search, ended by the
 * Place Details request for the place picked, so Google bills the search as
 * one session.
 */
export const PLACES_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,36}$/;

/** Australia and its external territories with their own region codes: Christmas Island, Cocos (Keeling) Islands, Norfolk Island. */
export const PLACES_REGION_CODES = ["au", "cx", "cc", "nf"] as const;

export const PLACES_LANGUAGE = "en-AU";

/** How long one Google request may take before it counts as unavailable. */
export const PLACES_TIMEOUT_MS = 5_000;

/** At most this many suggestions are returned. */
export const MAX_PLACE_SUGGESTIONS = 5;

/**
 * The field masks (X-Goog-FieldMask). Essentials-tier fields only, and never
 * a position: no `location`, `viewport`, `plusCode` or `geometry`
 * (tests/server/places.test.ts checks).
 */
export const PLACES_FIELD_MASKS = {
  autocomplete: "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
  details: "id,formattedAddress,addressComponents",
  verify: "id,addressComponents",
} as const;

const PLACES_ORIGIN = "https://places.googleapis.com";

/** One Autocomplete suggestion: the venue's name, and the rest of its address. */
export interface PlaceSuggestion {
  placeId: string;
  /** The place's name ("The Tote Hotel") or the street address for an address. */
  primaryText: string;
  /** The rest ("Johnston Street, Collingwood VIC, Australia"); may be empty. */
  secondaryText: string;
}

/** What we read from Place Details: address parts only, never a position. */
export interface GooglePlace {
  placeId: string;
  /** Null when not asked for (verify). */
  formattedAddress: string | null;
  /** "71 Johnston St": the street number and route, or null without a route. */
  streetAddress: string | null;
  /** The suburb or town (`locality`, else `sublocality`, else `postal_town`), or null. */
  locality: string | null;
  postcode: string | null;
  /** The country's (or external territory's) region code, upper case: "AU", "CX", "CC", "NF", "NZ"…; null when absent. */
  regionCode: string | null;
  /**
   * The state or territory (lib/time-zones.ts STATE_CODES): an Australian
   * state's own code; OT for Jervis Bay Territory, Christmas Island, the
   * Cocos (Keeling) Islands and Norfolk Island. Null anywhere else, or when
   * Google gave no state.
   */
  state: StateCode | null;
}

/**
 * Google couldn't be asked or didn't answer usefully (no key, timeout,
 * network, quota, a bad key or a disabled API (400 / 403), 5xx, or our own
 * daily cap: `daily_cap`). `reason` is safe to log.
 */
export class PlacesUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`Google Places unavailable (${reason})`);
    this.name = "PlacesUnavailableError";
  }
}

export interface Places {
  /** Up to MAX_PLACE_SUGGESTIONS places in Australia for `input`. Throws PlacesUnavailableError. */
  autocomplete(input: string, sessionToken: string): Promise<PlaceSuggestion[]>;
  /**
   * The picked place's address (ends the search's billing session), or null
   * when Google doesn't know the id. Throws PlacesUnavailableError.
   */
  details(placeId: string, sessionToken: string): Promise<GooglePlace | null>;
  /** The place's address parts (no session: an event save's check), or null when Google doesn't know the id. */
  verify(placeId: string): Promise<GooglePlace | null>;
}

/** Whether a region code is Australia's or one of its external territories'. */
export function isAustralianRegion(regionCode: string | null): boolean {
  return regionCode !== null && (PLACES_REGION_CODES as readonly string[]).includes(regionCode.toLowerCase());
}

const STATE_BY_SHORT_NAME: ReadonlyMap<string, StateCode> = new Map([
  ["NSW", "NSW"],
  ["VIC", "VIC"],
  ["QLD", "QLD"],
  ["SA", "SA"],
  ["WA", "WA"],
  ["TAS", "TAS"],
  ["NT", "NT"],
  ["ACT", "ACT"],
  ["JBT", "OT"],
]);

/** Control characters out, whitespace collapsed, at most `max` characters: Google's text as we pass it on. */
function cleanText(value: unknown, max = 300): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

interface AddressComponent {
  longText?: unknown;
  shortText?: unknown;
  types?: unknown;
}

function componentsOf(value: unknown): AddressComponent[] {
  return Array.isArray(value) ? value.filter((c): c is AddressComponent => !!c && typeof c === "object") : [];
}

function hasType(component: AddressComponent, type: string): boolean {
  return Array.isArray(component.types) && component.types.includes(type);
}

/**
 * The state or territory from Place Details' address components: the country
 * component's code first (CX, CC, NF are OT), then, in Australia, the
 * administrative_area_level_1 short name (VIC, NSW, …; JBT for Jervis Bay
 * Territory is OT). Null outside Australia, or in Australia without a state.
 */
export function stateFromComponents(components: unknown): { regionCode: string | null; state: StateCode | null } {
  const list = componentsOf(components);
  const country = list.find((c) => hasType(c, "country"));
  const regionCode = cleanText(country?.shortText, 8).toUpperCase() || null;
  if (regionCode === "CX" || regionCode === "CC" || regionCode === "NF") return { regionCode, state: "OT" };
  if (regionCode !== "AU") return { regionCode, state: null };
  const area = list.find((c) => hasType(c, "administrative_area_level_1"));
  const short = cleanText(area?.shortText, 16).toUpperCase();
  const long = cleanText(area?.longText, 64).toLowerCase();
  const state = STATE_BY_SHORT_NAME.get(short) ?? (long === "jervis bay territory" ? "OT" : null);
  return { regionCode, state };
}

/** A Place Details response, read field by field: address parts only, whatever else is in it. */
export function placeFromGoogle(json: unknown, requestedId: string): GooglePlace | null {
  if (!json || typeof json !== "object") return null;
  const body = json as { id?: unknown; formattedAddress?: unknown; addressComponents?: unknown };
  const placeId = typeof body.id === "string" && PLACE_ID_PATTERN.test(body.id) ? body.id : requestedId;
  const list = componentsOf(body.addressComponents);
  const text = (type: string, field: "longText" | "shortText" = "longText") =>
    cleanText(list.find((c) => hasType(c, type))?.[field], 120) || null;
  const route = text("route", "shortText") ?? text("route");
  const number = text("street_number");
  const { regionCode, state } = stateFromComponents(body.addressComponents);
  return {
    placeId,
    formattedAddress: cleanText(body.formattedAddress, 300) || null,
    streetAddress: route ? [number, route].filter(Boolean).join(" ") : null,
    locality: text("locality") ?? text("sublocality_level_1") ?? text("sublocality") ?? text("postal_town"),
    postcode: text("postal_code"),
    regionCode,
    state,
  };
}

/** An Autocomplete response's place suggestions (query predictions and anything malformed skipped). */
export function suggestionsFromGoogle(json: unknown): PlaceSuggestion[] {
  const list = json && typeof json === "object" ? (json as { suggestions?: unknown }).suggestions : undefined;
  if (!Array.isArray(list)) return [];
  const suggestions: PlaceSuggestion[] = [];
  for (const item of list) {
    const prediction = item && typeof item === "object" ? (item as { placePrediction?: unknown }).placePrediction : undefined;
    if (!prediction || typeof prediction !== "object") continue;
    const p = prediction as {
      placeId?: unknown;
      structuredFormat?: { mainText?: { text?: unknown }; secondaryText?: { text?: unknown } };
      text?: { text?: unknown };
    };
    if (typeof p.placeId !== "string" || !PLACE_ID_PATTERN.test(p.placeId)) continue;
    const primaryText = cleanText(p.structuredFormat?.mainText?.text, 200) || cleanText(p.text?.text, 200);
    if (!primaryText) continue;
    suggestions.push({ placeId: p.placeId, primaryText, secondaryText: cleanText(p.structuredFormat?.secondaryText?.text, 200) });
    if (suggestions.length === MAX_PLACE_SUGGESTIONS) break;
  }
  return suggestions;
}

type Fetch = typeof fetch;

/**
 * The Places client for `apiKey`, or undefined without one (GOOGLE_MAPS_API_KEY
 * unset: the routes answer 503 and organisers drop a pin instead).
 */
export function createPlaces(apiKey: string | undefined, fetchImpl: Fetch = fetch): Places | undefined {
  const key = apiKey?.trim();
  if (!key) return undefined;

  async function call(path: string, mask: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${PLACES_ORIGIN}${path}`, {
        method: init.method,
        headers: {
          "X-Goog-Api-Key": key as string,
          "X-Goog-FieldMask": mask,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
        cache: "no-store",
        redirect: "error",
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new PlacesUnavailableError(timedOut ? "timeout" : "network");
    }
    return res;
  }

  /** An error response's body, unread (it's never logged), released. */
  async function discard(res: Response): Promise<void> {
    await res.body?.cancel().catch(() => {});
  }

  async function unavailable(res: Response): Promise<PlacesUnavailableError> {
    await discard(res);
    return new PlacesUnavailableError(`http_${res.status}`);
  }

  /**
   * Whether a 400's body is Google refusing the place id itself:
   * `error.status` NOT_FOUND, or INVALID_ARGUMENT whose message is about the
   * place id, and no ErrorInfo reason naming the API key. Read only to decide
   * this; never logged or passed on.
   */
  async function isPlaceIdRefusal(res: Response): Promise<boolean> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return false;
    }
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
    if (!error || typeof error !== "object") return false;
    const { status, message, details } = error as { status?: unknown; message?: unknown; details?: unknown };
    const reasons = Array.isArray(details)
      ? details.map((d) => (d && typeof d === "object" ? (d as { reason?: unknown }).reason : undefined))
      : [];
    if (reasons.some((r) => typeof r === "string" && /API_KEY|SERVICE_DISABLED|BILLING/i.test(r))) return false;
    if (status === "NOT_FOUND") return true;
    return status === "INVALID_ARGUMENT" && typeof message === "string" && /place[\s_-]*id/i.test(message);
  }

  async function jsonOf(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new PlacesUnavailableError("bad_response");
    }
  }

  async function getPlace(placeId: string, mask: string, sessionToken?: string): Promise<GooglePlace | null> {
    // Checked here too: the id goes into the URL path.
    if (!PLACE_ID_PATTERN.test(placeId)) return null;
    const qs = new URLSearchParams({ languageCode: PLACES_LANGUAGE, regionCode: "au" });
    if (sessionToken) qs.set("sessionToken", sessionToken);
    const res = await call(`/v1/places/${encodeURIComponent(placeId)}?${qs.toString()}`, mask, { method: "GET" });
    // Google doesn't know the id (NOT_FOUND).
    if (res.status === 404) {
      await discard(res);
      return null;
    }
    // A 400 is an unknown place only when Google says the place id is what's
    // wrong; a bad key or any other bad request is our problem (unavailable:
    // the editor offers a manual pin), not the organiser's.
    if (res.status === 400) {
      if (await isPlaceIdRefusal(res)) return null;
      throw new PlacesUnavailableError("http_400");
    }
    if (!res.ok) throw await unavailable(res);
    return placeFromGoogle(await jsonOf(res), placeId);
  }

  return {
    async autocomplete(input, sessionToken) {
      const res = await call("/v1/places:autocomplete", PLACES_FIELD_MASKS.autocomplete, {
        method: "POST",
        body: {
          input,
          sessionToken,
          includedRegionCodes: [...PLACES_REGION_CODES],
          languageCode: PLACES_LANGUAGE,
          regionCode: "au",
        },
      });
      if (!res.ok) throw await unavailable(res);
      return suggestionsFromGoogle(await jsonOf(res));
    },
    details: (placeId, sessionToken) => getPlace(placeId, PLACES_FIELD_MASKS.details, sessionToken),
    verify: (placeId) => getPlace(placeId, PLACES_FIELD_MASKS.verify),
  };
}
