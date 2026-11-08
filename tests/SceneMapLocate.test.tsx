// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import L from "leaflet";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findLocality } from "@/lib/location";
import { LOCATE_REFUSED_KEY } from "@/lib/locate-me";
import { MAP_NEAR_ZOOM } from "@/lib/map-layout";
import { NEAR_STORAGE_KEY, writeStoredNear } from "@/lib/near-storage";
import type { SheltuhEvent } from "@/lib/types";

/*
 * /map centred on the visitor (owner request, creator call): the saved suburb on open, else one ask
 * of the browser; a Near me button; the location filter and the search bar's suburb recentre it.
 * Mounts the real SceneMap with the real Leaflet map (see tests/SceneMap.test.tsx); the map's
 * position is read from the data attributes on its container, and navigator.geolocation is a mock.
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
import { loadLocation } from "@/lib/location-loader";

const sizeDescriptors = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
};

function makeEvent(overrides: Partial<SheltuhEvent> & Pick<SheltuhEvent, "id" | "title">): SheltuhEvent {
  return {
    slug: overrides.id,
    description: "A test event.",
    category: "live-music",
    suburb: "Fitzroy",
    venueName: "The Venue",
    venueAddress: "1 Test St",
    startsAt: "2026-11-20T09:00:00.000Z",
    organiserName: "Test Org",
    poster: { pattern: "burst", background: "#000000", primary: "#111111", secondary: "#222222" },
    ticketTypes: [{ id: "ga", name: "GA", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...overrides,
  };
}

const fitzroyGig = makeEvent({ id: "fitzroy-gig", title: "Fitzroy Gig", coordinates: { lat: -37.7986, lng: 144.9784 } });
const sydneyShow = makeEvent({
  id: "sydney-show",
  title: "Sydney Show",
  suburb: "Surry Hills",
  state: "NSW",
  timeZone: "Australia/Sydney",
  coordinates: { lat: -33.8861, lng: 151.2111 },
  startsAt: "2026-11-21T09:00:00.000Z",
});
const events = [fitzroyGig, sydneyShow];

/** jsdom has no layout: an element is this size, or 0×0 inside a `hidden` one (the phone's other tab). */
let screenSize = { width: 800, height: 600 };
function laidOut(this: HTMLElement, size: number): number {
  return this.closest(".hidden") ? 0 : size;
}

/** The map's ResizeObserver callbacks, for `resized()` to run once the test has shown or hidden the map. */
const resizeCallbacks = new Set<() => void>();
const resized = () => act(() => resizeCallbacks.forEach((callback) => callback()));

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return laidOut.call(this, screenSize.width);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return laidOut.call(this, screenSize.height);
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe() {
        resizeCallbacks.add(this.callback);
      }
      unobserve() {}
      disconnect() {
        resizeCallbacks.delete(this.callback);
      }
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  await loadLocation();
  // Warm the map's one-off dynamic import (Leaflet, react-leaflet) once, under the hook timeout.
  mockEvents = events;
  render(<SceneMap />);
  await waitFor(() => expect(document.querySelector(".leaflet-container")).not.toBeNull(), { timeout: 30_000 });
  cleanup();
}, 60_000);

afterAll(() => {
  for (const [key, descriptor] of Object.entries(sizeDescriptors)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
  vi.unstubAllGlobals();
});

// --- navigator.geolocation ---------------------------------------------------------------------

type GetCurrentPosition = (
  success: PositionCallback,
  failure?: PositionErrorCallback | null,
  options?: PositionOptions,
) => void;
const getCurrentPosition = vi.fn<GetCurrentPosition>();

function position(latitude: number, longitude: number): GeolocationPosition {
  const coords: GeolocationCoordinates = {
    latitude,
    longitude,
    accuracy: 1000,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    toJSON: () => ({}),
  };
  return { coords, timestamp: 0, toJSON: () => ({}) };
}

function positionError(code: 1 | 2 | 3): GeolocationPositionError {
  return { code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
}

/** The browser answers with this position. */
const answerAt = (latitude: number, longitude: number) =>
  getCurrentPosition.mockImplementation((success) => success(position(latitude, longitude)));
/** The browser answers with this error (1 denied, 2 unavailable, 3 timeout). */
const answerWithError = (code: 1 | 2 | 3) =>
  getCurrentPosition.mockImplementation((_success, failure) => failure?.(positionError(code)));

// Melbourne's centre (Bourke St Mall) and Sydney's, as a browser would report them.
const MELBOURNE = { lat: -37.8136, lng: 144.9631 };
const SYDNEY = { lat: -33.8688, lng: 151.2093 };

beforeEach(() => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
});

afterEach(() => {
  cleanup();
  getCurrentPosition.mockReset();
  replace.mockClear();
  params = new URLSearchParams();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "geolocation");
  Reflect.deleteProperty(window, "matchMedia");
});

