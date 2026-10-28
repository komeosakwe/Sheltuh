import { describe, expect, it } from "vitest";
import {
  ESRI_STYLE,
  MAPBOX_ATTRIBUTION,
  MAPBOX_STREETS_STYLE,
  mapboxTileUrl,
  mapTileStyle,
  readMapboxToken,
  TILE_MAX_ZOOM,
} from "@/lib/map-tiles";

/** Every map's basemap: Mapbox Streets with a public Mapbox token, else Esri (docs/maps.md). */

const TOKEN = "pk.eyJ1IjoidGVzdCJ9.abc-123_x";

describe("readMapboxToken", () => {
  it("is null with no token, an empty one, or anything that isn't a public pk.* token", () => {
    expect(readMapboxToken(undefined)).toBeNull();
    expect(readMapboxToken("")).toBeNull();
    expect(readMapboxToken("   ")).toBeNull();
    // A secret or temporary token is never used in the browser.
    expect(readMapboxToken("sk.eyJ1IjoidGVzdCJ9.secret")).toBeNull();
    expect(readMapboxToken("tk.eyJ1IjoidGVzdCJ9.temp")).toBeNull();
    expect(readMapboxToken("pk.has spaces")).toBeNull();
    expect(readMapboxToken("pk.")).toBeNull();
  });

  it("returns a public token, trimmed", () => {
    expect(readMapboxToken(` ${TOKEN} `)).toBe(TOKEN);
  });

  it("reads NEXT_PUBLIC_MAPBOX_TOKEN by default", () => {
    const before = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    try {
      delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      expect(readMapboxToken()).toBeNull();
      expect(mapTileStyle()).toBe(ESRI_STYLE);
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN = TOKEN;
      expect(readMapboxToken()).toBe(TOKEN);
      expect(mapTileStyle().id).toBe("mapbox-streets");
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      else process.env.NEXT_PUBLIC_MAPBOX_TOKEN = before;
    }
  });
});

describe("mapTileStyle", () => {
  it("is Esri's base and labels layers without a token", () => {
    expect(mapTileStyle(null)).toBe(ESRI_STYLE);
    expect(ESRI_STYLE.layers[0].url).toMatch(/^https:\/\/server\.arcgisonline\.com\/.*World_Light_Gray_Base/);
    expect(ESRI_STYLE.layers[0].attribution).toContain("Esri");
    expect(ESRI_STYLE.layers[1]?.url).toMatch(/World_Light_Gray_Reference/);
    expect(ESRI_STYLE.layers[0].maxZoom).toBe(TILE_MAX_ZOOM);
    // Leaflet's defaults (256px, no offset) for Esri.
    expect(ESRI_STYLE.layers[0]).not.toHaveProperty("tileSize");
    expect(ESRI_STYLE.layers[0]).not.toHaveProperty("zoomOffset");
  });

  it("is Mapbox Streets with a token: one Static Tiles API layer, 512px @2x tiles one zoom level down", () => {
    const style = mapTileStyle(TOKEN);
    expect(style.id).toBe("mapbox-streets");
    expect(MAPBOX_STREETS_STYLE).toBe("mapbox/streets-v12");
    expect(style.layers).toHaveLength(1);
    expect(style.layers[0]).toEqual({
      url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${TOKEN}`,
      attribution: MAPBOX_ATTRIBUTION,
      maxZoom: TILE_MAX_ZOOM,
      tileSize: 512,
      zoomOffset: -1,
    });
  });

  it("encodes the token in the tile URL", () => {
    expect(mapboxTileUrl("a/b", "pk.x&y")).toContain("access_token=pk.x%26y");
  });

  it("credits Mapbox and OpenStreetMap with links, and links Improve this map", () => {
    expect(MAPBOX_ATTRIBUTION).toContain('href="https://www.mapbox.com/about/maps/"');
    expect(MAPBOX_ATTRIBUTION).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(MAPBOX_ATTRIBUTION).toMatch(/<a href="https:\/\/www\.mapbox\.com\/map-feedback\/"[^>]*>Improve this map<\/a>/);
    expect(MAPBOX_ATTRIBUTION).toMatch(/&copy;.*Mapbox.*&copy;.*OpenStreetMap/);
  });
});
