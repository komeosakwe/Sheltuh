"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import MapboxLogo from "@/components/map/MapboxLogo";
import MapStyles from "@/components/map/MapStyles";
import { useMapTileStyle } from "@/components/map/useMapTileStyle";
import { AUSTRALIA_BOUNDS } from "@/lib/geo";
import type { Coordinates } from "@/lib/types";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

export interface VenuePinMapLeafletProps {
  /** The map's centre, where the fixed pin points. */
  centre: Coordinates;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  /** Every settled move or zoom, from a drag, a pinch or a double-click (and from following `centre`/`zoom`). */
  onMove: (centre: Coordinates, zoom: number) => void;
  /** Wheel zoom only in the full-screen dialog: inline, the wheel scrolls the page. */
  wheelZoom: boolean;
}

/** As /map and the event page: with no tile in this long, the map says it couldn't load. */
const TILE_LOAD_TIMEOUT_MS = 9000;

type TileStatus = "loading" | "loaded" | "failed";

/** Far enough apart to be a real move (about 1 cm), so following our own moves never loops. */
const SAME = 1e-7;

/**
 * Follows the picker's centre and zoom (the keyboard, the zoom buttons),
 * reports the map's own moves, and re-measures when the box changes size:
 * the phone dialog's map can be laid out before the dialog is shown.
 */
function Sync({
  centre,
  zoom,
  onMove,
}: Pick<VenuePinMapLeafletProps, "centre" | "zoom" | "onMove">) {
  const map = useMap();
  const reducedMotion = usePrefersReducedMotion();
  const report = useRef(onMove);
  useEffect(() => {
    report.current = onMove;
  }, [onMove]);

  useMapEvents({
    moveend: () => {
      const at = map.getCenter();
      report.current({ lat: at.lat, lng: at.lng }, map.getZoom());
    },
  });

  useEffect(() => {
    const at = map.getCenter();
    if (Math.abs(at.lat - centre.lat) < SAME && Math.abs(at.lng - centre.lng) < SAME && map.getZoom() === zoom) return;
    map.setView([centre.lat, centre.lng], zoom, { animate: !reducedMotion });
  }, [map, centre.lat, centre.lng, zoom, reducedMotion]);

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

/**
 * The venue pin picker's map (components/dashboard/VenuePinMap.tsx loads
 * it, client-only): the /map basemap (Mapbox Streets with a token, else
 * Esri; lib/map-tiles.ts) that the organiser drags under a fixed pin. Pinch,
 * double-click and wheel zoom keep the centre where it is, so the spot
 * under the pin stays under it. It can't be moved outside Australia
 * (AUSTRALIA_BOUNDS). Leaflet's own keyboard handling is off: the picker
 * handles the keys, so there's one tab stop.
 */
export default function VenuePinMapLeaflet({ centre, zoom, minZoom, maxZoom, onMove, wheelZoom }: VenuePinMapLeafletProps) {
  const tileStyle = useMapTileStyle();
  const reducedMotion = usePrefersReducedMotion();
  const [status, setStatus] = useState<TileStatus>("loading");
  const loaded = useRef(0);
  const errors = useRef(0);
  const b = AUSTRALIA_BOUNDS;

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
        center={[centre.lat, centre.lng]}
        zoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        maxBounds={[
          [b.south, b.west],
          [b.north, b.east],
        ]}
        maxBoundsViscosity={1}
        zoomControl={false}
        keyboard={false}
        boxZoom={false}
        touchZoom="center"
        doubleClickZoom="center"
        scrollWheelZoom={wheelZoom ? "center" : false}
        bounceAtZoomLimits={false}
        zoomAnimation={!reducedMotion}
        markerZoomAnimation={!reducedMotion}
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
        <Sync centre={centre} zoom={zoom} onMove={onMove} />
      </MapContainer>
      {status === "failed" && (
        // Over the fixed pin too (components/dashboard/VenuePinMap.tsx): there's nothing to pin on.
        <div className="absolute inset-0 z-[1200] flex items-center justify-center bg-surface px-4 text-center">
          <p className="text-sm text-muted">The map couldn&rsquo;t load.</p>
        </div>
      )}
    </>
  );
}
