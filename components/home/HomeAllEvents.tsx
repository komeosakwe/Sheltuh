"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import EventCard from "@/components/ui/EventCard";
import FilterDropdown from "@/components/ui/FilterDropdown";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Section";
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
  seeAllEventsLink,
} from "@/lib/home-filters";
import type { TrendingSignal } from "@/lib/home-sections";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";
import HomeSectionHead from "./HomeSectionHead";
import { ArrowRightIcon } from "./icons";

/**
 * The home's card grid (the rules' Layout board, Round 2 §1.2): one column below 768px, two from
 * 768px, three from 1024px and four from 1280px, so a card is never narrower than its foot needs to
 * sit on one line (who's going and the price label: 16rem): 304px at 1440 (1312px of content, 32px
 * gutters), 264px at 1280 (64px margins), 298px at 1024 and 340px at 768. Gutters 16 / 24 / 32px,
 * rows 32px apart.
 */
export const HOME_GRID = "grid grid-cols-1 gap-x-4 gap-y-8 md:grid-cols-2 md:gap-x-6 lg:grid-cols-3 lg:gap-x-8 xl:grid-cols-4";

/** Cards shown, always whole rows of HOME_GRID: two rows of four from 1280px… */
export const ALL_EVENTS_PAGE = 8;
/** …two rows of three from 1024px, and three rows of two from 768px… */
export const ALL_EVENTS_PAGE_MD = 6;
/** …and four in the single column below 768px (the owner's 390 mock). */
export const ALL_EVENTS_PAGE_PHONE = 4;

/** Below HOME_GRID's two columns (md, 768px), and below its four (xl, 1280px). */
const SINGLE_COLUMN_QUERY = "(max-width: 47.99rem)";
const BELOW_FOUR_COLUMNS_QUERY = "(max-width: 79.99rem)";

function subscribePageSize(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const queries = [SINGLE_COLUMN_QUERY, BELOW_FOUR_COLUMNS_QUERY].map((query) => window.matchMedia(query));
  for (const mql of queries) mql.addEventListener("change", onChange);
  return () => {
    for (const mql of queries) mql.removeEventListener("change", onChange);
  };
}
/** Without matchMedia (jsdom), the widest page. */
function pageSizeSnapshot(): number {
  if (typeof window.matchMedia !== "function") return ALL_EVENTS_PAGE;
  if (window.matchMedia(SINGLE_COLUMN_QUERY).matches) return ALL_EVENTS_PAGE_PHONE;
  if (window.matchMedia(BELOW_FOUR_COLUMNS_QUERY).matches) return ALL_EVENTS_PAGE_MD;
  return ALL_EVENTS_PAGE;
}
/** The server (and hydration) render the widest page; the real size follows straight after. */
const serverPageSize = () => ALL_EVENTS_PAGE;

/** How many cards fill whole rows of HOME_GRID at the current width, kept current as it resizes. */
function useAllEventsPageSize(): number {
  return useSyncExternalStore(subscribePageSize, pageSizeSnapshot, serverPageSize);
}

const NO_MATCH = "No events match your filters";
/** When the home didn't load every event: only what's loaded can be said not to match. */
const NO_LOADED_MATCH = "None of the events loaded here match your filters";
/** How long after clearing the status the new count is set (so a repeat is announced). */
const ANNOUNCE_DELAY_MS = 100;

/**
 * All events (the proposal, redesign PR 3): every upcoming event the home loaded, soonest first
 * (the saved suburb's state first), as a grid of the one EventCard, with the filters the loaded
 * events can answer: Price, Category and Date (FilterDropdown; Distance, Accessibility and Sort
 * are deferred). The category chips above set the same filters (`filters` lives in the parent).
 * It shows whole rows of cards (8 from 1280px, 6 from 768px, 4 below), with no paging (Round 2: no
 * "Show more events"): "See all events →" leads to the full list (/events, with the Category and
 * Free filters it shares: seeAllEventsLink), in the head and, when more match than are shown or the
 * home didn't load every event, at the bottom too, where Show more was ("See all live music events"
 * with a category on). The note gives the count only when it's the whole number (`complete`: the API returns
 * no total), and says "Across Australia" only when no state is saved (`stateSaved`: the list is
 * then that state's first, so it isn't simply Australia-wide). A filter change is announced ("5
 * events match"); with no match, the empty state.
 * Neither claims more than the loaded events when they aren't every event ("2 of the loaded events
 * match"; the empty state then says so and links to the full list).
 * Reset filters (either) clears them and moves focus to the section's heading. The filters are
 * one sideways row on phones.
 */
