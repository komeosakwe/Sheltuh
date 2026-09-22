"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import { MELBOURNE_DEFAULT_CENTER, MELBOURNE_DEFAULT_ZOOM, resolveEventCoordinates } from "@/lib/geo";
import type { Coordinates, EventCategory, SheltuhEvent } from "@/lib/types";

const PIN_SIZE = 34;
const ORANGE = "#e15b27";

// Simple monoline glyphs instead of category codes like "WKS"/"THR" — paired
// with a real aria-label (the event's title, not the category) on each
// marker element, since the glyph and even the category are decorative.
const CATEGORY_GLYPH: Record<EventCategory, string> = {
  "live-music": "♪",
  art: "◐",
  workshop: "▧",
  "pop-up": "✳",
  theatre: "▲",
};

interface MarkerDatum {
  event: SheltuhEvent;
  lat: number;
  lng: number;
}

// A stable icon per category — selection state is toggled after the fact
// via a CSS class (see PinStyles below), not by recreating the icon, so a
// marker's DOM element (and any listener attached to it) survives selection
// changes instead of being torn down and rebuilt on every click.
function pinIcon(category: EventCategory) {
  return L.divIcon({
    html: `<div class="scene-pin-inner" aria-hidden="true">${CATEGORY_GLYPH[category]}</div>`,
    className: "scene-pin",
    iconSize: [PIN_SIZE, PIN_SIZE],
    iconAnchor: [PIN_SIZE / 2, PIN_SIZE],
  });
}

/**
 * Leaflet markers are focusable (tabIndex, role="button") but — despite the
 * option being named `keyboard` — Leaflet itself never translates an Enter
 * or Space keypress into a click; that's left to the app. This supplies it.
 */
function PinStyles() {
  return (
    <style>{`
      .scene-pin { outline: none; }
      .scene-pin-inner {
        width: 100%; height: 100%; border-radius: 10px; border: 2px solid #69422e;
        background: linear-gradient(145deg,#8c4829,#201713);
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-size: 16px; line-height: 1;
        transition: background .15s, border-color .15s, box-shadow .15s;
      }
      .scene-pin.selected .scene-pin-inner {
        background: ${ORANGE}; border-color: ${ORANGE}; box-shadow: 0 0 0 6px rgba(225,91,39,.28);
        color: #17140f;
      }
      .scene-pin:focus-visible .scene-pin-inner { outline: 2px solid #fff; outline-offset: 2px; }
      .leaflet-control-attribution {
        background: rgba(8,8,8,.75) !important; color: #a3a3ad !important;
      }
      .leaflet-control-attribution a { color: #d5cec3 !important; }
      .leaflet-control-zoom a {
        background: #17171c !important; color: #f5f4f0 !important; border-color: #2a2a32 !important;
      }
      .leaflet-control-zoom a:hover { background: #232228 !important; }
    `}</style>
  );
}

