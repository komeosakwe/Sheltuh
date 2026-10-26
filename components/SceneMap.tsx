"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import SceneEventRow from "@/components/SceneEventRow";
import SceneMapFilterBar from "@/components/SceneMapFilterBar";
import MapStylePreview from "@/components/map/MapStylePreview";
import SceneMapEventCard from "@/components/map/SceneMapEventCard";
import { useMapTileStyle } from "@/components/map/useMapTileStyle";
import { Button } from "@/components/ui/Button";
import { SelectedDots } from "@/components/ui/FilterChip";
import { LoadingIndicator, ProgressLoader, useLoadingProgress } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice, PageHeader } from "@/components/ui/Section";
import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { getEventCategories, getUpcomingEvents } from "@/lib/data";
import { formatEventDateShort, formatEventTime } from "@/lib/format";
import { useLocationModule } from "@/components/search/useLocationModule";
import { findListedSuburb, resolveMapCoordinates, type SuburbLookup } from "@/lib/geo";
import { TILE_STYLE_PARAM, type TileStyleId } from "@/lib/map-tiles";
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
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <LoadingIndicator label="Loading the map" />
    </div>
  ),
});

type MobileView = "map" | "list";
type Status = "loading" | "loaded" | "error";

/** Where the selected-event card sits on the map instead of the phone's bottom sheet (Tailwind's lg). */
const DESKTOP_QUERY = "(min-width: 64rem)";

function isDesktop(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;
}

/** Can take focus where it is: in the page and not hidden (e.g. a list row while the phone shows the map). */
function isShown(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element?.isConnected) return false;
  return typeof element.checkVisibility === "function" ? element.checkVisibility() : true;
}

/** On the map: the event's own marker, else the cluster it's in; whichever is showing. */
function mapFocusTarget(pane: HTMLElement | null, eventId: string): HTMLElement | undefined {
  if (!pane) return undefined;
  const marker = Array.from(pane.querySelectorAll<HTMLElement>("[data-event-id]")).find(
    (el) => el.dataset.eventId === eventId,
  );
  const cluster = Array.from(pane.querySelectorAll<HTMLElement>("[data-event-ids]")).find((el) =>
    (el.dataset.eventIds ?? "").split(" ").includes(eventId),
  );
  return [marker, cluster].find(isShown);
}

/**
 * Focus `target` on the map, or the map itself. The map redraws its markers as the selection
 * changes (Leaflet re-inserts or replaces marker elements, which drops their focus), so for a
 * moment afterwards, focus that falls to the page goes back to the target, or to the map.
 */
function focusOnMap(pane: HTMLElement, target: HTMLElement | undefined) {
  const map = pane.querySelector<HTMLElement>(".leaflet-container");
  const focused = target ?? map;
  if (!focused) return;
  focused.focus();
  if (focused === map || typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    (isShown(focused) ? focused : map)?.focus();
  });
  observer.observe(pane, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 1000);
}

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

function writeFiltersToParams(
  filters: FilterState,
  selectedEventId: string | null,
  view: MobileView,
  tiles: TileStyleId | null = null,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.category !== "all") params.set("cat", filters.category);
  if (filters.time !== "all") params.set("time", filters.time);
  if (filters.specificDate) params.set("date", filters.specificDate);
  if (filters.suburb !== "all") params.set("suburb", filters.suburb);
  if (filters.pricing !== "all") params.set("price", filters.pricing);
  if (selectedEventId) params.set("sel", selectedEventId);
  // The map is the default view, so only the list is written.
  if (view === "list") params.set("view", "list");
  // The Mapbox preview's chosen style, for sharing (only ever set while the preview is on).
  if (tiles) params.set(TILE_STYLE_PARAM, tiles);
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
}

