// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheltuhEvent } from "@/lib/types";

/*
 * Every map's basemap (docs/maps.md): Mapbox Streets with a public
 * NEXT_PUBLIC_MAPBOX_TOKEN, in the Light and Dark theme alike, and Esri
 * without one. Mounts the real SceneMap (demo path) with the real Leaflet map,
 * as tests/SceneMap.test.tsx does, plus the event page's Location map and the
 * organiser's pin map, and reads the tile <img> URLs Leaflet asks for.
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
import VenuePinMapLeaflet from "@/components/dashboard/VenuePinMapLeaflet";
import EventLocationLeaflet from "@/components/events/EventLocationLeaflet";

const TOKEN = "pk.eyJ1IjoidGVzdCJ9.streets-token";

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
  document.documentElement.removeAttribute("data-theme");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  document.documentElement.removeAttribute("data-theme");
});

async function renderSceneMap() {
  mockEvents = [fitzroy];
  render(<SceneMap />);
  await waitFor(() => expect(document.querySelector(".leaflet-tile")).not.toBeNull());
}

function tileUrls(): string[] {
  return Array.from(document.querySelectorAll<HTMLImageElement>("img.leaflet-tile")).map((img) => img.src);
}

/** Waits until the map has tiles, every one of them from the given URL prefix. */
async function expectTiles(prefix: string) {
  await waitFor(() => {
    const urls = tileUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith(prefix)).toBe(true);
  });
}

const logo = () => document.querySelector<HTMLAnchorElement>('a[href="https://www.mapbox.com/"]');
const attribution = () => document.querySelector(".leaflet-control-attribution") as HTMLElement;
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_";
const STREETS = "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/";

describe("/map without NEXT_PUBLIC_MAPBOX_TOKEN", () => {
  it("loads Esri's base and labels tiles, credits Esri, and has no map style control", async () => {
    await renderSceneMap();
    await expectTiles(ESRI);
    expect(tileUrls().some((url) => url.includes("World_Light_Gray_Base"))).toBe(true);
    expect(tileUrls().some((url) => url.includes("World_Light_Gray_Reference"))).toBe(true);
    expect(screen.queryByText(/map style/i)).toBeNull();
    expect(screen.queryByRole("option", { name: /mapbox|esri/i })).toBeNull();
    expect(attribution()).toHaveTextContent("Esri");
    expect(attribution()).not.toHaveTextContent("Mapbox");
    expect(logo()).toBeNull();
  });

  it("ignores a secret (sk.*) token", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "sk.eyJ1IjoidGVzdCJ9.secret");
    await renderSceneMap();
    await expectTiles(ESRI);
  });

  it("keeps a ?tiles= parameter out of the URL it writes", async () => {
    params = new URLSearchParams("tiles=mapbox-dark");
    await renderSceneMap();
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls.at(-1)?.[0]).not.toContain("tiles=");
  });
});

describe("/map with a public NEXT_PUBLIC_MAPBOX_TOKEN", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", TOKEN);
  });

  it("loads Mapbox Streets tiles with the token at @2x, and has no map style control", async () => {
    await renderSceneMap();
    await expectTiles(STREETS);
    // The token rides on every tile request.
    for (const url of tileUrls()) expect(url).toMatch(new RegExp(`@2x\\?access_token=${TOKEN.replace(/\./g, "\\.")}$`));
    expect(screen.queryByText(/map style/i)).toBeNull();
    expect(screen.queryByRole("option", { name: /mapbox|esri/i })).toBeNull();
  });

  it("credits Mapbox and OpenStreetMap with links, with Mapbox's Improve this map link", async () => {
    await renderSceneMap();
    await expectTiles(STREETS);
    const credits = attribution();
    expect(credits.querySelector('a[href="https://www.mapbox.com/about/maps/"]')).toHaveTextContent("Mapbox");
    expect(credits.querySelector('a[href="https://www.openstreetmap.org/copyright"]')).toHaveTextContent("OpenStreetMap");
    expect(credits.querySelector('a[href="https://www.mapbox.com/map-feedback/"]')).toHaveTextContent("Improve this map");
    expect(credits).not.toHaveTextContent("Esri");
  });

  it("shows the Mapbox wordmark as a labelled external link, bottom-left, inside the map", async () => {
    await renderSceneMap();
    await expectTiles(STREETS);
    const link = logo();
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("aria-label", "Mapbox");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link?.closest(".leaflet-container")).not.toBeNull();
    expect(link?.closest(".leaflet-bottom.leaflet-left")).not.toBeNull();
    // The text credit also has a "Mapbox" link (to the map designs page); this one is to mapbox.com.
    expect(screen.getAllByRole("link", { name: "Mapbox" })).toContain(link);
  });

  it("stays on Mapbox Streets in the Dark theme", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    await renderSceneMap();
    await expectTiles(STREETS);
  });
});

describe("the event page's Location map and the organiser's pin map", () => {
  const renderLocation = () =>
    render(
      <div style={{ width: 400, height: 300 }}>
        <EventLocationLeaflet lat={-37.7986} lng={144.9784} zoom={15} event={fitzroy} />
      </div>,
    );
  const renderPin = () =>
    render(
      <div style={{ width: 400, height: 300 }}>
        <VenuePinMapLeaflet
          centre={{ lat: -37.7986, lng: 144.9784 }}
          zoom={15}
          minZoom={4}
          maxZoom={16}
          onMove={() => {}}
          wheelZoom={false}
        />
      </div>,
    );

  it("use Esri without a token", async () => {
    renderLocation();
    await expectTiles(ESRI);
    expect(logo()).toBeNull();
    cleanup();
    renderPin();
    await expectTiles(ESRI);
    expect(logo()).toBeNull();
  });

  it("use Mapbox Streets with a token, in the Light and Dark theme", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", TOKEN);
    renderLocation();
    await expectTiles(STREETS);
    expect(attribution()).toHaveTextContent("Improve this map");
    expect(logo()).not.toBeNull();
    cleanup();
    document.documentElement.setAttribute("data-theme", "dark");
    renderPin();
    await expectTiles(STREETS);
    expect(logo()).not.toBeNull();
  });
});
