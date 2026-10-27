import type { VenuePinMapLeafletProps } from "@/components/dashboard/VenuePinMapLeaflet";
import { PHONE_QUERY } from "@/components/ui/useIsPhone";
import type { VenueLocation } from "@/lib/api/types";

/**
 * For editor tests with a venue pin on screen (the "Check the pin" step,
 * components/dashboard/VenuePinMap.tsx): Leaflet stood in for, and
 * window.matchMedia, which jsdom lacks (useIsPhone). Mock the map with
 *
 *   vi.mock("@/components/dashboard/VenuePinMapLeaflet", async () => (await import("./test-utils/pinMapStub")).leafletStub());
 *
 * and call stubMatchMedia() in beforeEach (unstubMatchMedia() after).
 * "Drag to" moves the map to `pinMapDrag.to`.
 */
export const pinMapDrag = { to: { lat: -37.801, lng: 144.981 } };

export function leafletStub() {
  return {
    default: ({ centre, zoom, onMove }: VenuePinMapLeafletProps) => (
      <div data-testid="leaflet" data-lat={centre.lat} data-lng={centre.lng} data-zoom={zoom}>
        <button type="button" onClick={() => onMove(pinMapDrag.to, zoom)}>
          Drag to
        </button>
      </div>
    ),
  };
}

/** window.matchMedia answering the phone query with `phone` (and nothing else as matching). */
export function stubMatchMedia(phone = false) {
  window.matchMedia = ((query: string) => ({
    matches: query === PHONE_QUERY && phone,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

export function unstubMatchMedia() {
  Reflect.deleteProperty(window, "matchMedia");
}

/** A saved event's confirmed pin (a manual pin in Fitzroy): with it, the event can be published. */
export const CONFIRMED_PIN_LOCATION: VenueLocation = { source: "manual_pin", pin: { lat: -37.8, lng: 144.98 } };
