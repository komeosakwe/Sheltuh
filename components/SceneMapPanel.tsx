"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import { MELBOURNE_DEFAULT_CENTER, MELBOURNE_DEFAULT_ZOOM, resolveEventCoordinates } from "@/lib/geo";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

const PIN_SIZE = 36;

const CATEGORY_ABBR: Record<EventCategory, string> = {
  "live-music": "MUS",
  art: "ART",
  workshop: "WKS",
  "pop-up": "POP",
  theatre: "THR",
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
    html: `<div class="scene-pin-inner">${CATEGORY_ABBR[category]}</div>`,
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
        color: #fff; font: 600 10px 'DM Mono', monospace; letter-spacing: .05em;
        transition: background .15s, border-color .15s, box-shadow .15s;
      }
      .scene-pin.selected .scene-pin-inner {
        background: #e15b27; border-color: #e15b27; box-shadow: 0 0 0 6px rgba(225,91,39,.28);
      }
      .scene-pin:focus-visible .scene-pin-inner { outline: 2px solid #fff; outline-offset: 2px; }
    `}</style>
  );
}

/** Recentres/zooms the map when the selected event changes, and fits all markers on first load. */
function MapController({ markers, selectedEventId }: { markers: MarkerDatum[]; selectedEventId: string | null }) {
  const map = useMap();

  // Re-fits whenever the visible marker set actually changes (e.g. a
  // filter narrows it) — `markers` only gets a new reference when the
  // underlying event list or filters change, not on selection alone.
  useEffect(() => {
    if (markers.length === 0) return;
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
  }, [map, markers]);

  useEffect(() => {
    if (!selectedEventId) return;
    const marker = markers.find((m) => m.event.id === selectedEventId);
    if (!marker) return;
    map.flyTo([marker.lat, marker.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [map, markers, selectedEventId]);

  return null;
}

interface MarkerLayerProps {
  markers: MarkerDatum[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
}

/**
 * Renders the markers and keeps their selected styling in sync — via a CSS
 * class toggled imperatively on each marker's persistent DOM element, not
 * by recreating the icon — and gives each marker real Enter/Space keyboard
 * activation (see PinStyles' comment above for why that's needed at all).
 */
function MarkerLayer({ markers, selectedEventId, onSelect }: MarkerLayerProps) {
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
      el.classList.toggle("selected", id === selectedEventId);
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

interface SceneMapPanelProps {
  events: SheltuhEvent[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
}

/**
 * Client-only Leaflet map with OpenStreetMap's standard tile layer — no API
 * key required. OSM's tile usage policy isn't meant for heavy production
 * traffic; before a real launch, swap the TileLayer `url` for a dedicated
 * provider (e.g. MapTiler, Mapbox, Stadia Maps) with its own key.
 */
export default function SceneMapPanel({ events, selectedEventId, onSelect }: SceneMapPanelProps) {
  const markers = useMemo<MarkerDatum[]>(() => {
    return events.flatMap((event) => {
      const coords = resolveEventCoordinates(event);
      return coords ? [{ event, lat: coords.lat, lng: coords.lng }] : [];
    });
  }, [events]);

  const center = markers[0] ?? MELBOURNE_DEFAULT_CENTER;

  return (
    <div className="h-full w-full overflow-hidden rounded-lg border border-surface-border">
      <PinStyles />
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={MELBOURNE_DEFAULT_ZOOM}
        scrollWheelZoom
        style={{ height: "100%", width: "100%", background: "#080808" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController markers={markers} selectedEventId={selectedEventId} />
        <MarkerLayer markers={markers} selectedEventId={selectedEventId} onSelect={onSelect} />
      </MapContainer>
    </div>
  );
}
