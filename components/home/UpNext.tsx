"use client";

import DotsMark from "@/components/brand/DotsMark";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import FeaturedEventCard, { FEATURED_BOX, FeaturedEventCardPlaceholder } from "./FeaturedEventCard";
import { useHomeEvents } from "./HomeEventsProvider";
import QuickBuyLink from "./QuickBuyLink";

/**
 * The hero's "Up next" slot (docs/design/home.md §5.5). Every state keeps the
 * featured card's box, so loading, an error or an empty site shift nothing.
 * The page's one load error lives here, with Try again.
 */
export default function UpNext() {
  const { mode, state, retry } = useHomeEvents();
  const upNext = state.status === "ready" ? state.sections.upNext : undefined;

  return (
    <section aria-labelledby="home-next">
      <h2 id="home-next" className="sr-only">
        Up next
      </h2>
      {state.status === "loading" && <FeaturedEventCardPlaceholder />}
      {state.status === "error" && (
        <div className={`flex flex-col justify-end bg-surface p-5 sm:p-8 ${FEATURED_BOX}`}>
          <Notice tone="danger" role="alert">
            Couldn’t load events.
          </Notice>
          <Button variant="outline" size="lg" className="mt-3 self-start" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
      {state.status === "ready" && !upNext && (
        <div className={`flex flex-col justify-end bg-surface p-5 sm:p-8 ${FEATURED_BOX}`}>
          <DotsMark size="lg" className="text-foreground" />
          <p className="mt-6 text-base leading-6">No events have been published yet. Check back soon.</p>
        </div>
      )}
      {upNext && (
        <>
          <FeaturedEventCard event={upNext} mode={mode} />
          <QuickBuyLink event={upNext} mode={mode} className="mt-1" />
        </>
      )}
    </section>
  );
}
