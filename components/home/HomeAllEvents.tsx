"use client";

import { useEffect, useRef, useState } from "react";
import EventCard from "@/components/ui/EventCard";
import FilterDropdown from "@/components/ui/FilterDropdown";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Section";
import { useIsPhone } from "@/components/ui/useIsPhone";
import {
  hasHomeFilters,
  HOME_DATE_OPTIONS,
  HOME_PRICE_OPTIONS,
  matchesHomeFilters,
  NO_HOME_FILTERS,
  type HomeCategoryFilter,
  type HomeDateFilter,
  type HomeFilters,
  type HomePriceFilter,
} from "@/lib/home-filters";
import type { TrendingSignal } from "@/lib/home-sections";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";
import HomeSectionHead from "./HomeSectionHead";

/**
 * The home's card grid (the rules' Layout board): one column on phones, two from 640px, three
 * from 1024px and four from 1280px, so a card is never narrower than its foot needs to sit on one
 * line (who's going and the price label: 16rem): 304px at 1440 (1312px of content, 32px gutters),
 * 280px at 1280, 298px at 1024 and 340px at 768. Gutters 16 / 24 / 32px, rows 32px apart.
 */
export const HOME_GRID = "grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 md:gap-x-6 lg:grid-cols-3 lg:gap-x-8 xl:grid-cols-4";

/** Cards shown at first, and how many more each "Show more events" adds: two rows of four… */
export const ALL_EVENTS_PAGE = 8;
/** …and four on a phone's single column (the owner's 390 mock). */
export const ALL_EVENTS_PAGE_PHONE = 4;

const NO_MATCH = "No events match your filters";
/** How long after clearing the status the new count is set (so a repeat is announced). */
const ANNOUNCE_DELAY_MS = 100;

/**
 * All events (the proposal, redesign PR 3): every upcoming event the home loaded, soonest first
 * (the saved suburb's state first), as a grid of the one EventCard, with the filters the loaded
 * events can answer: Price, Category and Date (FilterDropdown; Distance, Accessibility and Sort
 * are deferred). The category chips above set the same filters (`filters` lives in the parent).
 * It shows ALL_EVENTS_PAGE cards (ALL_EVENTS_PAGE_PHONE on a phone), then "Show more events" adds as many again, moving focus to the
 * first new card's link so a keyboard user carries on from there. The home loads up to its own
 * limit, so "See all events" always leads to the full list (/events), in the head and, once
 * everything loaded is shown without it being every event, at the bottom too. The note gives the
 * count only when it's the whole number (`complete`: the API returns no total), else "Across
 * Australia". A filter change is announced ("5 events match"); with no match, the empty state.
 * Reset filters (either) clears them and moves focus to the section's heading. The filters are
 * one sideways row on phones.
 */
