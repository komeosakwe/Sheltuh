// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as location from "@/lib/location";
import type { LocationModule } from "@/lib/location-loader";
import type { SheltuhEvent } from "@/lib/types";

/*
 * /map places events without coordinates at their suburb's centre from the
 * ABS table, which loads on demand (lib/location-loader.ts): here the load
 * is under the test's control.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/map",
  useSearchParams: () => new URLSearchParams(),
}));

const boxHill: SheltuhEvent = {
  id: "box-hill",
  slug: "box-hill",
  title: "Box Hill Gig",
  description: "A test event.",
  category: "live-music",
  suburb: "Box Hill",
  venueName: "The Venue",
  venueAddress: "1 Test St",
  startsAt: "2026-11-20T09:00:00.000Z",
  organiserName: "Test Org",
  poster: { pattern: "burst", background: "#000000", primary: "#111111", secondary: "#222222" },
  ticketTypes: [{ id: "ga", name: "GA", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
};
vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return { ...actual, getEvents: async () => [boxHill], getUpcomingEvents: async () => [boxHill] };
});

const loadLocation = vi.fn<() => Promise<LocationModule>>();
vi.mock("@/lib/location-loader", () => ({
  loadLocation: () => loadLocation(),
  loadedLocation: () => null,
}));

import SceneMap from "@/components/SceneMap";

const sizes = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
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
  for (const [key, descriptor] of Object.entries(sizes)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
  vi.unstubAllGlobals();
});
afterEach(() => {
  cleanup();
  loadLocation.mockReset();
});

describe("SceneMap — suburb centres from the ABS table", () => {
  it("waits for the table before listing, so events are placed once", async () => {
    let resolve: (module: LocationModule) => void = () => {};
    loadLocation.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<SceneMap />);
    // Still loading: no list rows yet.
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.queryByRole("link", { name: "Box Hill Gig" })).toBeNull();
    resolve(location);
    expect(await screen.findByRole("button", { name: "Locate Box Hill Gig on the map" }, { timeout: 5_000 })).toBeEnabled();
    expect(screen.queryByText(/can.t be placed on the map yet/)).toBeNull();
  });

  it("if the table can't load: says so, falls back, and Try again places the event", async () => {
    loadLocation.mockRejectedValueOnce(new Error("chunk failed")).mockResolvedValueOnce(location);
    render(<SceneMap />);
    const alert = await screen.findByRole("alert", {}, { timeout: 5_000 });
    expect(alert).toHaveTextContent("Couldn’t load suburb locations");
    // Box Hill isn't one of the fallback's 20 inner suburbs.
    expect(screen.getByRole("button", { name: "Locate Box Hill Gig on the map" })).toBeDisabled();
    expect(screen.getByText(/1 event can.t be placed on the map yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Locate Box Hill Gig on the map" }, { timeout: 5_000 })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loadLocation).toHaveBeenCalledTimes(2);
  });
});
