import { isInAustralia } from "@/lib/geo";
import type { Coordinates, SheltuhEvent } from "@/lib/types";

/**
 * Where a map link goes: the venue as the organiser wrote it, plus what pins
 * it down exactly when there is one. That is the Google place id the
 * organiser linked (`venuePlaceId`) and their own pin (`coordinates` while
 * `venuePinned`). Coordinates without `venuePinned` (the demo's samples) are
 * never routed to. A SheltuhEvent fits as is; the ticket email passes the
 * text fields alone.
 */
export type VenueLinkTarget = Pick<SheltuhEvent, "venueName" | "venueAddress" | "suburb"> &
  Partial<Pick<SheltuhEvent, "venuePlaceId" | "venuePinned" | "coordinates">>;

/** The venue's name and its street address (or suburb): "The Tote, 71 Johnston St, Collingwood VIC 3066". */
function destinationText(target: Pick<VenueLinkTarget, "venueName" | "venueAddress" | "suburb">): string {
  const name = target.venueName.trim();
  const where = target.venueAddress.trim() || target.suburb.trim();
  return [name, where].filter(Boolean).join(", ");
}

/**
 * The organiser's pin, when there is one and it's a real position in
 * Australia (lib/geo.ts AUSTRALIA_BOUNDS); otherwise null, and the links go
 * by the place id or the text.
 */
export function venuePin(target: VenueLinkTarget): Coordinates | null {
  const pin = target.coordinates;
  if (!target.venuePinned || !pin) return null;
  if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng) || !isInAustralia(pin)) return null;
  return pin;
}

/** "lat,lng" to 6 decimal places (about 10 cm), the comma left as is (both Google and Apple accept it). */
function latLng(pin: Coordinates): string {
  return `${Number(pin.lat.toFixed(6))},${Number(pin.lng.toFixed(6))}`;
}

function placeIdOf(target: Pick<VenueLinkTarget, "venuePlaceId">): string | null {
  return target.venuePlaceId?.trim() || null;
}

/**
 * "Get directions" (docs/design/mobile-redesign.md §6.5): Google's documented
 * cross-platform Maps URL, which opens the Google Maps app where it's
 * installed (Android, and iOS with the app) and Google Maps on the web
 * otherwise, routing from the person's own location. No user-agent sniffing
 * (so the server and browser render the same link) and no `geo:` scheme
 * (unsupported on desktop and iOS Safari).
 *
 * The destination, most exact first:
 * - a linked Google place: the venue's name and address, plus
 *   `destination_place_id` (Google requires the text alongside the id, and
 *   it still finds the address if the id ever goes stale);
 * - the organiser's pin: `destination=lat,lng`;
 * - otherwise the venue's name and street address (or suburb).
 *
 * Null when there's nothing to route to.
 */
export function directionsHref(target: VenueLinkTarget): string | null {
  const text = destinationText(target);
  const pin = venuePin(target);
  const placeId = placeIdOf(target);
  const base = "https://www.google.com/maps/dir/?api=1&destination=";
  if (placeId) {
    const destination = text ? encodeURIComponent(text) : pin ? latLng(pin) : null;
    return destination ? `${base}${destination}&destination_place_id=${encodeURIComponent(placeId)}` : null;
  }
  if (pin) return `${base}${latLng(pin)}`;
  return text ? `${base}${encodeURIComponent(text)}` : null;
}

/**
 * The same venue in Apple Maps (maps.apple.com, which opens the Maps app on
 * iPhone, iPad and Mac, and Apple Maps on the web elsewhere). It never uses
 * the Google place id. With the organiser's pin it's that spot, labelled
 * with the venue's name (`ll` and `q`). Otherwise it's directions to the
 * street address as written (`daddr`), or to the venue's name and suburb
 * without one. Null when there's nothing to go to.
 */
export function appleMapsHref(target: VenueLinkTarget): string | null {
  const pin = venuePin(target);
  if (pin) {
    const label = target.venueName.trim() || destinationText(target);
    return `https://maps.apple.com/?ll=${latLng(pin)}${label ? `&q=${encodeURIComponent(label)}` : ""}`;
  }
  const address =
    target.venueAddress.trim() || [target.venueName.trim(), target.suburb.trim()].filter(Boolean).join(", ");
  return address ? `https://maps.apple.com/?daddr=${encodeURIComponent(address)}` : null;
}

/**
 * The linked Google place itself, not directions ("Check on Google Maps" in
 * the event editor): Google's cross-platform search URL with
 * `query_place_id`, and the venue's text as the `query` it requires. Null
 * without a place id, or without any text for `query`.
 */
export function googlePlaceHref(
  target: Pick<VenueLinkTarget, "venueName" | "venueAddress" | "suburb" | "venuePlaceId">,
): string | null {
  const placeId = placeIdOf(target);
  const text = destinationText(target);
  if (!placeId || !text) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}&query_place_id=${encodeURIComponent(placeId)}`;
}
