import type { SheltuhEvent } from "@/lib/types";

/**
 * "Get directions" (docs/design/mobile-redesign.md §6.5): Google's documented
 * cross-platform Maps URL, which opens the Google Maps app where it's
 * installed (Android, and iOS with the app) and Google Maps on the web
 * otherwise, routing from the person's own location. No user-agent sniffing
 * (so the server and browser render the same link) and no `geo:` scheme
 * (unsupported on desktop and iOS Safari). The destination is the venue's
 * name and street address (or suburb), not the coordinates, which may be a
 * suburb's centre. Null when there's nothing to route to.
 */
export function directionsHref(
  event: Pick<SheltuhEvent, "venueName" | "venueAddress" | "suburb">,
): string | null {
  const name = event.venueName.trim();
  const where = event.venueAddress.trim() || event.suburb.trim();
  const destination = [name, where].filter(Boolean).join(", ");
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
