"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import EventResults from "@/components/EventResults";
import FeedLoading from "@/components/FeedLoading";
import { useLoadingProgress } from "@/components/ui/ProgressLoader";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import EventFilterBar, { type PricingFilter } from "@/components/EventFilterBar";
import NearbyResults, { NEAR_MAX_EVENTS } from "@/components/search/NearbyResults";
import { listPublicEvents, type PublicEvent } from "@/lib/api/public-events";
import type { Locality } from "@/lib/location";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

interface Props {
  categories: { value: EventCategory; label: string }[];
  /** Free-text search (from /search); sent to the API alongside the filters. */
  query?: string;
  /**
   * The suburb from /search?near=, already found in the suburb table (by the
   * page, on the server). Results are ordered by distance from it here in the
   * browser (lib/location.ts); it's never sent to the API.
   */
  near?: Locality;
  /** Starting filters (from /events?category=&pricing=); "Reset filters" still clears to all. */
  initialCategory?: EventCategory | "all";
  initialPricing?: PricingFilter;
}

type Status = "loading" | "loaded" | "error";

// Bounds the "skip past an empty filtered page that still has a cursor"
// loop below, so a pathological run of empty pages can't hang a request.
const MAX_EMPTY_PAGES_TO_SKIP = 10;

// Near a suburb, the soonest NEAR_MAX_EVENTS matches are read (4 pages of the
// API's largest page, the HOME_WEEKEND_TOP_UP_MAX_PAGES precedent) and then
// ordered by distance, so there's no "Load more" in that mode.
const NEAR_PAGE_LIMIT = 50;
const NEAR_MAX_PAGES = NEAR_MAX_EVENTS / NEAR_PAGE_LIMIT;

interface FetchResult {
  items: PublicEvent[];
  nextCursor: string | undefined;
  /** Near mode only: more matched than were read. */
  capped: boolean;
}

/**
 * The live (API-backed) event feed: sends category/date/pricing filters to
 * the API rather than filtering an already-fetched list, and paginates via
 * the API's opaque `nextCursor` instead of ever loading everything at once.
 */
