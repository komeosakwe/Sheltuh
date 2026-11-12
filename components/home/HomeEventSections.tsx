"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import DotsMark from "@/components/brand/DotsMark";
import { Button, ButtonLink } from "@/components/ui/Button";
import EventCard, { EventCardPlaceholder } from "@/components/ui/EventCard";
import { Notice } from "@/components/ui/Section";
import { matchesHomeFilters, NO_HOME_FILTERS, type HomeFilters } from "@/lib/home-filters";
import { formatWeekendRange, popularEvents, popularTitle, type HomeSections, type TrendingSignal } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import CategoryRow from "./CategoryRow";
import FeaturedCarousel from "./FeaturedCarousel";
import HomeAllEvents, { HOME_GRID } from "./HomeAllEvents";
import { useHomeEvents } from "./HomeEventsProvider";
import HomeSectionHead from "./HomeSectionHead";

/** The page's one load error (docs/design/mobile-redesign.md §6.3.4). */
export const HOME_LOAD_ERROR = "Couldn’t load events. Check your connection and try again.";

/** All events' section id: the category chips control it. */
export const HOME_ALL_EVENTS_ID = "home-all-events";

/** The space above each event section (the proposal's rhythm: 96px from 1024px, 64px from 768px, 48px on phones). */
const SECTION = "mt-12 md:mt-16 lg:mt-24";

/**
 * This weekend's and From organisers you follow's cards: the home grid from 640px; on a phone a
 * sideways row of 288px cards (the next one peeking in), so the section stays short there.
 */
const ROW =
  "no-scrollbar -mx-4 flex snap-x snap-mandatory gap-x-4 overflow-x-auto overscroll-x-contain scroll-px-4 px-4 py-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-y-8 sm:overflow-visible sm:px-0 sm:py-0 md:gap-x-6 lg:grid-cols-3 lg:gap-x-8 xl:grid-cols-4";
const ROW_ITEM = "flex w-72 min-w-0 shrink-0 snap-start sm:w-auto";

/**
 * The home's event sections under the hero (the proposal, redesign PR 3), in order: the featured
 * carousel (Popular right now from real trending data, else Coming up), the category chips, This
 * weekend, From organisers you follow (signed-in members who follow someone), then All events.
 * The carousel, This weekend and From organisers you follow never repeat an event between them
 * (lib/home-sections.ts claims each once, the carousel first); All events is the full list, with
 * This weekend's events last, so its first page doesn't repeat them.
 * A section with no cards renders nothing.
 *
 * The chips and All events' dropdowns are one set of filters (lib/home-filters.ts): they narrow
 * This weekend, From organisers you follow and All events (not the carousel, which is above the
 * chips); a section with nothing left is hidden, and All events says so with Reset filters.
 *
 * The first slot holds the page's loading skeleton, its one load error (with Try again), or,
 * with nothing upcoming at all, a note saying so. Try again keeps the error (and its focused
 * button, now busy) on screen while it loads; when the events arrive, focus moves to the first
 * section (`data-home-focus`), since the button it was on has gone (only if focus went down with
 * it).
 */
