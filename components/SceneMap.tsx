"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import SceneEventRow from "@/components/SceneEventRow";
import SceneMapFilterBar, { type ScenePricingFilter } from "@/components/SceneMapFilterBar";
import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { getEventCategories, getEvents, isFreeEvent } from "@/lib/data";
import { resolveEventCoordinates } from "@/lib/geo";
import { distinctSuburbs, matchesTimeFilter, type TimeFilter } from "@/lib/scene-map-filters";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

const SceneMapPanel = dynamic(() => import("@/components/SceneMapPanel"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted">Loading map&hellip;</div>,
});

const ORANGE = "#e15b27";

type MobileView = "map" | "list";
type Status = "loading" | "loaded" | "error";

interface SceneMapViewProps {
  events: SheltuhEvent[];
  categories: { value: EventCategory; label: string }[];
  status: Status;
  error?: string | null;
  onRetry?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  demo?: boolean;
}

function SceneMapView({
  events,
  categories,
  status,
  error,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
  demo,
}: SceneMapViewProps) {
  const [mobileView, setMobileView] = useState<MobileView>("map");
  const [rawSelectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [time, setTime] = useState<TimeFilter>("all");
  const [suburb, setSuburb] = useState<string | "all">("all");
  const [pricing, setPricing] = useState<ScenePricingFilter>("all");

  const now = useMemo(() => new Date(), []);
  const suburbs = useMemo(() => distinctSuburbs(events), [events]);

  const filtered = useMemo(() => {
    return events
      .filter((event) => category === "all" || event.category === category)
      .filter((event) => {
        if (pricing === "all") return true;
        const free = isFreeEvent(event);
        return pricing === "free" ? free : !free;
      })
      .filter((event) => suburb === "all" || event.suburb === suburb)
      .filter((event) => matchesTimeFilter(event, time, now))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, category, pricing, suburb, time, now]);

  // Derived rather than synced via effect: a selection that no longer
  // matches the active filters is simply treated as no selection.
  const selectedEventId =
    rawSelectedEventId && filtered.some((event) => event.id === rawSelectedEventId) ? rawSelectedEventId : null;

  const withoutLocationCount = filtered.filter((event) => resolveEventCoordinates(event) === null).length;

  const hasActiveFilters = category !== "all" || pricing !== "all" || suburb !== "all" || time !== "all";
  function resetFilters() {
    setCategory("all");
    setPricing("all");
    setSuburb("all");
    setTime("all");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: ORANGE }}>
          Direction 01 &middot; Discovery by place
        </p>
        <h1
          className="max-w-2xl text-[42px] leading-[0.9] font-bold tracking-[-0.03em] text-foreground sm:text-6xl lg:text-7xl"
        >
          Find the room.
          <br />
          <em className="not-italic" style={{ color: ORANGE }}>
            Find your people.
          </em>
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          Sheltüh maps the creative events that usually disappear into the feed &mdash; from openings and live
          sets to film nights, workshops and the spaces around them.
        </p>
      </div>

      {demo && (
        <DemoNotice>
          These are fictional sample listings for this local prototype &mdash; no real tickets are on sale.
        </DemoNotice>
      )}

      <SceneMapFilterBar
        categories={categories}
        category={category}
        onCategoryChange={setCategory}
        time={time}
        onTimeChange={setTime}
        suburbs={suburbs}
        suburb={suburb}
        onSuburbChange={setSuburb}
        pricing={pricing}
        onPricingChange={setPricing}
        hasActiveFilters={hasActiveFilters}
        onReset={resetFilters}
      />

      {status === "loading" && <p className="text-sm text-muted">Loading events&hellip;</p>}

      {status === "error" && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-4">
          <p role="alert" className="text-sm text-foreground">
            {error}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded border border-surface-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-accent hover:text-accent"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {status === "loaded" && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p aria-live="polite" className="text-sm text-muted">
              Showing {filtered.length} of {events.length} event{events.length === 1 ? "" : "s"}
              {hasActiveFilters ? " matching your filters" : ""}
            </p>

            {/* Mobile-only map/list toggle. Both panels are always visible from lg: up. */}
            <div className="flex gap-1 rounded-full border border-surface-border p-1 lg:hidden" role="tablist" aria-label="View">
              {(["map", "list"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={mobileView === view}
                  onClick={() => setMobileView(view)}
                  className="rounded-full px-4 py-1.5 text-xs font-medium capitalize transition-colors"
                  style={
                    mobileView === view
                      ? { background: ORANGE, color: "#fff" }
                      : { color: "#a3a3ad" }
                  }
                >
                  {view}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-surface-border p-10 text-center">
              <p className="font-heading text-2xl text-foreground">No events match your filters</p>
              <p className="mt-2 text-sm text-muted">
                Try a different neighbourhood, time window, category, or clearing the price filter.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 rounded px-4 py-2 text-sm font-medium text-white"
                style={{ background: ORANGE }}
              >
                Reset filters
              </button>
            </div>
          ) : (
            <>
              <div
                className="grid overflow-hidden rounded-lg border border-surface-border lg:grid-cols-[1.7fr_1fr]"
                style={{ minHeight: 0 }}
              >
                <div className={`h-[420px] lg:h-[560px] ${mobileView === "map" ? "block" : "hidden"} lg:block`}>
                  <SceneMapPanel events={filtered} selectedEventId={selectedEventId} onSelect={setSelectedEventId} />
                </div>
                <div
                  className={`h-[420px] overflow-y-auto border-t border-surface-border lg:h-[560px] lg:border-t-0 lg:border-l ${
                    mobileView === "list" ? "block" : "hidden"
                  } lg:block`}
                  style={{ background: "#11100f" }}
                >
                  {filtered.map((event) => (
                    <SceneEventRow
                      key={event.id}
                      event={event}
                      selected={event.id === selectedEventId}
                      onSelect={setSelectedEventId}
                      hasLocation={resolveEventCoordinates(event) !== null}
                    />
                  ))}
                </div>
              </div>

              {withoutLocationCount > 0 && (
                <p className="text-xs text-muted">
                  {withoutLocationCount} event{withoutLocationCount === 1 ? "" : "s"} can&rsquo;t be placed on the
                  map yet (no venue location on file) &mdash; still listed above.
                </p>
              )}

              {hasMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="w-fit self-center rounded border border-surface-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more events"}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SceneMapDemo() {
  const categories = getEventCategories();
  const [events, setEvents] = useState<SheltuhEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEvents().then((loaded) => {
      if (!cancelled) setEvents(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SceneMapView
      events={events ?? []}
      categories={categories}
      status={events === null ? "loading" : "loaded"}
      demo
    />
  );
}

function SceneMapLive({ categories }: { categories: { value: EventCategory; label: string }[] }) {
  const [events, setEvents] = useState<SheltuhEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  function load(cursor: string | undefined, replace: boolean) {
    if (replace) {
      setStatus("loading");
    } else {
      setLoadingMore(true);
    }
    setError(null);

    listPublicEvents({ cursor })
      .then((page) => {
        const adapted = page.items.map(adaptPublicEvent);
        setEvents((prev) => {
          if (replace) return adapted;
          const seenIds = new Set(prev.map((e) => e.id));
          return [...prev, ...adapted.filter((e) => !seenIds.has(e.id))];
        });
        setNextCursor(page.nextCursor);
        setStatus("loaded");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Couldn't load events.");
        setStatus("error");
      })
      .finally(() => setLoadingMore(false));
  }

  useEffect(() => {
    // Deferred via queueMicrotask so the effect body itself never calls
    // setState directly — matches the pattern in LiveEventFeed.tsx.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) load(undefined, true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SceneMapView
      events={events}
      categories={categories}
      status={status}
      error={error}
      onRetry={() => load(undefined, true)}
      hasMore={Boolean(nextCursor)}
      loadingMore={loadingMore}
      onLoadMore={() => load(nextCursor, false)}
    />
  );
}

/**
 * The "Scene Map" discovery experience: a real (client-only, Leaflet + OSM,
 * no API key) map on the left synced with a scrollable event list on the
 * right, backed by the same demo/live event data as the rest of the app.
 */
export default function SceneMap() {
  const categories = getEventCategories();

  if (!isApiConfigured) return <SceneMapDemo />;

  return <SceneMapLive categories={categories} />;
}
