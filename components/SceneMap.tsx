"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import BrandU from "@/components/brand/BrandU";
import SceneEventRow from "@/components/SceneEventRow";
import SceneMapFilterBar, { NEARBY_DISTANCE_ID, radiusLabel } from "@/components/SceneMapFilterBar";
import NearMeButton from "@/components/map/NearMeButton";
import { useMapLocate } from "@/components/map/useMapLocate";
import SceneMapEventCard from "@/components/map/SceneMapEventCard";
import { ListIcon, PinFilledIcon } from "@/components/map/MapControlIcons";
import { Button } from "@/components/ui/Button";
import FilterChip from "@/components/ui/FilterChip";
import { LoadingIndicator, ProgressLoader, useLoadingProgress } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice, PageHeader } from "@/components/ui/Section";
import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { getEventCategories, getUpcomingEvents } from "@/lib/data";
import { startDateTimeLine } from "@/lib/event-card";
import { useMapTileStyle } from "@/components/map/useMapTileStyle";
import { useLocationModule } from "@/components/search/useLocationModule";
import { findListedSuburb, resolveMapCoordinates, type SuburbLookup } from "@/lib/geo";
import {
  DEFAULT_NEARBY_RADIUS,
  NEAR_FRAME_FALLBACK_KM,
  NEARBY_RADII_KM,
  formatDistanceKm,
  nearestPlaceNames,
  nearestWithin,
  parseNearbyRadius,
  sortNearestFirst,
  splitByRadius,
  type DistanceEntry,
  type NearbyRadius,
} from "@/lib/map-near";
import { parseNearParam, readStoredNear, subscribeStoredNear } from "@/lib/near-storage";
import { bareSuburb } from "@/lib/place";
import { formatFeedPrice } from "@/lib/pricing";
import {
  matchesPricing,
  matchesSearch,
  matchesTimeFilter,
  type ScenePricingFilter,
  type TimeFilter,
} from "@/lib/scene-map-filters";
import type { Coordinates, EventCategory, SheltuhEvent } from "@/lib/types";

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

/** Live /map reads up to this many pages of PAGE_LIMIT at a time (the first load, and each Load more). */
export const MAP_PAGES_PER_LOAD = 4;
const PAGE_LIMIT = 50;

// The remembered "near" suburb (lib/near-storage.ts), followed in the browser: Nearby measures from it.
const serverNoNear = () => "";

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
  pricing: ScenePricingFilter;
}

const DEFAULT_FILTERS: FilterState = {
  search: "",
  category: "all",
  time: "all",
  specificDate: "",
  pricing: "all",
};

/**
 * What an address can carry that is the visitor's own view of the page: filters, a selected event.
 * With one, Nearby doesn't ask the browser for a position on open (it still measures from the
 * remembered suburb). `suburb` is an older address's place, read as `near`. Not `within`, `near`
 * or `view`: a radius, a place and List or Map are no reason not to ask.
 */
const VIEW_PARAMS = ["q", "cat", "time", "date", "suburb", "price", "sel"] as const;

function carriesViewState(params: URLSearchParams): boolean {
  return VIEW_PARAMS.some((key) => params.has(key));
}

function readFiltersFromParams(params: URLSearchParams): FilterState {
  return {
    search: params.get("q") ?? "",
    category: (params.get("cat") as EventCategory | "all") || "all",
    time: (params.get("time") as TimeFilter) || "all",
    specificDate: params.get("date") ?? "",
    pricing: (params.get("price") as ScenePricingFilter) || "all",
  };
}

