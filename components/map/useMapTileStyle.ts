"use client";

import { useMemo } from "react";
import { mapTileStyle, type TileStyle } from "@/lib/map-tiles";

/**
 * A map's basemap (lib/map-tiles.ts): Mapbox Streets with a public Mapbox
 * token, else Esri. The token is inlined at build time, so the server and
 * the browser agree and it never changes while the page is open; memoised
 * so the layers keep their identity across renders.
 */
export function useMapTileStyle(): TileStyle {
  return useMemo(() => mapTileStyle(), []);
}
