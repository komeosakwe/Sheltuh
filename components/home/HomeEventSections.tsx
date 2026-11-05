"use client";

import { useEffect, useRef, useState } from "react";
import DotsMark from "@/components/brand/DotsMark";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RESULTS_GRID } from "@/components/EventResults";
import EventCard, { EventCardPlaceholder } from "@/components/ui/EventCard";
import { Notice } from "@/components/ui/Section";
import { useIsPhone } from "@/components/ui/useIsPhone";
import { formatWeekendRange, popularTitle, type HomeSections, type TrendingSignal } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import { useHomeEvents } from "./HomeEventsProvider";
import { HOME_CONTAINER, HomeRailItem, RAIL_SKELETON } from "./HomeRail";
import HomeGridSection, { HomeGridItem } from "./HomeGridSection";
import HomeRailSection from "./HomeRailSection";

/** The page's one load error (docs/design/mobile-redesign.md §6.3.4). */
export const HOME_LOAD_ERROR = "Couldn’t load events. Check your connection and try again.";

/** Every home section's spacing, the first after the category row included (Refinement, 22 Oct 2026: tighter). */
const SECTION = "mt-6 sm:mt-10 lg:mt-8";

/**
 * The home's event sections below the hero (docs/design/mobile-redesign.md
 * §6.3), in order: This weekend, From organisers you follow (signed-in
 * members who follow someone, when any of their events are left to show),
 * then Popular right now (real trending data), titled "Coming up" when that's
 * too thin to fill it ("Coming up across Australia" when a state is saved and
 * none of them is in it), then "Recently on" (events that ended in the last
 * 14 days: marked "Ended", nothing to buy; it fills a young marketplace's page). A weekend with nothing on is left out, so the few
 * events a young marketplace has always show. Each event appears once on the page (the provider's
 * sections are already de-duplicated). A section with no cards renders
 * nothing, and a section's link shows only beside cards.
 * From 640px every card is the `rail` EventCard, and every section is visible from the
 * start: nothing waits for a scroll to appear. Each section's head sits in
 * the page column and its cards run full width as a horizontal rail at
 * every width (`HomeRailSection`, `HomeRail`), so the caller places this
 * outside the page column. From 640px the cards are 224px wide (256px from
 * 1280px; from 768px they follow the screen, so three whole cards and part of a
 * fourth show at 768, four and part of a fifth at 1024).
 *
 * Below 640px (Tailwind `sm`) the rails give way to the same sections as
 * two-column grids of `grid` EventCards, as /events has (`HomeGridSection`;
 * 12px between columns; the first row's photos load at once, the rest
 * lazily). That is chosen in the browser (`useIsPhone`; the server and the
 * first render are not a phone), but the loading skeleton is CSS (`sm:hidden`
 * / `hidden sm:block`), so a phone never paints the rails' skeleton. The
 * loading skeleton (a grid of card placeholders on phones), the error and the
 * empty state are otherwise the same.
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
  const specs = sections ? sectionSpecs(sections) : [];
  const phone = useIsPhone();
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
        <>
          <div aria-hidden="true" className={`hidden sm:block ${SECTION}`}>
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
          {/* Phones: two columns of card placeholders. */}
          <div aria-hidden="true" data-home-grid-loading="" className={`${SECTION} sm:hidden`}>
            <div className={HOME_CONTAINER}>
              <div className="mb-3 h-6 w-40 bg-surface" />
              <div className={RESULTS_GRID}>
                {Array.from({ length: 4 }, (_, i) => (
                  <EventCardPlaceholder key={i} variant="grid" />
                ))}
              </div>
            </div>
          </div>
        </>
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

      {sections && !sections.anyUpcoming && sections.recent.length === 0 && <HomeEmpty />}

      {specs.map((spec, s) => {
        const cards = spec.cards.map(({ event, signal }, i) =>
          phone ? (
            <HomeGridItem key={event.id}>
              {/* The first row (two cards) loads at once; everything below it lazily. */}
              <EventCard event={event} variant="grid" mode={mode} signal={signal} now={now} priority={s === 0 && i < 2} />
            </HomeGridItem>
          ) : (
            <HomeRailItem key={event.id}>
              <EventCard event={event} variant="rail" mode={mode} signal={signal} now={now} />
            </HomeRailItem>
          ),
        );
        return phone ? (
          <HomeGridSection key={spec.id} id={spec.id} title={spec.title} note={spec.note} link={spec.link} className={SECTION}>
            {cards}
          </HomeGridSection>
        ) : (
          <HomeRailSection key={spec.id} id={spec.id} title={spec.title} note={spec.note} link={spec.link} count={spec.cards.length} className={SECTION}>
            {cards}
          </HomeRailSection>
        );
      })}
    </div>
  );
}

interface SectionSpec {
  id: string;
  title: string;
  note?: string;
  link: { href: string; label?: string; srLabel?: string };
  cards: { event: SheltuhEvent; signal?: TrendingSignal }[];
}

/** The sections with cards, in page order (a section with none is left out). */
function sectionSpecs(sections: HomeSections): SectionSpec[] {
  const { weekend, following, popular, recent } = sections;
  const plain = (events: SheltuhEvent[]) => events.map((event) => ({ event }));
  const specs: SectionSpec[] = [];
  if (weekend.status === "cards") {
    specs.push({
      id: "home-weekend",
      title: "This weekend",
      note: formatWeekendRange(weekend.window),
      // /events isn't filtered to the weekend, so the link says where it goes.
      link: { href: "/events", label: "All events" },
      cards: plain(weekend.items),
    });
  }
  if (following.length > 0) {
    specs.push({
      id: "home-following",
      title: "From organisers you follow",
      link: { href: "/following", srLabel: "organisers you follow" },
      cards: plain(following),
    });
  }
  if (popular) {
    specs.push({
      id: "home-popular",
      title: popularTitle(popular),
      // Nor sorted by popularity: "All events", as This weekend.
      link: { href: "/events", label: "All events" },
      cards: popular.kind === "popular" ? popular.items : plain(popular.items),
    });
  }
  if (recent.length > 0) {
    // Last, after everything upcoming: these have ended (their cards say "Ended" and have no ticket action).
    specs.push({ id: "home-recent", title: "Recently on", link: { href: "/events", label: "All events" }, cards: plain(recent) });
  }
  return specs;
}

/** "No events yet." and the way to the full list (the page's empty state). */
function HomeEmpty() {
  return (
    <div className={`${HOME_CONTAINER} ${SECTION}`}>
      <div data-home-empty="" tabIndex={-1} className="rounded-card bg-surface p-5 sm:p-8">
        <DotsMark size="lg" className="text-foreground" />
        <p className="mt-6 text-base leading-6">No events yet.</p>
        <ButtonLink href="/events" variant="outline" size="lg" className="mt-3">
          All events
        </ButtonLink>
      </div>
    </div>
  );
}
