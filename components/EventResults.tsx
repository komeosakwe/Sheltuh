import EventTile from "@/components/ui/EventTile";
import type { SheltuhEvent } from "@/lib/types";

/** The results grid's columns (docs/design/brand-direction-one.md §7): two on phones, then three, then four. */
export const RESULTS_GRID =
  "grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 lg:gap-x-8";

/**
 * A list of events as a grid of image-first tiles (/events, /search,
 * /saved), every event exactly once, in the order given. The tiles rise in,
 * a row at a time, as they scroll into view (RevealObserver; not under
 * reduced motion).
 */
export default function EventResults({ events }: { events: SheltuhEvent[] }) {
  return (
    <ul aria-label="Events" data-reveal-stagger className={RESULTS_GRID}>
      {events.map((event) => (
        <li key={event.id} className="flex min-w-0">
          <EventTile event={event} className="w-full" />
        </li>
      ))}
    </ul>
  );
}
