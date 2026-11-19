// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { findLocality } from "@/lib/location";
import { MAP_NEAR_ZOOM } from "@/lib/map-layout";
import type { SheltuhEvent } from "@/lib/types";

/*
 * Where (Nearby's one location control) on a visit that has not loaded the suburb table: every event
 * has coordinates and no suburb is saved, so /map has no reason to fetch the table up front and its
 * lookup is the small Melbourne-only fallback (lib/geo.ts). Picking a place outside that list must
 * still centre on it. Its own file, and nothing here loads lib/location through the loader (as
 * tests/SceneMapLocate.test.tsx's warm-up does), so the table really is cold when the suburb is picked.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/map",
  // The map view (a phone's list is the default), and a filter so the browser isn't asked on open.
  useSearchParams: () => new URLSearchParams("cat=live-music&view=map"),
}));

let mockEvents: SheltuhEvent[] = [];
vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return { ...actual, getEvents: async () => mockEvents, getUpcomingEvents: async () => mockEvents };
});

import SceneMap from "@/components/SceneMap";
import { loadedLocation } from "@/lib/location-loader";

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

const events = [
  makeEvent({ id: "fitzroy-gig", title: "Fitzroy Gig", coordinates: { lat: -37.7986, lng: 144.9784 } }),
  makeEvent({
    id: "sydney-show",
    title: "Sydney Show",
    suburb: "Surry Hills",
    state: "NSW",
    timeZone: "Australia/Sydney",
    coordinates: { lat: -33.8861, lng: 151.2111 },
    startsAt: "2026-11-21T09:00:00.000Z",
  }),
];

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
  // Warm the map's one-off dynamic import (Leaflet, react-leaflet) under the hook timeout.
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
  localStorage.clear();
  sessionStorage.clear();
});

describe("Where with the suburb table not yet loaded", () => {
  it("picking a place outside the Melbourne fallback loads the table and centres on it, zoomed in", async () => {
    mockEvents = events;
    render(<SceneMap />);
    await screen.findAllByRole("link", { name: /^(Fitzroy Gig|Sydney Show)$/ });
    // The precondition: nothing has fetched the suburb table.
    expect(loadedLocation()).toBeNull();

    const panel = document.querySelector<HTMLElement>("[data-location-panel]") as HTMLElement;
    // Perth: no event near it, so the map centres on the place itself.
    fireEvent.click(within(panel).getByRole("button", { name: /^Perth/, hidden: true }));

    const perth = findLocality("Perth");
    expect(perth).not.toBeNull();
    const container = document.querySelector<HTMLElement>(".leaflet-container");
    await waitFor(() => {
      expect(Number(container?.dataset.zoom)).toBe(MAP_NEAR_ZOOM);
      expect(Number(container?.dataset.centerLat)).toBeCloseTo(perth?.lat ?? 0, 2);
      expect(Number(container?.dataset.centerLng)).toBeCloseTo(perth?.lng ?? 0, 2);
    });
    expect(screen.queryByRole("button", { name: /Search this area/ })).toBeNull();
  });
});
