"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import EventResults from "@/components/EventResults";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import EventFilterBar, { type PricingFilter } from "@/components/EventFilterBar";
import { listPublicEvents } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

interface Props {
  categories: { value: EventCategory; label: string }[];
  /** Free-text search (from /search); sent to the API alongside the filters. */
  query?: string;
  /** Starting filters (from /events?category=&pricing=); "Reset filters" still clears to all. */
  initialCategory?: EventCategory | "all";
  initialPricing?: PricingFilter;
}

type Status = "loading" | "loaded" | "error";

// Bounds the "skip past an empty filtered page that still has a cursor"
// loop below, so a pathological run of empty pages can't hang a request.
const MAX_EMPTY_PAGES_TO_SKIP = 10;

/**
 * The live (API-backed) event feed: sends category/date/pricing filters to
 * the API rather than filtering an already-fetched list, and paginates via
 * the API's opaque `nextCursor` instead of ever loading everything at once.
 */
export default function LiveEventFeed({ categories, query, initialCategory = "all", initialPricing = "all" }: Props) {
  const [category, setCategory] = useState<EventCategory | "all">(initialCategory);
  const [pricing, setPricing] = useState<PricingFilter>(initialPricing);
  const [onOrAfter, setOnOrAfter] = useState("");

  const [events, setEvents] = useState<SheltuhEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Bumped whenever a new request supersedes any in flight (a filter change,
  // or a fresh "load more" click), so a response that arrives late from an
  // earlier request is discarded instead of overwriting newer results.
  const requestIdRef = useRef(0);

  const hasActiveFilters = category !== "all" || pricing !== "all" || onOrAfter !== "";

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
    async (cursor: string | undefined, myRequestId: number) => {
      let cur = cursor;
      for (let i = 0; i < MAX_EMPTY_PAGES_TO_SKIP; i++) {
        const page = await listPublicEvents({
          category: category === "all" ? undefined : category,
          pricing: pricing === "all" ? undefined : pricing,
          onOrAfter: onOrAfter || undefined,
          q: query || undefined,
          cursor: cur,
        });
        if (requestIdRef.current !== myRequestId) return "stale" as const;
        if (page.items.length > 0 || !page.nextCursor) {
          return { items: page.items, nextCursor: page.nextCursor };
        }
        cur = page.nextCursor;
      }
      return { items: [], nextCursor: cur };
    },
    [category, pricing, onOrAfter, query],
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
  }, [category, pricing, onOrAfter, query]);

  function handleRetry() {
    requestIdRef.current += 1;
    load(undefined, true);
  }

  function handleLoadMore() {
    requestIdRef.current += 1;
    load(nextCursor, false);
  }

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

      {/* Always mounted so "Loading events…" is announced (see EventFeed). */}
      <p role="status" className={status === "loading" ? "text-sm text-muted" : "sr-only"}>
        {status === "loading" ? "Loading events…" : ""}
      </p>

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

      {status === "loaded" && (
        <>
          {/* This is how many results have loaded so far, not the total
              number of events in the database — later pages may add more. */}
          <p aria-live="polite" className="text-sm text-muted">
            Showing {events.length} event{events.length === 1 ? "" : "s"}
            {hasActiveFilters || query ? " matching your search" : ""}
          </p>

          {events.length === 0 ? (
            <EmptyState
              title={
                hasActiveFilters || query
                  ? "No events match your filters"
                  : "No events have been published yet"
              }
              action={
                hasActiveFilters ? <Button onClick={resetFilters}>Reset filters</Button> : undefined
              }
            >
              {hasActiveFilters || query
                ? "Try a different search, category, an earlier date, or clearing the price filter."
                : "Check back soon."}
            </EmptyState>
          ) : (
            <>
              <EventResults events={events} />
              {nextCursor && (
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
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
