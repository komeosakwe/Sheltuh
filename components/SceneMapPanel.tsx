"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import EventMarkerLayer, { type MarkerDatum, type OpenSpot } from "@/components/map/EventMarkerLayer";
import MapSpotList from "@/components/map/MapSpotList";
import MapboxLogo from "@/components/map/MapboxLogo";
import MapStyles from "@/components/map/MapStyles";
import { runQuietly, stopQuietly } from "@/components/map/quiet-map";
import { useMapTileStyle } from "@/components/map/useMapTileStyle";
import { buttonClass } from "@/components/ui/Button";
import { ProgressLoader, useLoadingProgress } from "@/components/ui/ProgressLoader";
import type { MapFocus } from "@/components/map/useMapLocate";
import { MAP_NEAR_ZOOM } from "@/lib/map-layout";
import { nearestToFrame } from "@/lib/map-near";
import {
  AUSTRALIA_BOUNDS,
  AUSTRALIA_MIN_ZOOM,
  AUSTRALIA_VIEW,
  resolveMapCoordinates,
  type SuburbLookup,
} from "@/lib/geo";
import type { Coordinates, SheltuhEvent } from "@/lib/types";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

function hasSize(map: L.Map): boolean {
  const size = map.getSize();
  return size.x > 0 && size.y > 0;
}

/** Fits `targets`, or the mainland and Tasmania when there are none. */
function fitTargets(map: L.Map, targets: MarkerDatum[], reducedMotion: boolean, programmaticMoveRef: RefObject<boolean>) {
  programmaticMoveRef.current = true;
  if (targets.length === 0) {
    const v = AUSTRALIA_VIEW;
    map.fitBounds(
      [
        [v.south, v.west],
        [v.north, v.east],
      ],
      { padding: [8, 8], animate: !reducedMotion },
    );
    return;
  }
  const bounds = L.latLngBounds(targets.map((m) => [m.lat, m.lng]));
  map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15, animate: !reducedMotion });
}

/** Centres on `place` at the suburb zoom: flies there when `smooth` (and motion is welcome), else jumps. */
function centreOn(
  map: L.Map,
  place: Coordinates,
  smooth: boolean,
  reducedMotion: boolean,
  programmaticMoveRef: RefObject<boolean>,
) {
  programmaticMoveRef.current = true;
  if (smooth && !reducedMotion) map.flyTo([place.lat, place.lng], MAP_NEAR_ZOOM, { duration: 0.8 });
  else map.setView([place.lat, place.lng], MAP_NEAR_ZOOM, { animate: false });
}

/**
 * Frames `around` (the visitor, or their saved suburb's centre) with the events nearest it
 * (lib/map-near.ts nearestToFrame): fits them all, zooming in no further than MAP_NEAR_ZOOM, so a
 * few events close together still show the neighbourhood. With none near enough, centres on
 * `around` at MAP_NEAR_ZOOM, unless `onlyIfNear` (a re-fit after a filter change, where the events
 * themselves matter more than the visitor): then it does nothing and returns false.
 */
function frameAround(
  map: L.Map,
  around: Coordinates,
  markers: MarkerDatum[],
  smooth: boolean,
  reducedMotion: boolean,
  programmaticMoveRef: RefObject<boolean>,
  onlyIfNear: boolean,
): boolean {
  const near = nearestToFrame(
    around,
    markers.map((marker) => ({ lat: marker.lat, lng: marker.lng })),
  );
  if (near.length === 0) {
    if (onlyIfNear) return false;
    centreOn(map, around, smooth, reducedMotion, programmaticMoveRef);
    return true;
  }
  const bounds = L.latLngBounds([[around.lat, around.lng], ...near.map((place): L.LatLngTuple => [place.lat, place.lng])]);
  programmaticMoveRef.current = true;
  const options = { padding: L.point(48, 48), maxZoom: MAP_NEAR_ZOOM };
  if (smooth && !reducedMotion) map.flyToBounds(bounds, { ...options, duration: 0.8 });
  else map.fitBounds(bounds, { ...options, animate: false });
  return true;
}

/**
 * Applies a centre request the map hasn't yet (`applied` holds the last one's id), once it has a
 * size (a hidden map waits for its resize). Returns whether it did, so the caller skips fitting
 * the markers over it. `onFocused` lets the owner drop the request (and its coordinates).
 */
