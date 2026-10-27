import EventLocationMap from "@/components/events/EventLocationMap";
import { ExternalIcon } from "@/components/home/icons";
import { Panel } from "@/components/ui/Section";
import { appleMapsHref, directionsHref, venuePin } from "@/lib/maps";
import { placeName } from "@/lib/place";
import type { SheltuhEvent } from "@/lib/types";

const LINK_CLASS =
  "inline-flex min-h-11 items-center gap-1 text-base leading-6 font-medium underline underline-offset-4 hover:decoration-2";

/**
 * The event page's Location section, in the main column after About (owner
 * request, 26 Oct 2026): the venue's name and address, a small map with the
 * venue pinned (EventLocationMap: loaded as it nears the screen, and left out
 * when the event can't be placed), and two links out, "Google Maps" (the
 * same directions link as the address under the title) and "Apple Maps"
 * (lib/maps.ts). Both are always shown, with no user-agent sniffing, so the
 * server and browser render the same (owner decision A-D4, 27 Oct 2026).
 * Nothing at all when there's nowhere to route to (no venue, address or
 * suburb).
 */
export default function EventLocation({ event }: { event: SheltuhEvent }) {
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
    <Panel title="Location" titleId="location-title">
      <div data-event-location="" className="flex flex-col gap-4">
        <address className="flex flex-col text-base leading-6 not-italic">
          {venue && <span className="font-semibold">{venue}</span>}
          {where && <span className="break-words">{where}</span>}
        </address>
        <EventLocationMap event={event} directions={directions} />
        <div className="flex flex-wrap gap-x-6">
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
          )}
        </div>
      </div>
    </Panel>
  );
}
