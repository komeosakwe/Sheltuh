import {
  isValidRefundDays,
  MAX_REFUND_DAYS,
  MIN_REFUND_DAYS,
  REFUND_POLICIES,
  type RefundPolicy,
} from "@/lib/refund-policy";
import { isInAustralia } from "@/lib/geo";
import { didYouMean, findLocality, isPinNearLocality, PIN_REACH_MARGIN_KM } from "@/lib/location";
import { placeName } from "@/lib/place";
import type { TicketingMode } from "@/lib/ticketing";
import {
  PLATFORM_TIME_ZONE,
  STATE_CODES,
  ZONES_BY_STATE,
  type AustralianTimeZone,
  type StateCode,
} from "@/lib/time-zones";
import { PLACE_ID_PATTERN } from "./places";
import { parseTicketing, type Ticketing } from "./ticketing-input";
import type { EventCategory, TicketTypeInput } from "./types";
import {
  fail,
  requireCategory,
  requireLocalDateTime,
  requireString,
  requireTicketTypes,
} from "./validation";

export interface EventInput {
  title: string;
  description: string;
  category: EventCategory;
  venueName: string;
  venueAddress: string;
  /**
   * As typed, when the body sent no `state` / `timeZone`; with them, the ABS
   * locality's display name (lib/location.ts `Locality.name`: "Fitzroy",
   * "Richmond NSW", "Brisbane City").
   */
  suburb: string;
  /** The event's state or territory: as sent, or (neither sent) the stored one on edit, VIC on create. */
  state: StateCode;
  /** The zone `startsAt` and `endsAt` were read in, saved with them: as `state`. */
  timeZone: AustralianTimeZone;
  startsAt: string;
  endsAt: string;
  /** Always empty for an external event. */
  ticketTypes: TicketTypeInput[];
  ticketingMode: TicketingMode;
  /** The ticket link, as the URL parser writes it (external only; null otherwise). */
  externalTicketUrl: string | null;
  /** External only (false otherwise). */
  externalFree: boolean;
  /** External, paid only: the organiser's "price from" in whole AUD cents (null: none). */
  externalPriceFromCents: number | null;
  /**
   * Absent when the body didn't send one (parseRefundPolicy): the database
   * then uses the default on create and keeps the stored policy on edit.
   */
  refundPolicy?: RefundPolicy;
  /** With `refundPolicy` only: the days for `days_before`, null for `no_change_of_mind`. */
  refundDays?: number | null;
  /**
   * The venue location as it's to be saved (parseLocation): absent when the
   * body sent no `location` (create: none; edit: the stored one is kept);
   * `legacy` when it sent null (cleared).
   */
  location?: LocationInput;
}

/** A venue location as the database stores it (events.location_source, venue_place_id, venue_lat / venue_lng). */
export interface LocationInput {
  source: "legacy" | "places" | "manual_pin";
  /** `places` only. */
  placeId: string | null;
  /** The organiser's pin, rounded to 6 decimal places: required for `manual_pin`, optional for `places`, none for `legacy`. */
  pin: { lat: number; lng: number } | null;
}

// The ticketing fields are parsed in ./ticketing-input, which (unlike this
// module) doesn't load the suburb table; re-exported for this module's callers.
export { parseTicketing, type Ticketing };

interface RawEventBody {
  title?: unknown;
  description?: unknown;
  category?: unknown;
  venueName?: unknown;
  venueAddress?: unknown;
  suburb?: unknown;
  state?: unknown;
  timeZone?: unknown;
  start?: unknown;
  end?: unknown;
  ticketTypes?: unknown;
  ticketingMode?: unknown;
  externalTicketUrl?: unknown;
  externalFree?: unknown;
  externalPriceFromCents?: unknown;
  refundPolicy?: unknown;
  refundDays?: unknown;
  location?: unknown;
}

/** The event's refund policy as parseRefundPolicy returns it: nothing sent, or both fields. */
export type RefundInput = Pick<EventInput, "refundPolicy" | "refundDays">;

/**
 * `refundPolicy` and `refundDays` (lib/refund-policy.ts), with errors under
 * those field names:
 * - neither sent (absent or null): `{}`, so the stored policy is kept on edit
 *   and the default (`no_change_of_mind`) used on create;
 * - `days_before`: `refundDays` must be a whole number from 1 to 30;
 * - `no_change_of_mind`: `refundDays` must be absent or null (it's stored as
 *   null, clearing any days the event had), rather than being silently dropped;
 * - anything else as the policy, or days without a policy, is an error.
 */
