// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// The demo map lists upcoming events only: getEvents (everything) also has one that has ended.
vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return {
    ...actual,
    getEvents: async () => [...mockEvents, endedEvent],
    getUpcomingEvents: async () => mockEvents,
  };
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

const endedEvent: SheltuhEvent = {
  ...event("ended-night", "Ended Night", 2000),
  startsAt: "2026-01-10T09:00:00.000Z",
  endsAt: "2026-01-10T12:00:00.000Z",
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

/** Phones (no matchMedia match) or desktop (the lg query matches). Undone after each test. */
const originalMatchMedia = window.matchMedia;
function stubViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes("min-width: 64rem"),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/** jsdom has no CSS: treat an element under a `hidden` class (the phone's inactive pane) as not shown. */
function stubVisibility() {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "checkVisibility");
  Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
    configurable: true,
    value(this: HTMLElement) {
      return !this.closest(".hidden");
    },
  });
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, "checkVisibility", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
  };
}

// Two spots far enough apart that they never cluster.
async function renderTwoSpots() {
  mockEvents = [
    event("paid-night", "Paid Night", 2000),
    { ...event("free-day", "Free Day", 0), suburb: "St Kilda", coordinates: { lat: -37.8677, lng: 144.9811 } },
  ];
  render(<SceneMap />);
  await screen.findByRole("link", { name: "Paid Night" }, { timeout: 30_000 });
  await screen.findByRole("button", { name: /^Paid Night\./ }, { timeout: 30_000 });
}

const sheet = () => document.querySelector<HTMLElement>("[data-map-sheet]");

describe("/map focus and layout on phones (WCAG 2.4.3, 2.4.11)", () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("'Show the list' moves focus to the list, which is part of the page on phones (no scroll box inside it)", async () => {
    stubViewport(false);
    await renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Show the list of 2 events" }));
    const list = screen.getByRole("region", { name: "Events list" });
    await waitFor(() => expect(document.activeElement).toBe(list));
    expect(list).toHaveAttribute("tabindex", "-1");
    // No nested scroll below lg; it scrolls beside the map from lg. The map keeps its 60svh cap.
    expect(list).toHaveClass("h-auto", "overflow-visible", "lg:h-[37.5rem]", "lg:overflow-y-auto");
    expect(list.className).not.toMatch(/(^|\s)overflow-y-auto/);
    expect(list.className).not.toMatch(/(^|\s)h-\[min/);
    expect(document.querySelector(".leaflet-container")?.closest(".relative.h-\\[min\\(26\\.25rem\\,60svh\\)\\]")).not.toBeNull();
  });

  it("Locate on a phone focuses the selected event's sheet; Dismiss returns focus to the event's marker", async () => {
    stubViewport(false);
    const restore = stubVisibility();
    try {
      params = new URLSearchParams("view=list");
      await renderTwoSpots();
      fireEvent.click(screen.getByRole("button", { name: "Locate Paid Night on the map" }));

      await waitFor(() => expect(document.activeElement).toBe(sheet()));
      const card = sheet() as HTMLElement;
      expect(card).toHaveAttribute("tabindex", "-1");
      expect(card).toHaveAccessibleName("Selected event");
      expect(card).toHaveTextContent("Paid Night");
      // While it's open the page knows how much of the screen it covers (globals.css pads by it).
      expect(document.documentElement.style.getPropertyValue("--map-sheet-h")).toMatch(/^\d+px$/);

      // The Locate button is in the hidden list now, so focus goes to the event's own marker.
      fireEvent.click(within(card).getByRole("button", { name: "Dismiss selected event" }));
      const marker = await screen.findByRole("button", { name: /^Paid Night\./ });
      expect(document.activeElement).toBe(marker);
      await waitFor(() => expect(sheet()).toBeNull());
      expect(document.documentElement.style.getPropertyValue("--map-sheet-h")).toBe("");
    } finally {
      restore();
    }
  }, 40_000);

  it("Dismiss after choosing a marker returns focus to that marker", async () => {
    stubViewport(false);
    await renderTwoSpots();
    const marker = await screen.findByRole("button", { name: /^Free Day\./ });
    act(() => marker.focus());
    fireEvent.click(marker);
    const card = await waitFor(() => {
      const found = sheet();
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss selected event" }));
    expect(document.activeElement).toBe(await screen.findByRole("button", { name: /^Free Day\./ }));
  }, 40_000);

  it("on desktop, Locate keeps focus on the row, and Dismiss on the map's card returns it there", async () => {
    stubViewport(true);
    await renderTwoSpots();
    const locate = screen.getByRole("button", { name: "Locate Free Day on the map" });
    act(() => locate.focus());
    fireEvent.click(locate);
    await waitFor(() => expect(screen.getAllByRole("region", { name: "Selected event" }).length).toBeGreaterThan(0));
    expect(document.activeElement).toBe(locate);
    const overlay = screen.getAllByRole("region", { name: "Selected event" }).find((el) => !el.hasAttribute("data-map-sheet"));
    fireEvent.click(within(overlay as HTMLElement).getByRole("button", { name: "Dismiss selected event" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Locate Free Day on the map" }));
  }, 40_000);
});

describe("/map results and controls", () => {
  it("announces the count in its persistent status; the visible count isn't a second live region", async () => {
    await renderMap();
    const status = screen.getAllByRole("status").find((el) => el.textContent === "2 upcoming events");
    expect(status).toBeDefined();
    const visible = screen.getByText("2 upcoming events", { selector: "p:not([role='status'])" });
    expect(visible).not.toHaveAttribute("aria-live");
  });

  it("has no single-option Sort control (it's always soonest first)", async () => {
    await renderMap();
    expect(screen.queryByLabelText(/Sort/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Sort/ })).toBeNull();
  });

  it("labels the search field visibly on phones, with a short placeholder", async () => {
    await renderMap();
    const search = screen.getByRole("searchbox", { name: "Search events, venues or suburbs" });
    expect(search).toHaveAttribute("placeholder", "Search events");
    const label = document.querySelector('label[for="scene-search"]');
    expect(label).toHaveClass("sm:sr-only");
    expect(label).not.toHaveClass("sr-only");
  });

  // Refinement (22 Oct 2026): the page's one sample-data disclosure is the layout's DemoBanner, so the map
  // no longer repeats its own; each event page's ticket panel still says nothing can be booked.
  it("demo: lists upcoming events only, with no second demo notice of its own", async () => {
    await renderMap();
    expect(screen.queryByRole("link", { name: "Ended Night" })).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
});
