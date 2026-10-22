"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import DotsMark from "@/components/brand/DotsMark";
import { Button } from "@/components/ui/Button";
import EventCard, { EventCardPlaceholder } from "@/components/ui/EventCard";
import { Notice } from "@/components/ui/Section";
import { formatWeekendRange } from "@/lib/home-sections";
import { useHomeEvents } from "./HomeEventsProvider";
import HomeRail, { HomeRailItem } from "./HomeRail";
import SectionHead from "./SectionHead";

/** The page's one load error (docs/design/mobile-redesign.md §6.3.4). */
export const HOME_LOAD_ERROR = "Couldn’t load events. Check your connection and try again.";

/** Every home section's spacing, the first after the hero included. */
const SECTION = "mt-8 sm:mt-12 lg:mt-16";

/**
 * The home's event sections below the hero (docs/design/mobile-redesign.md
 * §6.3), in order: This weekend, From organisers you follow (signed-in
 * members who follow someone, when any of their events are left to show),
 * Trending, Coming up near you, the static `guide` slot, then Free &
 * low-cost. Each event appears once on the page (the provider's sections are
 * already de-duplicated). A section with too few events renders nothing.
 * Every card is the `rail` EventCard, and every section is visible from the
 * start: nothing waits for a scroll to appear.
 *
 * The first slot holds the page's loading skeleton, its one load error (with
 * Try again), or, with nothing upcoming at all, a note saying so. Try again
 * keeps the error (and its focused button, now busy) on screen while it
 * loads; when the events arrive, focus moves to the first section's heading,
 * since the button it was on has gone (only if focus went down with it).
 */
export default function HomeEventSections({ guide }: { guide?: ReactNode }) {
  const { mode, state, retry } = useHomeEvents();
  const loading = state.status === "loading";
  const retrying = state.status === "error" && state.retrying;
  // Try again keeps the error box on screen (no skeleton), but its load is announced like the first.
  const announceLoading = loading || retrying;
  const sections = state.status === "ready" ? state.sections : null;
  const now = state.status === "ready" ? state.now : undefined;
  const weekend = sections?.anyUpcoming && sections.weekend.status !== "hidden" ? sections.weekend : null;
  const rootRef = useRef<HTMLDivElement>(null);
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
    if (active && active !== document.body) return;
    rootRef.current?.querySelector<HTMLElement>("[data-home-section] h2, [data-home-empty]")?.focus();
  }, [state.status]);

  function handleRetry() {
    retried.current = true;
    retry();
  }

  return (
    <div ref={rootRef}>
      {/* Always mounted so "Loading events…" is announced. */}
      <p role="status" className="sr-only">
        {announceLoading ? "Loading events…" : ""}
      </p>

      {loading && (
        <div aria-hidden="true" className={SECTION}>
          <div className="border-t border-foreground pt-3">
            <div className="mb-3 h-6 w-40 bg-surface sm:mb-5" />
          </div>
          <div className="-mx-5 -my-4 flex gap-3 overflow-hidden px-5 py-4 sm:mx-0 sm:my-0 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:px-0 sm:py-0 md:grid-cols-3">
            <EventCardPlaceholder variant="rail" />
            <EventCardPlaceholder variant="rail" />
            <EventCardPlaceholder variant="rail" className="hidden md:flex" />
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className={`${SECTION} rounded-card bg-surface p-5 sm:p-8`}>
          <Notice key={failures} tone="danger" role="alert">
            {HOME_LOAD_ERROR}
          </Notice>
          <Button variant="outline" size="lg" className="mt-3" busy={retrying} onClick={handleRetry}>
            {retrying ? "Trying again…" : "Try again"}
          </Button>
        </div>
      )}

      {sections && !sections.anyUpcoming && (
        <div data-home-empty="" tabIndex={-1} className={`${SECTION} rounded-card bg-surface p-5 sm:p-8`}>
          <DotsMark size="lg" className="text-foreground" />
          <p className="mt-6 text-base leading-6">No events have been published yet. Check back soon.</p>
        </div>
      )}

      {weekend && (
        <section aria-labelledby="home-weekend" data-home-section className={SECTION}>
          <SectionHead
            id="home-weekend"
            title="This weekend"
            note={{ text: formatWeekendRange(weekend.window) }}
            seeAll={{ href: "/events", srLabel: "events" }}
          />
          {weekend.status === "cards" ? (
            <HomeRail labelledBy="home-weekend">
              {weekend.items.map((event) => (
                <HomeRailItem key={event.id}>
                  <EventCard event={event} variant="rail" mode={mode} now={now} />
                </HomeRailItem>
              ))}
            </HomeRail>
          ) : (
            <p className="text-sm leading-5 text-muted">
              Nothing listed for this weekend yet. New events are added through the week.
            </p>
          )}
        </section>
      )}

      {sections && sections.following.length > 0 && (
        <section aria-labelledby="home-following" data-home-section className={SECTION}>
          <SectionHead
            id="home-following"
            title="From organisers you follow"
            strap="Following"
            seeAll={{ href: "/following", srLabel: "organisers you follow" }}
          />
          <HomeRail labelledBy="home-following">
            {sections.following.map((event) => (
              <HomeRailItem key={event.id}>
                <EventCard event={event} variant="rail" mode={mode} now={now} />
              </HomeRailItem>
            ))}
          </HomeRail>
        </section>
      )}

      {sections && sections.trending.length > 0 && (
        <section aria-labelledby="home-trending" data-home-section className={SECTION}>
          <SectionHead id="home-trending" title="Trending" />
          <HomeRail labelledBy="home-trending">
            {sections.trending.map(({ event, signal }) => (
              <HomeRailItem key={event.id}>
                <EventCard event={event} variant="rail" mode={mode} signal={signal} now={now} />
              </HomeRailItem>
            ))}
          </HomeRail>
        </section>
      )}

      {sections && sections.comingUp.length > 0 && (
        <section aria-labelledby="home-coming" data-home-section className={SECTION}>
          <SectionHead
            id="home-coming"
            title="Coming up near you"
            strap="Coming up"
            seeAll={{ href: "/events", srLabel: "events" }}
          />
          <p className="hidden max-w-xl text-sm leading-5 text-muted sm:-mt-3 sm:mb-6 sm:block">
            The most interesting live music, art, workshops and pop-ups in your city — curated, not scraped.
          </p>
          <HomeRail labelledBy="home-coming">
            {sections.comingUp.map((event) => (
              <HomeRailItem key={event.id}>
                <EventCard event={event} variant="rail" mode={mode} now={now} />
              </HomeRailItem>
            ))}
          </HomeRail>
        </section>
      )}

      {guide}

      {sections && sections.lowCost.length > 0 && (
        <section aria-labelledby="home-free" data-home-section className={SECTION}>
          <SectionHead
            id="home-free"
            title="Free & low-cost"
            seeAll={{ href: "/events?pricing=free", srLabel: "free events" }}
          />
          <HomeRail labelledBy="home-free">
            {sections.lowCost.map(({ event, badge }) => (
              <HomeRailItem key={event.id}>
                <EventCard event={event} variant="rail" mode={mode} badge={badge} now={now} />
              </HomeRailItem>
            ))}
          </HomeRail>
        </section>
      )}
    </div>
  );
}
