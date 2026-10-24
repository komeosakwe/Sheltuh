"use client";

import { useEffect, useRef, useState } from "react";
import DotsMark from "@/components/brand/DotsMark";
import { Button } from "@/components/ui/Button";
import EventCard, { EventCardPlaceholder } from "@/components/ui/EventCard";
import { Notice } from "@/components/ui/Section";
import { formatWeekendRange } from "@/lib/home-sections";
import { titleText, WEEKEND_TITLE } from "./home-content";
import { useHomeEvents } from "./HomeEventsProvider";
import { HOME_CONTAINER, HomeRailItem, isPairRail, RAIL_SKELETON } from "./HomeRail";
import HomeRailSection from "./HomeRailSection";

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
 * start: nothing waits for a scroll to appear. Each section's head sits in
 * the page column and its cards run full width as a horizontal rail at
 * every width (`HomeRailSection`, `HomeRail`), so the caller places this
 * outside the page column. A section of one or two cards is a pair: a
 * two-column grid of wide cards from 1024px (`isPairRail`, EventCard `wide`).
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
          <div className={HOME_CONTAINER}>
            <div className="mb-3 h-6 w-40 bg-surface sm:mb-4" />
          </div>
          {/* As many as the widest screen shows; the row clips the rest. */}
          <div className={RAIL_SKELETON}>
            {Array.from({ length: 6 }, (_, i) => (
              <EventCardPlaceholder key={i} variant="rail" />
            ))}
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className={`${HOME_CONTAINER} ${SECTION}`}>
          <div className="rounded-card bg-surface p-5 sm:p-8">
            <Notice key={failures} tone="danger" role="alert">
              {HOME_LOAD_ERROR}
            </Notice>
            <Button variant="outline" size="lg" className="mt-3" busy={retrying} onClick={handleRetry}>
              {retrying ? "Trying again…" : "Try again"}
            </Button>
          </div>
        </div>
      )}

      {sections && !sections.anyUpcoming && (
        <div className={`${HOME_CONTAINER} ${SECTION}`}>
          <div data-home-empty="" tabIndex={-1} className="rounded-card bg-surface p-5 sm:p-8">
            <DotsMark size="lg" className="text-foreground" />
            <p className="mt-6 text-base leading-6">No events have been published yet. Check back soon.</p>
          </div>
        </div>
      )}

      {weekend && (
        <HomeRailSection
          id="home-weekend"
          title={titleText(WEEKEND_TITLE)}
          dottedTitle={WEEKEND_TITLE}
          note={formatWeekendRange(weekend.window)}
          // /events isn't filtered to the weekend, so the link says where it goes.
          link={weekend.status === "cards" ? { href: "/events", label: "All events" } : undefined}
          count={weekend.status === "cards" ? weekend.items.length : 0}
          empty={
            weekend.status === "cards" ? undefined : (
              <p className="text-sm leading-5 text-muted">
                Nothing listed for this weekend yet. New events are added through the week.
              </p>
            )
          }
          className={SECTION}
        >
          {weekend.status === "cards" &&
            weekend.items.map((event) => (
              <HomeRailItem key={event.id}>
                <EventCard event={event} variant="rail" wide={isPairRail(weekend.items.length)} mode={mode} now={now} />
              </HomeRailItem>
            ))}
        </HomeRailSection>
      )}

      {sections && sections.following.length > 0 && (
        <HomeRailSection
          id="home-following"
          title="From organisers you follow"
          link={{ href: "/following", srLabel: "organisers you follow" }}
          count={sections.following.length}
          className={SECTION}
        >
          {sections.following.map((event) => (
            <HomeRailItem key={event.id}>
              <EventCard event={event} variant="rail" wide={isPairRail(sections.following.length)} mode={mode} now={now} />
            </HomeRailItem>
          ))}
        </HomeRailSection>
      )}

      {popular && (
        <HomeRailSection
          id="home-popular"
          title={popular.kind === "popular" ? "Popular right now" : "Coming up"}
          // Nor sorted by popularity: "All events", as This weekend.
          link={{ href: "/events", label: "All events" }}
          count={popular.items.length}
          className={SECTION}
        >
          {popular.kind === "popular"
            ? popular.items.map(({ event, signal }) => (
                <HomeRailItem key={event.id}>
                  <EventCard event={event} variant="rail" wide={isPairRail(popular.items.length)} mode={mode} signal={signal} now={now} />
                </HomeRailItem>
              ))
            : popular.items.map((event) => (
                <HomeRailItem key={event.id}>
                  <EventCard event={event} variant="rail" wide={isPairRail(popular.items.length)} mode={mode} now={now} />
                </HomeRailItem>
              ))}
        </HomeRailSection>
      )}
    </div>
  );
}
