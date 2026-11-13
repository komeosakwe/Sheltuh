// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NEAR_STORAGE_KEY } from "@/lib/near-storage";
import type { SheltuhEvent } from "@/lib/types";

/*
 * Nearby's radius (redesign PR 5; the audit's P1, "'Sheltüh near yoü' shows events 1376 km away"):
 * with a place to measure from, the list, the markers and the count keep only the events within
 * the radius (25 km by default); the rest are summarised under Further away, one press from
 * "Show all of Australia"; with nothing near, the audit's empty state. Mounts the real SceneMap
 * (demo path) with the real Leaflet map, as tests/SceneMap.test.tsx does, with Caulfield East saved.
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

// From Caulfield East's centre (the suburb table's): Malvern about 3 km, Fitzroy about 11, Frankston
// about 30, Fortitude Valley (Brisbane) about 1,378. The Brisbane one is the soonest.
const malvern = makeEvent({
  id: "malvern-gig",
  title: "Malvern Gig",
  suburb: "Malvern",
  coordinates: { lat: -37.8566, lng: 145.0286 },
  startsAt: "2026-11-21T09:00:00.000Z",
});
const fitzroy = makeEvent({
  id: "fitzroy-gig",
  title: "Fitzroy Gig",
  category: "art",
  coordinates: { lat: -37.7986, lng: 144.9784 },
  startsAt: "2026-11-22T09:00:00.000Z",
});
const frankston = makeEvent({
  id: "frankston-play",
  title: "Frankston Play",
  suburb: "Frankston",
  category: "theatre",
  coordinates: { lat: -38.1448, lng: 145.1227 },
  startsAt: "2026-11-23T09:00:00.000Z",
});
const brisbane = makeEvent({
  id: "valley-show",
  title: "Valley Show",
  suburb: "Fortitude Valley",
  state: "QLD",
  timeZone: "Australia/Brisbane",
  coordinates: { lat: -27.4575, lng: 153.0355 },
  startsAt: "2026-11-19T09:00:00.000Z",
});
const events = [brisbane, malvern, fitzroy, frankston];

/** A desktop (≥1024px) window: the search field, Where and the filters in a row (no Filters button). */
function desktopMatchMedia(query: string): MediaQueryList {
  return {
    matches: query.includes("min-width: 64rem"),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  };
}

