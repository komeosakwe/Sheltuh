// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SheltuhEvent } from "@/lib/types";

/*
 * Mounts the real SceneMap (demo path) with the real Leaflet map. jsdom has
 * no layout, so the map's container gets a fixed size and ResizeObserver /
 * scrollIntoView are stubbed; everything else (markers, clustering, cards)
 * is the production code.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/map",
  useSearchParams: () => new URLSearchParams(),
}));

let mockEvents: SheltuhEvent[] = [];
vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return { ...actual, getEvents: async () => mockEvents };
});

import SceneMap from "@/components/SceneMap";

const sizeDescriptors = {
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
  for (const [key, descriptor] of Object.entries(sizeDescriptors)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
  vi.unstubAllGlobals();
});

afterEach(cleanup);

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

// Far enough apart (Fitzroy, St Kilda, Footscray) that they never cluster at the fitted zoom.
const withPhoto = makeEvent({
  id: "photo-night",
  title: "Photo Night",
  imageUrl: "/events/photo-night.jpg",
  coordinates: { lat: -37.7986, lng: 144.9784 },
});
const noPhoto = makeEvent({
  id: "poster-only",
  title: "Poster Only",
  category: "theatre",
  suburb: "St Kilda",
  coordinates: { lat: -37.8677, lng: 144.9811 },
  startsAt: "2026-11-21T09:00:00.000Z",
});
const westSide = makeEvent({
  id: "west-side",
  title: "West Side",
  category: "art",
  suburb: "Footscray",
  coordinates: { lat: -37.7996, lng: 144.9007 },
  startsAt: "2026-11-22T09:00:00.000Z",
});
const unmapped = makeEvent({ id: "unmapped", title: "Somewhere Unknown", suburb: "Nowhereville" });

async function renderMap(events: SheltuhEvent[]) {
  mockEvents = events;
  render(<SceneMap />);
  // The map panel is a dynamic (client-only) import; wait for Leaflet to mount.
  await waitFor(() => expect(document.querySelector(".leaflet-container")).not.toBeNull());
}

const markerButton = (title: string) => screen.findByRole("button", { name: new RegExp(`^${title}\\.`) });
const mapPanel = () => document.querySelector(".leaflet-container") as HTMLElement;

describe("SceneMap photo markers", () => {
  it("renders each located event as a photo marker in a category ring, with an accessible name", async () => {
    await renderMap([withPhoto, noPhoto, westSide]);

    const marker = await markerButton("Photo Night");
    expect(marker.tagName).toBe("BUTTON");
    expect(marker).toHaveAttribute("aria-pressed", "false");
    expect(marker).toHaveAccessibleName(/^Photo Night\. Live music, /);
    expect(marker.querySelector(".bg-cat-live-music")).not.toBeNull();
    expect(marker.querySelector("img")).toHaveAttribute("src", "/events/photo-night.jpg");
    expect(marker.querySelector("img")).toHaveAttribute("loading", "lazy");

    const theatre = await markerButton("Poster Only");
    expect(theatre.querySelector(".bg-cat-theatre")).not.toBeNull();
    // Each marker sits in a fixed 48px Leaflet icon box: no layout shift when the photo loads or fails.
    const icon = marker.closest(".leaflet-marker-icon") as HTMLElement;
    expect(icon.style.width).toBe("48px");
    expect(icon.style.height).toBe("48px");
  });

  it("falls back to the poster art when there is no photo, or when the photo fails to load", async () => {
    await renderMap([withPhoto, noPhoto, westSide]);

    const posterOnly = await markerButton("Poster Only");
    expect(posterOnly.querySelector("img")).toBeNull();
    expect(posterOnly.querySelector("svg")).not.toBeNull();

    const photo = await markerButton("Photo Night");
    const img = photo.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    expect(photo.querySelector("img")).toBeNull();
    expect(photo.querySelector("svg")).not.toBeNull();
  });

  it("is one keyboard stop per marker: a native button inside the map, with Leaflet's wrapper left out of the tab order", async () => {
    await renderMap([withPhoto, noPhoto, westSide]);

    const marker = await markerButton("Photo Night");
    expect(mapPanel()).toContainElement(marker);
    expect(marker).toHaveAttribute("type", "button");
    expect(marker).not.toBeDisabled();
    expect(marker).not.toHaveAttribute("tabindex");
    expect(marker.closest(".leaflet-marker-icon")).not.toHaveAttribute("tabindex");
    expect(marker.closest(".leaflet-marker-icon")).not.toHaveAttribute("role");

    act(() => marker.focus());
    expect(document.activeElement).toBe(marker);
  });

  it("selecting a marker presses it and shows a card that leads with the photo, then title, date, venue, price and a link", async () => {
    await renderMap([withPhoto, noPhoto, westSide]);

    // Enter/Space on a native button dispatch this click in browsers (verified in Playwright).
    fireEvent.click(await markerButton("Photo Night"));

    await waitFor(() => expect(screen.getAllByRole("region", { name: "Selected event" }).length).toBeGreaterThan(0));
    expect(await markerButton("Photo Night")).toHaveAttribute("aria-pressed", "true");

    const card = screen.getAllByRole("region", { name: "Selected event" })[0];
    const photo = card.querySelector("img");
    expect(photo).toHaveAttribute("src", "/events/photo-night.jpg");
    const title = within(card).getByText("Photo Night");
    expect(photo?.compareDocumentPosition(title) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(card).toHaveTextContent(/Fri 20 Nov, 8:00 pm/);
    expect(card).toHaveTextContent("The Venue · Fitzroy");
    // All-inclusive: A$20 + 4% + A$0.50 booking fee.
    expect(card).toHaveTextContent("A$21.30 incl. booking fee");
    expect(within(card).getByRole("link", { name: /View event/ })).toHaveAttribute("href", "/events/photo-night");

    fireEvent.click(within(card).getByRole("button", { name: "Dismiss selected event" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selected event" })).toBeNull());
    expect(await markerButton("Photo Night")).toHaveAttribute("aria-pressed", "false");
  });

  it("lists events without a location but doesn't pin them, and says so", async () => {
    await renderMap([withPhoto, noPhoto, unmapped]);

    await markerButton("Photo Night");
    expect(screen.getByRole("link", { name: "Somewhere Unknown" })).toBeInTheDocument();

    // Zoom out to the whole world, so viewport culling can't be what hides a
    // wrongly placed pin: the located events merge, and nothing else appears.
    const zoomOut = within(mapPanel()).getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 16; i += 1) act(() => fireEvent.click(zoomOut));
    await within(mapPanel()).findByRole("button", { name: /^2 events/ });
    const markerNames = within(mapPanel())
      .getAllByRole("button")
      .filter((button) => button.closest(".leaflet-marker-icon"))
      .map((button) => button.getAttribute("aria-label"));
    expect(markerNames).toHaveLength(1);
    expect(markerNames.join()).not.toMatch(/Somewhere Unknown/);
    expect(screen.getByRole("button", { name: "Locate Somewhere Unknown on the map" })).toBeDisabled();
    expect(screen.getByText(/1 event can.t be placed on the map yet/)).toBeInTheDocument();
  });

  it("gives every list row a thumbnail of the event photo", async () => {
    await renderMap([withPhoto, noPhoto]);
    await markerButton("Photo Night");
    const row = screen.getByRole("link", { name: "Photo Night" }).closest("div.grid") as HTMLElement;
    expect(row.querySelector("img")).toHaveAttribute("src", "/events/photo-night.jpg");
  });
});

describe("SceneMap overlapping events", () => {
  // No venue coordinates of their own: both fall back to Fitzroy's suburb centre (the common live-data case).
  const stackedA = makeEvent({ id: "stacked-a", title: "Stacked A", startsAt: "2026-11-20T09:00:00.000Z" });
  const stackedB = makeEvent({ id: "stacked-b", title: "Stacked B", category: "art", startsAt: "2026-11-21T09:00:00.000Z" });

  it("groups events on the same spot into one cluster that opens a list, and Escape returns focus to it", async () => {
    await renderMap([stackedA, stackedB, westSide]);

    const cluster = await within(mapPanel()).findByRole("button", { name: /^2 events at this spot, including Stacked A/ });
    expect(cluster).toHaveAttribute("aria-expanded", "false");
    expect(within(mapPanel()).queryByRole("button", { name: /^Stacked B\./ })).toBeNull();

    fireEvent.click(cluster);
    const list = await screen.findByRole("region", { name: "2 events in Fitzroy" });
    expect(list).toHaveTextContent("Pinned at the suburb centre");
    const first = within(list).getByRole("button", { name: /Stacked A/ });
    expect(document.activeElement).toBe(first);
    expect(cluster).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(first, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "2 events in Fitzroy" })).toBeNull());
    expect(document.activeElement).toBe(cluster);
  });

  it("choosing from the list selects that event, which then gets its own marker and an approximate-location card", async () => {
    await renderMap([stackedA, stackedB, westSide]);

    fireEvent.click(await within(mapPanel()).findByRole("button", { name: /^2 events at this spot/ }));
    const list = await screen.findByRole("region", { name: "2 events in Fitzroy" });
    fireEvent.click(within(list).getByRole("button", { name: /Stacked B/ }));

    expect(await markerButton("Stacked B")).toHaveAttribute("aria-pressed", "true");
    const card = screen.getAllByRole("region", { name: "Selected event" })[0];
    expect(card).toHaveTextContent("Stacked B");
    expect(card).toHaveTextContent("Pinned at the suburb centre, not the exact venue.");
  });
});
