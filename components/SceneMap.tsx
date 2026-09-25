"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import SceneEventRow from "@/components/SceneEventRow";
import SceneMapFilterBar from "@/components/SceneMapFilterBar";
import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { getEventCategories, getEvents } from "@/lib/data";
import { formatEventDateShort } from "@/lib/format";
import { resolveEventCoordinates } from "@/lib/geo";
import { formatFeedPrice } from "@/lib/pricing";
import {
  distinctSuburbs,
  matchesPricing,
  matchesSearch,
  matchesTimeFilter,
  type ScenePricingFilter,
  type TimeFilter,
} from "@/lib/scene-map-filters";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

const SceneMapPanel = dynamic(() => import("@/components/SceneMapPanel"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted">Loading map&hellip;</div>,
});

const ORANGE = "#e15b27";

type MobileView = "map" | "list";
type Status = "loading" | "loaded" | "error";

interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface FilterState {
  search: string;
  category: EventCategory | "all";
  time: TimeFilter;
  specificDate: string;
  suburb: string | "all";
  pricing: ScenePricingFilter;
}

const DEFAULT_FILTERS: FilterState = {
  search: "",
  category: "all",
  time: "all",
  specificDate: "",
  suburb: "all",
  pricing: "all",
};

function readFiltersFromParams(params: URLSearchParams): FilterState {
  return {
    search: params.get("q") ?? "",
    category: (params.get("cat") as EventCategory | "all") || "all",
    time: (params.get("time") as TimeFilter) || "all",
    specificDate: params.get("date") ?? "",
    suburb: params.get("suburb") ?? "all",
    pricing: (params.get("price") as ScenePricingFilter) || "all",
  };
}

