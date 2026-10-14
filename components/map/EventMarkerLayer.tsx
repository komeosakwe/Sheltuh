"use client";

import L from "leaflet";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { useMap } from "react-leaflet";
import MapClusterMarker from "@/components/map/MapClusterMarker";
import MapEventMarker from "@/components/map/MapEventMarker";
import PortalMarker, { MARKER_SIZE } from "@/components/map/PortalMarker";
import { stopQuietly } from "@/components/map/quiet-map";
import { isSinglePoint, layoutMapPoints, padPixelBounds } from "@/lib/map-layout";
import type { SheltuhEvent } from "@/lib/types";

export interface MarkerDatum {
  event: SheltuhEvent;
  lat: number;
  lng: number;
}

/** Markers closer than this (px) merge into a cluster: slightly more than a marker, so discs never overlap. */
const CLUSTER_RADIUS = MARKER_SIZE + 4;
/** Hard cap on markers in the DOM at once; with clustering it is only reached on very large maps. */
export const MAX_RENDERED_MARKERS = 150;
/** Lay out markers a little beyond the visible edge so panning doesn't reveal blank space. */
const VIEWPORT_PADDING = 0.25;

export interface OpenSpot {
  ids: string[];
  /** The cluster button to return focus to when the list closes. */
  returnFocus: HTMLElement | null;
}

interface EventMarkerLayerProps {
  markers: MarkerDatum[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
  openSpotLeadId: string | null;
  onOpenSpot: (spot: OpenSpot) => void;
  onAnnounce: (message: string) => void;
  reducedMotion: boolean;
  programmaticMoveRef: RefObject<boolean>;
}

/**
 * Lays the events out for the current view: culls those well outside it,
 * clusters overlapping ones, and caps how many render. The selected event is
 * always its own marker on top. Re-runs after every move or zoom.
 */
export default function EventMarkerLayer({
  markers,
  selectedEventId,
  onSelect,
  openSpotLeadId,
  onOpenSpot,
  onAnnounce,
  reducedMotion,
  programmaticMoveRef,
}: EventMarkerLayerProps) {
  const map = useMap();
  const [viewVersion, setViewVersion] = useState(0);

  useEffect(() => {
    const bump = () => setViewVersion((version) => version + 1);
    map.on("moveend zoomend resize viewreset", bump);
    return () => {
      map.off("moveend zoomend resize viewreset", bump);
    };
  }, [map]);

  const byId = useMemo(() => new Map(markers.map((marker) => [marker.event.id, marker])), [markers]);

  const layout = useMemo(() => {
    void viewVersion; // recompute against the map's current view after every move
    const zoom = map.getZoom();
    const size = map.getSize();
    const points = markers.map((marker) => {
      const point = map.project([marker.lat, marker.lng], zoom);
      return { id: marker.event.id, x: point.x, y: point.y };
    });
    const pixelBounds = map.getPixelBounds();
    // A 0×0 map (e.g. the hidden mobile tab) has no meaningful viewport: skip culling.
    const viewport =
      size.x > 0 && size.y > 0 && pixelBounds.min && pixelBounds.max
        ? padPixelBounds(
            { minX: pixelBounds.min.x, minY: pixelBounds.min.y, maxX: pixelBounds.max.x, maxY: pixelBounds.max.y },
            VIEWPORT_PADDING,
          )
        : undefined;
    const result = layoutMapPoints(points, {
      radius: CLUSTER_RADIUS,
      viewport,
      maxItems: MAX_RENDERED_MARKERS,
      pinnedId: selectedEventId,
    });
    return { zoom, ...result };
  }, [map, markers, selectedEventId, viewVersion]);

  function activateCluster(ids: string[], button: HTMLButtonElement) {
    const members = ids.flatMap((id) => byId.get(id) ?? []);
    if (members.length === 0) return;
    const stacked = isSinglePoint(members) || map.getZoom() >= map.getMaxZoom();
    if (stacked) {
      onOpenSpot({ ids, returnFocus: button });
      return;
    }
    stopQuietly(map, programmaticMoveRef);
    map.fitBounds(L.latLngBounds(members.map((m) => [m.lat, m.lng])), {
      padding: [MARKER_SIZE + 16, MARKER_SIZE + 16],
      maxZoom: map.getMaxZoom(),
      animate: !reducedMotion,
    });
    // The cluster button is about to be replaced by its members; keep keyboard
    // focus in the map (Tab from here reaches the markers) rather than the page.
    map.getContainer().focus({ preventScroll: true });
    onAnnounce(`Zoomed in on ${members.length} events.`);
  }

  return (
    <>
      {layout.items.map((item) => {
        if (item.kind === "single") {
          const marker = byId.get(item.id);
          if (!marker) return null;
          const selected = item.id === selectedEventId;
          return (
            <PortalMarker
              key={item.id}
              lat={marker.lat}
              lng={marker.lng}
              zIndexOffset={selected ? 2000 : 0}
              tooltip={marker.event.title}
              reducedMotion={reducedMotion}
              programmaticMoveRef={programmaticMoveRef}
            >
              <MapEventMarker event={marker.event} selected={selected} onSelect={onSelect} />
            </PortalMarker>
          );
        }
        const members = item.ids.flatMap((id) => byId.get(id)?.event ?? []);
        const centre = map.unproject([item.x, item.y], layout.zoom);
        const positions = item.ids.flatMap((id) => byId.get(id) ?? []);
        const stacked = isSinglePoint(positions) || layout.zoom >= map.getMaxZoom();
        return (
          <PortalMarker
            key={`cluster:${item.ids[0]}:${item.ids.length}`}
            lat={centre.lat}
            lng={centre.lng}
            zIndexOffset={1000}
            reducedMotion={reducedMotion}
            programmaticMoveRef={programmaticMoveRef}
          >
            <MapClusterMarker
              events={members}
              stacked={stacked}
              expanded={openSpotLeadId === item.ids[0]}
              onActivate={(button) => activateCluster(item.ids, button)}
            />
          </PortalMarker>
        );
      })}
      {layout.hiddenCount > 0 && (
        <p className="pointer-events-none absolute inset-x-0 bottom-8 z-[1000] flex justify-center">
          <span className="bg-foreground px-3 py-1 font-sans text-xs text-background">
            {layout.hiddenCount} more events in view. Zoom in to see them.
          </span>
        </p>
      )}
    </>
  );
}
