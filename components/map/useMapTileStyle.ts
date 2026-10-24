"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  availableTileStyles,
  parseTileStyleId,
  readMapboxConfig,
  readStoredTileStyle,
  resolveTileStyle,
  subscribeStoredTileStyle,
  writeStoredTileStyle,
  type TileStyle,
  type TileStyleId,
} from "@/lib/map-tiles";
import { getServerTheme, getTheme, subscribeTheme } from "@/lib/theme";

export interface MapTileStyleState {
  /** True only when a public Mapbox token is configured: the preview control shows. */
  preview: boolean;
  styles: TileStyle[];
  active: TileStyle;
  /** An explicit choice to keep in the URL (?tiles=), for sharing; null when there's none or the preview is off. */
  picked: TileStyleId | null;
  choose: (id: TileStyleId) => void;
}

/** The server (and hydration) render without a stored choice; the stored one follows straight after. */
const getServerStored = () => null;

/**
 * The /map basemap (lib/map-tiles.ts). `initialParam` is the ?tiles= value
 * the page was opened with. With no Mapbox token this is always Esri and
 * nothing is written to storage (the stored choice is read but ignored).
 */
export function useMapTileStyle(initialParam: string | null): MapTileStyleState {
  const styles = useMemo(() => availableTileStyles(readMapboxConfig()), []);
  const preview = styles.length > 1;
  const [picked, setPicked] = useState<TileStyleId | null>(() =>
    preview ? parseTileStyleId(initialParam, styles) : null,
  );
  const stored = useSyncExternalStore(subscribeStoredTileStyle, readStoredTileStyle, getServerStored);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const active = resolveTileStyle({ styles, picked, stored: preview ? stored : null, theme });

  function choose(id: TileStyleId) {
    if (!preview || !parseTileStyleId(id, styles)) return;
    setPicked(id);
    writeStoredTileStyle(id);
  }

  return { preview, styles, active, picked, choose };
}