function writeFiltersToParams(filters: FilterState, selectedEventId: string | null): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.category !== "all") params.set("cat", filters.category);
  if (filters.time !== "all") params.set("time", filters.time);
  if (filters.specificDate) params.set("date", filters.specificDate);
  if (filters.suburb !== "all") params.set("suburb", filters.suburb);
  if (filters.pricing !== "all") params.set("price", filters.pricing);
  if (selectedEventId) params.set("sel", selectedEventId);
  return params;
}

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read once on mount — the URL is the source of truth for "coming back",
  // not for reacting to every subsequent change (that would fight typing).
  const initial = useMemo(() => readFiltersFromParams(searchParams), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialSelected = useMemo(() => searchParams.get("sel"), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [filters, setFilters] = useState<FilterState>(initial);
  const [rawSelectedEventId, setSelectedEventId] = useState<string | null>(initialSelected);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [areaBounds, setAreaBounds] = useState<MapBounds | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const hasRestoredScroll = useRef(false);

  const now = useMemo(() => new Date(), []);
  const suburbs = useMemo(() => distinctSuburbs(events), [events]);

  const filtered = useMemo(() => {
    return events
      .filter((event) => filters.category === "all" || event.category === filters.category)
      .filter((event) => matchesPricing(event, filters.pricing))
      .filter((event) => filters.suburb === "all" || event.suburb === filters.suburb)
      .filter((event) => matchesTimeFilter(event, filters.time, now, filters.specificDate))
      .filter((event) => matchesSearch(event, filters.search))
      .filter((event) => {
        if (!areaBounds) return true;
        const coords = resolveEventCoordinates(event);
        if (!coords) return false;
        return (
          coords.lat <= areaBounds.north &&
          coords.lat >= areaBounds.south &&
          coords.lng <= areaBounds.east &&
          coords.lng >= areaBounds.west
        );
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, filters, now, areaBounds]);

  // Derived rather than synced via effect: a selection that no longer
  // matches the active filters is simply treated as no selection.
  const selectedEventId =
    rawSelectedEventId && filtered.some((event) => event.id === rawSelectedEventId) ? rawSelectedEventId : null;
  const selectedEvent = filtered.find((event) => event.id === selectedEventId) ?? null;

  // Keeps the URL in sync (via replace, so filter tweaks don't spam
  // history) so the back button from a details page returns here with
  // filters and selection intact.
  useEffect(() => {
    const params = writeFiltersToParams(filters, rawSelectedEventId);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, rawSelectedEventId, pathname]);

  // On first load with a `sel` param (arriving via back-navigation), scroll
  // that row into view once the list has rendered.
  useEffect(() => {
    if (hasRestoredScroll.current || !initialSelected || status !== "loaded") return;
    const row = rowRefs.current.get(initialSelected);
    if (row) {
      row.scrollIntoView({ block: "center" });
      hasRestoredScroll.current = true;
    }
  }, [initialSelected, status, filtered]);

  const withoutLocationCount = filtered.filter((event) => resolveEventCoordinates(event) === null).length;

  const hasActiveFilters =
    filters.category !== "all" ||
    filters.pricing !== "all" ||
    filters.suburb !== "all" ||
    filters.time !== "all" ||
    filters.search !== "" ||
    areaBounds !== null;

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setAreaBounds(null);
  }

  function handleLocate(eventId: string) {
    setSelectedEventId(eventId);
    setMobileView("map");
  }

  function timeLabel(): string {
    if (filters.time === "tonight") return "Tonight";
    if (filters.time === "weekend") return "This weekend";
    if (filters.time === "date" && filters.specificDate) {
      return formatEventDateShort(new Date(`${filters.specificDate}T12:00:00`).toISOString());
    }
    return "";
  }

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.search) chips.push({ key: "q", label: `"${filters.search}"`, onRemove: () => setFilters((f) => ({ ...f, search: "" })) });
  if (filters.suburb !== "all")
    chips.push({ key: "suburb", label: filters.suburb, onRemove: () => setFilters((f) => ({ ...f, suburb: "all" })) });
  if (filters.time !== "all")
    chips.push({
      key: "time",
      label: timeLabel(),
      onRemove: () => setFilters((f) => ({ ...f, time: "all", specificDate: "" })),
    });
  if (filters.category !== "all") {
    const label = categories.find((c) => c.value === filters.category)?.label ?? filters.category;
    chips.push({ key: "cat", label, onRemove: () => setFilters((f) => ({ ...f, category: "all" })) });
  }
  if (filters.pricing !== "all")
    chips.push({
      key: "price",
      label: filters.pricing === "free" ? "Free" : "Under $25",
      onRemove: () => setFilters((f) => ({ ...f, pricing: "all" })),
    });
  if (areaBounds) chips.push({ key: "area", label: "This area", onRemove: () => setAreaBounds(null) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: ORANGE }}>
          Melbourne&rsquo;s creative scene
        </p>
        <h1 className="max-w-2xl text-[34px] leading-[0.95] font-bold tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl">
          Find the room.
          <br />
          <span style={{ color: ORANGE }}>Find your people.</span>
        </h1>
        <p className="max-w-xl font-sans text-sm text-muted sm:text-base">
          Discover music, art, fashion and the spaces that bring Melbourne together.
        </p>
      </div>

      {demo && (
        <DemoNotice>Sample listings only. No tickets on sale.</DemoNotice>
      )}

      <SceneMapFilterBar
        search={filters.search}
        onSearchChange={(search) => setFilters((f) => ({ ...f, search }))}
        categories={categories}
        category={filters.category}
        onCategoryChange={(category) => setFilters((f) => ({ ...f, category }))}
        time={filters.time}
        onTimeChange={(time) => setFilters((f) => ({ ...f, time, specificDate: time === "date" ? f.specificDate : "" }))}
        specificDate={filters.specificDate}
        onSpecificDateChange={(specificDate) => setFilters((f) => ({ ...f, specificDate }))}
        suburbs={suburbs}
        suburb={filters.suburb}
        onSuburbChange={(suburb) => setFilters((f) => ({ ...f, suburb }))}
        pricing={filters.pricing}
        onPricingChange={(pricing) => setFilters((f) => ({ ...f, pricing }))}
      />

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="flex h-8 items-center gap-1.5 rounded-full border px-3 font-sans text-xs font-medium text-foreground"
              style={{ borderColor: "#3d352e", background: "#151311" }}
            >
              {chip.label}
              <span aria-hidden="true" className="text-muted">
                &times;
              </span>
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="h-8 rounded-full px-3 font-sans text-xs font-medium underline underline-offset-2"
            style={{ color: ORANGE }}
          >
            Clear all
          </button>
        </div>
      )}

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
            <p aria-live="polite" className="font-sans text-sm text-muted">
              {filtered.length} upcoming event{filtered.length === 1 ? "" : "s"}
              {hasActiveFilters ? " matching your filters" : ""}
            </p>
            <label className="flex items-center gap-1.5 font-sans text-sm text-muted">
              Sort:
              <select className="rounded border border-surface-border bg-background px-2 py-1 text-foreground" defaultValue="soonest">
                <option value="soonest">Soonest</option>
              </select>
            </label>
          </div>

          {/* Mobile-only map/list toggle. Both panels are always visible from lg: up. */}
          <div
            className="flex gap-1 self-start rounded-full border border-surface-border p-1 lg:hidden"
            role="tablist"
            aria-label="View"
          >
            {(["list", "map"] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={mobileView === view}
                onClick={() => setMobileView(view)}
                className="min-h-[44px] rounded-full px-5 font-sans text-sm font-semibold capitalize transition-colors"
                style={mobileView === view ? { background: ORANGE, color: "#17140f" } : { color: "#a3a3ad" }}
              >
                {view}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-surface-border p-10 text-center">
              <p className="font-heading text-2xl text-foreground">No events match your filters</p>
              <p className="mt-2 font-sans text-sm text-muted">
                Try a different neighbourhood, time window, category, or clearing the price filter.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 rounded px-4 py-2 font-sans text-sm font-medium"
                style={{ background: ORANGE, color: "#17140f" }}
              >
                Broaden search
              </button>
            </div>
          ) : (
            <>
              <div className="grid overflow-hidden rounded-lg border border-surface-border lg:grid-cols-[55fr_45fr]">
                <div className={`h-[420px] lg:h-[600px] ${mobileView === "map" ? "block" : "hidden"} lg:block`}>
                  <SceneMapPanel
                    events={filtered}
                    selectedEventId={selectedEventId}
                    onSelect={(id) => {
                      setSelectedEventId(id);
                      rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
                    }}
                    onSearchArea={setAreaBounds}
                  />
                </div>
                <div
                  className={`h-[420px] overflow-y-auto border-t border-surface-border lg:h-[600px] lg:border-t-0 lg:border-l ${
                    mobileView === "list" ? "block" : "hidden"
                  } lg:block`}
                  style={{ background: "#11100f" }}
                >
                  {filtered.map((event) => (
                    <div
                      key={event.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(event.id, el);
                        else rowRefs.current.delete(event.id);
                      }}
                    >
                      <SceneEventRow
                        event={event}
                        selected={event.id === selectedEventId}
                        onLocate={handleLocate}
                        hasLocation={resolveEventCoordinates(event) !== null}
                        detailsHref={`/events/${event.slug}`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {withoutLocationCount > 0 && (
                <p className="font-sans text-xs text-muted">
                  {withoutLocationCount} event{withoutLocationCount === 1 ? "" : "s"} can&rsquo;t be placed on the
                  map yet (no venue location on file) &mdash; still listed above.
                </p>
              )}

              {hasMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="w-fit self-center rounded border border-surface-border px-4 py-2 font-sans text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more events"}
                </button>
              )}
            </>
          )}

          {/* Mobile map tab only: a compact, dismissible summary for the selected event, since the highlighted list row isn't visible there. */}
          {selectedEvent && mobileView === "map" && (
            <div
              className="fixed inset-x-3 bottom-3 z-[1200] flex items-center gap-3 rounded-lg border p-3 shadow-xl lg:hidden"
              style={{ background: "#151311", borderColor: ORANGE }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-sans text-sm font-semibold text-foreground">{selectedEvent.title}</p>
                <p className="truncate font-sans text-xs text-muted">
                  {formatEventDateShort(selectedEvent.startsAt)} &middot; {selectedEvent.suburb} &middot;{" "}
                  {formatFeedPrice(selectedEvent)}
                </p>
              </div>
              <Link
                href={`/events/${selectedEvent.slug}`}
                className="flex h-11 items-center rounded px-3 font-sans text-sm font-medium"
                style={{ background: ORANGE, color: "#17140f" }}
              >
                View
              </Link>
              <button
                type="button"
                onClick={() => setSelectedEventId(null)}
                aria-label="Dismiss selected event"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-surface-border font-sans text-lg text-muted"
              >
                &times;
              </button>
            </div>
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
 * The "Scene Map" discovery experience: a real (client-only, Leaflet +
 * CARTO dark tiles, no API key) map synced with a scrollable event list,
 * backed by the same demo/live event data as the rest of the app.
 */
export default function SceneMap() {
  const categories = getEventCategories();

  if (!isApiConfigured) return <SceneMapDemo />;

  return <SceneMapLive categories={categories} />;
}