function writeFiltersToParams({
  filters,
  selectedEventId,
  view,
  radius,
  near,
}: {
  filters: FilterState;
  selectedEventId: string | null;
  view: MobileView;
  radius: NearbyRadius;
  near: string | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (near) params.set("near", near);
  if (filters.search) params.set("q", filters.search);
  if (filters.category !== "all") params.set("cat", filters.category);
  if (filters.time !== "all") params.set("time", filters.time);
  if (filters.specificDate) params.set("date", filters.specificDate);
  if (filters.pricing !== "all") params.set("price", filters.pricing);
  if (radius !== DEFAULT_NEARBY_RADIUS) params.set("within", String(radius));
  if (selectedEventId) params.set("sel", selectedEventId);
  // The list is the default view on phones (the rules' Layout board), so only the map is written.
  if (view === "map") params.set("view", "map");
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

type Listed = DistanceEntry<SheltuhEvent>;

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

  // A place for this visit only: Community's Scenes by city link here as /map?near=Sydney (an
  // older address's ?suburb= too). Nearby measures from it and Where shows it, but it never
  // replaces the remembered suburb; a place chosen here (or Near me, or All of Australia) does,
  // and then that's what counts.
  const [nearParam] = useState(() => parseNearParam(searchParams.get("near") ?? searchParams.get("suburb") ?? undefined));
  const [nearDropped, setNearDropped] = useState(false);
  useEffect(() => subscribeStoredNear(() => setNearDropped(true)), []);
  const visitNear = nearParam && !nearDropped ? nearParam : null;

  // Events without venue coordinates go at their suburb's centre, from the ABS table of every
  // Australian suburb (lib/localities.ts). It loads here, after the page and only if some event
  // or the place needs it, so it isn't in /map's first load; the map waits for it, so markers
  // aren't placed twice. If it can't load, the few hand-entered centres in lib/geo.ts stand in,
  // and the page says so.
  // The table also finds the visitor's remembered suburb (owner decision D5: browser-only, never
  // sent), for Nearby to measure from.
  const savedNear = useSyncExternalStore(subscribeStoredNear, readStoredNear, serverNoNear);
  const needsSuburbs = events.some((event) => !event.coordinates);
  const needsTable = needsSuburbs || savedNear !== "" || visitNear !== null;
  const suburbTable = useLocationModule(needsTable);
  const findSuburb: SuburbLookup = suburbTable.module?.findLocality ?? findListedSuburb;
  const status: Status =
    eventsStatus === "loaded" && needsTable && !suburbTable.module && !suburbTable.failed ? "loading" : eventsStatus;
  const visitPlace = visitNear && suburbTable.module ? suburbTable.module.findLocality(visitNear) : null;
  const savedPlace = savedNear && suburbTable.module ? suburbTable.module.findLocality(savedNear) : null;
  // A place the table doesn't know is no place to measure from: the remembered one stands.
  const nearPlace = visitPlace ?? savedPlace;
  // Where's words, while the visit's place applies (until the table says it doesn't know it).
  const nearShown = visitNear && (!suburbTable.module || visitPlace) ? visitNear : undefined;
  const nearLat = nearPlace?.lat;
  const nearLng = nearPlace?.lng;
  const near = useMemo(
    () => (nearLat !== undefined && nearLng !== undefined ? { lat: nearLat, lng: nearLng } : null),
    [nearLat, nearLng],
  );

  // Read once on mount — the URL is the source of truth for "coming back",
  // not for reacting to every subsequent change (that would fight typing).
  const initial = useMemo(() => readFiltersFromParams(searchParams), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialSelected = useMemo(() => searchParams.get("sel"), []); // eslint-disable-line react-hooks/exhaustive-deps
  const initialView = useMemo<MobileView>(() => (searchParams.get("view") === "map" ? "map" : "list"), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [urlSteers] = useState(() => carriesViewState(searchParams));
  const [radius, setRadius] = useState<NearbyRadius>(() => parseNearbyRadius(searchParams.get("within")));
  // A selected event in the address outside the radius (a shared link): opens with no radius, once.
  const [selectionChecked, setSelectionChecked] = useState(!initialSelected);
  const [areaBounds, setAreaBounds] = useState<MapBounds | null>(null);
  const [rawSelectedEventId, setSelectedEventId] = useState<string | null>(initialSelected);
  // The event Near me opened: selecting it doesn't recentre the map, which stays framed on the
  // visitor and the nearest few (SceneMapPanel's `recentreOnSelect`). Any other selection does.
  const [nearestOpenedId, setNearestOpenedId] = useState<string | null>(null);

  // The desktop event card sits above the Mapbox wordmark in the map's lower-left corner (components/map/MapboxLogo.tsx).
  const mapboxLogo = useMapTileStyle().id === "mapbox-streets";
  const [filters, setFilters] = useState<FilterState>(initial);
  // List first on phones and tablets (the rules' Layout board: "List default, Map toggle button").
  const [mobileView, setMobileView] = useState<MobileView>(initialView);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const hasRestoredScroll = useRef(false);
  const listRef = useRef<HTMLElement>(null);
  const mapPaneRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);
  // What selected the current event (a row's Locate, a marker), for Dismiss to return focus to.
  const openerRef = useRef<HTMLElement | null>(null);
  // Focus to move once the next render has shown its target: the list after "Show the list",
  // the phone's sheet after Locate, the results after a radius button that has gone.
  const pendingFocus = useRef<"list" | "sheet" | "results" | null>(null);
  // Near me reordered the list nearest first: scroll it back to its top once rendered.
  const listToTop = useRef(false);
  // Dismiss: the event whose card closed, for focus to go back to once the map has re-rendered.
  const dismissedFrom = useRef<{ eventId: string; opener: HTMLElement | null } | null>(null);
  // The events listed before "Load more", to find the first new one if the button then goes.
  const idsBeforeMore = useRef<Set<string> | null>(null);

  const now = useMemo(() => new Date(), []);

  // The events the filters leave (before "Search this area" and the radius), soonest first.
  const matching = useMemo(() => {
    return events
      .filter((event) => filters.category === "all" || event.category === filters.category)
      .filter((event) => matchesPricing(event, filters.pricing))
      .filter((event) => matchesTimeFilter(event, filters.time, now, filters.specificDate))
      .filter((event) => matchesSearch(event, filters.search))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, filters, now]);

  const filtered = useMemo(() => {
    if (!areaBounds) return matching;
    return matching.filter((event) => {
      const coords = resolveMapCoordinates(event, findSuburb);
      if (!coords) return false;
      return (
        coords.lat <= areaBounds.north &&
        coords.lat >= areaBounds.south &&
        coords.lng <= areaBounds.east &&
        coords.lng >= areaBounds.west
      );
    });
  }, [matching, areaBounds, findSuburb]);

  // A located visitor is asking for what's near them: an earlier "Search this area" no longer
  // applies, and neither does an earlier selection. When they pressed Near me (not the ask on
  // open), the nearest event within the radius of those the filters leave opens, as if its pin
  // were tapped, and the map keeps its framing of the visitor and the nearest few rather than
  // flying to it.
  const locate = useMapLocate(!urlSteers && !nearParam, (position: Coordinates, byRequest: boolean) => {
    setAreaBounds(null);
    setSelectedEventId(null);
    setNearestOpenedId(null);
    if (!byRequest) return null;
    const reach = radius === "all" ? NEAR_FRAME_FALLBACK_KM : radius;
    const nearest = nearestWithin(matching, position, (event) => resolveMapCoordinates(event, findSuburb), reach);
    if (!nearest) return null;
    const id = nearest.item.id;
    // Dismiss gives focus back to Near me, which has kept it.
    openerRef.current = mapPaneRef.current?.querySelector<HTMLElement>("[data-near-me] button") ?? null;
    setSelectedEventId(id);
    setNearestOpenedId(id);
    // The list reorders nearest first: bring its top, where the opened event now is, into view.
    listToTop.current = true;
    return `Nearest: ${nearest.item.title}, ${formatDistanceKm(nearest.km ?? 0)}. Showing events nearest you.`;
  });

  // Where the visitor is, for the list to run nearest first within the radius and the map to frame
  // the events near them: their position from this page's Near me (or the ask on open), else the
  // place they chose (this visit's, else the remembered suburb's centre). In this page's memory only.
  const origin = locate.origin ?? (near ? { ...near, precise: false } : null);
  const originLat = origin?.lat;
  const originLng = origin?.lng;
  const originPrecise = origin?.precise ?? false;
  const located = useMemo(
    () => (originLat !== undefined && originLng !== undefined ? { lat: originLat, lng: originLng } : null),
    [originLat, originLng],
  );
  // A visitor's own "Search this area" is theirs to keep: the map stops framing around them while it applies.
  const frameAround = areaBounds ? null : located;
  const visitor = originPrecise ? located : null;
  // The place's name, as Where shows it: "within 25 km of Caulfield East".
  const placeShown = (nearShown ?? savedNear).trim();

  // The radius applies with a place to measure from, unless the visitor searched an area of the map.
  const radiusKm = located && !areaBounds && radius !== "all" ? radius : null;

  // `filtered`, nearest first from the place with each one's distance (else soonest first), split
  // at the radius: the list, the markers and the count are the events inside it. Events with no
  // position can't be near: with a radius they're left out (and counted as not on the map).
  const ranked = useMemo<Listed[]>(() => {
    if (!located) return filtered.map((event) => ({ item: event, km: null }));
    return sortNearestFirst(filtered, located, (event) => resolveMapCoordinates(event, findSuburb));
  }, [filtered, located, findSuburb]);
  const split = useMemo(
    () => (radiusKm === null ? { inside: ranked, outside: [], unplaced: [] } : splitByRadius(ranked, radiusKm)),
    [ranked, radiusKm],
  );
  const listed = split.inside;
  // The map keeps soonest first (what decides which event leads a cluster).
  const mapEvents = useMemo(() => {
    if (radiusKm === null) return filtered;
    const inside = new Set(listed.map((entry) => entry.item.id));
    return filtered.filter((event) => inside.has(event.id));
  }, [filtered, listed, radiusKm]);

  // A selected event in the address that the radius would hide (a shared link to one far away):
  // show every distance instead, once, so the selection the link was for still shows.
  if (!selectionChecked && status === "loaded") {
    setSelectionChecked(true);
    const far = split.outside.some((entry) => entry.item.id === initialSelected);
    if (far) setRadius("all");
  }

  // Derived rather than synced via effect: a selection that no longer
  // matches the active filters (or the radius) is simply treated as no selection.
  const selectedEvent = mapEvents.find((event) => event.id === rawSelectedEventId) ?? null;
  const selectedEventId = selectedEvent?.id ?? null;

  // Keeps the URL in sync (via replace, so filter tweaks don't spam
  // history) so the back button from a details page returns here with
  // filters and selection intact.
  useEffect(() => {
    const params = writeFiltersToParams({
      filters,
      selectedEventId: rawSelectedEventId,
      view: mobileView,
      radius,
      near: visitNear,
    });
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, rawSelectedEventId, mobileView, radius, visitNear, pathname]);

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
  }, [initialSelected, status, listed, progress.visible]);

  // After each render: move focus the user asked for once its target is showing.
  useEffect(() => {
    if (listToTop.current) {
      listToTop.current = false;
      if (listRef.current) listRef.current.scrollTop = 0;
    }
    if (pendingFocus.current === "list" && mobileView === "list" && listRef.current) {
      pendingFocus.current = null;
      listRef.current.focus();
    } else if (pendingFocus.current === "sheet" && sheetRef.current) {
      pendingFocus.current = null;
      if (isShown(sheetRef.current)) sheetRef.current.focus();
    } else if (pendingFocus.current === "results") {
      // The radius buttons that asked have gone: the Distance filter (which now says the radius),
      // else the list, else the count.
      pendingFocus.current = null;
      const distance = document.getElementById(NEARBY_DISTANCE_ID);
      if (isShown(distance)) distance.focus();
      else if (isShown(listRef.current)) listRef.current.focus();
      else countRef.current?.focus();
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
        const firstNew = listed.find((entry) => !before.has(entry.item.id));
        const link = firstNew ? rowRefs.current.get(firstNew.item.id)?.querySelector("a") : null;
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

  const withoutLocationCount =
    radiusKm === null
      ? filtered.filter((event) => resolveMapCoordinates(event, findSuburb) === null).length
      : split.unplaced.length;

  const hasActiveFilters =
    filters.category !== "all" ||
    filters.pricing !== "all" ||
    filters.time !== "all" ||
    filters.search !== "" ||
    areaBounds !== null;
  const count = listed.length;
  const countWords = `upcoming event${count === 1 ? "" : "s"}`;
  // "within 25 km of Caulfield East" (the proposal); just the radius when the place has no name.
  const withinWords = radiusKm === null ? "" : ` within ${radiusKm} km${placeShown ? ` of ${placeShown}` : ""}`;
  // Announced in full; shown as the proposal (the filters show themselves, the rows the distances).
  const countSentence = `${count} ${countWords}${hasActiveFilters ? " matching your filters" : ""}${
    withinWords || (located ? ", nearest first" : "")
  }`;
  const noneNear = radiusKm !== null && count === 0 && filtered.length > 0;
  const noneNearSentence = `No events found near ${placeShown || "you"}.`;
  // Further away: how many more there are outside the radius, and the nearest few places they're in.
  const furtherCount = split.outside.length;
  const furtherPlaces = nearestPlaceNames(split.outside, (event) => bareSuburb(event.suburb, event.state));

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setAreaBounds(null);
    locate.clearFocus();
  }

  /** A radius from the empty state or the Further away strip, whose buttons then go. */
  function chooseRadius(next: NearbyRadius) {
    setRadius(next);
    pendingFocus.current = "results";
  }

  // Phones: Locate switches to the map, hiding the row (and its button) that had focus, so focus
  // goes to the selected event's sheet. Desktop keeps it on the row: the card is on the map beside it.
  function handleLocate(eventId: string, opener: HTMLElement) {
    openerRef.current = opener;
    setSelectedEventId(eventId);
    setNearestOpenedId(null);
    setMobileView("map");
    if (!isDesktop()) pendingFocus.current = "sheet";
  }

  function handleMapSelect(eventId: string) {
    // A marker, or a spot list's row (which closes): Dismiss falls back to the marker if that's gone.
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedEventId(eventId);
    setNearestOpenedId(null);
    rowRefs.current.get(eventId)?.scrollIntoView({ block: "nearest" });
  }

  // Dismiss removes the focused button with the card, so focus goes back to what opened it: the
  // row's Locate button, or the event on the map. Done after the re-render: deselecting can put
  // the event back into a cluster, replacing its marker (see the effect below).
  function handleDismiss() {
    if (selectedEventId) dismissedFrom.current = { eventId: selectedEventId, opener: openerRef.current };
    openerRef.current = null;
    setSelectedEventId(null);
    setNearestOpenedId(null);
  }

  function showList() {
    pendingFocus.current = "list";
    setMobileView("list");
  }

  function handleLoadMore() {
    idsBeforeMore.current = new Set(listed.map((entry) => entry.item.id));
    onLoadMore?.();
  }

  // Only the filters that don't show their own choice get a removable chip (the time, scene, price
  // and distance filters say theirs): Clear all still resets every one.
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.search) chips.push({ key: "q", label: `"${filters.search}"`, onRemove: () => setFilters((f) => ({ ...f, search: "" })) });
  if (areaBounds) chips.push({ key: "area", label: "This area", onRemove: () => setAreaBounds(null) });

  // The owner's mocks (390, 768): List | Map, the chosen half black. 48px, for touch.
  const viewButton = (view: MobileView, label: string) => (
    <button
      type="button"
      aria-pressed={mobileView === view}
      onClick={() => setMobileView(view)}
      className={`label-button flex flex-1 items-center justify-center gap-2 rounded-control px-4 ${
        mobileView === view ? "bg-foreground text-background" : "text-foreground hover:bg-hover"
      }`}
    >
      {view === "map" ? <PinFilledIcon className="size-4" /> : <ListIcon className="size-4" />}
      {label}
    </button>
  );
  const viewToggle = (
    <div
      role="group"
      aria-label="Show events as"
      className="flex h-12 shrink-0 gap-1 rounded-control border-control border-foreground bg-background p-1 lg:hidden"
    >
      {viewButton("list", "List")}
      {viewButton("map", "Map")}
    </div>
  );

  // The radii the empty state offers (the audit's: "Within 10 km", "25 km", "50 km"): the one in
  // use, pressed, and every larger one of those.
  const widerRadii = radiusKm === null ? [] : NEARBY_RADII_KM.filter((km) => km === radiusKm || (km > radiusKm && km >= 10));

  return (
    <div className="flex flex-col gap-6">
      {/* The proposal's headline: the brand's Ü shown through BrandU, read as "Sheltüh near you."; the eyebrow names the page. */}
      <PageHeader
        brand
        flush
        eyebrow="Nearby"
        title={<BrandU spoken="Sheltüh near you.">SHELTÜH NEAR YOÜ.</BrandU>}
      />

      <div className="mt-2">
        <SceneMapFilterBar
          search={filters.search}
          onSearchChange={(search) => setFilters((f) => ({ ...f, search }))}
          near={nearShown}
          categories={categories}
          category={filters.category}
          onCategoryChange={(category) => setFilters((f) => ({ ...f, category }))}
          time={filters.time}
          onTimeChange={(time) => setFilters((f) => ({ ...f, time, specificDate: time === "date" ? f.specificDate : "" }))}
          specificDate={filters.specificDate}
          onSpecificDateChange={(specificDate) => setFilters((f) => ({ ...f, specificDate }))}
          pricing={filters.pricing}
          onPricingChange={(pricing) => setFilters((f) => ({ ...f, pricing }))}
          radius={located ? radius : null}
          onRadiusChange={setRadius}
          viewToggle={viewToggle}
        />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="flex min-h-12 items-center gap-2 rounded-control border-control border-foreground bg-background px-4 text-sm leading-5 font-medium text-foreground hover:bg-hover"
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
            className="min-h-12 px-2 text-sm leading-5 font-semibold underline underline-offset-4"
          >
            Clear all
          </button>
        </div>
      )}

      {/* The polite status is always mounted, so the start of a load and its result ("12 upcoming
          events") are both announced; the visible count below isn't a second live region. */}
      <p role="status" className="sr-only">
        {status === "loading"
          ? "Loading events…"
          : status === "loaded" && !progress.visible
            ? noneNear
              ? noneNearSentence
              : countSentence
            : ""}
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

      {status === "loaded" && !progress.visible && needsSuburbs && suburbTable.failed && (
        <div className="flex flex-col items-start gap-4">
          <Notice tone="danger" role="alert">
            Couldn’t load suburb locations. Some events aren’t on the map.
          </Notice>
          <Button variant="outline" size="sm" onClick={suburbTable.retry}>
            Try again
          </Button>
        </div>
      )}

      {status === "loaded" && !progress.visible && (
        <>
          {/* How many are listed, and within what of where (the proposal); the status above is what
              announces it. Focusable, for focus to land on when the buttons that changed it go. */}
          <p
            ref={countRef}
            tabIndex={-1}
            data-map-count=""
            className="mono-s border-t border-surface-border pt-6 text-foreground focus:outline-none lg:mono-m"
          >
            <span className="font-semibold">{count}</span> {countWords}
            {withinWords}
          </p>

          {filtered.length === 0 ? (
            <EmptyState
              title="No events match your filters"
              action={<Button onClick={resetFilters}>Broaden search</Button>}
            />
          ) : (
            <>
              <div className="grid overflow-hidden rounded-card border-control border-foreground bg-background lg:grid-cols-[55fr_45fr]">
                {/* At most 60% of a phone's height, so there's always page to scroll by outside the map. */}
                <div
                  ref={mapPaneRef}
                  data-map-pane=""
                  className={`relative h-[min(26.25rem,60svh)] lg:h-[37.5rem] ${mobileView === "map" ? "block" : "hidden"} lg:block`}
                >
                  <SceneMapPanel
                    events={mapEvents}
                    findSuburb={findSuburb}
                    around={frameAround}
                    visitor={visitor}
                    focus={locate.focus}
                    onFocused={locate.focused}
                    selectedEventId={selectedEventId}
                    recentreOnSelect={selectedEventId !== nearestOpenedId}
                    onSelect={handleMapSelect}
                    onSearchArea={setAreaBounds}
                    onShowList={showList}
                  />
                  {/* Phones: the map's lower-left corner (above the Mapbox wordmark, where it's shown); from lg,
                      under the zoom buttons, clear of the selected event's card. */}
                  {locate.canLocate && (
                    <NearMeButton
                      onLocate={locate.locate}
                      locating={locate.locating}
                      status={locate.status}
                      onDismiss={locate.dismissStatus}
                      onHold={locate.holdStatus}
                      onExtend={locate.extendStatus}
                      className={`${mapboxLogo ? "bottom-8" : "bottom-px"} lg:top-27 lg:bottom-auto`}
                    />
                  )}
                  {/* Desktop: the selected event over the map's lower-left corner (phones get the bottom card below). */}
                  {selectedEvent && (
                    <SceneMapEventCard
                      variant="overlay"
                      event={selectedEvent}
                      findSuburb={findSuburb}
                      detailsHref={`/events/${selectedEvent.slug}`}
                      onDismiss={handleDismiss}
                      className={`absolute left-3 z-10 hidden w-72 lg:block ${mapboxLogo ? "bottom-10" : "bottom-3"}`}
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
                  className={`relative h-auto overflow-visible focus-visible:-outline-offset-2 lg:h-[37.5rem] lg:overflow-y-auto lg:border-l-control lg:border-foreground ${
                    mobileView === "list" ? "block" : "hidden"
                  } lg:block`}
                >
                  {noneNear && (
                    // The audit's empty state (p. 19): say nothing is close, rather than show other states.
                    <div data-nearby-empty="" className="p-6 lg:p-8">
                      <h2 className="heading-h3">{noneNearSentence}</h2>
                      <p className="body-m mt-2 text-muted">Try expanding your search area.</p>
                      <div className="mt-6 flex flex-wrap gap-2">
                        {widerRadii.map((km) => (
                          <FilterChip key={km} pressed={km === radiusKm} onClick={() => chooseRadius(km)}>
                            {km === radiusKm ? radiusLabel(km) : `${km} km`}
                          </FilterChip>
                        ))}
                      </div>
                    </div>
                  )}
                  {listed.map(({ item: event, km }) => (
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
                        distance={km === null ? null : formatDistanceKm(km)}
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
                  className="inline-flex min-h-12 items-center gap-1 self-start text-sm leading-5 font-semibold underline underline-offset-4 lg:hidden"
                >
                  Show the list of {count} event{count === 1 ? "" : "s"}
                </button>
              )}
            </>
          )}

          {/* The proposal's Further away: what the radius leaves out, and the way to see it all. */}
          {furtherCount > 0 && radiusKm !== null && (
            <div
              data-further-away=""
              className="flex flex-col items-start gap-4 rounded-card bg-surface p-4 lg:flex-row lg:items-center lg:gap-6 lg:bg-transparent lg:p-0"
            >
              <p className="mono-s shrink-0 text-muted uppercase">Further away</p>
              <p className="body-m text-foreground">
                {furtherCount} more event{furtherCount === 1 ? "" : "s"} outside {radiusKm} km
                {furtherPlaces.length > 0 ? ` — ${furtherPlaces.join(", ")}.` : "."}
              </p>
              <Button variant="outline" size="sm" onClick={() => chooseRadius("all")} className="shrink-0">
                Show all of Australia
              </Button>
            </div>
          )}

          {withoutLocationCount > 0 && (
            <p className="body-s text-muted">
              {withoutLocationCount} event{withoutLocationCount === 1 ? "" : "s"} not on the map (no venue
              location).
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
              ? `Selected ${selectedEvent.title}, ${startDateTimeLine(selectedEvent)}, ${selectedEvent.venueName}, ${formatFeedPrice(selectedEvent)}.`
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

/**
 * Live /map's events from `cursor` on: upcoming only, 50 a page (without these the map listed the
 * oldest events, ended ones included), up to MAP_PAGES_PER_LOAD pages at once, so a national map
 * isn't just the soonest 50. `nextCursor`: where the next Load more starts, if there's more.
 */
async function readMapPages(cursor: string | undefined): Promise<{ items: SheltuhEvent[]; nextCursor?: string }> {
  const items: SheltuhEvent[] = [];
  let next = cursor;
  for (let page = 0; page < MAP_PAGES_PER_LOAD; page++) {
    const result = await listPublicEvents({ upcoming: true, limit: PAGE_LIMIT, cursor: next });
    items.push(...result.items.map(adaptPublicEvent));
    next = result.nextCursor;
    if (!next) break;
  }
  return { items, nextCursor: next };
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

    readMapPages(cursor)
      .then((page) => {
        setEvents((prev) => {
          // An event can shift across a page boundary between two reads: keep the first copy.
          const seenIds = new Set(replace ? [] : prev.map((e) => e.id));
          const fresh = page.items.filter((e) => !seenIds.has(e.id) && seenIds.add(e.id));
          return replace ? fresh : [...prev, ...fresh];
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
 * Nearby (/map): what's on within a radius of the visitor's one location, as a list beside a real
 * (client-only, Leaflet; Mapbox Streets tiles with a token, else Esri's: lib/map-tiles.ts) map,
 * backed by the same demo/live event data as the rest of the app.
 */
export default function SceneMap() {
  const categories = getEventCategories();

  if (!isApiConfigured) return <SceneMapDemo />;

  return <SceneMapLive categories={categories} />;
}
