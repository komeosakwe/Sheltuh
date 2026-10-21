"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import EventMarkerLayer, { type MarkerDatum, type OpenSpot } from "@/components/map/EventMarkerLayer";
import MapSpotList from "@/components/map/MapSpotList";
import { runQuietly, stopQuietly } from "@/components/map/quiet-map";
import { buttonClass } from "@/components/ui/Button";
import {
  MELBOURNE_DEFAULT_CENTER,
  MELBOURNE_DEFAULT_ZOOM,
  MELBOURNE_METRO_BOUNDS,
  MELBOURNE_MIN_ZOOM,
  resolveMapCoordinates,
} from "@/lib/geo";
import type { Coordinates, SheltuhEvent } from "@/lib/types";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

/**
 * Leaflet chrome restyled to the app's tokens, plus reduced-motion handling
 * for Leaflet's CSS zoom/fade transitions (it falls back to a timer, so
 * removing the transition is safe). Marker styling lives in components/map/.
 */
function MapStyles() {
  return (
    <style>{`
      .scene-marker { background: none; border: 0; }
      .leaflet-control-attribution {
        background: color-mix(in srgb, var(--background) 85%, transparent) !important; color: var(--muted) !important;
      }
      .leaflet-control-attribution a { color: var(--foreground) !important; }
      .leaflet-control-zoom a {
        background: var(--background) !important; color: var(--foreground) !important; border-color: var(--foreground) !important;
      }
      .leaflet-control-zoom a:hover { background: var(--surface) !important; }
      @media (prefers-reduced-motion: reduce) {
        .leaflet-zoom-anim .leaflet-zoom-animated, .leaflet-fade-anim .leaflet-tile, .leaflet-fade-anim .leaflet-popup {
          transition: none !important;
        }
      }
    `}</style>
  );
}

function hasSize(map: L.Map): boolean {
  const size = map.getSize();
  return size.x > 0 && size.y > 0;
}

/** Centres on the selected event if there is one, otherwise fits every marker. */
function frameMarkers(
  map: L.Map,
  markers: MarkerDatum[],
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
  if (markers.length === 0) return;
  programmaticMoveRef.current = true;
  const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
  map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15, animate: !reducedMotion });
}

/** Recentres/zooms the map when the selected event changes, and fits all markers on first load. */
function MapController({
  markers,
  selectedEventId,
  programmaticMoveRef,
  reducedMotion,
}: {
  markers: MarkerDatum[];
  selectedEventId: string | null;
  programmaticMoveRef: RefObject<boolean>;
  reducedMotion: boolean;
}) {
  const map = useMap();
  // Latest props for the resize listener below, which is registered once.
  const latest = useRef({ markers, selectedEventId, reducedMotion });
  useEffect(() => {
    latest.current = { markers, selectedEventId, reducedMotion };
  });

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
    if (markers.length === 0) return;
    // Synchronous, same-tick safeguard: if this container was just
    // revealed (e.g. the mobile list→map tab switch) in this very render,
    // the async ResizeObserver in ResizeSync hasn't caught up yet — so
    // re-measure right here too, before projecting any coordinates against it.
    runQuietly(programmaticMoveRef, () => map.invalidateSize());
    // Hidden (the phone's list tab): fitting a 0×0 map snaps to max zoom
    // around the centre. Wait for the resize listener below instead.
    if (!hasSize(map)) return;
    programmaticMoveRef.current = true;
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15, animate: !reducedMotion });
  }, [map, markers, programmaticMoveRef, reducedMotion]);

  useEffect(() => {
    if (!selectedEventId) return;
    const marker = markers.find((m) => m.event.id === selectedEventId);
    if (!marker) return;
    stopQuietly(map, programmaticMoveRef);
    runQuietly(programmaticMoveRef, () => map.invalidateSize());
    if (!hasSize(map)) return;
    frameMarkers(map, markers, selectedEventId, reducedMotion, programmaticMoveRef);
  }, [map, markers, selectedEventId, programmaticMoveRef, reducedMotion]);

  // The first time a hidden map gets a real size (the phone's Map tab), frame it then.
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
        frameMarkers(map, current.markers, current.selectedEventId, current.reducedMotion, programmaticMoveRef);
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
        className="pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full border border-foreground bg-foreground px-4 py-2 text-sm font-medium text-background"
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
}

