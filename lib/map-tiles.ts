import type { Theme } from "@/lib/theme";

/**
 * The basemap tiles behind /map (SceneMapPanel). Esri's light-gray canvas is
 * the map everyone gets. A Mapbox *preview* (docs/mapbox-preview.md) is
 * switched on only by a public Mapbox token in `NEXT_PUBLIC_MAPBOX_TOKEN`:
 * with it, /map shows a "Map style (preview)" control for comparing Mapbox
 * styles over the same Leaflet map (Mapbox's raster Static Tiles API, so no
 * new dependency). Without it nothing here changes the site: Esri, no
 * control, and `?tiles=` is ignored.
 */

export type TileStyleId = "esri" | "mapbox-light" | "mapbox-dark" | "mapbox-streets" | "mapbox-custom";

/** One Leaflet tile layer. The first layer of a style is its base: its tile load/error events drive the map's loading and failure UI. */
export interface TileLayerSpec {
  url: string;
  attribution?: string;
  maxZoom: number;
  tileSize?: number;
  zoomOffset?: number;
  /** A Leaflet pane, for a labels layer drawn over the markers' shadows. */
  pane?: string;
}

export interface TileStyle {
  id: TileStyleId;
  label: string;
  layers: [TileLayerSpec, ...TileLayerSpec[]];
}

export interface MapboxConfig {
  token: string;
  /** "username/styleid" of a style made in Mapbox Studio, if one is set. */
  customStyle: string | null;
}

/** localStorage key for the viewer's preview choice (only read or written while the preview is on). */
export const TILE_STYLE_STORAGE_KEY = "sheltuh:map-tiles";

/** The URL parameter for sharing a preview style, e.g. /map?tiles=mapbox-dark. */
export const TILE_STYLE_PARAM = "tiles";

/** The map's zoom ceiling (Esri's light-gray canvas stops at 16); Mapbox styles keep it so both previews behave alike. */
const MAX_ZOOM = 16;

export const ESRI_STYLE: TileStyle = {
  id: "esri",
  label: "Current (Esri)",
  layers: [
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      attribution:
        '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, GIS community',
      maxZoom: MAX_ZOOM,
    },
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      maxZoom: MAX_ZOOM,
      pane: "shadowPane",
    },
  ],
};

/**
 * Mapbox's required text attribution for its map designs and OpenStreetMap
 * data, with the "Improve this map" feedback link
 * (docs.mapbox.com/help/getting-started/attribution/).
 */
export const MAPBOX_ATTRIBUTION =
  '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer">Mapbox</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> ' +
  '<strong><a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener noreferrer">Improve this map</a></strong>';

const MAPBOX_PRESETS: { id: Exclude<TileStyleId, "esri" | "mapbox-custom">; label: string; style: string }[] = [
  // Mapbox has no public monochrome style id (Studio's "Monochrome" is a template you copy);
  // light-v11 is its greyscale one and the closest to the brand.
  { id: "mapbox-light", label: "Mapbox Light (monochrome)", style: "mapbox/light-v11" },
  { id: "mapbox-dark", label: "Mapbox Dark", style: "mapbox/dark-v11" },
  { id: "mapbox-streets", label: "Mapbox Streets", style: "mapbox/streets-v12" },
];

/** Public tokens only: a secret (sk.*) or temporary (tk.*) token is never used in the browser. */
const PUBLIC_TOKEN = /^pk\.[A-Za-z0-9._-]+$/;
/** A Mapbox Studio style id: "username/styleid". */
const STYLE_ID = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

/**
 * The preview's settings, or null when it's off (no token, or a token that
 * isn't a public pk.* one). Read at call time so tests can set the env; Next
 * inlines both `process.env.NEXT_PUBLIC_*` references at build time, so a
 * changed value needs a redeploy.
 */
export function readMapboxConfig(
  env: { token?: string; style?: string } = {
    token: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    style: process.env.NEXT_PUBLIC_MAPBOX_STYLE,
  },
): MapboxConfig | null {
  const token = env.token?.trim() ?? "";
  if (!PUBLIC_TOKEN.test(token)) return null;
  const style = env.style?.trim() ?? "";
  return { token, customStyle: STYLE_ID.test(style) ? style : null };
}

/** Mapbox's Static Tiles API as 512px raster tiles, at @2x for sharp maps on high-density screens. */
export function mapboxTileUrl(style: string, token: string): string {
  return `https://api.mapbox.com/styles/v1/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token)}`;
}

function mapboxStyle(id: TileStyleId, label: string, style: string, token: string): TileStyle {
  return {
    id,
    label,
    layers: [
      {
        url: mapboxTileUrl(style, token),
        attribution: MAPBOX_ATTRIBUTION,
        maxZoom: MAX_ZOOM,
        // 512px tiles one zoom level down cover what four 256px tiles would.
        tileSize: 512,
        zoomOffset: -1,
      },
    ],
  };
}

/** The styles the control offers: just Esri when the preview is off. */
export function availableTileStyles(config: MapboxConfig | null): TileStyle[] {
  if (!config) return [ESRI_STYLE];
  const styles = [ESRI_STYLE, ...MAPBOX_PRESETS.map((p) => mapboxStyle(p.id, p.label, p.style, config.token))];
  if (config.customStyle) {
    styles.push(mapboxStyle("mapbox-custom", "Sheltüh custom (Mapbox Studio)", config.customStyle, config.token));
  }
  return styles;
}

/** A style id from the URL or storage, if it's one on offer. */
export function parseTileStyleId(value: string | null | undefined, styles: TileStyle[]): TileStyleId | null {
  if (!value) return null;
  return styles.find((style) => style.id === value)?.id ?? null;
}

/**
 * Which style shows: Esri when the preview is off. In preview, an explicit
 * choice (this visit's pick or ?tiles=, then the stored one) wins; otherwise
 * Mapbox Dark in the Dark theme, else the custom Studio style if one is set,
 * else Mapbox Light.
 */
export function resolveTileStyle({
  styles,
  picked,
  stored,
  theme,
}: {
  styles: TileStyle[];
  picked: TileStyleId | null;
  stored: string | null;
  theme: Theme;
}): TileStyle {
  const byId = (id: TileStyleId | null) => (id ? styles.find((style) => style.id === id) : undefined);
  if (styles.length <= 1) return ESRI_STYLE;
  const explicit = byId(picked) ?? byId(parseTileStyleId(stored, styles));
  if (explicit) return explicit;
  const fallback: TileStyleId =
    theme === "dark" ? "mapbox-dark" : byId("mapbox-custom") ? "mapbox-custom" : "mapbox-light";
  return byId(fallback) ?? ESRI_STYLE;
}

const listeners = new Set<() => void>();

/** For useSyncExternalStore: this tab's writes and other tabs' (the storage event). */
export function subscribeStoredTileStyle(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === TILE_STYLE_STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

/** The stored choice as written (validated by the caller); null if none or storage is unavailable. */
export function readStoredTileStyle(): string | null {
  try {
    return localStorage.getItem(TILE_STYLE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Remembers the choice; if storage fails (private mode, quota) it still applies for this visit. */
export function writeStoredTileStyle(id: TileStyleId): void {
  try {
    localStorage.setItem(TILE_STYLE_STORAGE_KEY, id);
  } catch {
    // Not stored: the caller's state still shows the chosen style until the page is closed.
  }
  for (const listener of listeners) listener();
}
