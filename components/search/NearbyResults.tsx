import EventResults from "@/components/EventResults";
import { orderByNearness, type Locality } from "@/lib/location";
import type { SheltuhEvent } from "@/lib/types";

/** Live near mode reads at most this many events (4 pages of 50) before ordering them by distance. */
export const NEAR_MAX_EVENTS = 200;

/**
 * /search results near a suburb (owner decision D4, 24 Oct 2026): in bands,
 * nearest first (In {suburb}, Within 5 km, 5–15 km, Further away, Location
 * not on file), soonest first within each, each under a small visible h2.
 * The h2s are the structure: no region landmark per band, and the lists
 * aren't named again with the heading's words.
 * Every event is listed: one whose suburb isn't known goes last, never away.
 * `capped`: more events matched than were read, so say only the soonest
 * were ordered.
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
  const groups = orderByNearness(events, origin);
  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <p data-near-note="" className="text-sm leading-5 text-muted">
        Closest to {origin.name} first. Distances are between suburb centres, so they’re approximate.
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