function applyFocus(
  map: L.Map,
  focus: MapFocus | null,
  markers: MarkerDatum[],
  applied: RefObject<number | null>,
  reducedMotion: boolean,
  programmaticMoveRef: RefObject<boolean>,
  onFocused: ((id: number) => void) | undefined,
): boolean {
  if (!focus || focus.id === applied.current || !hasSize(map)) return false;
  applied.current = focus.id;
  stopQuietly(map, programmaticMoveRef);
  if (focus.nearby) frameAround(map, focus, markers, focus.smooth, reducedMotion, programmaticMoveRef, false);
  else centreOn(map, focus, focus.smooth, reducedMotion, programmaticMoveRef);
  onFocused?.(focus.id);
  return true;
}

/**
 * Frames the markers. With a place to frame around (`around`: the visitor, or the saved suburb's
 * centre), the first framing always goes there (the nearest events with it, or just the place);
 * a later one (a filter changed the markers) does when some are near it, else fits them all.
 * Without one: every marker (or Australia).
 */
function frameFirst(
  map: L.Map,
  markers: MarkerDatum[],
  around: Coordinates | null,
  first: boolean,
  reducedMotion: boolean,
  programmaticMoveRef: RefObject<boolean>,
) {
  if (around && frameAround(map, around, markers, false, reducedMotion, programmaticMoveRef, !first)) return;
  fitTargets(map, markers, reducedMotion, programmaticMoveRef);
}

/** Centres on the selected event if there is one, otherwise frames the markers (frameFirst). */
function frameMarkers(
  map: L.Map,
  markers: MarkerDatum[],
  around: Coordinates | null,
  first: boolean,
  selectedEventId: string | null,
  reducedMotion: boolean,
  programmaticMoveRef: RefObject<boolean>,
) {
  const selected = selectedEventId ? markers.find((m) => m.event.id === selectedEventId) : undefined;
  if (selected) {
    programmaticMoveRef.current = true;
    const zoom = Math.max(map.getZoom(), 14);
    if (reducedMotion) map.setView([selected.lat, selected.lng], zoom, { animate: false });
    else map.flyTo([selected.lat, selected.lng], zoom, { duration: 0.6 });
    return;
  }
  frameFirst(map, markers, around, first, reducedMotion, programmaticMoveRef);
}

/**
 * Recentres/zooms the map when the selected event changes, and fits the
 * markers whenever they change: around the visitor (or their saved suburb)
 * and the events nearest them if there is one (`around`), else all of them,
 * or Australia with none. A centre request (`focus`: the visitor's
 * location, a suburb they picked) wins over fitting the markers. The visitor's
 * own pan or zoom is never undone: nothing re-frames unless the markers change
 * or a new request comes in.
 */
