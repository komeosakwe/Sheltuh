import type { Ref } from "react";
import EventCard from "@/components/ui/EventCard";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The results grid (the rules' Layout board): two columns on phones and tablets, four from 1024px,
 * with the rules' gutters (16px, 24px from 768px, 32px from 1024px). Rows are 32px apart, so a
 * card's 8px hover panel never meets its neighbour's.
 */
export const RESULTS_GRID = "grid grid-cols-2 gap-x-4 gap-y-8 md:gap-x-6 lg:grid-cols-4 lg:gap-x-8";

/**
 * A list of events as a grid of image-first cards (/events, /search,
 * /saved), every event exactly once, in the order given. Every card is
 * visible from the start: nothing waits for a scroll to appear.
 *
 * `heading`: a visually hidden h2 above the grid, for pages whose grid has
 * no visible section heading, so the cards' h3 titles sit under an h2
 * rather than straight under the page's h1 (/events, /search).
 */
export default function EventResults({
  events,
  heading,
  label = "Events",
  listRef,
}: {
  events: SheltuhEvent[];
  heading?: string;
  /** The list's name; `null` for none, where a visible heading right above already names it (/search near a suburb). */
  label?: string | null;
  listRef?: Ref<HTMLUListElement>;
}) {
  const list = (
    <ul ref={listRef} aria-label={label ?? undefined} className={RESULTS_GRID}>
      {events.map((event) => (
        <li key={event.id} className="flex min-w-0">
          <EventCard event={event} variant="grid" />
        </li>
      ))}
    </ul>
  );
  if (!heading) return list;
  return (
    <>
      <h2 className="sr-only">{heading}</h2>
      {list}
    </>
  );
}
