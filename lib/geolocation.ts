/**
 * The browser's position, asked the same way everywhere (the search bar's
 * "Use my current location" and /map): coarse, at most 10 seconds, and a
 * reading up to 10 minutes old is fine. The position is for matching a
 * suburb (and centring the map); it's never stored, put in a URL or sent
 * (docs/architecture.md, "Location (near you)").
 */
export const GEOLOCATION_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 };

/** Whether this browser can be asked for a position. */
export function hasGeolocation(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator && Boolean(navigator.geolocation);
}