function MapController({
  markers,
  around,
  focus,
  onFocused,
  selectedEventId,
  programmaticMoveRef,
  reducedMotion,
}: {
  markers: MarkerDatum[];
  around: Coordinates | null;
  focus: MapFocus | null;
  onFocused?: (id: number) => void;
  selectedEventId: string | null;
  programmaticMoveRef: RefObject<boolean>;
  reducedMotion: boolean;
}) {
  const map = useMap();
  // Latest props for the resize listener below, which is registered once.
  const latest = useRef({ markers, around, focus, onFocused, selectedEventId, reducedMotion });
  useEffect(() => {
    latest.current = { markers, around, focus, onFocused, selectedEventId, reducedMotion };
  });
  // The markers the map was first framed with: only that framing centres on the saved suburb. Kept
  // as the markers themselves rather than a flag, so framing them again (React re-running effects
  // in development) is still the first framing; a new set of markers (a filter) isn't.
  const firstFramed = useRef<MarkerDatum[] | null>(null);
  const isFirstFraming = (current: MarkerDatum[]) => firstFramed.current === null || firstFramed.current === current;
  // The id of the last centre request applied.
  const appliedFocus = useRef<number | null>(null);
  // What the map's viewport was last set for (markers framed, a centre request applied, the selected
  // event flown to), to tell a map revealed after being hidden (the phone's Map tab) that already has
  // its viewport, which stays, from one with a framing still owed.
  const framed = useRef<{ markers: MarkerDatum[]; selectedEventId: string | null } | null>(null);
  const needsFraming = (current: { markers: MarkerDatum[]; selectedEventId: string | null }) =>
    framed.current === null ||
    framed.current.markers !== current.markers ||
    (current.selectedEventId !== null && framed.current.selectedEventId !== current.selectedEventId);

  // Re-fits whenever the visible marker set actually changes (e.g. a
  // filter narrows it) — `markers` only gets a new reference when the
  // underlying event list or filters change, not on selection alone.
  useEffect(() => {
    // A filter change can land mid-flight of a previous fitBounds/flyTo
    // animation. Leaflet's animation loop keeps touching layers each
    // frame, and if a marker it's tracking has just been unmounted by
    // React (e.g. the result set went to zero), that read throws
    // ("Cannot read properties of undefined (reading '_leaflet_pos')").
    // Cancelling any in-flight animation before the marker set changes
    // avoids that race entirely.
    stopQuietly(map, programmaticMoveRef);
    // Synchronous, same-tick safeguard: if this container was just
    // revealed (e.g. the mobile list→map tab switch) in this very render,
    // the async ResizeObserver in ResizeSync hasn't caught up yet — so
    // re-measure right here too, before projecting any coordinates against it.
    runQuietly(programmaticMoveRef, () => map.invalidateSize());
    // Hidden (the phone's list tab): fitting a 0×0 map snaps to max zoom
    // around the centre. Wait for the resize listener below instead.
    if (!hasSize(map)) return;
    const current = latest.current;
    // A centre request made with this change (the location filter) wins over fitting.
    if (!applyFocus(map, current.focus, markers, appliedFocus, reducedMotion, programmaticMoveRef, current.onFocused)) {
      frameFirst(map, markers, current.around, isFirstFraming(markers), reducedMotion, programmaticMoveRef);
    }
    firstFramed.current ??= markers;
    framed.current = { markers, selectedEventId: current.selectedEventId };
  }, [map, markers, programmaticMoveRef, reducedMotion]);

  // A new centre request: the visitor's location, or a suburb picked in the location filter.
  useEffect(() => {
    const current = latest.current;
    if (applyFocus(map, focus, current.markers, appliedFocus, current.reducedMotion, programmaticMoveRef, current.onFocused)) {
      framed.current = { markers: current.markers, selectedEventId: current.selectedEventId };
    }
  }, [map, focus, programmaticMoveRef]);

  // Nothing selected on a shown map: a later selection (even of the same event) needs flying to.
  useEffect(() => {
    if (!selectedEventId && framed.current && hasSize(map)) {
      framed.current = { markers: framed.current.markers, selectedEventId: null };
    }
  }, [map, selectedEventId]);

  useEffect(() => {
    if (!selectedEventId) return;
    const marker = markers.find((m) => m.event.id === selectedEventId);
    if (!marker) return;
    stopQuietly(map, programmaticMoveRef);
    runQuietly(programmaticMoveRef, () => map.invalidateSize());
    if (!hasSize(map)) return;
    frameMarkers(map, markers, null, false, selectedEventId, reducedMotion, programmaticMoveRef);
    firstFramed.current ??= markers;
    framed.current = { markers, selectedEventId };
  }, [map, markers, selectedEventId, programmaticMoveRef, reducedMotion]);

  // When a hidden map gets a real size (the phone's Map tab), do the framing it was owed: a centre
  // request, new markers or a selection made while it was hidden, or its first framing. A map
  // that was already framed keeps its viewport (a located one, say); Leaflet's invalidateSize,
  // which raised this resize, keeps the centre.
  // Deferred a frame: `resize` fires from inside invalidateSize(), and framing
  // must start after that call (and its own moveend) has finished.
  useEffect(() => {
    let frame: number | null = null;
    function handleResize(resize: L.ResizeEvent) {
      const wasHidden = resize.oldSize.x === 0 || resize.oldSize.y === 0;
      if (!wasHidden || resize.newSize.x === 0 || resize.newSize.y === 0) return;
      if (frame !== null) L.Util.cancelAnimFrame(frame);
      frame = L.Util.requestAnimFrame(() => {
        frame = null;
        const current = latest.current;
        stopQuietly(map, programmaticMoveRef);
        if (applyFocus(map, current.focus, current.markers, appliedFocus, current.reducedMotion, programmaticMoveRef, current.onFocused)) {
          firstFramed.current ??= current.markers;
          framed.current = { markers: current.markers, selectedEventId: current.selectedEventId };
          return;
        }
        if (!needsFraming(current)) return;
        frameMarkers(
          map,
          current.markers,
          current.around,
          isFirstFraming(current.markers),
          current.selectedEventId,
          current.reducedMotion,
          programmaticMoveRef,
        );
        firstFramed.current ??= current.markers;
        framed.current = { markers: current.markers, selectedEventId: current.selectedEventId };
      });
    }
    map.on("resize", handleResize);
    return () => {
      map.off("resize", handleResize);
      if (frame !== null) L.Util.cancelAnimFrame(frame);
    };
  }, [map, programmaticMoveRef]);

  return null;
}