export function parseRefundPolicy(body: RawEventBody, errors: Record<string, string>): RefundInput {
  const daysSent = body.refundDays !== undefined && body.refundDays !== null;
  if (body.refundPolicy === undefined || body.refundPolicy === null) {
    if (daysSent) errors.refundPolicy = "Choose a refund policy.";
    return {};
  }
  if (typeof body.refundPolicy !== "string" || !REFUND_POLICIES.includes(body.refundPolicy as RefundPolicy)) {
    errors.refundPolicy = "Choose a refund policy.";
    return {};
  }
  const refundPolicy = body.refundPolicy as RefundPolicy;
  if (refundPolicy === "no_change_of_mind") {
    if (daysSent) errors.refundDays = "Only for refunds up to a number of days before the event.";
    return { refundPolicy, refundDays: null };
  }
  if (!isValidRefundDays(body.refundDays)) {
    errors.refundDays = `Enter a whole number of days from ${MIN_REFUND_DAYS} to ${MAX_REFUND_DAYS}.`;
    return { refundPolicy, refundDays: null };
  }
  return { refundPolicy, refundDays: body.refundDays };
}

/** An event's state and the zone its times are entered and shown in, as stored. */
export type EventPlace = Pick<EventInput, "state" | "timeZone">;

/** A new event's place when the body sends none: Melbourne, as every event was before events had a zone. */
export const DEFAULT_EVENT_PLACE: EventPlace = { state: "VIC", timeZone: PLATFORM_TIME_ZONE };

/** An event's stored place (EventRecord's `state` / `timeZone`; absent in a record from before them: the default). */
export function storedPlaceOf(event: { state?: StateCode; timeZone?: AustralianTimeZone }): EventPlace {
  return event.state && event.timeZone ? { state: event.state, timeZone: event.timeZone } : DEFAULT_EVENT_PLACE;
}

/** The state, as `state` is sent: one of STATE_CODES exactly. */
function isStateCode(value: unknown): value is StateCode {
  return typeof value === "string" && (STATE_CODES as readonly string[]).includes(value);
}

/** Whether `zone` is one an event in `state` may use (ZONES_BY_STATE: the events_place_check constraint's table). */
export function isZoneOfState(state: StateCode, zone: unknown): zone is AustralianTimeZone {
  return typeof zone === "string" && (ZONES_BY_STATE[state] as readonly string[]).includes(zone);
}

/**
 * The suburb `suburb` names in `state`, or null: the text with the state
 * after it ("Richmond NSW"), or the text alone when it already names the
 * state ("Richmond NSW" as the API returned it, which "Richmond NSW NSW"
 * wouldn't find). Only ever a locality in `state`.
 */
function localityIn(suburb: string, state: StateCode) {
  for (const text of [`${suburb} ${state}`, suburb]) {
    const place = findLocality(text);
    if (place?.state === state) return place;
  }
  return null;
}

/**
 * `state` and `timeZone`, sent together or not at all (errors under those
 * names), and the suburb checked against the state:
 * - neither sent (absent or null): `fallback` (the stored place on edit, the
 *   default on create), and the suburb as typed, so a client that predates
 *   them keeps working, its times read in the stored zone;
 * - both: `state` one of STATE_CODES, `timeZone` one of ZONES_BY_STATE[state],
 *   and `suburb` a locality in that state (lib/location.ts), saved as its
 *   display name; otherwise fieldErrors.suburb, with a near spelling in the
 *   state when there's one ("Did you mean Fremantle, WA?"), else how to
 *   name a place in another state ("Richmond, NSW", as the editor's field
 *   takes it: it has no state control of its own);
 * - only one: an error on the missing one.
 *
 * `zoneForTimes` is the zone to read the times in: null when the place is in
 * error (the times then aren't converted).
 */