export default function HomeAllEvents({
  id,
  events,
  signals = {},
  complete,
  mode,
  now,
  filters,
  onFiltersChange,
  className = "",
}: {
  /** The section's id: the h2 is `${id}-title`; the chips' aria-controls point at the section. */
  id: string;
  events: SheltuhEvent[];
  /** The trending signals the page has, by event id: a card's real going count comes only from these. */
  signals?: Readonly<Record<string, TrendingSignal>>;
  complete: boolean;
  mode: "demo" | "live";
  now: Date;
  filters: HomeFilters;
  onFiltersChange: (next: HomeFilters) => void;
  className?: string;
}) {
  const titleId = `${id}-title`;
  const listRef = useRef<HTMLUListElement>(null);
  const pageSize = useIsPhone() ? ALL_EVENTS_PAGE_PHONE : ALL_EVENTS_PAGE;
  const [pages, setPages] = useState(1);
  /** After Show more: the index of the first new card, whose link takes focus once it's rendered. */
  const focusFrom = useRef<number | null>(null);
  // A filter change starts the list again from the first page, and is announced: the status is
  // cleared first, then set a moment later, so the same count twice in a row is still read out.
  const [announcement, setAnnouncement] = useState("");
  const [changes, setChanges] = useState(0);
  const [lastFilters, setLastFilters] = useState(filters);
  if (lastFilters !== filters) {
    setLastFilters(filters);
    setPages(1);
    setAnnouncement("");
    setChanges((n) => n + 1);
  }

  const matches = events.filter((event) => matchesHomeFilters(event, filters, now));
  const matchMessage = `${matches.length} ${matches.length === 1 ? "event matches" : "events match"}`;
  useEffect(() => {
    if (changes === 0) return;
    const timer = setTimeout(() => setAnnouncement(matchMessage), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [changes, matchMessage]);
  const visible = matches.slice(0, pages * pageSize);
  const filtered = hasHomeFilters(filters);
  const note = complete ? `${matches.length} upcoming · Across Australia` : "Across Australia";

  useEffect(() => {
    const index = focusFrom.current;
    if (index === null) return;
    focusFrom.current = null;
    listRef.current?.children[index]?.querySelector<HTMLElement>("[data-card-link]")?.focus();
  }, [pages]);

  /** Clears every filter and moves focus to the section's heading (the button it was on may go). */
  function reset() {
    onFiltersChange(NO_HOME_FILTERS);
    document.getElementById(titleId)?.focus();
  }

  function showMore() {
    focusFrom.current = visible.length;
    setPages((n) => n + 1);
  }

  return (
    <section id={id} aria-labelledby={titleId} data-home-section="" className={className}>
      <HomeSectionHead id={titleId} title="All events" note={note} link={{ href: "/events", label: "See all events" }} />
      {/* One sideways row on phones (a filter sheet is Batch 2), wrapping from 640px. */}
      <form
        aria-label="Filter events"
        className="no-scrollbar -mx-4 flex flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain px-4 py-1 sm:mx-0 sm:flex-wrap sm:gap-4 sm:overflow-visible sm:px-0"
        onSubmit={(event) => event.preventDefault()}
      >
        <FilterDropdown
          label="Price"
          active={filters.price !== "all"}
          value={filters.price}
          onChange={(event) => onFiltersChange({ ...filters, price: event.target.value as HomePriceFilter })}
        >
          {HOME_PRICE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FilterDropdown>
        <FilterDropdown
          label="Category"
          active={filters.category !== "all"}
          value={filters.category}
          onChange={(event) => onFiltersChange({ ...filters, category: event.target.value as HomeCategoryFilter })}
        >
          <option value="all">All categories</option>
          {EVENT_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </FilterDropdown>
        <FilterDropdown
          label="Date"
          active={filters.date !== "all"}
          value={filters.date}
          onChange={(event) => onFiltersChange({ ...filters, date: event.target.value as HomeDateFilter })}
        >
          {HOME_DATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FilterDropdown>
        {filtered && (
          <button
            type="button"
            onClick={reset}
            className="label-button min-h-12 shrink-0 px-2 underline underline-offset-4"
          >
            Reset filters
          </button>
        )}
      </form>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {matches.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={NO_MATCH}
            action={<Button onClick={reset}>Reset filters</Button>}
          />
        </div>
      ) : (
        <ul ref={listRef} aria-labelledby={titleId} className={`mt-8 ${HOME_GRID}`}>
          {visible.map((event) => (
            <li key={event.id} className="flex min-w-0">
              <EventCard event={event} mode={mode} signal={signals[event.id]} now={now} />
            </li>
          ))}
        </ul>
      )}
      {matches.length > visible.length ? (
        <div className="mt-12 flex justify-center">
          <Button variant="outline" onClick={showMore}>
            Show more events
          </Button>
        </div>
      ) : (
        // Everything loaded is shown, but the home didn't load every event: the way to the rest.
        !complete && (
          <div className="mt-12 flex justify-center">
            <ButtonLink href="/events" variant="outline">
              See all events
            </ButtonLink>
          </div>
        )
      )}
    </section>
  );
}
