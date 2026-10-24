import { describe, expect, it } from "vitest";
import {
  availableTileStyles,
  ESRI_STYLE,
  MAPBOX_ATTRIBUTION,
  mapboxTileUrl,
  parseTileStyleId,
  readMapboxConfig,
  resolveTileStyle,
} from "@/lib/map-tiles";

/** The /map basemap: Esri unless a public Mapbox token turns on the style preview (docs/mapbox-preview.md). */

const TOKEN = "pk.eyJ1IjoidGVzdCJ9.abc-123_x";

describe("readMapboxConfig", () => {
  it("is off with no token, an empty one, or anything that isn't a public pk.* token", () => {
    expect(readMapboxConfig({})).toBeNull();
    expect(readMapboxConfig({ token: "" })).toBeNull();
    expect(readMapboxConfig({ token: "   " })).toBeNull();
    // A secret or temporary token is never used in the browser.
    expect(readMapboxConfig({ token: "sk.eyJ1IjoidGVzdCJ9.secret" })).toBeNull();
    expect(readMapboxConfig({ token: "tk.eyJ1IjoidGVzdCJ9.temp" })).toBeNull();
    expect(readMapboxConfig({ token: "pk.has spaces" })).toBeNull();
  });

  it("is on with a public token, with a custom Studio style only when it's username/styleid", () => {
    expect(readMapboxConfig({ token: ` ${TOKEN} ` })).toEqual({ token: TOKEN, customStyle: null });
    expect(readMapboxConfig({ token: TOKEN, style: "sheltuh/clabc123" })).toEqual({
      token: TOKEN,
      customStyle: "sheltuh/clabc123",
    });
    expect(readMapboxConfig({ token: TOKEN, style: "not-a-style" })?.customStyle).toBeNull();
    expect(readMapboxConfig({ token: TOKEN, style: "a/b?x=1" })?.customStyle).toBeNull();
  });

  it("reads NEXT_PUBLIC_MAPBOX_TOKEN and NEXT_PUBLIC_MAPBOX_STYLE by default", () => {
    const before = { token: process.env.NEXT_PUBLIC_MAPBOX_TOKEN, style: process.env.NEXT_PUBLIC_MAPBOX_STYLE };
    try {
      delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      expect(readMapboxConfig()).toBeNull();
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN = TOKEN;
      process.env.NEXT_PUBLIC_MAPBOX_STYLE = "sheltuh/custom1";
      expect(readMapboxConfig()).toEqual({ token: TOKEN, customStyle: "sheltuh/custom1" });
    } finally {
      for (const [key, value] of [
        ["NEXT_PUBLIC_MAPBOX_TOKEN", before.token],
        ["NEXT_PUBLIC_MAPBOX_STYLE", before.style],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("tile styles", () => {
  it("offers only Esri, as today, when the preview is off", () => {
    const styles = availableTileStyles(null);
    expect(styles).toEqual([ESRI_STYLE]);
    expect(ESRI_STYLE.label).toBe("Current (Esri)");
    expect(ESRI_STYLE.layers[0].url).toMatch(/^https:\/\/server\.arcgisonline\.com\/.*World_Light_Gray_Base/);
    expect(ESRI_STYLE.layers[0].attribution).toContain("Esri");
    expect(ESRI_STYLE.layers[1]?.url).toMatch(/World_Light_Gray_Reference/);
    // Leaflet's defaults (256px, no offset) for Esri.
    expect(ESRI_STYLE.layers[0]).not.toHaveProperty("tileSize");
    expect(ESRI_STYLE.layers[0]).not.toHaveProperty("zoomOffset");
  });

  it("adds Mapbox Light, Dark and Streets with a token, and the custom style when one is set", () => {
    expect(availableTileStyles({ token: TOKEN, customStyle: null }).map((s) => s.id)).toEqual([
      "esri",
      "mapbox-light",
      "mapbox-dark",
      "mapbox-streets",
    ]);
    const withCustom = availableTileStyles({ token: TOKEN, customStyle: "sheltuh/clabc123" });
    expect(withCustom.map((s) => s.id)).toEqual(["esri", "mapbox-light", "mapbox-dark", "mapbox-streets", "mapbox-custom"]);
    expect(withCustom.find((s) => s.id === "mapbox-custom")?.layers[0].url).toContain("/styles/v1/sheltuh/clabc123/");
  });

  it("builds Static Tiles API URLs: the style, 512px @2x tiles, the token, one zoom level down", () => {
    const styles = availableTileStyles({ token: TOKEN, customStyle: null });
    const expected: Record<string, string> = {
      "mapbox-light": "mapbox/light-v11",
      "mapbox-dark": "mapbox/dark-v11",
      "mapbox-streets": "mapbox/streets-v12",
    };
    for (const [id, style] of Object.entries(expected)) {
      const layer = styles.find((s) => s.id === id)?.layers[0];
      expect(layer?.url).toBe(
        `https://api.mapbox.com/styles/v1/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${TOKEN}`,
      );
      expect(layer?.tileSize).toBe(512);
      expect(layer?.zoomOffset).toBe(-1);
      expect(layer?.maxZoom).toBe(16);
      expect(layer?.attribution).toBe(MAPBOX_ATTRIBUTION);
    }
    expect(mapboxTileUrl("a/b", "pk.x&y")).toContain("access_token=pk.x%26y");
  });

  it("credits Mapbox and OpenStreetMap with links, and links Improve this map", () => {
    expect(MAPBOX_ATTRIBUTION).toContain('href="https://www.mapbox.com/about/maps/"');
    expect(MAPBOX_ATTRIBUTION).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(MAPBOX_ATTRIBUTION).toMatch(/<a href="https:\/\/www\.mapbox\.com\/map-feedback\/"[^>]*>Improve this map<\/a>/);
    expect(MAPBOX_ATTRIBUTION).toMatch(/&copy;.*Mapbox.*&copy;.*OpenStreetMap/);
  });
});

describe("choosing a style", () => {
  const preview = availableTileStyles({ token: TOKEN, customStyle: null });
  const withCustom = availableTileStyles({ token: TOKEN, customStyle: "sheltuh/clabc123" });

  it("parses only ids on offer", () => {
    expect(parseTileStyleId("mapbox-dark", preview)).toBe("mapbox-dark");
    expect(parseTileStyleId("esri", preview)).toBe("esri");
    expect(parseTileStyleId("mapbox-custom", preview)).toBeNull();
    expect(parseTileStyleId("mapbox-custom", withCustom)).toBe("mapbox-custom");
    expect(parseTileStyleId("mapbox-dark", [ESRI_STYLE])).toBeNull();
    expect(parseTileStyleId("nonsense", preview)).toBeNull();
    expect(parseTileStyleId(null, preview)).toBeNull();
  });

  it("is always Esri with the preview off, whatever the URL, storage or theme say", () => {
    const off = [ESRI_STYLE];
    expect(resolveTileStyle({ styles: off, picked: "mapbox-dark", stored: "mapbox-streets", theme: "dark" })).toBe(ESRI_STYLE);
  });

  it("in preview: the pick (or ?tiles=) wins, then the stored choice, then the theme's default", () => {
    const id = (args: Parameters<typeof resolveTileStyle>[0]) => resolveTileStyle(args).id;
    expect(id({ styles: preview, picked: "mapbox-streets", stored: "esri", theme: "dark" })).toBe("mapbox-streets");
    expect(id({ styles: preview, picked: null, stored: "esri", theme: "dark" })).toBe("esri");
    expect(id({ styles: preview, picked: null, stored: "garbage", theme: "light" })).toBe("mapbox-light");
    expect(id({ styles: preview, picked: null, stored: null, theme: "light" })).toBe("mapbox-light");
    // Dark theme: Mapbox Dark by default.
    expect(id({ styles: preview, picked: null, stored: null, theme: "dark" })).toBe("mapbox-dark");
    // A custom Studio style is the Light default when there is one.
    expect(id({ styles: withCustom, picked: null, stored: null, theme: "light" })).toBe("mapbox-custom");
    expect(id({ styles: withCustom, picked: null, stored: null, theme: "dark" })).toBe("mapbox-dark");
  });
});
