"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import { EventMarkerMark } from "@/components/map/MapEventMarker";
import MapboxLogo from "@/components/map/MapboxLogo";
import MapStyles from "@/components/map/MapStyles";
import { MARKER_SIZE } from "@/components/map/PortalMarker";
import { useMapTileStyle } from "@/components/map/useMapTileStyle";
import type { SheltuhEvent } from "@/lib/types";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

export interface EventLocationLeafletProps {
  /** The pin: the venue's own position, or its suburb's centre (`zoom` is then wider). */
  lat: number;
  lng: number;
  zoom: number;
  /** For the pin's look: the event's photo or poster art, as on /map. */
  event: Pick<SheltuhEvent, "poster" | "title" | "imageUrl" | "imageFocus">;
}

/** As /map (SceneMapPanel): with no tile in this long, the map says it couldn't load. */
const TILE_LOAD_TIMEOUT_MS = 9000;

type TileStatus = "loading" | "loaded" | "failed";

/**
 * The event page's Location map (components/events/EventLocationMap.tsx
 * loads it, client-only, as the section nears the screen): the /map basemap
 * (Mapbox Streets with a token, else Esri; lib/map-tiles.ts) with one pin in
 * /map's marker style, and its credit. A picture, not a widget: no zoom
 * controls, dragging, wheel, pinch or keyboard handling, so it never traps
 * scrolling; the section's map links are the action.
 */
export default function EventLocationLeaflet({ lat, lng, zoom, event }: EventLocationLeafletProps) {
  const tileStyle = useMapTileStyle();
  const reducedMotion = usePrefersReducedMotion();
  const [status, setStatus] = useState<TileStatus>("loading");
  const loaded = useRef(0);
  const errors = useRef(0);
  // The pin's content is React (the photo with its poster fallback), portalled into the node Leaflet places.
  const [pin] = useState(() => document.createElement("div"));
  const icon = useMemo(
    () =>
      L.divIcon({
        html: pin,
        className: "scene-marker",
        iconSize: [MARKER_SIZE, MARKER_SIZE],
        iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2],
      }),
    [pin],
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setStatus((current) => (current === "loading" && loaded.current === 0 ? "failed" : current));
    }, TILE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <>
      <MapStyles />
      <MapContainer
        center={[lat, lng]}
        zoom={zoom}
        zoomControl={false}
        dragging={false}
        touchZoom={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        keyboard={false}
        zoomAnimation={false}
        markerZoomAnimation={false}
        fadeAnimation={!reducedMotion}
        className="h-full w-full bg-surface"
      >
        {/* Spread as is, as on /map: Leaflet would take an explicit `undefined` option over its default. */}
        {tileStyle.layers.map((layer, index) => (
          <TileLayer
            key={`${tileStyle.id}-${index}`}
            {...layer}
            {...(index === 0
              ? {
                  eventHandlers: {
                    tileload: () => {
                      loaded.current += 1;
                      setStatus("loaded");
                    },
                    tileerror: () => {
                      errors.current += 1;
                      // As /map: a few dropped tiles are normal; only none at all is a failure.
                      if (loaded.current === 0 && errors.current > 3) setStatus("failed");
                    },
                  },
                }
              : {})}
          />
        ))}
        <MapboxLogo />
        <Marker position={[lat, lng]} icon={icon} interactive={false} keyboard={false} />
      </MapContainer>
      {createPortal(
        // The icon's 48px box, as /map's marker button.
        <span className="block size-12">
          <EventMarkerMark event={event} />
        </span>,
        pin,
      )}
      {status === "failed" && (
        // Over the grey basemap: the address and map links below still work.
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-surface px-4 text-center">
          <p className="text-sm text-muted">The map couldn&rsquo;t load.</p>
        </div>
      )}
    </>
  );
}