export default function HomeEventSections() {
  const { mode, state, retry } = useHomeEvents();
  const loading = state.status === "loading";
  const retrying = state.status === "error" && state.retrying;
  // Try again keeps the error box on screen (no skeleton), but its load is announced like the first.
  const announceLoading = loading || retrying;
  const ready = state.status === "ready" ? state : null;
  const sections = ready?.sections ?? null;
  const [filters, setFilters] = useState<HomeFilters>(NO_HOME_FILTERS);
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
    rootRef.current?.querySelector<HTMLElement>("[data-home-focus], [data-home-empty]")?.focus();
  }, [state.status]);

  function handleRetry() {
    retried.current = true;
    retry();
  }

  const anyUpcoming = sections?.anyUpcoming ?? false;
  const now = ready?.now ?? new Date();
  const signals = sections ? trendingSignals(sections) : {};
  const pass = (event: SheltuhEvent) => matchesHomeFilters(event, filters, now);

  return (
    <div ref={rootRef} className="page-container">
      {/* Always mounted so "Loading events…" is announced. */}
      <p role="status" className="sr-only">
        {announceLoading ? "Loading events…" : ""}
      </p>

      {loading && <div aria-hidden="true" data-home-loading="" className="mt-8 aspect-[4/5] rounded-card bg-surface sm:aspect-video lg:mt-12 lg:aspect-[5/2]" />}

      {state.status === "error" && (
        <div className="mt-8 rounded-card bg-surface p-4 sm:p-8">
          <Notice key={failures} tone="danger" role="alert">
            {HOME_LOAD_ERROR}
          </Notice>
          <Button variant="outline" size="lg" className="mt-4" busy={retrying} onClick={handleRetry}>
            {retrying ? "Trying again…" : "Try again"}
          </Button>
        </div>
      )}

      {sections && !anyUpcoming && <HomeEmpty />}

      {sections?.popular && ready && (
        <FeaturedCarousel id="home-featured" title={popularTitle(sections.popular)} events={popularEvents(sections.popular)} now={ready.now} className="mt-8 lg:mt-12" />
      )}

      {(loading || anyUpcoming) && (
        <CategoryRow filters={filters} onChange={setFilters} controls={HOME_ALL_EVENTS_ID} className="mt-8 lg:mt-12" />
      )}

      {loading && (
        <div aria-hidden="true" data-home-grid-loading="" className={SECTION}>
          <div className="mb-8 h-10 w-56 max-w-full rounded-badge bg-surface" />
          <div className={HOME_GRID}>
            {Array.from({ length: 4 }, (_, i) => (
              <EventCardPlaceholder key={i} className={i > 0 ? "max-sm:hidden" : ""} />
            ))}
          </div>
        </div>
      )}

      {sections && ready && sections.weekend.status === "cards" && (
        <CardRowSection
          id="home-weekend"
          title="This weekend"
          note={formatWeekendRange(sections.weekend.window)}
          // Nearby's weekend filter: the one listing that has one.
          link={{ href: "/map?time=weekend", label: "See all this weekend" }}
        >
          {sections.weekend.items.filter(pass).map((event, i) => {
            const count = sections.weekend.going[event.id];
            return (
              <li key={event.id} className={ROW_ITEM}>
                <EventCard
                  event={event}
                  mode={mode}
                  signal={count === undefined ? undefined : { kind: "going", count }}
                  now={ready.now}
                  priority={i < 2 && !sections.popular}
                />
              </li>
            );
          })}
        </CardRowSection>
      )}

      {sections && ready && sections.following.length > 0 && (
        <CardRowSection id="home-following" title="From organisers you follow" link={{ href: "/following", label: "See all", srLabel: "organisers you follow" }}>
          {sections.following.filter(pass).map((event) => (
            <li key={event.id} className={ROW_ITEM}>
              <EventCard event={event} mode={mode} signal={signals[event.id]} now={ready.now} />
            </li>
          ))}
        </CardRowSection>
      )}

      {ready && anyUpcoming && (
        <HomeAllEvents
          id={HOME_ALL_EVENTS_ID}
          events={afterWeekend(ready.events, sections)}
          signals={signals}
          complete={ready.complete}
          mode={mode}
          now={ready.now}
          filters={filters}
          onFiltersChange={setFilters}
          className={SECTION}
        />
      )}
    </div>
  );
}

/**
 * All events' order: every upcoming event once, with This weekend's (shown just above) moved to
 * the end, so its first page never repeats them; the count stays the whole number.
 */
function afterWeekend(events: SheltuhEvent[], sections: HomeSections | null): SheltuhEvent[] {
  const weekend = new Set(sections?.weekend.status === "cards" ? sections.weekend.items.map((event) => event.id) : []);
  return [...events.filter((event) => !weekend.has(event.id)), ...events.filter((event) => weekend.has(event.id))];
}

/** The real going counts and qualifiers the page has (trending, and This weekend's), by event id. */
function trendingSignals(sections: HomeSections): Record<string, TrendingSignal> {
  const signals: Record<string, TrendingSignal> = {};
  if (sections.popular?.kind === "popular") for (const { event, signal } of sections.popular.items) signals[event.id] = signal;
  for (const [id, count] of Object.entries(sections.weekend.going)) signals[id] = { kind: "going", count };
  return signals;
}

/** A titled section of cards (This weekend, From organisers you follow), hidden when the filters leave none. */
function CardRowSection({
  id,
  title,
  note,
  link,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  link: { href: string; label: string; srLabel?: string };
  children: ReactNode[];
}) {
  if (children.length === 0) return null;
  return (
    <section aria-labelledby={id} data-home-section="" className={SECTION}>
      <HomeSectionHead id={id} title={title} note={note} link={link} />
      <ul aria-labelledby={id} className={ROW}>
        {children}
      </ul>
    </section>
  );
}

/** "No events yet." and the way to the full list (the page's empty state). */
function HomeEmpty() {
  return (
    <div data-home-empty="" tabIndex={-1} className="mt-8 rounded-card bg-surface p-4 sm:p-8">
      <DotsMark size="lg" className="text-foreground" />
      <p className="mt-6 body-m">No events yet.</p>
      <ButtonLink href="/events" variant="outline" size="lg" className="mt-4">
        All events
      </ButtonLink>
    </div>
  );
}
