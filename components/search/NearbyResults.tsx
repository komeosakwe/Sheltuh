"use client";

import EventResults from "@/components/EventResults";
import { Button } from "@/components/ui/Button";
import { useLocationModule } from "@/components/search/useLocationModule";
import { Notice } from "@/components/ui/Section";
import type { Locality } from "@/lib/location";
import { placeName } from "@/lib/place";
import type { SheltuhEvent } from "@/lib/types";

/** Live near mode reads at most this many events (4 pages of 50) before ordering them by distance. */
export const NEAR_MAX_EVENTS = 200;

/**
 * /search results near a suburb (owner decision D4, 24 Oct 2026): in bands,
 * nearest first (In {Suburb, STATE}, Within 5 km, 5–15 km, 15–100 km, Over 100
 * km (owner decision D8, 26 Oct 2026: events are Australia-wide), Location
 * not on file), soonest first within each, each under a small visible h2.
 * Each event's suburb is found with its state (lib/place.ts placeQuery).
 * The h2s are the structure: no region landmark per band, and the lists
 * aren't named again with the heading's words.
 * Every event is listed: one whose suburb isn't known goes last, never away.
 * `capped`: more events matched than were read, so say only the soonest
 * were ordered.
 *
 * Placing the events' suburbs needs the suburb table, which loads here on
 * demand (lib/location-loader.ts) rather than with every page that has a
 * feed. Until it has: a short status. If it can't: the error, a retry, and
 * the events soonest first.
 */
export default function NearbyResults({
  events,
  origin,
  capped = false,
}: {
  events: SheltuhEvent[];
  origin: Locality;
  capped?: boolean;
}) {
  const { module: location, failed, retry } = useLocationModule();
  // "Fitzroy, VIC", "Richmond, NSW" (owner decision D4).
  const originName = placeName(origin.name, origin.state);

  if (!location) {
    if (failed) {
      return (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-start gap-4">
            <Notice tone="danger" role="alert">
              Couldn’t sort these by distance from {originName}, so they’re soonest first.
            </Notice>
            <Button variant="outline" size="sm" onClick={retry}>
              Try again
            </Button>
          </div>
          <EventResults events={events} heading="Events" />
        </div>
      );
    }
    return (
      <p role="status" className="text-sm leading-5 text-muted">
        Sorting by distance from {originName}…
      </p>
    );
  }

  const groups = location.orderByNearness(events, origin);
  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <p data-near-note="" className="text-sm leading-5 text-muted">
        Closest to {originName} first. Distances are between suburb centres, so they’re approximate.
        {capped && ` Sorted the ${NEAR_MAX_EVENTS} soonest events by distance.`}
      </p>
      {groups.map((group) => (
        <div key={group.band} data-near-band={group.band}>
          <h2 className="eyebrow mb-4 text-foreground">{group.label}</h2>
          <EventResults events={group.items} label={null} />
        </div>
      ))}
    </div>
  );
}
