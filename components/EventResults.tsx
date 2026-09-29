import EventTile from "@/components/ui/EventTile";
import Carousel, { CarouselItem } from "@/components/ui/Carousel";
import type { SheltuhEvent } from "@/lib/types";

const CAROUSEL_COUNT = 24;

/**
 * Editorial results layout: the first few events lead in a horizontal
 * carousel; anything beyond that (later pages, "load more") flows into a
 * roomy grid beneath. Every event renders exactly once.
 */
export default function EventResults({ events }: { events: SheltuhEvent[] }) {
  const lead = events.slice(0, CAROUSEL_COUNT);
  const rest = events.slice(CAROUSEL_COUNT);

  return (
    <div className="flex flex-col gap-14">
      {/* key: a different set of events (a filter change) starts a fresh carousel, so its
          arrows and drift position never refer to the previous set. */}
      <Carousel key={lead.map((event) => event.id).join(",")} label="Events" autoScroll>
        {lead.map((event) => (
          <CarouselItem key={event.id}>
            <EventTile event={event} />
          </CarouselItem>
        ))}
      </Carousel>
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">
          {rest.map((event) => (
            <EventTile key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
