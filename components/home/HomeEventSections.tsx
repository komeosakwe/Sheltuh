"use client";

import { useEffect, useRef, useState } from "react";
import DotsMark from "@/components/brand/DotsMark";
import { Button } from "@/components/ui/Button";
import EventCard, { EventCardPlaceholder } from "@/components/ui/EventCard";
import { Notice } from "@/components/ui/Section";
import { formatWeekendRange } from "@/lib/home-sections";
import { useHomeEvents } from "./HomeEventsProvider";
import HomeRail, { HomeRailItem } from "./HomeRail";
import SectionHead from "@/components/ui/SectionHead";

/** The page's one load error (docs/design/mobile-redesign.md §6.3.4). */
export const HOME_LOAD_ERROR = "Couldn’t load events. Check your connection and try again.";

/** Every home section's spacing, the first after the category row included (Refinement, 22 Oct 2026: tighter). */
const SECTION = "mt-6 sm:mt-10 lg:mt-12";

/**
 * The home's event sections below the hero (docs/design/mobile-redesign.md
 * §6.3), in order: This weekend, From organisers you follow (signed-in
 * members who follow someone, when any of their events are left to show),
 * then Popular right now (real trending data), titled "Coming up" when that's
 * too thin to fill it. Each event appears once on the page (the provider's
 * sections are already de-duplicated). A section with no cards renders
 * nothing, and a section's link shows only beside cards.
 * Every card is the `rail` EventCard, and every section is visible from the
 * start: nothing waits for a scroll to appear.
 *
 * The first slot holds the page's loading skeleton, its one load error (with
 * Try again), or, with nothing upcoming at all, a note saying so. Try again
 * keeps the error (and its focused button, now busy) on screen while it
 * loads; when the events arrive, focus moves to the first section's heading,
 * since the button it was on has gone (only if focus went down with it).
 */
export default function HomeEventSections() {
  const { mode, state, retry } = useHomeEvents();
  const loading = state.status === "loading";
  const retrying = state.status === "error" && state.retrying;
  // Try again keeps the error box on screen (no skeleton), but its load is announced like the first.
  const announceLoading = loading || retrying;
  const sections = state.status === "ready" ? state.sections : null;
  const now = state.status === "ready" ? state.now : undefined;
  const weekend = sections?.anyUpcoming && sections.weekend.status !== "hidden" ? sections.weekend : null;
  const popular = sections?.popular ?? null;
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
          <div className="mb-3 h-6 w-40 bg-surface sm:mb-4" />
          <div className="-mx-5 -my-4 flex gap-3 overflow-hidden px-5 py-4 sm:mx-0 sm:my-0 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:px-0 sm:py-0 md:grid-cols-3 lg:grid-cols-4">
            <EventCardPlaceholder variant="rail" />
            <EventCardPlaceholder variant="rail" />
            <EventCardPlaceholder variant="rail" className="hidden md:flex" />
            <EventCardPlaceholder variant="rail" className="hidden lg:flex" />
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
            note={formatWeekendRange(weekend.window)}
            // /events isn't filtered to the weekend, so the link says where it goes.
            link={weekend.status === "cards" ? { href: "/events", label: "All events" } : undefined}
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
            link={{ href: "/following", srLabel: "organisers you follow" }}
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

      {popular && (
        <section aria-labelledby="home-popular" data-home-section className={SECTION}>
          <SectionHead
            id="home-popular"
            title={popular.kind === "popular" ? "Popular right now" : "Coming up"}
            // Nor sorted by popularity: "All events", as This weekend.
            link={{ href: "/events", label: "All events" }}
          />
          <HomeRail labelledBy="home-popular">
            {popular.kind === "popular"
              ? popular.items.map(({ event, signal }) => (
                  <HomeRailItem key={event.id}>
                    <EventCard event={event} variant="rail" mode={mode} signal={signal} now={now} />
                  </HomeRailItem>
                ))
              : popular.items.map((event) => (
                  <HomeRailItem key={event.id}>
                    <EventCard event={event} variant="rail" mode={mode} now={now} />
                  </HomeRailItem>
                ))}
          </HomeRail>
        </section>
      )}
    </div>
  );
}