async function renderMap(list: SheltuhEvent[] = events) {
  mockEvents = list;
  render(<SceneMap />);
  await waitFor(() => expect(document.querySelector(".leaflet-container")).not.toBeNull());
  await waitFor(() => expect(document.querySelector("[data-scene-row]")).not.toBeNull());
}

/** The listed events' titles, top to bottom. */
const listedTitles = () =>
  Array.from(document.querySelectorAll("[data-scene-row]")).map((row) => row.querySelector("a")?.textContent ?? "");

const container = () => document.querySelector<HTMLElement>(".leaflet-container");

/** Where the map is, from the attributes SceneMapPanel publishes on its container. */
function view() {
  const el = container();
  return {
    lat: Number(el?.dataset.centerLat),
    lng: Number(el?.dataset.centerLng),
    zoom: Number(el?.dataset.zoom),
  };
}

/**
 * Waits for the map to be at `place`, zoomed in to MAP_NEAR_ZOOM. The map frames the place with the
 * events nearest it (lib/map-near.ts), so with one a few km away the centre is part-way between
 * (within `offset` degrees of the place); events too close to need more room stay at MAP_NEAR_ZOOM.
 */
async function expectCentredOn(place: { lat: number; lng: number }, offset = 0.04) {
  await waitFor(() => {
    const now = view();
    expect(now.zoom).toBe(MAP_NEAR_ZOOM);
    expect(Math.abs(now.lat - place.lat)).toBeLessThan(offset);
    expect(Math.abs(now.lng - place.lng)).toBeLessThan(offset);
  });
}

/** True when the map is still on its default view: the events fitted, not zoomed in on a place. */
const onDefaultView = () => view().zoom < MAP_NEAR_ZOOM;

function storedValues(): string[] {
  return [localStorage, sessionStorage].flatMap((store) =>
    Array.from({ length: store.length }, (_, i) => `${store.key(i)}=${store.getItem(store.key(i) ?? "")}`),
  );
}

function expectNoCoordinatesStored() {
  // Latitudes and longitudes of the points used here (-37.8…, 144.9…, -33.8…, 151.2…).
  expect(storedValues().join("\n")).not.toMatch(/-?\d{2,3}\.\d{3,}/);
}