/** Recentres/zooms the map when the selected event changes, and fits all markers on first load. */
function MapController({
  markers,
  selectedEventId,
  programmaticMoveRef,
}: {
  markers: MarkerDatum[];
  selectedEventId: string | null;
  programmaticMoveRef: RefObject<boolean>;
}) {
  const map = useMap();

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
    map.stop();
    if (markers.length === 0) return;
    // Synchronous, same-tick safeguard: if this container was just
    // revealed (e.g. the mobile list→map tab switch) in this very render,
    // the async ResizeObserver in ResizeSync hasn't caught up yet — so
    // re-measure right here too, before projecting any coordinates against it.
    map.invalidateSize();
    programmaticMoveRef.current = true;
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
  }, [map, markers, programmaticMoveRef]);

  useEffect(() => {
    if (!selectedEventId) return;
    const marker = markers.find((m) => m.event.id === selectedEventId);
    if (!marker) return;
    map.stop();
    map.invalidateSize();
    programmaticMoveRef.current = true;
    map.flyTo([marker.lat, marker.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [map, markers, selectedEventId, programmaticMoveRef]);

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
        className="pointer-events-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg"
        style={{ background: "#1a1917", border: `1px solid ${ORANGE}` }}
      >
        <span aria-hidden="true">⟳</span> Search this area
      </button>
    </div>
  );
}

/**
 * Renders the markers and keeps their selected styling in sync — via a CSS
 * class toggled imperatively on each marker's persistent DOM element, not
 * by recreating the icon — and gives each marker real Enter/Space keyboard
 * activation (see PinStyles' comment above for why that's needed at all)
 * plus a real accessible name (the event's title, not its category code).
 */
function MarkerLayer({
  markers,
  selectedEventId,
  onSelect,
}: {
  markers: MarkerDatum[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
}) {
  const markerRefs = useRef(new Map<string, L.Marker>());

  // A ref callback fires (via useImperativeHandle) before react-leaflet's
  // own effect has called map.addLayer() on the marker, so its icon DOM
  // element doesn't exist yet at that point — getElement() would be null.
  // Doing the DOM wiring here instead, in a regular effect that runs after
  // child effects have committed, is what makes getElement() reliable.
  useEffect(() => {
    markerRefs.current.forEach((marker, id) => {
      const el = marker.getElement();
      if (!el) return;
      const event = markers.find((m) => m.event.id === id)?.event;
      el.classList.toggle("selected", id === selectedEventId);
      if (event) el.setAttribute("aria-label", event.title);
      el.onkeydown = (domEvent) => {
        if (domEvent.key === "Enter" || domEvent.key === " " || domEvent.key === "Spacebar") {
          domEvent.preventDefault();
          onSelect(id);
        }
      };
    });
  }, [selectedEventId, markers, onSelect]);

  return (
    <>
      {markers.map(({ event, lat, lng }) => (
        <Marker
          key={event.id}
          position={[lat, lng]}
          icon={pinIcon(event.category)}
          eventHandlers={{ click: () => onSelect(event.id) }}
          ref={(marker) => {
            if (!marker) {
              markerRefs.current.delete(event.id);
              return;
            }
            markerRefs.current.set(event.id, marker);
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            {event.title}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

type TileStatus = "loading" | "loaded" | "failed";

/** Tracks whether the basemap's tiles actually rendered, for the loading/failure UI in the parent. */
function TileWatcher({ status, retryKey }: { status: TileStatus; retryKey: number }) {
  const map = useMap();
  useEffect(() => {
    // A retry (new retryKey) or filter-driven refit shouldn't get stuck
    // showing a stale failure banner once tiles are actually loading again.
    void retryKey;
    map.invalidateSize();
  }, [map, retryKey, status]);
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
function ResizeSync() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
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
 * Client-only Leaflet map. Basemap is CARTO's free "Dark Matter" tiles (no
 * API key) so it actually reads as a dark map with streets and neighbourhood
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

  const markers = useMemo<MarkerDatum[]>(() => {
    return events.flatMap((event) => {
      const coords = resolveEventCoordinates(event);
      return coords ? [{ event, lat: coords.lat, lng: coords.lng }] : [];
    });
  }, [events]);

  const center: Coordinates = markers[0] ?? MELBOURNE_DEFAULT_CENTER;

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
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-surface-border">
      <PinStyles />
      <MapContainer
        key={retryKey}
        center={[center.lat, center.lng]}
        zoom={MELBOURNE_DEFAULT_ZOOM}
        scrollWheelZoom
        style={{ height: "100%", width: "100%", background: "#0c0c0c" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, GIS community'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
          eventHandlers={{ tileload: handleTileLoad, tileerror: handleTileError }}
        />
        <TileWatcher status={status} retryKey={retryKey} />
        <ResizeSync />
        <MapController markers={markers} selectedEventId={selectedEventId} programmaticMoveRef={programmaticMoveRef} />
        <MarkerLayer markers={markers} selectedEventId={selectedEventId} onSelect={onSelect} />
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

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center bg-[#0c0c0c]/60">
          <p className="rounded-full bg-black/70 px-4 py-2 text-sm text-foreground">Loading map&hellip;</p>
        </div>
      )}

      {status === "failed" && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-[#0c0c0c] px-6 text-center">
          <p className="font-heading text-xl text-foreground">Map couldn&rsquo;t load</p>
          <p className="max-w-xs text-sm text-muted">
            The map tiles didn&rsquo;t come through &mdash; your connection or the tile provider may be
            unreachable right now. The event list still works below.
          </p>
          <button
            type="button"
            onClick={() => setRetryKey((k) => k + 1)}
            className="rounded px-4 py-2 text-sm font-medium"
            style={{ background: ORANGE, color: "#17140f" }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
