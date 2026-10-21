// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SheltuhEvent } from "@/lib/types";

/*
 * The /map page around the map itself (brand-direction-one.md §7; owner
 * requests of 21 Oct 2026): the brand h1, Map first and by default on
 * phones with ?view=list still opening the list, and the orange "Buy
 * tickets" on every list row. Mounts the real SceneMap (demo path), as
 * tests/SceneMap.test.tsx does for the map's markers.
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
  return { ...actual, getEvents: async () => mockEvents };
});

import SceneMap from "@/components/SceneMap";

const sizes = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
};

const event = (id: string, title: string, priceCents: number): SheltuhEvent => ({
  id,
  slug: id,
  title,
  description: "A test event.",
  category: "live-music",
  suburb: "Fitzroy",
  venueName: "The Venue",
  venueAddress: "1 Test St",
  startsAt: "2026-11-20T09:00:00.000Z",
  organiserName: "Test Org",
  coordinates: { lat: -37.7986, lng: 144.9784 },
  poster: { pattern: "burst", background: "#000000", primary: "#111111", secondary: "#222222" },
  ticketTypes: [{ id: "ga", name: "GA", priceCents, feePolicy: "buyer-pays", quantityAvailable: 10 }],
});

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
  replace.mockClear();
  params = new URLSearchParams();
});

async function renderMap() {
  mockEvents = [event("paid-night", "Paid Night", 2000), event("free-day", "Free Day", 0)];
  render(<SceneMap />);
  await screen.findByRole("link", { name: "Paid Night" }, { timeout: 30_000 });
}

describe("/map around the map", () => {
  it("has the brand line as its h1, read as 'Sheltüh near you.'", async () => {
    await renderMap();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Sheltüh near you.");
    expect(h1).toHaveClass("display-lg", "font-display");
  }, 40_000);

  it("shows the map first and by default on phones, then the list", async () => {
    await renderMap();
    const group = screen.getByRole("group", { name: "Show events as" });
    const [first, second] = within(group).getAllByRole("button");
    expect(first).toHaveAccessibleName("Map");
    expect(second).toHaveAccessibleName("List");
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");
    // The map view keeps a visible way on to the list below the map.
    fireEvent.click(screen.getByRole("button", { name: "Show the list of 2 events" }));
    expect(second).toHaveAttribute("aria-pressed", "true");
    // The list is written to the URL so it can be shared; the map, the default, isn't.
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/map?view=list", { scroll: false }));
    fireEvent.click(first);
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith("/map", { scroll: false }));
  });

  it("opens the list for a shared ?view=list", async () => {
    params = new URLSearchParams("view=list");
    await renderMap();
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /^Show the list/ })).toBeNull();
  });

  it("gives every list row its orange quick buy: Buy tickets, or Get free tickets", async () => {
    await renderMap();
    const paid = screen.getByRole("link", { name: "Buy tickets for Paid Night" });
    expect(paid).toHaveAttribute("href", "/events/paid-night#tickets");
    expect(paid).toHaveClass("btn-signal");
    expect(screen.getByRole("link", { name: "Get free tickets for Free Day" })).toHaveAttribute(
      "href",
      "/events/free-day#tickets",
    );
    // A sibling of the row's title link and its locate button, never inside them.
    expect(paid.closest("div.grid")).toContainElement(screen.getByRole("link", { name: "Paid Night" }));
    expect(screen.getByRole("button", { name: "Locate Paid Night on the map" })).toBeInTheDocument();
  });
});