describe("/map opens on the visitor's location", () => {
  it("a saved suburb: centres on it, zoomed in, without asking the browser", async () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Fitzroy", state: "VIC" }));
    await renderMap();
    const fitzroy = findLocality("Fitzroy");
    expect(fitzroy).not.toBeNull();
    await expectCentredOn({ lat: fitzroy?.lat ?? 0, lng: fitzroy?.lng ?? 0 });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    // The map's own opening is not a visitor's pan: no "Search this area".
    expect(screen.queryByRole("button", { name: /Search this area/ })).toBeNull();
  });

  it("no suburb saved: asks the browser once (coarse, 10 s, 10 min), then centres there and saves the suburb", async () => {
    answerAt(MELBOURNE.lat, MELBOURNE.lng);
    await renderMap();
    await expectCentredOn(MELBOURNE);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
    // Only the suburb's name and state are kept; the position is dropped.
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Melbourne", state: "VIC" });
    expectNoCoordinatesStored();
    expect(replace.mock.calls.flat().join(" ")).not.toMatch(/-?\d{2,3}\.\d{3,}/);
    expect(screen.queryByRole("button", { name: /Search this area/ })).toBeNull();
    // The visitor is told, politely.
    expect(screen.getByText("Map centred on Melbourne, VIC.")).toBeInTheDocument();
  });

  it("denied: keeps the default view, saves nothing, and doesn't ask again this session", async () => {
    answerWithError(1);
    await renderMap();
    await waitFor(() => expect(sessionStorage.getItem(LOCATE_REFUSED_KEY)).toBe("1"));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(onDefaultView()).toBe(true);
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    // Silent: no message on the page.
    expect(screen.queryByText("Couldn’t find your location.")).toBeNull();
    cleanup();

    await renderMap();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(onDefaultView()).toBe(true);
  });

  it.each([
    ["an error", 2],
    ["a timeout", 3],
  ] as const)("%s: keeps the default view silently and remembers it for the session", async (_name, code) => {
    answerWithError(code);
    await renderMap();
    await waitFor(() => expect(sessionStorage.getItem(LOCATE_REFUSED_KEY)).toBe("1"));
    expect(onDefaultView()).toBe(true);
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it("a position overseas can't be placed: default view, nothing saved", async () => {
    answerAt(51.5072, -0.1276);
    await renderMap();
    await waitFor(() => expect(sessionStorage.getItem(LOCATE_REFUSED_KEY)).toBe("1"));
    expect(onDefaultView()).toBe(true);
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ["?sel= an event", "sel=sydney-show"],
    ["a suburb filter", "suburb=Surry%20Hills"],
    ["another filter", "cat=live-music"],
    ["the list", "view=list"],
  ])("%s in the address: doesn't ask", async (_name, query) => {
    params = new URLSearchParams(query);
    answerAt(MELBOURNE.lat, MELBOURNE.lng);
    await renderMap();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it("a saved suburb doesn't override a selected event in the address", async () => {
    params = new URLSearchParams("sel=sydney-show");
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Fitzroy", state: "VIC" }));
    await renderMap();
    await waitFor(() => expect(view().lat).toBeCloseTo(sydneyShow.coordinates?.lat ?? 0, 2));
  });

  it("without geolocation in the browser: no prompt and no Near me button", async () => {
    Reflect.deleteProperty(navigator, "geolocation");
    await renderMap();
    expect(onDefaultView()).toBe(true);
    expect(screen.queryByRole("button", { name: "Near me" })).toBeNull();
  });
});

describe("Near me", () => {
  it("is a 44px button that asks the browser, shows it's busy, then centres and saves the suburb", async () => {
    params = new URLSearchParams("cat=live-music");
    let answer: PositionCallback = () => {};
    getCurrentPosition.mockImplementation((success) => {
      answer = success;
    });
    await renderMap();
    expect(getCurrentPosition).not.toHaveBeenCalled();

    const button = screen.getByRole("button", { name: "Near me" });
    expect(button).toHaveClass("min-h-11");
    fireEvent.click(button);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const busy = await screen.findByRole("button", { name: "Locating…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    // A second press while it looks does nothing.
    fireEvent.click(busy);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    await act(async () => answer(position(SYDNEY.lat, SYDNEY.lng)));
    await expectCentredOn(SYDNEY);
    expect(screen.getByRole("button", { name: "Near me" })).not.toHaveAttribute("aria-disabled");
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toMatchObject({ state: "NSW" });
    expectNoCoordinatesStored();
    // Centring is the map's own move, not the visitor's pan.
    expect(screen.queryByRole("button", { name: /Search this area/ })).toBeNull();
  });

  it("after a refusal on open, still works on demand", async () => {
    answerWithError(1);
    await renderMap();
    await waitFor(() => expect(sessionStorage.getItem(LOCATE_REFUSED_KEY)).toBe("1"));
    answerAt(MELBOURNE.lat, MELBOURNE.lng);
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await expectCentredOn(MELBOURNE);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it("on failure: the location card asks for it in a polite status, the view stays, and it can be tried again", async () => {
    params = new URLSearchParams("cat=live-music");
    answerWithError(1);
    await renderMap();
    const nearMe = screen.getByRole("button", { name: "Near me" });
    nearMe.focus();
    fireEvent.click(nearMe);
    const status = await screen.findByRole("status", {
      name: (_name, element) => element.textContent?.includes("Share your location?") ?? false,
    });
    expect(status).toHaveTextContent("Share your location?To see events near you, allow location access in your browser settings.");
    const card = status.closest("[data-location-card]") as HTMLElement;
    expect(card).not.toBeNull();
    // No way out to offer in an ordinary browser: just the ✕.
    expect(within(card).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Dismiss location message"]);
    expect(within(card).queryByRole("link")).toBeNull();
    // It doesn't take focus.
    expect(screen.getByRole("button", { name: "Near me" })).toHaveFocus();
    expect(onDefaultView()).toBe(true);
    expect(screen.getByRole("button", { name: "Near me" })).not.toHaveAttribute("aria-disabled");
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  describe("inside an in-app browser", () => {
    const INSTAGRAM_IOS =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.26.108 (iPhone15,2; iOS 18_1; en_AU)";

    // Not vi.unstubAllGlobals(): that would also drop this file's ResizeObserver stub.
    const realNavigator = navigator;
    const realLocation = window.location;
    function pretend(userAgent: string, url: string) {
      vi.stubGlobal("navigator", Object.create(navigator, { userAgent: { value: userAgent } }));
      vi.stubGlobal("location", new URL(url));
    }
    afterEach(() => {
      vi.stubGlobal("navigator", realNavigator);
      vi.stubGlobal("location", realLocation);
    });

    const INSTAGRAM_ANDROID =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 340.0.0.30.109 Android";

    async function failInside(userAgent: string, url: string, clipboard?: { writeText: (text: string) => Promise<void> }) {
      vi.stubGlobal(
        "navigator",
        Object.create(navigator, { userAgent: { value: userAgent }, clipboard: { value: clipboard } }),
      );
      vi.stubGlobal("location", new URL(url));
      answerWithError(1);
      await renderMap();
      fireEvent.click(screen.getByRole("button", { name: "Near me" }));
      const status = await screen.findByRole("status", {
        name: (_name, element) => element.textContent?.includes("Share your location?") ?? false,
      });
      return { status, card: status.closest("[data-location-card]") as HTMLElement };
    }

    it("iOS: asks for it in Safari; Open in Safari copies the page's https address (no fragment) and gives the steps", async () => {
      const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
      const { status, card } = await failInside(INSTAGRAM_IOS, "https://app.sheltuh.com.au/map?cat=live-music#token=secret", { writeText });
      expect(status).toHaveTextContent("To see events near you, allow location access in Safari.");
      // Never the x-safari-https link Instagram ignores.
      expect(document.querySelector('a[href^="x-safari"]')).toBeNull();
      const open = within(card).getByRole("button", { name: "Open in Safari" });
      fireEvent.click(open);
      await waitFor(() => expect(status).toHaveTextContent("Link copied. Tap ••• at the top, then Open in external browser."));
      expect(writeText).toHaveBeenCalledWith("https://app.sheltuh.com.au/map?cat=live-music");
      expect(status).not.toHaveTextContent("allow location access in Safari");
      expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    });

    it("iOS: when the clipboard refuses, only the steps", async () => {
      const writeText = vi.fn<(text: string) => Promise<void>>(async () => {
        throw new Error("NotAllowedError");
      });
      const { status, card } = await failInside(INSTAGRAM_IOS, "https://app.sheltuh.com.au/map", { writeText });
      fireEvent.click(within(card).getByRole("button", { name: "Open in Safari" }));
      await waitFor(() => expect(status).toHaveTextContent(/^Share your location\?Tap ••• at the top, then Open in external browser\.$/));
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    it("iOS: with no https address (or no clipboard), nothing is copied: only the steps", async () => {
      const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
      const { status, card } = await failInside(INSTAGRAM_IOS, "http://localhost:3000/map", { writeText });
      fireEvent.click(within(card).getByRole("button", { name: "Open in Safari" }));
      await waitFor(() => expect(status).toHaveTextContent(/^Share your location\?Tap ••• at the top, then Open in external browser\.$/));
      expect(writeText).not.toHaveBeenCalled();
    });

    it("Android: asks for it in Chrome, with Open in Chrome (an intent link, no fragment)", async () => {
      const { status, card } = await failInside(INSTAGRAM_ANDROID, "https://app.sheltuh.com.au/map?cat=live-music#token=secret");
      expect(status).toHaveTextContent("To see events near you, allow location access in Chrome.");
      expect(within(card).getByRole("link", { name: "Open in Chrome" })).toHaveAttribute(
        "href",
        "intent://app.sheltuh.com.au/map?cat=live-music#Intent;scheme=https;package=com.android.chrome;end",
      );
    });

    it("on open the refusal stays silent, as in any browser", async () => {
      pretend(INSTAGRAM_IOS, "https://app.sheltuh.com.au/map");
      answerWithError(1);
      await renderMap();
      await waitFor(() => expect(sessionStorage.getItem(LOCATE_REFUSED_KEY)).toBe("1"));
      expect(document.querySelector("[data-location-card]")).toBeNull();
      expect(screen.queryByRole("button", { name: "Open in Safari" })).toBeNull();
    });
  });
});

describe("the phone's List and Map tabs", () => {
  // A 375px phone's map: at the desktop's size the whole of Australia is smaller than the view, which
  // Leaflet's max bounds then pans after forever (an artefact of the test, not of a phone).
  beforeEach(() => {
    screenSize = { width: 343, height: 420 };
  });
  afterEach(() => {
    screenSize = { width: 800, height: 600 };
  });

  /** Lets the map's deferred (next animation frame) reveal handling run. */
  const settle = () => new Promise<void>((done) => setTimeout(done, 150));

  it("Near me, then List, then Map: the map keeps the visitor's location", async () => {
    params = new URLSearchParams("cat=live-music");
    answerAt(SYDNEY.lat, SYDNEY.lng);
    await renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await expectCentredOn(SYDNEY);
    const fit = vi.spyOn(L.Map.prototype, "fitBounds");

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    await resized();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await resized();
    await settle();

    expect(fit).not.toHaveBeenCalled();
    await expectCentredOn(SYDNEY);
  });

  it("a suburb picked while the map is hidden is centred on when it's shown", async () => {
    params = new URLSearchParams("cat=live-music&view=list");
    await renderMap();
    const surryHills = findLocality("Surry Hills NSW");
    fireEvent.change(screen.getByRole("combobox", { name: "Location" }), { target: { value: "Surry Hills" } });
    await settle();
    expect(onDefaultView()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await resized();
    await expectCentredOn({ lat: surryHills?.lat ?? 0, lng: surryHills?.lng ?? 0 });
    await settle();
  });

  it("a filter changed while the map is hidden refits the matching events when it's shown", async () => {
    params = new URLSearchParams("cat=live-music");
    answerAt(SYDNEY.lat, SYDNEY.lng);
    await renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await expectCentredOn(SYDNEY);

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    await resized();
    await settle();
    const fit = vi.spyOn(L.Map.prototype, "fitBounds");
    fireEvent.change(screen.getByRole("searchbox", { name: /Search events/ }), { target: { value: "Fitzroy Gig" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await resized();
    await waitFor(() => expect(fit).toHaveBeenCalled());
    // Let the animated refit finish before the map is torn down (Leaflet would finish it on a removed map).
    await new Promise<void>((done) => setTimeout(done, 600));
  });
});

describe("a location put in recentres the map", () => {
  it("picking a suburb in the location filter centres on it, zoomed in", async () => {
    params = new URLSearchParams("cat=live-music");
    await renderMap();
    const surryHills = findLocality("Surry Hills NSW");
    expect(surryHills).not.toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Location" }), { target: { value: "Surry Hills" } });
    await expectCentredOn({ lat: surryHills?.lat ?? 0, lng: surryHills?.lng ?? 0 });
    expect(screen.queryByRole("button", { name: /Search this area/ })).toBeNull();
  });

  it("the search bar's suburb changing while on the map centres on it", async () => {
    params = new URLSearchParams("cat=live-music");
    await renderMap();
    act(() => {
      writeStoredNear("Footscray", "VIC");
    });
    const footscray = findLocality("Footscray");
    await expectCentredOn({ lat: footscray?.lat ?? 0, lng: footscray?.lng ?? 0 }, 0.06);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("flies there, or with reduced motion jumps without animation", async () => {
    params = new URLSearchParams("cat=live-music");
    await renderMap();
    const fly = vi.spyOn(L.Map.prototype, "flyTo");
    const setView = vi.spyOn(L.Map.prototype, "setView");

    fireEvent.change(screen.getByRole("combobox", { name: "Location" }), { target: { value: "Surry Hills" } });
    await waitFor(() => expect(fly).toHaveBeenCalledTimes(1));
    expect(fly.mock.calls[0][1]).toBe(MAP_NEAR_ZOOM);
    cleanup();
    fly.mockClear();
    setView.mockClear();

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    await renderMap();
    fireEvent.change(screen.getByRole("combobox", { name: "Location" }), { target: { value: "Surry Hills" } });
    await waitFor(() =>
      expect(setView.mock.calls.some(([, zoom, options]) => zoom === MAP_NEAR_ZOOM && options?.animate === false)).toBe(true),
    );
    expect(fly).not.toHaveBeenCalled();
  });
});

describe("Near me puts the nearest events first and frames them", () => {
  // The soonest is in Sydney: for a Melbourne visitor it used to head the list (owner report).
  const sydneySoonest = { ...sydneyShow, startsAt: "2026-11-18T09:00:00.000Z" };
  const footscrayGig = makeEvent({
    id: "footscray-gig",
    title: "Footscray Gig",
    suburb: "Footscray",
    coordinates: { lat: -37.8, lng: 144.9 },
    startsAt: "2026-11-19T09:00:00.000Z",
  });
  const brightonGig = makeEvent({
    id: "brighton-gig",
    title: "Brighton Gig",
    suburb: "Brighton",
    category: "theatre",
    coordinates: { lat: -37.9167, lng: 144.9926 },
    startsAt: "2026-11-22T09:00:00.000Z",
  });
  const frankstonGig = makeEvent({
    id: "frankston-gig",
    title: "Frankston Gig",
    suburb: "Frankston",
    category: "theatre",
    coordinates: { lat: -38.1448, lng: 145.1227 },
    startsAt: "2026-11-17T09:00:00.000Z",
  });
  const spread = [frankstonGig, sydneySoonest, footscrayGig, fitzroyGig, brightonGig];

  it("lists soonest first until the visitor is located, then nearest first with each distance", async () => {
    params = new URLSearchParams("cat=live-music");
    answerAt(MELBOURNE.lat, MELBOURNE.lng);
    await renderMap([sydneySoonest, fitzroyGig, footscrayGig]);
    expect(listedTitles()).toEqual(["Sydney Show", "Footscray Gig", "Fitzroy Gig"]);
    expect(document.body).not.toHaveTextContent(/\d km/);

    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await expectCentredOn(MELBOURNE, 0.06);
    await waitFor(() => expect(listedTitles()).toEqual(["Fitzroy Gig", "Footscray Gig", "Sydney Show"]));
    const rows = Array.from(document.querySelectorAll("[data-scene-row]"));
    // Fitzroy is about 2 km from the CBD, Footscray about 6, Sydney about 700 (approximate, short).
    expect(rows[0]).toHaveTextContent(/Live music · 2\.\d km away/);
    expect(rows[1]).toHaveTextContent(/Live music · [4-6]\.\d km away/);
    expect(rows[2]).toHaveTextContent(/Live music · 7\d\d km away/);
    expect(screen.getAllByText(/3 upcoming events matching your filters, nearest first/).length).toBeGreaterThan(0);
    // The position is only in this page's memory.
    expectNoCoordinatesStored();
    expect(replace.mock.calls.flat().join(" ")).not.toMatch(/-?\d{2,3}\.\d{3,}/);
  });

  it("a saved suburb: opens nearest first from its centre, without asking", async () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Melbourne", state: "VIC" }));
    await renderMap([sydneySoonest, fitzroyGig]);
    await waitFor(() => expect(listedTitles()).toEqual(["Fitzroy Gig", "Sydney Show"]));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    // A suburb's centre isn't the visitor: no dot for it.
    expect(document.querySelector(".scene-visitor")).toBeNull();
  });

  it("Near me replaces a selected event with the nearest, and the map goes to the visitor rather than back to the old selection", async () => {
    // Codex, PR #34: a retained selection's effect flew the map back to the selected event.
    params = new URLSearchParams("sel=sydney-show");
    answerAt(MELBOURNE.lat, MELBOURNE.lng);
    await renderMap([sydneySoonest, fitzroyGig, footscrayGig]);
    await waitFor(() => expect(view().lat).toBeCloseTo(sydneySoonest.coordinates?.lat ?? 0, 2));

    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await expectCentredOn(MELBOURNE, 0.06);
    await waitFor(() => expect(replace.mock.calls.at(-1)?.[0] ?? "").toMatch(/sel=fitzroy-gig/));
    expect(replace.mock.calls.at(-1)?.[0] ?? "").not.toMatch(/sydney-show/);
    await waitFor(() => expect(listedTitles()[0]).toBe("Fitzroy Gig"));
    expect(screen.getAllByRole("region", { name: "Selected event" })[0]).toHaveTextContent("Fitzroy Gig");
  });

  describe("opens the nearest event", () => {
    const selectedCard = () => screen.getAllByRole("region", { name: "Selected event" })[0];

    it("selects the nearest event the filters leave, announces it, and keeps the map framed on the visitor", async () => {
      // Theatre only: Fitzroy (live music, 2 km) is filtered out, so Brighton (12 km) is the nearest.
      params = new URLSearchParams("cat=theatre");
      answerAt(MELBOURNE.lat, MELBOURNE.lng);
      await renderMap(spread);
      expect(screen.queryByRole("region", { name: "Selected event" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Near me" }));
      await waitFor(() => expect(screen.getAllByRole("region", { name: "Selected event" }).length).toBeGreaterThan(0));
      expect(selectedCard()).toHaveTextContent("Brighton Gig");
      expect(selectedCard()).not.toHaveTextContent("Fitzroy Gig");

      // Announced in the status that already speaks for Near me.
      const status = screen.getByText(/^Nearest: Brighton Gig, 1\d km\. Showing events nearest you\.$/);
      expect(status.closest("[role=status]")).not.toBeNull();

      // Framed as before: the visitor with the nearest (Brighton, 12 km), not flown in on the one event.
      await waitFor(() => {
        const now = view();
        expect(now.zoom).toBeGreaterThanOrEqual(11);
        expect(now.zoom).toBeLessThan(14);
        expect(now.lat).toBeLessThan(MELBOURNE.lat);
        expect(now.lat).toBeGreaterThan(-37.95);
      });
      await new Promise<void>((done) => setTimeout(done, 700));
      expect(view().zoom).toBeLessThan(14);
      expect(document.querySelector(".scene-visitor")).not.toBeNull();
      expect(screen.queryByRole("button", { name: /Search this area/ })).toBeNull();
    });

    it("puts only the event's id in the address: no coordinate", async () => {
      params = new URLSearchParams("cat=theatre");
      answerAt(MELBOURNE.lat, MELBOURNE.lng);
      await renderMap(spread);
      fireEvent.click(screen.getByRole("button", { name: "Near me" }));
      await waitFor(() => expect(replace.mock.calls.at(-1)?.[0] ?? "").toMatch(/sel=brighton-gig/));
      expect(replace.mock.calls.at(-1)?.[0]).toBe("/map?cat=theatre&sel=brighton-gig");
      expect(replace.mock.calls.flat().join(" ")).not.toMatch(/-?\d{2,3}\.\d{3,}/);
      expectNoCoordinatesStored();
    });

    it("opens nothing when no event is within 100 km, and keeps the view and list as before", async () => {
      params = new URLSearchParams("cat=live-music");
      const PERTH = { lat: -31.9523, lng: 115.8613 };
      answerAt(PERTH.lat, PERTH.lng);
      await renderMap([fitzroyGig, sydneySoonest]);
      fireEvent.click(screen.getByRole("button", { name: "Near me" }));
      await expectCentredOn(PERTH);
      await waitFor(() => expect(listedTitles()).toEqual(["Fitzroy Gig", "Sydney Show"]));
      expect(screen.queryByRole("region", { name: "Selected event" })).toBeNull();
      expect(screen.queryByText(/^Nearest:/)).toBeNull();
      expect(screen.getByText("Map centred on Perth, WA.")).toBeInTheDocument();
      expect(replace.mock.calls.flat().join(" ")).not.toMatch(/sel=/);
    });

    it("the ask on open orders the list but opens nothing", async () => {
      answerAt(MELBOURNE.lat, MELBOURNE.lng);
      await renderMap([sydneySoonest, fitzroyGig, footscrayGig]);
      await expectCentredOn(MELBOURNE, 0.06);
      await waitFor(() => expect(listedTitles()[0]).toBe("Fitzroy Gig"));
      expect(screen.queryByRole("region", { name: "Selected event" })).toBeNull();
      expect(screen.queryByText(/^Nearest:/)).toBeNull();
      expect(replace.mock.calls.flat().join(" ")).not.toMatch(/sel=/);
    });

    it("focus stays on Near me, and Dismiss gives it back there", async () => {
      params = new URLSearchParams("cat=live-music");
      answerAt(MELBOURNE.lat, MELBOURNE.lng);
      await renderMap([sydneySoonest, fitzroyGig, footscrayGig]);
      const button = screen.getByRole("button", { name: "Near me" });
      button.focus();
      fireEvent.click(button);
      await waitFor(() => expect(screen.getAllByRole("region", { name: "Selected event" }).length).toBeGreaterThan(0));
      expect(selectedCard()).toHaveTextContent("Fitzroy Gig");
      expect(screen.getByRole("button", { name: "Near me" })).toHaveFocus();

      screen.getAllByRole("button", { name: "Dismiss selected event" })[0].click();
      await waitFor(() => expect(screen.queryByRole("region", { name: "Selected event" })).toBeNull());
      expect(screen.getByRole("button", { name: "Near me" })).toHaveFocus();
    });

    it("a later pin tap or row is selected the usual way, flying to it", async () => {
      params = new URLSearchParams("cat=live-music");
      answerAt(MELBOURNE.lat, MELBOURNE.lng);
      await renderMap([sydneySoonest, fitzroyGig, footscrayGig]);
      fireEvent.click(screen.getByRole("button", { name: "Near me" }));
      await waitFor(() => expect(screen.getAllByRole("region", { name: "Selected event" }).length).toBeGreaterThan(0));
      await expectCentredOn(MELBOURNE, 0.06);

      fireEvent.click(screen.getByRole("button", { name: "Locate Sydney Show on the map" }));
      await waitFor(() => expect(view().lat).toBeCloseTo(sydneySoonest.coordinates?.lat ?? 0, 2));
      expect(selectedCard()).toHaveTextContent("Sydney Show");
    });
  });

  it("an address with its own view keeps soonest first until Near me is pressed", async () => {
    params = new URLSearchParams("cat=live-music");
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Melbourne", state: "VIC" }));
    await renderMap([sydneySoonest, fitzroyGig]);
    expect(listedTitles()).toEqual(["Sydney Show", "Fitzroy Gig"]);
  });

  it("frames the visitor with the nearest few events, and no further out than the local radius", async () => {
    params = new URLSearchParams("price=all");
    answerAt(MELBOURNE.lat, MELBOURNE.lng);
    await renderMap(spread);
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    // Footscray (6 km west), Fitzroy (2 km), Brighton (12 km south): all in; Frankston (38 km) and Sydney out.
    await waitFor(() => {
      const now = view();
      expect(now.zoom).toBeGreaterThanOrEqual(11);
      expect(now.zoom).toBeLessThan(MAP_NEAR_ZOOM);
      expect(Math.abs(now.lat - MELBOURNE.lat)).toBeLessThan(0.08);
      expect(Math.abs(now.lng - MELBOURNE.lng)).toBeLessThan(0.08);
    });
    // The visitor's own dot, and still no "Search this area": framing is the map's own move.
    expect(document.querySelector(".scene-visitor")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Search this area/ })).toBeNull();
    expect(listedTitles().slice(0, 4)).toEqual(["Fitzroy Gig", "Footscray Gig", "Brighton Gig", "Frankston Gig"]);
  });

  it("respects the filters: only the matching events are listed and framed", async () => {
    params = new URLSearchParams("cat=theatre");
    answerAt(MELBOURNE.lat, MELBOURNE.lng);
    await renderMap(spread);
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await waitFor(() => expect(listedTitles()).toEqual(["Brighton Gig", "Frankston Gig"]));
    // Brighton (12 km) and Frankston (38 km, past the local radius) are theatre: only Brighton is framed.
    await waitFor(() => {
      const now = view();
      expect(now.zoom).toBeGreaterThanOrEqual(11);
      expect(now.lat).toBeGreaterThan(-37.95);
    });
  });

  it("with nothing within 25 km, frames the single nearest event up to 100 km away", async () => {
    params = new URLSearchParams("cat=theatre");
    answerAt(MELBOURNE.lat, MELBOURNE.lng);
    await renderMap([frankstonGig, sydneySoonest]);
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await waitFor(() => {
      const now = view();
      expect(now.zoom).toBeGreaterThanOrEqual(9);
      expect(now.zoom).toBeLessThan(12);
      expect(now.lat).toBeLessThan(MELBOURNE.lat);
    });
  });

  it("with no event within 100 km, centres on the visitor at MAP_NEAR_ZOOM, listing the nearest with its distance", async () => {
    params = new URLSearchParams("cat=live-music");
    const PERTH = { lat: -31.9523, lng: 115.8613 };
    answerAt(PERTH.lat, PERTH.lng);
    await renderMap([fitzroyGig, sydneySoonest]);
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await expectCentredOn(PERTH);
    await waitFor(() => expect(listedTitles()).toEqual(["Fitzroy Gig", "Sydney Show"]));
    expect(document.querySelectorAll("[data-scene-row]")[0]).toHaveTextContent(/2,\d{3} km away/);
  });

  it("an event with no position goes last, with no distance", async () => {
    params = new URLSearchParams("cat=live-music");
    answerAt(MELBOURNE.lat, MELBOURNE.lng);
    const nowhere = makeEvent({ id: "nowhere", title: "Nowhere Gig", suburb: "Atlantis", startsAt: "2026-11-16T09:00:00.000Z" });
    await renderMap([nowhere, sydneySoonest, fitzroyGig]);
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    await waitFor(() => expect(listedTitles()).toEqual(["Fitzroy Gig", "Sydney Show", "Nowhere Gig"]));
    expect(document.querySelectorAll("[data-scene-row]")[2]).not.toHaveTextContent(/km/);
  });
});
