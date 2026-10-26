// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TILE_STYLE_STORAGE_KEY } from "@/lib/map-tiles";
import type { SheltuhEvent } from "@/lib/types";

/*
 * The Mapbox style preview on /map (docs/mapbox-preview.md). Mounts the real
 * SceneMap (demo path) with the real Leaflet map, as tests/SceneMap.test.tsx
 * does, and reads the tile <img> URLs Leaflet asks for. Without
 * NEXT_PUBLIC_MAPBOX_TOKEN nothing changes: Esri, no control, ?tiles= ignored.
 */

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/map",
  useSearchParams: () => params,
}));

let mockEvents: SheltuhEvent[] = [];
vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return { ...actual, getEvents: async () => mockEvents, getUpcomingEvents: async () => mockEvents };
});

import SceneMap from "@/components/SceneMap";

const TOKEN = "pk.eyJ1IjoidGVzdCJ9.preview-token";

const sizes = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
};

const fitzroy: SheltuhEvent = {
  id: "fitzroy-night",
  slug: "fitzroy-night",
  title: "Fitzroy Night",
  description: "A test event.",
  category: "live-music",
  suburb: "Fitzroy",
  venueName: "The Venue",
  venueAddress: "1 Test St",
  startsAt: "2026-11-20T09:00:00.000Z",
  organiserName: "Test Org",
  coordinates: { lat: -37.7986, lng: 144.9784 },
  poster: { pattern: "burst", background: "#000000", primary: "#111111", secondary: "#222222" },
  ticketTypes: [{ id: "ga", name: "GA", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
};

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  // Warm the map panel's dynamic import once, under the hook timeout (see tests/SceneMap.test.tsx).
  mockEvents = [fitzroy];
  render(<SceneMap />);
  await waitFor(() => expect(document.querySelector(".leaflet-tile")).not.toBeNull(), { timeout: 30_000 });
  cleanup();
});

afterAll(() => {
  for (const [key, descriptor] of Object.entries(sizes)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
  vi.unstubAllGlobals();
});

beforeEach(() => {
  params = new URLSearchParams();
  replace.mockClear();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_STYLE", "");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  document.documentElement.removeAttribute("data-theme");
});

async function renderMap() {
  mockEvents = [fitzroy];
  render(<SceneMap />);
  await waitFor(() => expect(document.querySelector(".leaflet-tile")).not.toBeNull());
}

function tileUrls(): string[] {
  return Array.from(document.querySelectorAll<HTMLImageElement>("img.leaflet-tile")).map((img) => img.src);
}

/** Waits until every tile on the map is from the given style's URL prefix. */
async function expectTiles(prefix: string) {
  await waitFor(() => {
    const urls = tileUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith(prefix)).toBe(true);
  });
}

const attribution = () => document.querySelector(".leaflet-control-attribution") as HTMLElement;
const lastUrl = () => (replace.mock.calls.at(-1)?.[0] as string | undefined) ?? "";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_";
const mapbox = (style: string) => `https://api.mapbox.com/styles/v1/${style}/tiles/512/`;

describe("without NEXT_PUBLIC_MAPBOX_TOKEN (as production today)", () => {
  it("shows no style control, loads Esri's base and labels tiles and credits Esri", async () => {
    await renderMap();
    await expectTiles(ESRI);
    expect(tileUrls().some((url) => url.includes("World_Light_Gray_Base"))).toBe(true);
    expect(tileUrls().some((url) => url.includes("World_Light_Gray_Reference"))).toBe(true);
    expect(screen.queryByLabelText("Map style (preview)")).toBeNull();
    expect(attribution()).toHaveTextContent("Esri");
    expect(attribution()).not.toHaveTextContent("Mapbox");
  });

  it("ignores ?tiles= and a stored choice, and keeps ?tiles= out of the URL", async () => {
    params = new URLSearchParams("tiles=mapbox-dark");
    localStorage.setItem(TILE_STYLE_STORAGE_KEY, "mapbox-streets");
    await renderMap();
    await expectTiles(ESRI);
    expect(screen.queryByLabelText("Map style (preview)")).toBeNull();
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(lastUrl()).not.toContain("tiles=");
  });

  it("ignores a secret (sk.*) token", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "sk.eyJ1IjoidGVzdCJ9.secret");
    await renderMap();
    await expectTiles(ESRI);
    expect(screen.queryByLabelText("Map style (preview)")).toBeNull();
  });
});

