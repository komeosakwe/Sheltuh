"use client";

import L from "leaflet";
import { useMemo, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Marker, Tooltip, useMap } from "react-leaflet";
import { stopQuietly } from "@/components/map/quiet-map";

/** Every marker's icon box, in px. Fixed, so swapping photo/poster or selecting never shifts anything. */
export const MARKER_SIZE = 48;
/** Keep a focused marker at least this far inside the map's edge. */
const FOCUS_PAN_PADDING = 56;

interface PortalMarkerProps {
  lat: number;
  lng: number;
  zIndexOffset?: number;
  /** Hover label for pointer users (screen readers get the button's own name). */
  tooltip?: string;
  reducedMotion: boolean;
  programmaticMoveRef: RefObject<boolean>;
  children: ReactNode;
}

/**
 * A Leaflet marker whose icon is React content, rendered through a portal into
 * a DOM node Leaflet owns (DivIcon accepts an element as `html`). The icon is
 * created once per marker, so focus and image state survive re-renders.
 * Leaflet's own keyboard handling is off: the content supplies a real button,
 * and focusing it pans the map so it is never focused off-screen.
 */
export default function PortalMarker({
  lat,
  lng,
  zIndexOffset = 0,
  tooltip,
  reducedMotion,
  programmaticMoveRef,
  children,
}: PortalMarkerProps) {
  const map = useMap();
  // Client-only (SceneMapPanel is loaded with ssr: false), so `document` exists.
  const [container] = useState(() => document.createElement("div"));
  const icon = useMemo(
    () =>
      L.divIcon({
        html: container,
        className: "scene-marker",
        iconSize: [MARKER_SIZE, MARKER_SIZE],
        iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2],
      }),
    [container],
  );
  const position = useMemo<L.LatLngTuple>(() => [lat, lng], [lat, lng]);

  function panIntoView() {
    const point = map.latLngToContainerPoint(position);
    const size = map.getSize();
    const outside =
      point.x < FOCUS_PAN_PADDING ||
      point.y < FOCUS_PAN_PADDING ||
      point.x > size.x - FOCUS_PAN_PADDING ||
      point.y > size.y - FOCUS_PAN_PADDING;
    if (!outside) return;
    // Stop any running pan first: stopping fires its moveend, which would
    // otherwise consume the flag below meant for this pan.
    stopQuietly(map, programmaticMoveRef);
    // Not the person panning, so "Search this area" shouldn't appear for it.
    programmaticMoveRef.current = true;
    map.panInside(position, { padding: [FOCUS_PAN_PADDING, FOCUS_PAN_PADDING], animate: !reducedMotion });
  }

  return (
    <>
      <Marker position={position} icon={icon} keyboard={false} autoPanOnFocus={false} zIndexOffset={zIndexOffset}>
        {tooltip && (
          <Tooltip direction="top" offset={[0, -MARKER_SIZE / 2]}>
            {tooltip}
          </Tooltip>
        )}
      </Marker>
      {createPortal(
        <div className="h-full w-full" onFocus={panIntoView}>
          {children}
        </div>,
        container,
      )}
    </>
  );
}
