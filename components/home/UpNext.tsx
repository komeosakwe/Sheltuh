"use client";

import { useEffect, useRef, useState } from "react";
import DotsMark from "@/components/brand/DotsMark";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import FeaturedEventCard, { FEATURED_BOX, FeaturedEventCardPlaceholder } from "./FeaturedEventCard";
import { useHomeEvents } from "./HomeEventsProvider";
import QuickBuyLink from "./QuickBuyLink";

/** The page's one load error (docs/design/home.md §5.5). */
export const HOME_LOAD_ERROR = "Couldn’t load events. Check your connection and try again.";

/**
 * The hero's "Up next" slot (docs/design/home.md §5.5). Every state keeps the
 * featured card's box, so loading, an error or an empty site shift nothing.
 * The page's one load error lives here, with Try again.
 *
 * Try again keeps the error box (and the focused button, now busy) on screen
 * while it loads. When the events arrive, focus moves to this section's
 * heading, since the button it was on has gone; if it fails again, the alert
 * is announced again.
 */
export default function UpNext() {
  const { mode, state, retry } = useHomeEvents();
  const upNext = state.status === "ready" ? state.sections.upNext : undefined;
  const retrying = state.status === "error" && state.retrying;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retried = useRef(false);

  // A failed retry re-mounts the alert, so it's announced again.
  const [wasRetrying, setWasRetrying] = useState(retrying);
  const [failures, setFailures] = useState(0);
  if (wasRetrying !== retrying) {
    setWasRetrying(retrying);
    if (!retrying && state.status === "error") setFailures((n) => n + 1);
  }

  useEffect(() => {
    if (state.status !== "ready" || !retried.current) return;
    retried.current = false;
    // Only when focus went down with the button: never pull it from where the visitor moved it.
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, [state.status]);

  function handleRetry() {
    retried.current = true;
    retry();
  }

  return (
    <section aria-labelledby="home-next">
      <h2 id="home-next" ref={headingRef} tabIndex={-1} className="sr-only">
        Up next
      </h2>
      {state.status === "loading" && <FeaturedEventCardPlaceholder />}
      {state.status === "error" && (
        <div className={`flex flex-col justify-end bg-surface p-5 sm:p-8 ${FEATURED_BOX}`}>
          <Notice key={failures} tone="danger" role="alert">
            {HOME_LOAD_ERROR}
          </Notice>
          <Button variant="outline" size="lg" className="mt-3 self-start" busy={retrying} onClick={handleRetry}>
            {retrying ? "Trying again…" : "Try again"}
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
          <QuickBuyLink event={upNext} mode={mode} className="mt-3" />
        </>
      )}
    </section>
  );
}