describe("with a public NEXT_PUBLIC_MAPBOX_TOKEN (the preview)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", TOKEN);
  });

  it("offers a labelled style control listing Esri and the Mapbox styles, Mapbox Light first in Light", async () => {
    await renderMap();
    const select = screen.getByLabelText("Map style (preview)");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveAccessibleDescription(/remembered on this device/);
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "Current (Esri)",
      "Mapbox Light (monochrome)",
      "Mapbox Dark",
      "Mapbox Streets",
    ]);
    expect(select).toHaveValue("mapbox-light");
    await expectTiles(mapbox("mapbox/light-v11"));
    // The token rides on every tile request, at @2x.
    for (const url of tileUrls()) expect(url).toMatch(new RegExp(`@2x\\?access_token=${TOKEN.replace(/\./g, "\\.")}$`));
  });

  it("credits Mapbox and OpenStreetMap with links, with Mapbox's Improve this map link", async () => {
    await renderMap();
    await expectTiles(mapbox("mapbox/light-v11"));
    const credits = attribution();
    expect(credits.querySelector('a[href="https://www.mapbox.com/about/maps/"]')).toHaveTextContent("Mapbox");
    expect(credits.querySelector('a[href="https://www.openstreetmap.org/copyright"]')).toHaveTextContent("OpenStreetMap");
    expect(credits.querySelector('a[href="https://www.mapbox.com/map-feedback/"]')).toHaveTextContent("Improve this map");
    expect(credits).not.toHaveTextContent("Esri");
  });

  it("switches style from the control, remembers it and puts it in the URL to share", async () => {
    await renderMap();
    const select = screen.getByLabelText("Map style (preview)");
    fireEvent.change(select, { target: { value: "mapbox-streets" } });
    await expectTiles(mapbox("mapbox/streets-v12"));
    expect(select).toHaveValue("mapbox-streets");
    expect(localStorage.getItem(TILE_STYLE_STORAGE_KEY)).toBe("mapbox-streets");
    await waitFor(() => expect(lastUrl()).toContain("tiles=mapbox-streets"));

    // Back to Esri: both of its layers, and its credit instead of Mapbox's.
    fireEvent.change(select, { target: { value: "esri" } });
    await expectTiles(ESRI);
    expect(attribution()).toHaveTextContent("Esri");
    expect(attribution()).not.toHaveTextContent("Improve this map");
    expect(localStorage.getItem(TILE_STYLE_STORAGE_KEY)).toBe("esri");
  });

  it("opens on the style in ?tiles=, and keeps it in the URL", async () => {
    params = new URLSearchParams("tiles=mapbox-dark");
    localStorage.setItem(TILE_STYLE_STORAGE_KEY, "mapbox-streets");
    await renderMap();
    expect(screen.getByLabelText("Map style (preview)")).toHaveValue("mapbox-dark");
    await expectTiles(mapbox("mapbox/dark-v11"));
    await waitFor(() => expect(lastUrl()).toContain("tiles=mapbox-dark"));
  });

  it("ignores an unknown ?tiles= value", async () => {
    params = new URLSearchParams("tiles=satellite");
    await renderMap();
    expect(screen.getByLabelText("Map style (preview)")).toHaveValue("mapbox-light");
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(lastUrl()).not.toContain("tiles=");
  });

  it("opens on the stored choice", async () => {
    localStorage.setItem(TILE_STYLE_STORAGE_KEY, "esri");
    await renderMap();
    expect(screen.getByLabelText("Map style (preview)")).toHaveValue("esri");
    await expectTiles(ESRI);
  });

  it("still works when storage throws", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      await renderMap();
      const select = screen.getByLabelText("Map style (preview)");
      fireEvent.change(select, { target: { value: "mapbox-dark" } });
      await expectTiles(mapbox("mapbox/dark-v11"));
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("defaults to Mapbox Dark in the Dark theme, unless a style was chosen", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    await renderMap();
    expect(screen.getByLabelText("Map style (preview)")).toHaveValue("mapbox-dark");
    await expectTiles(mapbox("mapbox/dark-v11"));
    cleanup();

    localStorage.setItem(TILE_STYLE_STORAGE_KEY, "mapbox-streets");
    await renderMap();
    expect(screen.getByLabelText("Map style (preview)")).toHaveValue("mapbox-streets");
  });

  it("adds a custom Mapbox Studio style from NEXT_PUBLIC_MAPBOX_STYLE, the Light default", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_STYLE", "sheltuh/clabc123");
    await renderMap();
    const select = screen.getByLabelText("Map style (preview)");
    expect(select).toHaveValue("mapbox-custom");
    expect(screen.getByRole("option", { name: "Sheltüh custom (Mapbox Studio)" })).toBeInTheDocument();
    await expectTiles(mapbox("sheltuh/clabc123"));
  });
});
