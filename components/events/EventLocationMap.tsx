"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { EventLocationLeafletProps } from "@/components/events/EventLocationLeaflet";
import { useLocationModule } from "@/components/search/useLocationModule";
import { findListedSuburb, resolveMapCoordinates, type SuburbLookup } from "@/lib/geo";
import { placeName } from "@/lib/place";
import type { SheltuhEvent } from "@/lib/types";

/** Start loading this far before the map scrolls into view, so it's usually ready when it arrives. */
const NEAR_MARGIN = "400px 0px";

/** Street level for the venue's own position; a neighbourhood for a suburb's centre. */
const VENUE_ZOOM = 15;
const SUBURB_ZOOM = 13;

/** If Leaflet's chunk can't load: the same box, saying so (the address and link still work). */
function MapUnavailable() {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center">
      <p className="text-sm text-muted">The map couldn&rsquo;t load.</p>
    </div>
  );
}

// Leaflet and react-leaflet only in the browser, and only once the section is near (below).
const EventLocationLeaflet = dynamic<EventLocationLeafletProps>(
  () => import("@/components/events/EventLocationLeaflet").catch(() => MapUnavailable),
  { ssr: false, loading: () => null },
);

type Proximity = "far" | "near" | "unsupported";

/**
 * The Location section's map: a fixed box (so nothing shifts) that stays an
 * empty placeholder until it nears the screen, then loads Leaflet and places
 * the pin as /map does (lib/geo.ts resolveMapCoordinates): the venue's own
 * coordinates, else its suburb's centre from the Australia-wide suburb table,
 * which loads only then and only for an event without coordinates (as
 * /map's, through useLocationModule; the hand-entered Melbourne centres stand
 * in if it can't load). A suburb's centre isn't the venue, so the map is
 * zoomed out and says the pin is approximate. Nothing places the event (or
 * the browser has no IntersectionObserver): no map, and the address and
 * "Open in Maps" carry the section.
 *
 * Decorative to assistive technology and out of the tab order (aria-hidden,
 * inert); a tap or click on it opens directions, the same as the section's
 * "Open in Maps" link, which is the one named, focusable control.
 */
export default function EventLocationMap({
  event,
  directions,
}: {
  event: SheltuhEvent;
  directions: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [proximity, setProximity] = useState<Proximity>("far");
  const near = proximity === "near";
  const approximate = !event.coordinates;
  const suburbTable = useLocationModule(near && approximate);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      // Deferred, so the effect never sets state synchronously (as SceneMapPanel's).
      queueMicrotask(() => setProximity("unsupported"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setProximity("near");
          observer.disconnect();
        }
      },
      { rootMargin: NEAR_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Until the table answers (or fails, when the listed centres stand in), there's no lookup yet.
  const findSuburb: SuburbLookup | null = approximate
    ? (suburbTable.module?.findLocality ?? (suburbTable.failed ? findListedSuburb : null))
    : findListedSuburb;
  const located = near && findSuburb !== null;
  const position = located ? resolveMapCoordinates(event, findSuburb) : null;

  // Nowhere to put the pin: no box at all.
  if (proximity === "unsupported" || (located && !position)) return null;

  const place = placeName(event.suburb, event.state);

  return (
    <div aria-hidden="true" data-event-map="" className="flex flex-col gap-2">
      <div
        ref={box}
        data-surface="paper"
        // The box is sized before anything loads: 208px tall on phones, 256px from lg.
        className="relative isolate h-52 w-full overflow-hidden rounded-card border border-surface-border bg-surface lg:h-64"
      >
        {position && (
          <div inert className="h-full w-full">
            <EventLocationLeaflet
              lat={position.lat}
              lng={position.lng}
              zoom={approximate ? SUBURB_ZOOM : VENUE_ZOOM}
              event={event}
            />
          </div>
        )}
        {/* The whole map is a tap target for directions, kept out of the tab order and the
            accessibility tree: "Open in Maps" below is the same link, named. */}
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          data-event-map-link=""
          className="absolute inset-0 z-[1100]"
        />
      </div>
      {position && approximate && place && (
        <p className="text-xs leading-4 text-muted">The pin marks {place}, not the venue&rsquo;s exact spot.</p>
      )}
    </div>
  );
}