const TILE_LOAD_TIMEOUT_MS = 9000;

/**
 * Client-only Leaflet map. Basemap is CARTO's free light-gray Esri tiles (no
 * API key) so it actually reads as a light, quiet map with streets and neighbourhood
 * labels, matching the app's palette — plain default OpenStreetMap tiles are
 * a bright daytime style that wouldn't fit even when they load. CARTO's
 * usage terms are fine for this traffic level; a real launch should still
 * put a dedicated provider key behind this before relying on it at scale.
 */
export default function SceneMapPanel({ events, selectedEventId, onSelect, onSearchArea }: SceneMapPanelProps) {
  const [status, setStatus] = useState<TileStatus>("loading");
  const [retryKey, setRetryKey] = useState(0);
  const loadedCount = useRef(0);
  const errorCount = useRef(0);
  const programmaticMoveRef = useRef(false);
  const mapRef = useRef<L.Map | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [openSpot, setOpenSpot] = useState<OpenSpot | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const markers = useMemo<MarkerDatum[]>(() => {
    return events.flatMap((event) => {
      // Outside Greater Melbourne = not pinned (the map is Melbourne-only).
      const coords = resolveMapCoordinates(event);
      return coords ? [{ event, lat: coords.lat, lng: coords.lng }] : [];
    });
  }, [events]);

  // Always start on Melbourne; the controller then fits the events within it.
  const center: Coordinates = MELBOURNE_DEFAULT_CENTER;

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
    <div className="relative isolate h-full w-full overflow-hidden rounded-none border border-surface-border">
      <MapStyles />
      <MapContainer
        key={retryKey}
        ref={mapRef}
        zoomAnimation={!reducedMotion}
        markerZoomAnimation={!reducedMotion}
        fadeAnimation={!reducedMotion}
        center={[center.lat, center.lng]}
        zoom={MELBOURNE_DEFAULT_ZOOM}
        minZoom={MELBOURNE_MIN_ZOOM}
        maxBounds={[
          [MELBOURNE_METRO_BOUNDS.south, MELBOURNE_METRO_BOUNDS.west],
          [MELBOURNE_METRO_BOUNDS.north, MELBOURNE_METRO_BOUNDS.east],
        ]}
        maxBoundsViscosity={1}
        scrollWheelZoom
        className="h-full w-full bg-background"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, GIS community'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
          eventHandlers={{ tileload: handleTileLoad, tileerror: handleTileError }}
        />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
          pane="shadowPane"
        />
        <TileWatcher status={status} retryKey={retryKey} programmaticMoveRef={programmaticMoveRef} />
        <ResizeSync programmaticMoveRef={programmaticMoveRef} />
        <MapController
          markers={markers}
          selectedEventId={selectedEventId}
          programmaticMoveRef={programmaticMoveRef}
          reducedMotion={reducedMotion}
        />
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

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center bg-background/60">
          <p className="rounded-full bg-foreground px-4 py-2 text-sm text-background">Loading map&hellip;</p>
        </div>
      )}

      {status === "failed" && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
          <p className="font-heading text-xl text-foreground">Map couldn&rsquo;t load</p>
          <p className="max-w-xs text-sm text-muted">
            The map tiles didn&rsquo;t come through &mdash; your connection or the tile provider may be
            unreachable right now. The event list still works below.
          </p>
          <button
            type="button"
            onClick={() => setRetryKey((k) => k + 1)}
            className={buttonClass("solid")}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