/**
 * Publishes where the map is (centre rounded to about 100 m, zoom) as data attributes on its
 * container, for the end-to-end tests. Written straight to the DOM on each move: no React state.
 */
function MapViewProbe() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    function publish() {
      const centre = map.getCenter();
      container.dataset.centerLat = centre.lat.toFixed(3);
      container.dataset.centerLng = centre.lng.toFixed(3);
      container.dataset.zoom = String(map.getZoom());
    }
    publish();
    map.on("moveend", publish);
    return () => {
      map.off("moveend", publish);
    };
  }, [map]);
  return null;
}

const VISITOR_ICON = L.divIcon({
  html: '<span aria-hidden="true"></span>',
  className: "scene-visitor",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/** A dot where the visitor is, under the events' markers. Not interactive: nothing to focus or press. */
function VisitorMarker({ position }: { position: Coordinates }) {
  return <Marker position={[position.lat, position.lng]} icon={VISITOR_ICON} interactive={false} keyboard={false} zIndexOffset={-1000} />;
}

/** Shows "Search this area" only after the *user* pans/zooms — not after a programmatic fitBounds/flyTo. */
function SearchThisAreaControl({
  programmaticMoveRef,
  onSearchArea,
}: {
  programmaticMoveRef: RefObject<boolean>;
  onSearchArea: (bounds: L.LatLngBounds) => void;
}) {
  const map = useMap();
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    function handleMoveEnd() {
      if (programmaticMoveRef.current) {
        programmaticMoveRef.current = false;
        return;
      }
      setShowButton(true);
    }
    map.on("moveend", handleMoveEnd);
    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [map, programmaticMoveRef]);

  if (!showButton) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center">
      <button
        type="button"
        onClick={() => {
          onSearchArea(map.getBounds());
          setShowButton(false);
        }}
        className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-control border border-foreground bg-foreground px-4 py-2 text-sm font-medium text-background"
      >
        <span aria-hidden="true">⟳</span> Search this area
      </button>
    </div>
  );
}

type TileStatus = "loading" | "loaded" | "failed";

/** Tracks whether the basemap's tiles actually rendered, for the loading/failure UI in the parent. */
function TileWatcher({
  status,
  retryKey,
  programmaticMoveRef,
}: {
  status: TileStatus;
  retryKey: number;
  programmaticMoveRef: RefObject<boolean>;
}) {
  const map = useMap();
  useEffect(() => {
    // A retry (new retryKey) or filter-driven refit shouldn't get stuck
    // showing a stale failure banner once tiles are actually loading again.
    void retryKey;
    runQuietly(programmaticMoveRef, () => map.invalidateSize());
  }, [map, retryKey, status, programmaticMoveRef]);
  return null;
}

/**
 * On mobile the map tab starts `display:none` (list-first) while still
 * mounted, so Leaflet measures a 0×0 container and caches that. Revealing
 * it later without telling Leaflet its size actually changed leaves that
 * stale 0×0 cached — the next fitBounds/flyTo then projects coordinates
 * against it and throws "Invalid LatLng object: (NaN, NaN)", crashing the
 * page. A ResizeObserver on the map's own container is what notices the
 * hidden→visible flip (or any other resize) and re-measures.
 */
function ResizeSync({ programmaticMoveRef }: { programmaticMoveRef: RefObject<boolean> }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => runQuietly(programmaticMoveRef, () => map.invalidateSize()));
    observer.observe(container);
    return () => observer.disconnect();
  }, [map, programmaticMoveRef]);
  return null;
}

