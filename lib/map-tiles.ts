/**
 * The basemap tiles behind every map on the site: /map (SceneMapPanel), the
 * event page's Location map and the organiser's venue pin step
 * (docs/maps.md). With a public Mapbox token in `NEXT_PUBLIC_MAPBOX_TOKEN`
 * they're Mapbox Streets (mapbox/streets-v12) in both the Light and Dark
 * theme, through Mapbox's raster Static Tiles API over the same Leaflet maps
 * (no new dependency). With no token, or one that isn't a public pk.* token,
 * they're Esri's light-gray canvas, which needs no key.
 */

export type TileStyleId = "esri" | "mapbox-streets";

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
  layers: [TileLayerSpec, ...TileLayerSpec[]];
}

/** The maps' zoom ceiling (Esri's light-gray canvas stops at 16); Mapbox Streets keeps it so both behave alike. */
export const TILE_MAX_ZOOM = 16;

/** Mapbox's Streets style, used in both themes whenever a token is set. */
export const MAPBOX_STREETS_STYLE = "mapbox/streets-v12";

export const ESRI_STYLE: TileStyle = {
  id: "esri",
  layers: [
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      attribution:
        '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, GIS community',
      maxZoom: TILE_MAX_ZOOM,
    },
    {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      maxZoom: TILE_MAX_ZOOM,
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

/** Public tokens only: a secret (sk.*) or temporary (tk.*) token is never used in the browser. */
const PUBLIC_TOKEN = /^pk\.[A-Za-z0-9._-]+$/;

/**
 * The public Mapbox token, or null when there's none or it isn't a public
 * pk.* one. Read at call time so tests can set the env; Next inlines the
 * `process.env.NEXT_PUBLIC_MAPBOX_TOKEN` reference at build time, so a
 * changed value needs a redeploy.
 */
export function readMapboxToken(token: string | undefined = process.env.NEXT_PUBLIC_MAPBOX_TOKEN): string | null {
  const trimmed = token?.trim() ?? "";
  return PUBLIC_TOKEN.test(trimmed) ? trimmed : null;
}

/** Mapbox's Static Tiles API as 512px raster tiles, at @2x for sharp maps on high-density screens. */
export function mapboxTileUrl(style: string, token: string): string {
  return `https://api.mapbox.com/styles/v1/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token)}`;
}

/** Mapbox Streets for a public token, in either theme; Esri without one. */
export function mapTileStyle(token: string | null = readMapboxToken()): TileStyle {
  if (!token) return ESRI_STYLE;
  return {
    id: "mapbox-streets",
    layers: [
      {
        url: mapboxTileUrl(MAPBOX_STREETS_STYLE, token),
        attribution: MAPBOX_ATTRIBUTION,
        maxZoom: TILE_MAX_ZOOM,
        // 512px tiles one zoom level down cover what four 256px tiles would.
        tileSize: 512,
        zoomOffset: -1,
      },
    ],
  };
}
