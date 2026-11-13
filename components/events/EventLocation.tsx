import EventLocationMap from "@/components/events/EventLocationMap";
import { ExternalIcon } from "@/components/home/icons";
import { appleMapsHref, directionsHref, venuePin } from "@/lib/maps";
import { placeName } from "@/lib/place";
import type { SheltuhEvent } from "@/lib/types";

// Mono like the address beside them, in the words' own case (the owner's event mock), each a 44px target.
const LINK_CLASS =
  "mono-m inline-flex min-h-11 items-center gap-2 underline underline-offset-4 hover:decoration-2";

/**
 * The event page's Location section, in the main column after About (owner
 * request, 26 Oct 2026; the owner's event mock): a small map with the venue
 * pinned (EventLocationMap: a placeholder until it nears the screen, and left
 * out when the event can't be placed), then one mono line, the venue's name
 * and address and two links out, "Google Maps" (the same directions link as
 * the address under the title) and "Apple Maps" (lib/maps.ts). Both are always shown, with no user-agent sniffing, so the
 * server and browser render the same (owner decision A-D4, 27 Oct 2026).
 * Nothing at all when there's nowhere to route to (no venue, address or
 * suburb).
 */
export default function EventLocation({ event, map = true }: { event: SheltuhEvent; /** False: no map (the editor's live preview). */ map?: boolean }) {
  const directions = directionsHref(event);
  const apple = appleMapsHref(event);
  if (!directions) return null;
  const venue = event.venueName.trim();
  // The street address, or where it has none, the suburb ("Fitzroy, VIC").
  const where = event.venueAddress.trim() || placeName(event.suburb, event.state);
  const destination = [venue, where].filter(Boolean).join(", ");
  // With the organiser's pin, Apple Maps opens on that spot; otherwise it routes to the address.
  const appleAction = venuePin(event) ? destination : `directions to ${destination}`;

  return (
    <section aria-labelledby="location-title" className="flex flex-col gap-4">
      <h2 id="location-title" className="heading-h2">
        Location
      </h2>
      <div data-event-location="" className="flex flex-col gap-2">
        {map && <EventLocationMap event={event} directions={directions} />}
        <div className="flex flex-wrap items-center gap-x-2">
          <address className="mono-m flex flex-wrap gap-x-2 not-italic">
            {venue && <span className="font-semibold">{venue}</span>}
            {venue && where && <span aria-hidden="true">·</span>}
            {where && <span className="break-words">{where}</span>}
          </address>
          <span aria-hidden="true" className="mono-m">
            ·
          </span>
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            data-google-maps=""
            // Starts with the visible words (label in name), then where it goes and that it opens a new tab.
            aria-label={`Google Maps: directions to ${destination} (opens in a new tab)`}
            className={LINK_CLASS}
          >
            Google Maps
            <ExternalIcon className="size-4" />
          </a>
          {apple && (
            <>
              <span aria-hidden="true" className="mono-m">
                ·
              </span>
              <a
                href={apple}
                target="_blank"
                rel="noopener noreferrer"
                data-apple-maps=""
                aria-label={`Apple Maps: ${appleAction} (opens in a new tab)`}
                className={LINK_CLASS}
              >
                Apple Maps
                <ExternalIcon className="size-4" />
              </a>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
