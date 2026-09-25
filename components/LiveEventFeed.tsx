"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import EventCard from "@/components/EventCard";
import EventFilterBar, { type PricingFilter } from "@/components/EventFilterBar";
import { listPublicEvents } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

interface Props {
  categories: { value: EventCategory; label: string }[];
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
export default function LiveEventFeed({ categories }: Props) {
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [pricing, setPricing] = useState<PricingFilter>("all");
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
    [category, pricing, onOrAfter],
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
            // Defends against a duplicate item across adjacent pages (e.g. a
            // page boundary landing mid-tie on the sort key) rather than
            // assuming DynamoDB pagination is perfectly exclusive.
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
  }, [category, pricing, onOrAfter]);

  function handleRetry() {
    requestIdRef.current += 1;
    load(undefined, true);
  }

  function handleLoadMore() {
    requestIdRef.current += 1;
    load(nextCursor, false);
  }

  return (
    <div className="flex flex-col gap-6">
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

      {status === "loading" && <p className="text-sm text-muted">Loading events…</p>}

      {status === "error" && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-4">
          <p role="alert" className="text-sm text-foreground">
            {error}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 rounded border border-surface-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-accent hover:text-accent"
          >
            Try again
          </button>
        </div>
      )}

      {status === "loaded" && (
        <>
          {/* This is how many results have loaded so far, not the total
              number of events in the database — later pages may add more. */}
          <p aria-live="polite" className="text-sm text-muted">
            Showing {events.length} event{events.length === 1 ? "" : "s"}
            {hasActiveFilters ? " matching your filters" : ""}
          </p>

          {events.length === 0 ? (
            <div className="rounded-lg border border-dashed border-surface-border p-10 text-center">
              <p className="font-heading text-2xl text-foreground">
                {hasActiveFilters ? "No events match your filters" : "No events have been published yet"}
              </p>
              <p className="mt-2 text-sm text-muted">
                {hasActiveFilters
                  ? "Try a different category, an earlier date, or clearing the price filter."
                  : "Check back soon."}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-4 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
              {nextCursor && (
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="w-fit self-center rounded border border-surface-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