beforeAll(async () => {
  vi.stubGlobal("matchMedia", desktopMatchMedia);
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

afterEach(() => {
  cleanup();
  replace.mockClear();
  params = new URLSearchParams();
  localStorage.clear();
});

async function renderNearby(list: SheltuhEvent[] = events) {
  localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Caulfield East", state: "VIC" }));
  mockEvents = list;
  render(<SceneMap />);
  await waitFor(() => expect(document.querySelector(".leaflet-container")).not.toBeNull());
  await waitFor(() => expect(document.querySelector("[data-map-count]")).toHaveTextContent(/within/));
}

const listedTitles = () =>
  Array.from(document.querySelectorAll("[data-scene-row]")).map((row) => row.querySelector("a")?.textContent ?? "");
const count = () => document.querySelector("[data-map-count]");
const further = () => document.querySelector<HTMLElement>("[data-further-away]");
const distance = () => screen.getByRole("combobox", { name: "Distance" });
const mapPanel = () => document.querySelector(".leaflet-container") as HTMLElement;
const statusSaying = (text: string) => screen.getAllByRole("status").some((el) => el.textContent === text);

/** Every event with a marker on the map (its own, or in a cluster), zoomed out so none is out of view. */
async function eventsOnMap(): Promise<string[]> {
  const zoomOut = within(mapPanel()).getByRole("button", { name: "Zoom out" });
  for (let i = 0; i < 16; i += 1) act(() => fireEvent.click(zoomOut));
  await new Promise<void>((done) => setTimeout(done, 300));
  const ids = new Set<string>();
  mapPanel()
    .querySelectorAll<HTMLElement>("[data-event-id]")
    .forEach((el) => ids.add(el.dataset.eventId ?? ""));
  mapPanel()
    .querySelectorAll<HTMLElement>("[data-event-ids]")
    .forEach((el) => (el.dataset.eventIds ?? "").split(" ").forEach((id) => ids.add(id)));
  return [...ids].sort();
}

describe("Nearby within a radius of the saved suburb", () => {
  it("lists only the events within 25 km, nearest first, and says so: 'N upcoming events within 25 km of {place}'", async () => {
    await renderNearby();
    expect(listedTitles()).toEqual(["Malvern Gig", "Fitzroy Gig"]);
    expect(count()).toHaveTextContent(/^2 upcoming events within 25 km of Caulfield East$/);
    // The number is black (the foreground), never orange text on white.
    expect(count()?.querySelector("span")).toHaveTextContent(/^2$/);
    expect(count()?.querySelector("span")?.className).not.toMatch(/signal/);
    expect(statusSaying("2 upcoming events within 25 km of Caulfield East")).toBe(true);
    expect(distance()).toHaveValue("25");
    // The default radius isn't "active": not filled.
    expect(distance().closest("[data-select-filter]")).not.toHaveClass("bg-foreground");
    // The Brisbane event, the soonest, isn't listed "near you" (the audit's 1,376 km).
    expect(screen.queryByRole("link", { name: "Valley Show" })).toBeNull();
  });

  it("puts only those events on the map", async () => {
    await renderNearby();
    expect(await eventsOnMap()).toEqual(["fitzroy-gig", "malvern-gig"]);
  });

  it("summarises the rest under Further away, nearest places first, with Show all of Australia", async () => {
    await renderNearby();
    const strip = further() as HTMLElement;
    expect(strip).toHaveTextContent("Further away");
    expect(strip).toHaveTextContent("2 more events outside 25 km — Frankston, Fortitude Valley.");

    fireEvent.click(within(strip).getByRole("button", { name: "Show all of Australia" }));
    await waitFor(() => expect(listedTitles()).toEqual(["Malvern Gig", "Fitzroy Gig", "Frankston Play", "Valley Show"]));
    expect(further()).toBeNull();
    expect(count()).toHaveTextContent(/^4 upcoming events$/);
    expect(statusSaying("4 upcoming events, nearest first")).toBe(true);
    // Its button went with it: focus goes to the Distance filter, which now says All of Australia.
    expect(distance()).toHaveValue("all");
    expect(document.activeElement).toBe(distance());
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/map?within=all", { scroll: false }));
    expect(await eventsOnMap()).toEqual(["fitzroy-gig", "frankston-play", "malvern-gig", "valley-show"]);
  });

  it("the Distance filter sets the radius: 5, 10, 25 or 50 km, written to the address unless it's 25", async () => {
    await renderNearby();
    fireEvent.change(distance(), { target: { value: "5" } });
    await waitFor(() => expect(listedTitles()).toEqual(["Malvern Gig"]));
    expect(count()).toHaveTextContent(/^1 upcoming event within 5 km of Caulfield East$/);
    expect(further()).toHaveTextContent("3 more events outside 5 km — Fitzroy, Frankston, Fortitude Valley.");
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/map?within=5", { scroll: false }));

    fireEvent.change(distance(), { target: { value: "50" } });
    await waitFor(() => expect(listedTitles()).toEqual(["Malvern Gig", "Fitzroy Gig", "Frankston Play"]));
    expect(further()).toHaveTextContent("1 more event outside 50 km — Fortitude Valley.");

    fireEvent.change(distance(), { target: { value: "25" } });
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/map", { scroll: false }));
  });

  it("opens with the radius in the address", async () => {
    params = new URLSearchParams("within=50");
    await renderNearby();
    expect(listedTitles()).toEqual(["Malvern Gig", "Fitzroy Gig", "Frankston Play"]);
    expect(distance()).toHaveValue("50");
  });

  it("applies the other filters first: the counts are of what they leave", async () => {
    params = new URLSearchParams("cat=live-music");
    await renderNearby();
    expect(listedTitles()).toEqual(["Malvern Gig"]);
    expect(further()).toHaveTextContent("1 more event outside 25 km — Fortitude Valley.");
    expect(statusSaying("1 upcoming event matching your filters within 25 km of Caulfield East")).toBe(true);
  });

  describe("with nothing within the radius", () => {
    it("says so (the audit's empty state), offers wider radii, and the map stays on the place", async () => {
      params = new URLSearchParams("cat=theatre");
      await renderNearby();
      const empty = document.querySelector("[data-nearby-empty]") as HTMLElement;
      expect(within(empty).getByRole("heading", { level: 3 })).toHaveTextContent("No events found near Caulfield East.");
      expect(empty).toHaveTextContent("Try expanding your search area.");
      const radii = within(empty).getAllByRole("button");
      expect(radii.map((button) => button.textContent)).toEqual(["Within 25 km", "50 km"]);
      expect(radii[0]).toHaveAttribute("aria-pressed", "true");
      expect(radii[1]).toHaveAttribute("aria-pressed", "false");
      // The current radius: nothing to do, and focus stays on it.
      radii[0].focus();
      fireEvent.click(radii[0]);
      expect(document.activeElement).toBe(radii[0]);
      // No orange dots here (they mark a selected filter, not a radius choice).
      expect(empty.querySelector("[data-selected-dots]")).toBeNull();
      expect(listedTitles()).toEqual([]);
      // Announced with the radius, so a wider one that still finds nothing is announced too.
      expect(statusSaying("No events within 25 km of Caulfield East.")).toBe(true);
      expect(count()).toHaveTextContent(/^0 upcoming events within 25 km of Caulfield East$/);
      expect(further()).toHaveTextContent("1 more event outside 25 km — Frankston.");
      // Not the "no events match your filters" state: the filters do match, just not near here.
      expect(screen.queryByText("No events match your filters")).toBeNull();
      expect(mapPanel()).toBeInTheDocument();

      fireEvent.click(within(empty).getByRole("button", { name: "50 km" }));
      await waitFor(() => expect(listedTitles()).toEqual(["Frankston Play"]));
      expect(document.querySelector("[data-nearby-empty]")).toBeNull();
      expect(distance()).toHaveValue("50");
      expect(document.activeElement).toBe(distance());
    });

    it("from 5 km, offers 10, 25 and 50 km beside it", async () => {
      params = new URLSearchParams("cat=art&within=5");
      await renderNearby();
      const empty = document.querySelector("[data-nearby-empty]") as HTMLElement;
      expect(within(empty).getAllByRole("button").map((button) => button.textContent)).toEqual(["Within 5 km", "10 km", "25 km", "50 km"]);
      fireEvent.click(within(empty).getByRole("button", { name: "25 km" }));
      await waitFor(() => expect(listedTitles()).toEqual(["Fitzroy Gig"]));
    });
  });

  it("without a place to measure from, lists every event soonest first, with no radius, Distance or Further away", async () => {
    mockEvents = events;
    render(<SceneMap />);
    await screen.findByRole("link", { name: "Valley Show" }, { timeout: 30_000 });
    expect(listedTitles()).toEqual(["Valley Show", "Malvern Gig", "Fitzroy Gig", "Frankston Play"]);
    expect(count()).toHaveTextContent(/^4 upcoming events$/);
    expect(screen.queryByRole("combobox", { name: "Distance" })).toBeNull();
    expect(further()).toBeNull();
  });
});