function SceneMapView({
  events,
  categories,
  status: eventsStatus,
  error,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
}: SceneMapViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Events without venue coordinates go at their suburb's centre, from the ABS table of every
  // Australian suburb (lib/localities.ts). It loads here, after the page and only if some event
  // needs it, so it isn't in /map's first load; the map waits for it, so markers aren't placed
  // twice. If it can't load, the few hand-entered centres in lib/geo.ts stand in, and the page
  // says so.
  const needsSuburbs = events.some((event) => !event.coordinates);
  const suburbTable = useLocationModule(needsSuburbs);
  const findSuburb: SuburbLookup = suburbTable.module?.findLocality ?? findListedSuburb;
  const status: Status =
    eventsStatus === "loaded" && needsSuburbs && !suburbTable.module && !suburbTable.failed ? "loading" : eventsStatus;

  // Read once on mount — the URL is the source of truth for "coming back",
  // not for reacting to every subsequent change (that would fight typing).
  const initial = useMemo(() => readFiltersFromParams(searchParams), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialSelected = useMemo(() => searchParams.get("sel"), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialView = useMemo<MobileView>(() => (searchParams.get("view") === "list" ? "list" : "map"), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialTiles = useMemo(() => searchParams.get(TILE_STYLE_PARAM), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Esri, unless a Mapbox token turns on the style preview (docs/mapbox-preview.md).
  const tiles = useMapTileStyle(initialTiles);

  const [filters, setFilters] = useState<FilterState>(initial);
  const [rawSelectedEventId, setSelectedEventId] = useState<string | null>(initialSelected);
  // Map first (owner request); a shared ?view=list still opens the list.
  const [mobileView, setMobileView] = useState<MobileView>(initialView);
  const [areaBounds, setAreaBounds] = useState<MapBounds | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const hasRestoredScroll = useRef(false);
  const listRef = useRef<HTMLElement>(null);
  const mapPaneRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  // What selected the current event (a row's Locate, a marker), for Dismiss to return focus to.
  const openerRef = useRef<HTMLElement | null>(null);
  // Focus to move once the next render has shown its target: the list after "Show the list",
  // the phone's sheet after Locate.
  const pendingFocus = useRef<"list" | "sheet" | null>(null);
  // Dismiss: the event whose card closed, for focus to go back to once the map has re-rendered.
  const dismissedFrom = useRef<{ eventId: string; opener: HTMLElement | null } | null>(null);
  // The events listed before "Load more", to find the first new one if the button then goes.
  const idsBeforeMore = useRef<Set<string> | null>(null);

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
        const coords = resolveMapCoordinates(event, findSuburb);
        if (!coords) return false;
        return (
          coords.lat <= areaBounds.north &&
          coords.lat >= areaBounds.south &&
          coords.lng <= areaBounds.east &&
          coords.lng >= areaBounds.west
        );
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, filters, now, areaBounds, findSuburb]);

  // Derived rather than synced via effect: a selection that no longer
  // matches the active filters is simply treated as no selection.
  const selectedEventId =
    rawSelectedEventId && filtered.some((event) => event.id === rawSelectedEventId) ? rawSelectedEventId : null;
  const selectedEvent = filtered.find((event) => event.id === selectedEventId) ?? null;

  // Keeps the URL in sync (via replace, so filter tweaks don't spam
  // history) so the back button from a details page returns here with
  // filters and selection intact.
  useEffect(() => {
    const params = writeFiltersToParams(filters, rawSelectedEventId, mobileView, tiles.picked);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, rawSelectedEventId, mobileView, pathname, tiles.picked]);

  // The loader's estimated progress; the results replace it once it's done.
  const progress = useLoadingProgress(status === "loading");

  // On first load with a `sel` param (arriving via back-navigation), scroll
  // that row into view once the list has rendered.
  useEffect(() => {
    if (hasRestoredScroll.current || !initialSelected || status !== "loaded" || progress.visible) return;
    const row = rowRefs.current.get(initialSelected);
    if (row) {
      row.scrollIntoView({ block: "center" });
      hasRestoredScroll.current = true;
    }
  }, [initialSelected, status, filtered, progress.visible]);

  // After each render: move focus the user asked for once its target is showing.
  useEffect(() => {
    if (pendingFocus.current === "list" && mobileView === "list" && listRef.current) {
      pendingFocus.current = null;
      listRef.current.focus();
    } else if (pendingFocus.current === "sheet" && sheetRef.current) {
      pendingFocus.current = null;
      if (isShown(sheetRef.current)) sheetRef.current.focus();
    }
    if (dismissedFrom.current) {
      const { eventId, opener } = dismissedFrom.current;
      dismissedFrom.current = null;
      const pane = mapPaneRef.current;
      if (isShown(opener)) opener.focus();
      else if (pane) focusOnMap(pane, mapFocusTarget(pane, eventId));
    }
    // "Load more" keeps focus while it loads (busy, not disabled). If the last page took the
    // button away with focus on it, focus goes to the first new event instead of the page.
    if (idsBeforeMore.current && !loadingMore) {
      const before = idsBeforeMore.current;
      idsBeforeMore.current = null;
      if (!loadMoreRef.current && (document.activeElement === document.body || document.activeElement === null)) {
        const firstNew = filtered.find((event) => !before.has(event.id));
        const link = firstNew ? rowRefs.current.get(firstNew.id)?.querySelector("a") : null;
        if (link) link.focus();
        else listRef.current?.focus();
      }
    }
  });

  // The phone's bottom sheet is fixed over the end of the page: globals.css keeps focused things
  // clear of it (scroll-padding) and gives the page's end the same room, by its measured height.
  const sheetShown = Boolean(selectedEvent) && mobileView === "map" && status === "loaded" && !progress.visible;
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheetShown || !sheet) return;
    const root = document.documentElement;
    const measure = () => {
      const rect = sheet.getBoundingClientRect();
      // From the sheet's top edge to the bottom of the screen: its height, gap and safe area.
      const covered = rect.height > 0 ? Math.max(Math.ceil(window.innerHeight - rect.top), 0) : 0;
      root.style.setProperty("--map-sheet-h", `${covered}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(sheet);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--map-sheet-h");
    };
  }, [sheetShown]);

  const withoutLocationCount = filtered.filter((event) => resolveMapCoordinates(event, findSuburb) === null).length;

  const hasActiveFilters =
    filters.category !== "all" ||
    filters.pricing !== "all" ||
    filters.suburb !== "all" ||
    filters.time !== "all" ||
    filters.search !== "" ||
    areaBounds !== null;
  const countSentence = `${filtered.length} upcoming event${filtered.length === 1 ? "" : "s"}${
    hasActiveFilters ? " matching your filters" : ""
  }`;

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setAreaBounds(null);
  }

  // Phones: Locate switches to the map, hiding the row (and its button) that had focus, so focus
  // goes to the selected event's sheet. Desktop keeps it on the row: the card is on the map beside it.
  function handleLocate(eventId: string, opener: HTMLElement) {
    openerRef.current = opener;
    setSelectedEventId(eventId);
    setMobileView("map");
    if (!isDesktop()) pendingFocus.current = "sheet";
  }

  function handleMapSelect(eventId: string) {
    // A marker, or a spot list's row (which closes): Dismiss falls back to the marker if that's gone.
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedEventId(eventId);
    rowRefs.current.get(eventId)?.scrollIntoView({ block: "nearest" });
  }

  // Dismiss removes the focused button with the card, so focus goes back to what opened it: the
  // row's Locate button, or the event on the map. Done after the re-render: deselecting can put
  // the event back into a cluster, replacing its marker (see the effect below).
  function handleDismiss() {
    if (selectedEventId) dismissedFrom.current = { eventId: selectedEventId, opener: openerRef.current };
    openerRef.current = null;
    setSelectedEventId(null);
  }

  function showList() {
    pendingFocus.current = "list";
    setMobileView("list");
  }

  function handleLoadMore() {
    idsBeforeMore.current = new Set(filtered.map((event) => event.id));
    onLoadMore?.();
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

  const viewButton = (view: MobileView, label: string) => (
    <button
      type="button"
      aria-pressed={mobileView === view}
      onClick={() => setMobileView(view)}
      className={`flex min-h-11 items-center gap-2 rounded-badge px-5 text-sm leading-5 font-semibold ${
        mobileView === view ? "bg-foreground text-background" : "text-foreground hover:bg-surface"
      }`}
    >
      {mobileView === view && <SelectedDots />}
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Owner (26 Oct 2026): fewer special characters, so "near you" is spelt out and the eyebrow is just "Map". */}
      <PageHeader
        brand
        flush
        eyebrow="Map"
        title="Sheltüh near you."
        intro="Events on the map. Tap a spot to see what’s on there."
      />

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
              className="flex min-h-11 items-center gap-2 rounded-control border border-foreground bg-card px-3 text-sm leading-5 font-medium text-foreground hover:bg-surface sm:min-h-8"
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
            className="min-h-11 px-2 text-sm leading-5 font-semibold underline underline-offset-4 sm:min-h-8"
          >
            Clear all
          </button>
        </div>
      )}

      {/* The polite status is always mounted, so the start of a load and its result ("12 upcoming
          events") are both announced; the visible count below isn't a second live region. */}
      <p role="status" className="sr-only">
        {status === "loading" ? "Loading events…" : status === "loaded" && !progress.visible ? countSentence : ""}
      </p>
      {progress.visible && status !== "error" && <ProgressLoader percent={progress.percent} done={progress.done} label="Loading events" />}

      {status === "error" && (
        <div className="flex flex-col items-start gap-4">
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}

      {status === "loaded" && !progress.visible && suburbTable.failed && (
        <div className="flex flex-col items-start gap-4">
          <Notice tone="danger" role="alert">
            Couldn’t load suburb locations, so events outside a few inner suburbs aren’t on the map.
          </Notice>
          <Button variant="outline" size="sm" onClick={suburbTable.retry}>
            Try again
          </Button>
        </div>
      )}

      {status === "loaded" && !progress.visible && (
        <>
          {/* How many are listed, soonest first; the status above is what announces it. */}
          <p className="meta border-t border-foreground pt-3 text-muted">{countSentence}</p>

          {/* Phones only: map or list, map first and by default (owner request). Both show from lg. */}
          <div
            role="group"
            aria-label="Show events as"
            className="flex gap-1 self-start rounded-control border border-foreground bg-card p-1 lg:hidden"
          >
            {viewButton("map", "Map")}
            {viewButton("list", "List")}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No events match your filters"
              action={<Button onClick={resetFilters}>Broaden search</Button>}
            >
              Try a different neighbourhood, time window, category, or clearing the price filter.
            </EmptyState>
          ) : (
            <>
              {/* Only with a Mapbox token (preview builds); with the map, so hidden on the phone's list. */}
              {tiles.preview && (
                <MapStylePreview
                  styles={tiles.styles}
                  value={tiles.active.id}
                  onChange={tiles.choose}
                  className={`${mobileView === "map" ? "flex" : "hidden"} lg:flex`}
                />
              )}

              {/* map-bleed: wider than the page column on large screens (globals.css). */}
              <div className="map-bleed grid overflow-hidden rounded-card border border-foreground bg-card lg:grid-cols-[55fr_45fr]">
                {/* At most 60% of a phone's height, so there's always page to scroll by outside the map. */}
                <div
                  ref={mapPaneRef}
                  className={`relative h-[min(26.25rem,60svh)] lg:h-[37.5rem] ${mobileView === "map" ? "block" : "hidden"} lg:block`}
                >
                  <SceneMapPanel
                    events={filtered}
                    findSuburb={findSuburb}
                    selectedEventId={selectedEventId}
                    onSelect={handleMapSelect}
                    onSearchArea={setAreaBounds}
                    onShowList={showList}
                    tileStyle={tiles.active}
                  />
                  {/* Desktop: the selected event over the map's lower-left corner (phones get the bottom card below). */}
                  {selectedEvent && (
                    <SceneMapEventCard
                      variant="overlay"
                      event={selectedEvent}
                      findSuburb={findSuburb}
                      detailsHref={`/events/${selectedEvent.slug}`}
                      onDismiss={handleDismiss}
                      className="absolute bottom-3 left-3 z-10 hidden w-72 lg:block"
                    />
                  )}
                </div>
                {/* Phones: the list is part of the page (no scroll box inside the page's own scroll).
                    From lg it scrolls beside the map. Focusable, for "Show the list" to move focus to;
                    the ring is inset, since the card clips anything outside it. `relative`: the
                    rows' visually hidden text is positioned within the scroller, not the page,
                    or it would stretch the page far past the footer. */}
                <section
                  ref={listRef}
                  tabIndex={-1}
                  aria-label="Events list"
                  className={`relative h-auto overflow-visible focus-visible:-outline-offset-2 lg:h-[37.5rem] lg:overflow-y-auto lg:border-l lg:border-foreground ${
                    mobileView === "list" ? "block" : "hidden"
                  } lg:block`}
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
                        hasLocation={resolveMapCoordinates(event, findSuburb) !== null}
                        detailsHref={`/events/${event.slug}`}
                      />
                    </div>
                  ))}
                </section>
              </div>

              {/* Phones, map view: a visible way on to the list, under the map. */}
              {mobileView === "map" && (
                <button
                  type="button"
                  onClick={showList}
                  className="inline-flex min-h-11 items-center gap-1 self-start text-sm leading-5 font-semibold underline underline-offset-4 lg:hidden"
                >
                  Show the list of {filtered.length} event{filtered.length === 1 ? "" : "s"}
                </button>
              )}

              {withoutLocationCount > 0 && (
                <p className="text-xs leading-4 text-muted">
                  {withoutLocationCount} event{withoutLocationCount === 1 ? "" : "s"} can&rsquo;t be placed on the
                  map yet (no venue location on file) &mdash; still listed above.
                </p>
              )}

              {hasMore && (
                <Button
                  ref={loadMoreRef}
                  variant="outline"
                  onClick={handleLoadMore}
                  busy={loadingMore}
                  className="w-fit self-center"
                >
                  {loadingMore ? "Loading…" : "Load more events"}
                </Button>
              )}
            </>
          )}

          {/* Mobile map view only: a compact, dismissible summary for the selected event, since the highlighted list row isn't visible there. */}
          {selectedEvent && mobileView === "map" && (
            <SceneMapEventCard
              ref={sheetRef}
              variant="sheet"
              event={selectedEvent}
              findSuburb={findSuburb}
              detailsHref={`/events/${selectedEvent.slug}`}
              onDismiss={handleDismiss}
              className="fixed right-[calc(0.75rem+env(safe-area-inset-right))] bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-[calc(0.75rem+env(safe-area-inset-left))] z-[1200] lg:hidden"
            />
          )}

          <p className="sr-only" aria-live="polite">
            {selectedEvent
              ? `Selected ${selectedEvent.title}, ${formatEventDateShort(selectedEvent.startsAt)} ${formatEventTime(selectedEvent.startsAt)}, ${selectedEvent.venueName}, ${formatFeedPrice(selectedEvent)}.`
              : ""}
          </p>
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
    // Same rule as the live map and feeds (upcoming=1): only events that haven't ended.
    getUpcomingEvents().then((loaded) => {
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
 * Esri light-gray tiles, no API key) map synced with a scrollable event list,
 * backed by the same demo/live event data as the rest of the app.
 */
export default function SceneMap() {
  const categories = getEventCategories();

  if (!isApiConfigured) return <SceneMapDemo />;

  return <SceneMapLive categories={categories} />;
}