export function parsePlace(
  body: RawEventBody,
  suburb: string,
  errors: Record<string, string>,
  fallback: EventPlace = DEFAULT_EVENT_PLACE,
): { place: EventPlace; suburb: string; zoneForTimes: AustralianTimeZone | null } {
  const stateSent = body.state !== undefined && body.state !== null;
  const zoneSent = body.timeZone !== undefined && body.timeZone !== null;
  if (!stateSent && !zoneSent) return { place: fallback, suburb, zoneForTimes: fallback.timeZone };
  if (!stateSent || !zoneSent) {
    if (!stateSent) errors.state = "Choose the event's state or territory (sent with its time zone).";
    if (!zoneSent) errors.timeZone = "Choose the event's time zone (sent with its state or territory).";
    return { place: fallback, suburb, zoneForTimes: null };
  }
  if (!isStateCode(body.state)) {
    errors.state = "Choose a state or territory.";
    return { place: fallback, suburb, zoneForTimes: null };
  }
  const state = body.state;
  if (!isZoneOfState(state, body.timeZone)) {
    errors.timeZone = `Choose a time zone used in ${state}.`;
    return { place: fallback, suburb, zoneForTimes: null };
  }
  const place: EventPlace = { state, timeZone: body.timeZone };
  // An empty suburb already has its "required" error.
  if (!suburb || errors.suburb) return { place, suburb, zoneForTimes: place.timeZone };
  const locality = localityIn(suburb, state);
  if (!locality) {
    const near = didYouMean(`${suburb} ${state}`);
    errors.suburb =
      near && near.state === state
        ? `We couldn't find that suburb in ${state}. Did you mean ${placeName(near.name, near.state)}?`
        : `We couldn't find that suburb in ${state}. Check the spelling, or add the state it's in (“Richmond, NSW”).`;
    return { place, suburb, zoneForTimes: place.timeZone };
  }
  return { place, suburb: locality.name, zoneForTimes: place.timeZone };
}

export const LOCATION_CHOOSE = "Find the venue on Google Maps, or drop a pin on the map.";
export const PIN_OUTSIDE_AUSTRALIA = "Put the pin on the venue: it has to be in Australia.";
const PLACE_ID_INVALID = "That Google Maps place isn't valid. Search for the venue again, or drop a pin instead.";

/** A coordinate to 6 decimal places (about 10 cm), as it's stored. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** `{lat, lng}`: finite numbers inside AUSTRALIA_BOUNDS (lib/geo.ts; events_venue_pin_bounds), rounded. Null with an error otherwise. */
function parsePin(value: unknown, errors: Record<string, string>): { lat: number; lng: number } | null {
  const pin = value && typeof value === "object" && !Array.isArray(value) ? (value as { lat?: unknown; lng?: unknown }) : null;
  if (!pin || typeof pin.lat !== "number" || typeof pin.lng !== "number") {
    errors.location = "Put the pin on the venue.";
    return null;
  }
  const rounded = { lat: round6(pin.lat), lng: round6(pin.lng) };
  if (!Number.isFinite(rounded.lat) || !Number.isFinite(rounded.lng) || !isInAustralia(rounded)) {
    errors.location = PIN_OUTSIDE_AUSTRALIA;
    return null;
  }
  return rounded;
}

/**
 * The body's `location` (lib/api/types.ts VenueLocationInput), errors under
 * `location`:
 * - absent: undefined (create: none; edit: the stored one is kept);
 * - null: cleared (`legacy`);
 * - `{source: "places", placeId, pin?}`: placeId matching PLACE_ID_PATTERN;
 *   pin optional (absent or null: none);
 * - `{source: "manual_pin", pin}`: pin required.
 * Only the shape and bounds here: the pin against the suburb is checked by
 * parseEventInput, and a new place id with Google by the handler
 * (verifyVenuePlace).
 */
export function parseLocation(value: unknown, errors: Record<string, string>): LocationInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return { source: "legacy", placeId: null, pin: null };
  const body = typeof value === "object" && !Array.isArray(value) ? (value as { source?: unknown; placeId?: unknown; pin?: unknown }) : null;
  if (body?.source === "places") {
    if (typeof body.placeId !== "string" || !PLACE_ID_PATTERN.test(body.placeId)) {
      errors.location = PLACE_ID_INVALID;
      return undefined;
    }
    const pin = body.pin === undefined || body.pin === null ? null : parsePin(body.pin, errors);
    return errors.location ? undefined : { source: "places", placeId: body.placeId, pin };
  }
  if (body?.source === "manual_pin") {
    if (body.placeId !== undefined && body.placeId !== null) {
      errors.location = "A dropped pin has no Google Maps place.";
      return undefined;
    }
    const pin = parsePin(body.pin, errors);
    return pin ? { source: "manual_pin", placeId: null, pin } : undefined;
  }
  errors.location = LOCATION_CHOOSE;
  return undefined;
}

