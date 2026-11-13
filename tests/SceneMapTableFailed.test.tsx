// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NEAR_STORAGE_KEY } from "@/lib/near-storage";
import type { SheltuhEvent } from "@/lib/types";

/*
 * CodeRabbit (PR 43): the suburb table is needed for a saved place even when every event has a pin.
 * If it can't load, Nearby must say so and offer to try again, not leave the place silently unresolved.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/map",
  // A filter in the address, so the browser isn't asked for its location on open.
  useSearchParams: () => new URLSearchParams("cat=live-music"),
}));

vi.mock("@/lib/location-loader", () => ({
  loadLocation: () => Promise.reject(new Error("offline")),
  loadedLocation: () => null,
}));

let mockEvents: SheltuhEvent[] = [];
vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return { ...actual, getEvents: async () => mockEvents, getUpcomingEvents: async () => mockEvents };
});

import SceneMap from "@/components/SceneMap";

const sizeDescriptors = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
};

const pinned: SheltuhEvent = {
  id: "fitzroy-gig",
  slug: "fitzroy-gig",
  title: "Fitzroy Gig",
  description: "A test event.",
  category: "live-music",
  suburb: "Fitzroy",
  venueName: "The Venue",
  venueAddress: "1 Test St",
  startsAt: "2099-11-20T09:00:00.000Z",
  organiserName: "Test Org",
  poster: { pattern: "burst", background: "#000000", primary: "#111111", secondary: "#222222" },
  ticketTypes: [{ id: "ga", name: "GA", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  coordinates: { lat: -37.7986, lng: 144.9784 },
};

beforeAll(() => {
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
});

afterAll(() => {
  for (const [key, descriptor] of Object.entries(sizeDescriptors)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Nearby when the suburb table can't load", () => {
  it("every event pinned but a saved place: says the place can't be found yet, with Try again", async () => {
    mockEvents = [pinned];
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Perth", state: "WA" }));
    render(<SceneMap />);
    await waitFor(
      () => expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load suburb locations, so we can’t find your place yet."),
      { timeout: 10_000 },
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