export default function LiveEventFeed({
  categories,
  query,
  near,
  initialCategory = "all",
  initialPricing = "all",
}: Props) {
  const [category, setCategory] = useState<EventCategory | "all">(initialCategory);
  const [pricing, setPricing] = useState<PricingFilter>(initialPricing);
  const [onOrAfter, setOnOrAfter] = useState("");

  const [events, setEvents] = useState<SheltuhEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [capped, setCapped] = useState(false);
  // Near mode reads more up front and has no "Load more"; only whether there's a suburb matters to the fetch.
  const nearMode = near !== undefined;

  // Bumped whenever a new request supersedes any in flight (a filter change,
  // or a fresh "load more" click), so a response that arrives late from an
  // earlier request is discarded instead of overwriting newer results.
  const requestIdRef = useRef(0);

  const hasActiveFilters = category !== "all" || pricing !== "all" || onOrAfter !== "";
  const progress = useLoadingProgress(status === "loading");
  const listRef = useRef<HTMLUListElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  // How many results were showing when "Load more" was pressed, to find the first new one.
  const countBeforeMore = useRef<number | null>(null);
  // This is how many results have loaded so far, not the total number of
  // events in the database — later pages may add more.
  const summary = `Showing ${events.length} event${events.length === 1 ? "" : "s"}${
    hasActiveFilters || query ? " matching your search" : ""
  }`;

  function resetFilters() {
    setCategory("all");
    setPricing("all");
    setOnOrAfter("");
  }

  // Fetches pages from `cursor` onward, skipping past any page that comes
  // back empty but still carries a nextCursor (a filter can legitimately
  // leave a whole page with no matches without the result set being
  // exhausted) until it finds one with items or genuinely runs out.
  const fetchNonEmptyPage = useCallback(
    async (cursor: string | undefined, myRequestId: number): Promise<FetchResult | "stale"> => {
      // The filters only: the suburb (`near`) and any position never go to the API.
      const filters = {
        category: category === "all" ? undefined : category,
        pricing: pricing === "all" ? undefined : pricing,
        onOrAfter: onOrAfter || undefined,
        q: query || undefined,
        // Events that haven't ended, then (after them) ones that ended in the last 2 weeks, which the
        // card marks "Ended". Near mode orders by distance, so it keeps to upcoming events only.
        upcoming: true,
        recent: !nearMode,
      } as const;
      if (nearMode) {
        // Near mode: read the soonest pages, then the results are ordered by distance.
        const items: PublicEvent[] = [];
        const seen = new Set<string>();
        let cur = cursor;
        for (let i = 0; i < NEAR_MAX_PAGES; i++) {
          const page = await listPublicEvents({ ...filters, limit: NEAR_PAGE_LIMIT, cursor: cur });
          if (requestIdRef.current !== myRequestId) return "stale";
          // As "Load more" does: an event can shift across a page boundary between two reads.
          for (const item of page.items) {
            if (seen.has(item.eventId)) continue;
            seen.add(item.eventId);
            items.push(item);
          }
          cur = page.nextCursor;
          if (!cur) break;
        }
        return { items, nextCursor: undefined, capped: cur !== undefined };
      }
      let cur = cursor;
      for (let i = 0; i < MAX_EMPTY_PAGES_TO_SKIP; i++) {
        const page = await listPublicEvents({ ...filters, cursor: cur });
        if (requestIdRef.current !== myRequestId) return "stale";
        if (page.items.length > 0 || !page.nextCursor) {
          return { items: page.items, nextCursor: page.nextCursor, capped: false };
        }
        cur = page.nextCursor;
      }
      return { items: [], nextCursor: cur, capped: false };
    },
    [category, pricing, onOrAfter, query, nearMode],
  );

  const load = useCallback(
    (cursor: string | undefined, replace: boolean) => {
      const myRequestId = requestIdRef.current;
      if (replace) {
        setStatus("loading");
        setEvents([]);
        setNextCursor(undefined);
        // A filter change or retry always supersedes any "load more" that
        // was in flight — without this, that stale request's own guarded
        // finally() would never run, and the button would stay stuck
        // showing "Loading…" after the filters changed out from under it.
        setLoadingMore(false);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      fetchNonEmptyPage(cursor, myRequestId)
        .then((result) => {
          if (result === "stale") return;
          const adapted = result.items.map(adaptPublicEvent);
          setEvents((prev) => {
            if (replace) return adapted;
            // Defends against a duplicate item across adjacent pages (e.g. an
            // event published between two page loads shifting the offset)
            // rather than assuming pagination is perfectly exclusive.
            const seenIds = new Set(prev.map((e) => e.id));
            return [...prev, ...adapted.filter((e) => !seenIds.has(e.id))];
          });
          setNextCursor(result.nextCursor);
          setCapped(result.capped);
          setStatus("loaded");
        })
        .catch((err) => {
          if (requestIdRef.current !== myRequestId) return;
          setError(err instanceof Error ? err.message : "Couldn't load events.");
          setStatus("error");
        })
        .finally(() => {
          if (requestIdRef.current === myRequestId) setLoadingMore(false);
        });
    },
    [fetchNonEmptyPage],
  );

  // Refetches page one, from scratch, whenever a filter changes — never
  // appends onto results gathered under a different filter combination.
  useEffect(() => {
    requestIdRef.current += 1;
    let cancelled = false;
    // Deferred via queueMicrotask (rather than calling load() synchronously
    // here) so the effect body itself never calls setState directly — only
    // the microtask callback does, matching the pattern used elsewhere in
    // this codebase (see useOrganiser.ts).
    queueMicrotask(() => {
      if (!cancelled) load(undefined, true);
    });
    return () => {
      cancelled = true;
    };
    // `load` already reflects the current category/pricing/onOrAfter (it's
    // rebuilt via fetchNonEmptyPage's own dependency on them); depending on
    // those directly here, rather than on `load`, is what limits this effect
    // to firing on an actual filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, pricing, onOrAfter, query, nearMode]);

  function handleRetry() {
    requestIdRef.current += 1;
    load(undefined, true);
  }

  function handleLoadMore() {
    requestIdRef.current += 1;
    countBeforeMore.current = events.length;
    load(nextCursor, false);
  }

  // "Load more" keeps focus while it loads (busy, not disabled). When the last page takes the
  // button away with focus on it, focus goes to the first new event rather than the page.
  useEffect(() => {
    if (countBeforeMore.current === null || loadingMore) return;
    const before = countBeforeMore.current;
    countBeforeMore.current = null;
    if (loadMoreRef.current || (document.activeElement && document.activeElement !== document.body)) return;
    const firstNew = listRef.current?.children[before]?.querySelector("a");
    firstNew?.focus();
  }, [loadingMore, events]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <EventFilterBar
        categories={categories}
        category={category}
        onCategoryChange={setCategory}
        pricing={pricing}
        onPricingChange={setPricing}
        onOrAfter={onOrAfter}
        onOnOrAfterChange={setOnOrAfter}
        hasActiveFilters={hasActiveFilters}
        onReset={resetFilters}
      />

      {/* Always mounted, so the load's start ("Loading events…") and its result ("Showing 26
          events", after each Load more too) are announced (see EventFeed); the loader shows the progress. */}
      <p role="status" className="sr-only">
        {status === "loading" ? "Loading events…" : status === "loaded" && !progress.visible ? summary : ""}
      </p>

      {progress.visible && status !== "error" && <FeedLoading percent={progress.percent} done={progress.done} />}

      {status === "error" && (
        <div className="flex flex-col items-start gap-4">
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
          <Button variant="outline" size="sm" onClick={handleRetry}>
            Try again
          </Button>
        </div>
      )}

      {status === "loaded" && !progress.visible && (
        <>
          {/* Not a live region: the status above announces it. */}
          <p className="meta text-muted">{summary}</p>

          {events.length === 0 ? (
            <EmptyState
              title={hasActiveFilters || query ? "No events match your filters" : "No events yet"}
              action={
                hasActiveFilters ? <Button onClick={resetFilters}>Reset filters</Button> : undefined
              }
            />
          ) : near ? (
            <NearbyResults events={events} origin={near} capped={capped} />
          ) : (
            <>
              <EventResults events={events} heading="Events" listRef={listRef} />
              {nextCursor && (
                <Button
                  ref={loadMoreRef}
                  variant="outline"
                  onClick={handleLoadMore}
                  busy={loadingMore}
                  className="self-center"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