export default function HomeAllEvents({
  id,
  events,
  signals = {},
  complete,
  stateSaved = false,
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
  /** The visitor has a saved suburb with a state, so the list isn't simply "Across Australia". */
  stateSaved?: boolean;
  mode: "demo" | "live";
  now: Date;
  filters: HomeFilters;
  onFiltersChange: (next: HomeFilters) => void;
  className?: string;
}) {
  const titleId = `${id}-title`;
  const pageSize = useAllEventsPageSize();
  // A filter change is announced: the status is cleared first, then set a moment later, so the
  // same count twice in a row is still read out.
  const [announcement, setAnnouncement] = useState("");
  const [changes, setChanges] = useState(0);
  const [lastFilters, setLastFilters] = useState(filters);
  if (lastFilters !== filters) {
    setLastFilters(filters);
    setAnnouncement("");
    setChanges((n) => n + 1);
  }

  const matches = events.filter((event) => matchesHomeFilters(event, filters, now));
  // A count of the loaded events only, when they aren't every event (`complete`): more may match.
  const matchMessage = complete
    ? `${matches.length} ${matches.length === 1 ? "event matches" : "events match"}`
    : `${matches.length} of the loaded events ${matches.length === 1 ? "matches" : "match"}`;
  useEffect(() => {
    if (changes === 0) return;
    const timer = setTimeout(() => setAnnouncement(matchMessage), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [changes, matchMessage]);
  const visible = matches.slice(0, pageSize);
  const filtered = hasHomeFilters(filters);
  const where = stateSaved ? [] : ["Across Australia"];
  const note = [...(complete ? [`${matches.length} upcoming`] : []), ...where].join(" · ") || undefined;
  // The way to the rest, at the bottom: more match than are shown, or the home didn't load every
  // event (the empty state has its own).
  const more = matches.length > visible.length || (!complete && matches.length > 0);
  const seeAll = seeAllEventsLink(filters);

  /** Clears every filter and moves focus to the section's heading (the button it was on may go). */
  function reset() {
    onFiltersChange(NO_HOME_FILTERS);
    document.getElementById(titleId)?.focus();
  }

  return (
    <section id={id} aria-labelledby={titleId} data-home-section="" className={className}>
      <HomeSectionHead id={titleId} title="All events" note={note} link={{ href: seeAll.href, label: "See all events" }} />
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
            title={complete ? NO_MATCH : NO_LOADED_MATCH}
            action={
              <div className="flex flex-wrap gap-4">
                <Button onClick={reset}>Reset filters</Button>
                {!complete && (
                  <ButtonLink href={seeAll.href} variant="outline">
                    {seeAll.label}
                  </ButtonLink>
                )}
              </div>
            }
          >
            {complete ? undefined : "The full list has more events, and some of them may match."}
          </EmptyState>
        </div>
      ) : (
        <ul aria-labelledby={titleId} className={`mt-8 ${HOME_GRID}`}>
          {visible.map((event) => (
            <li key={event.id} className="flex min-w-0">
              <EventCard event={event} mode={mode} signal={signals[event.id]} now={now} />
            </li>
          ))}
        </ul>
      )}
      {more && (
        <div className="mt-8 flex justify-center lg:mt-12">
          <ButtonLink href={seeAll.href} variant="outline" data-all-events-more="">
            {seeAll.label}
            <ArrowRightIcon className="size-4 shrink-0" />
          </ButtonLink>
        </div>
      )}
    </section>
  );
}