/**
 * The pin's check against the suburb the event names (`suburb`, in `state`):
 * within the locality's reach plus PIN_REACH_MARGIN_KM (lib/location.ts
 * isPinNearLocality). An error under `location` when it isn't, or when the
 * suburb can't be found in the state (only possible for a client that sends
 * no state: otherwise parsePlace has already refused it).
 */
function checkPinNearSuburb(
  pin: { lat: number; lng: number },
  suburb: string,
  state: StateCode,
  errors: Record<string, string>,
): void {
  const locality = localityIn(suburb, state);
  if (!locality) {
    errors.location = "We couldn't check the pin against the suburb. Check the suburb's spelling.";
    return;
  }
  if (!isPinNearLocality(locality, pin)) {
    errors.location = `The pin is more than ${PIN_REACH_MARGIN_KM} km outside ${placeName(locality.name, locality.state)}. Move it onto the venue, or check the suburb.`;
  }
}

/** What parseEventInput needs besides the body. */
export interface ParseEventOptions {
  /**
   * The event's stored place, on edit: used when the body sends neither
   * `state` nor `timeZone`, so its times are read in the zone they were
   * entered in. Absent (create): DEFAULT_EVENT_PLACE.
   */
  storedPlace?: EventPlace;
}

/**
 * The event body for POST and PATCH (organiser and admin alike), validated:
 * 400 with fieldErrors for everything wrong at once. `start` and `end` are
 * local {date, time} pairs, read in the event's zone (parsePlace: the one
 * sent, else the stored one on edit, else Melbourne).
 */
export function parseEventInput(body: RawEventBody, options: ParseEventOptions = {}): EventInput {
  const errors: Record<string, string> = {};

  const title = requireString(body.title, "title", errors, 150);
  const description = requireString(body.description, "description", errors, 4000);
  const category = requireCategory(body.category, "category", errors);
  const venueName = requireString(body.venueName, "venueName", errors, 150);
  const venueAddress = requireString(body.venueAddress, "venueAddress", errors, 250);
  const typedSuburb = requireString(body.suburb, "suburb", errors, 100);
  const { place, suburb, zoneForTimes } = parsePlace(body, typedSuburb, errors, options.storedPlace);
  // With the place in error, the times can't be read yet: their errors wait for a valid zone.
  const startsAt = zoneForTimes ? requireLocalDateTime(body.start, "start", errors, zoneForTimes) : undefined;
  const endsAt = zoneForTimes ? requireLocalDateTime(body.end, "end", errors, zoneForTimes) : undefined;
  const ticketing = parseTicketing(body, errors);
  const refund = parseRefundPolicy(body, errors);
  const location = parseLocation(body.location, errors);
  // An empty or unknown suburb already has its own error.
  if (location?.pin && suburb && !errors.suburb && !errors.state && !errors.timeZone) {
    checkPinNearSuburb(location.pin, suburb, place.state, errors);
  }

  // An external event has no Sheltüh ticket types: none may be sent (an
  // absent, null or empty list is fine), rather than being silently dropped.
  let ticketTypes: TicketTypeInput[] = [];
  if (ticketing.ticketingMode === "external" && !errors.ticketingMode) {
    if (!(body.ticketTypes === undefined || body.ticketTypes === null) &&
        !(Array.isArray(body.ticketTypes) && body.ticketTypes.length === 0)) {
      errors.ticketTypes = "Events with tickets sold on another site don't have Sheltüh ticket types.";
    }
  } else {
    ticketTypes = requireTicketTypes(body.ticketTypes, "ticketTypes", errors);
  }

  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.end = "End time must be after the start time.";
  }

  if (Object.keys(errors).length > 0) fail(errors);

  return {
    title,
    description,
    category,
    venueName,
    venueAddress,
    suburb,
    ...place,
    startsAt: startsAt as string,
    endsAt: endsAt as string,
    ticketTypes,
    ...ticketing,
    ...refund,
    ...(location ? { location } : {}),
  };
}