interface SceneMapPanelProps {
  events: SheltuhEvent[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
  onSearchArea: (bounds: { north: number; south: number; east: number; west: number }) => void;
  /** Phones: switch to the list (offered when the map's tiles fail to load). */
  onShowList?: () => void;
  /** Where an event without coordinates of its own goes: its suburb's centre (lib/geo.ts). */
  findSuburb?: SuburbLookup;
  /**
   * Where the visitor is, for the map to frame around with the events nearest it (lib/map-near.ts):
   * their position, or the centre of their saved suburb (browser-only, never sent). It opens
   * there, and a filter change re-fits there while something is near. Null: every event.
   */
  around?: Coordinates | null;
  /** The visitor's own position, marked on the map (not a suburb's centre). Browser-only, never sent. */
  visitor?: Coordinates | null;
  /** Centre here now and zoom in (the visitor's location, a suburb picked); applied once per `id`. */
  focus?: MapFocus | null;
  /** Called with a request's `id` once the map has applied it. */
  onFocused?: (id: number) => void;
}

const TILE_LOAD_TIMEOUT_MS = 9000;

/**
 * Client-only Leaflet map. The basemap is Mapbox Streets when a public
 * Mapbox token is set, in both themes; without one it's Esri's free
 * light-gray canvas (no API key), a light, quiet map with streets and
 * neighbourhood labels (lib/map-tiles.ts, docs/maps.md).
 */
export default function SceneMapPanel({
  events,
  selectedEventId,
  onSelect,
  onSearchArea,
  onShowList,
  findSuburb,
  around = null,
  visitor = null,
  focus = null,
  onFocused,
}: SceneMapPanelProps) {
  const [status, setStatus] = useState<TileStatus>("loading");
  const [retryKey, setRetryKey] = useState(0);
  const loadedCount = useRef(0);
  const errorCount = useRef(0);
  const programmaticMoveRef = useRef(false);
  const mapRef = useRef<L.Map | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const tileStyle = useMapTileStyle();
  const [openSpot, setOpenSpot] = useState<OpenSpot | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const markers = useMemo<MarkerDatum[]>(() => {
    return events.flatMap((event) => {
      // Outside Australia = not pinned (a position overseas is a mistake).
      const coords = resolveMapCoordinates(event, findSuburb);
      return coords ? [{ event, lat: coords.lat, lng: coords.lng }] : [];
    });
  }, [events, findSuburb]);

  // Start on Australia; the controller then fits the events (or, with none, the mainland and Tasmania).
  const center: Coordinates = {
    lat: (AUSTRALIA_VIEW.south + AUSTRALIA_VIEW.north) / 2,
    lng: (AUSTRALIA_VIEW.west + AUSTRALIA_VIEW.east) / 2,
  };

  // Derived, not synced: when filters drop some of a spot's events the list
  // shrinks, and when none are left it is simply closed.
  const spotEvents = openSpot
    ? openSpot.ids.flatMap((id) => markers.find((marker) => marker.event.id === id)?.event ?? [])
    : [];

  function closeSpot() {
    const target = openSpot?.returnFocus;
    setOpenSpot(null);
    if (target?.isConnected) target.focus({ preventScroll: true });
    else mapRef.current?.getContainer().focus({ preventScroll: true });
  }

  // A new attempt: count its tiles afresh, so tiles that can't load (e.g. a Mapbox token
  // refused on this domain) show the failure UI again.
  useEffect(() => {
    loadedCount.current = 0;
    errorCount.current = 0;
    // Deferred via queueMicrotask so the effect body itself never calls
    // setState directly (matches the pattern used elsewhere in this app,
    // e.g. LiveEventFeed.tsx) — retryKey === 0's initial "loading" is
    // already the useState default, so this only does real work on a retry.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setStatus("loading");
    });
    const timeout = setTimeout(() => {
      setStatus((current) => (current === "loading" && loadedCount.current === 0 ? "failed" : current));
    }, TILE_LOAD_TIMEOUT_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [retryKey]);

  // The tiles' estimated progress (the map reports no real progress until the first tile is in).
  const tilesProgress = useLoadingProgress(status === "loading");

  function handleTileLoad() {
    loadedCount.current += 1;
    setStatus("loaded");
  }

  function handleTileError() {
    errorCount.current += 1;
    // Only declare failure once nothing has ever loaded — a handful of
    // dropped tiles at the map's edge is normal and not worth a banner.
    if (loadedCount.current === 0 && errorCount.current > 3) {
      setStatus("failed");
    }
  }

  return (
    // `isolate` keeps Leaflet's pane z-indexes (400–1000) below the sticky header.
    <div data-surface="paper" className="relative isolate h-full w-full overflow-hidden rounded-none border border-surface-border">
      <MapStyles />
      <MapContainer
        key={retryKey}
        ref={mapRef}
        zoomAnimation={!reducedMotion}
        markerZoomAnimation={!reducedMotion}
        fadeAnimation={!reducedMotion}
        center={[center.lat, center.lng]}
        zoom={4}
        minZoom={AUSTRALIA_MIN_ZOOM}
        maxBounds={[
          [AUSTRALIA_BOUNDS.south, AUSTRALIA_BOUNDS.west],
          [AUSTRALIA_BOUNDS.north, AUSTRALIA_BOUNDS.east],
        ]}
        maxBoundsViscosity={1}
        // The wheel scrolls the page, not the map, so a pointer passing over it never traps
        // scrolling; the zoom buttons, keyboard (+/-), pinch and double-click still zoom.
        scrollWheelZoom={false}
        className="h-full w-full bg-background"
      >
        {/* Spread as is: Leaflet would take an explicit `undefined` option (say, tileSize) over its
            default. The first layer is the base whose tiles are watched. */}
        {tileStyle.layers.map((layer, index) => (
          <TileLayer
            key={`${tileStyle.id}-${index}`}
            {...layer}
            {...(index === 0 ? { eventHandlers: { tileload: handleTileLoad, tileerror: handleTileError } } : {})}
          />
        ))}
        <MapboxLogo />
        <TileWatcher status={status} retryKey={retryKey} programmaticMoveRef={programmaticMoveRef} />
        <ResizeSync programmaticMoveRef={programmaticMoveRef} />
        {/* Before the controller: sibling effects run in order, so the markers and "Search this area"
            listen for the map's moves before the controller's first framing moves it (from
            Australia to the events). That framing can be too big a jump to animate, and then its
            moveend fires inside the controller's effect: a listener added after it would miss it,
            leave the move marked as the map's own, and take the visitor's first zoom for it. */}
        <EventMarkerLayer
          markers={markers}
          selectedEventId={selectedEventId}
          onSelect={onSelect}
          openSpotLeadId={spotEvents.length > 0 ? (openSpot?.ids[0] ?? null) : null}
          onOpenSpot={setOpenSpot}
          onAnnounce={setAnnouncement}
          reducedMotion={reducedMotion}
          programmaticMoveRef={programmaticMoveRef}
        />
        {visitor && <VisitorMarker position={visitor} />}
        <SearchThisAreaControl
          programmaticMoveRef={programmaticMoveRef}
          onSearchArea={(bounds) =>
            onSearchArea({
              north: bounds.getNorth(),
              south: bounds.getSouth(),
              east: bounds.getEast(),
              west: bounds.getWest(),
            })
          }
        />
        <MapController
          markers={markers}
          around={around}
          focus={focus}
          onFocused={onFocused}
          selectedEventId={selectedEventId}
          programmaticMoveRef={programmaticMoveRef}
          reducedMotion={reducedMotion}
        />
        <MapViewProbe />
      </MapContainer>

      {/* Outside the Leaflet container so its wheel/drag handling doesn't capture the list's scrolling. */}
      {spotEvents.length > 0 && (
        <div className="pointer-events-none absolute inset-3 z-[1100] flex items-start justify-end">
          <MapSpotList
            events={spotEvents}
            onChoose={(eventId) => {
              setOpenSpot(null);
              onSelect(eventId);
            }}
            onClose={closeSpot}
          />
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {tilesProgress.visible && status !== "failed" && (
        <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
          <ProgressLoader
            percent={tilesProgress.percent}
            done={tilesProgress.done}
            label="Loading the map"
            className="rounded-control border border-foreground bg-card px-3 py-2"
          />
        </div>
      )}

      {status === "failed" && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
          <p className="font-heading text-xl text-foreground">
            Map couldn&rsquo;t load
          </p>
          <p className="max-w-xs text-sm text-muted">Check your connection.</p>
          <div className="flex flex-wrap justify-center gap-3">
            {onShowList && (
              <button type="button" onClick={onShowList} className={buttonClass("solid", "md", "min-h-11 lg:hidden")}>
                Show the list
              </button>
            )}
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              className={buttonClass(onShowList ? "outline" : "solid", "md", "min-h-11 lg:min-h-10")}
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
