import EventLocationMap from "@/components/events/EventLocationMap";
import { ExternalIcon } from "@/components/home/icons";
import { Panel } from "@/components/ui/Section";
import { directionsHref } from "@/lib/maps";
import { placeName } from "@/lib/place";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The event page's Location section, in the main column after About (owner
 * request, 26 Oct 2026): the venue's name and address, a small map with the
 * venue pinned (EventLocationMap: loaded as it nears the screen, and left out
 * when the event can't be placed), and "Open in Maps", the same directions
 * link as the address under the title (lib/maps.ts). Nothing at all when
 * there's nowhere to route to (no venue, address or suburb).
 */
export default function EventLocation({ event }: { event: SheltuhEvent }) {
  const directions = directionsHref(event);
  if (!directions) return null;
  const venue = event.venueName.trim();
  // The street address, or where it has none, the suburb ("Fitzroy, VIC").
  const where = event.venueAddress.trim() || placeName(event.suburb, event.state);
  const destination = [venue, where].filter(Boolean).join(", ");

  return (
    <Panel title="Location" titleId="location-title">
      <div data-event-location="" className="flex flex-col gap-4">
        <address className="flex flex-col text-base leading-6 not-italic">
          {venue && <span className="font-semibold">{venue}</span>}
          {where && <span className="break-words">{where}</span>}
        </address>
        <EventLocationMap event={event} directions={directions} />
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          data-open-in-maps=""
          // Starts with the visible words (label in name), then where it goes and that it opens a new tab.
          aria-label={`Open in Maps: directions to ${destination} (opens Google Maps in a new tab)`}
          className="inline-flex min-h-11 items-center gap-1 self-start text-base leading-6 font-medium underline underline-offset-4 hover:decoration-2"
        >
          Open in Maps
          <ExternalIcon className="size-4" />
        </a>
      </div>
    </Panel>
  );
}
