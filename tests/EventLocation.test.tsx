// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import type { EventLocationLeafletProps } from "@/components/events/EventLocationLeaflet";
import EventLocation from "@/components/events/EventLocation";
import { directionsHref } from "@/lib/maps";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The event page's Location section (owner request, 26 Oct 2026): the venue,
 * a small decorative map loaded only as it nears the screen, and "Open in
 * Maps". Leaflet itself is stood in for (e2e/event-page.spec.ts runs the real
 * map); the suburb table is a stub whose loads are counted.
 */

const loader = vi.hoisted(() => ({ loads: 0 }));
vi.mock("@/lib/location-loader", async () => {
  const { locationStub } = await import("./test-utils/locationStub");
  return {
    loadLocation: () => {
      loader.loads += 1;
      return Promise.resolve(locationStub);
    },
    // Not loaded yet: the map has to ask for it.
    loadedLocation: () => null,
  };
});

vi.mock("@/components/events/EventLocationLeaflet", () => ({
  default: ({ lat, lng, zoom }: EventLocationLeafletProps) => (
    <div data-testid="leaflet" data-lat={lat} data-lng={lng} data-zoom={zoom} />
  ),
}));

type Entry = { target: Element; isIntersecting: boolean };
let notify: ((entries: Entry[]) => void) | null = null;
let observed: Element[] = [];
let rootMargin = "";

class FakeObserver {
  constructor(cb: (entries: Entry[]) => void, options?: { rootMargin?: string }) {
    notify = cb;
    rootMargin = options?.rootMargin ?? "";
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {
    observed = [];
  }
}

beforeEach(() => {
  loader.loads = 0;
  notify = null;
  observed = [];
  window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  // The sample events are dated Sept–Nov 2026: read them before then.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "IntersectionObserver");
});

function sample(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`no sample ${slug}`);
  return event;
}

/** The map box scrolls near the screen. */
function nearScreen() {
  const target = observed[0];
  if (!notify || !target) throw new Error("the map box isn't observed");
  const callback = notify;
  act(() => callback([{ target, isIntersecting: true }]));
}

const OPEN_IN_MAPS = /^Open in Maps: directions to /;

describe("EventLocation", () => {
  it("sits after About and before Good to know on the event page", () => {
    render(<EventDetailsView event={sample("neon-static")} demo />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const about = headings.indexOf("About this event");
    expect(about).toBeGreaterThanOrEqual(0);
    expect(headings.slice(about, about + 3)).toEqual(["About this event", "Location", "Good to know"]);
  });

  it("names the venue and address, and links them to directions as the one named control", () => {
    const event = sample("neon-static");
    render(<EventLocation event={event} />);
    const region = screen.getByRole("region", { name: "Location" });
    expect(within(region).getByText("Warehouse 9")).toHaveClass("font-semibold");
    expect(within(region).getByText("9 Rupert Street, Collingwood VIC 3066")).toBeInTheDocument();

    const link = within(region).getByRole("link", { name: OPEN_IN_MAPS });
    expect(link).toHaveAccessibleName(
      "Open in Maps: directions to Warehouse 9, 9 Rupert Street, Collingwood VIC 3066 (opens Google Maps in a new tab)",
    );
    expect(link).toHaveTextContent("Open in Maps");
    expect(link).toHaveAttribute("href", directionsHref(event));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The map's own tap target isn't a second link to assistive technology or the keyboard.
    expect(within(region).getAllByRole("link")).toHaveLength(1);

    const map = region.querySelector<HTMLElement>("[data-event-map]");
    expect(map).toHaveAttribute("aria-hidden", "true");
    const mapLink = region.querySelector<HTMLElement>("[data-event-map-link]");
    expect(mapLink).toHaveAttribute("href", directionsHref(event));
    expect(mapLink).toHaveAttribute("tabindex", "-1");
  });

  it("loads nothing until the map nears the screen, then pins the venue's own position at street level", async () => {
    const event = sample("neon-static");
    const { container } = render(<EventLocation event={event} />);
    // The box is there from the start (no layout shift), empty.
    const box = container.querySelector("[data-event-map] [data-surface]");
    expect(box).toHaveClass("h-52");
    expect(observed).toEqual([box]);
    expect(rootMargin).toBe("400px 0px");
    expect(screen.queryByTestId("leaflet")).toBeNull();
    expect(loader.loads).toBe(0);

    nearScreen();
    const map = await screen.findByTestId("leaflet");
    expect(map).toHaveAttribute("data-lat", String(event.coordinates?.lat));
    expect(map).toHaveAttribute("data-lng", String(event.coordinates?.lng));
    expect(map).toHaveAttribute("data-zoom", "15");
    // Inert: nothing inside the map can take focus or be clicked into.
    expect(map.closest("[inert]")).not.toBeNull();
    // Its own coordinates: no suburb table, and no claim it's approximate.
    expect(loader.loads).toBe(0);
    expect(screen.queryByText(/The pin marks/)).toBeNull();
  });

  it("without coordinates, loads the suburb table only once near, and says the pin is the suburb", async () => {
    const event: SheltuhEvent = { ...sample("fitzroy-poetry-and-noise"), coordinates: undefined };
    render(<EventLocation event={event} />);
    expect(loader.loads).toBe(0);

    nearScreen();
    const map = await screen.findByTestId("leaflet");
    expect(loader.loads).toBe(1);
    // The stub's Fitzroy (tests/test-utils/locationStub.ts), zoomed out to the neighbourhood.
    expect(map).toHaveAttribute("data-lat", "-37.8");
    expect(map).toHaveAttribute("data-lng", "144.98");
    expect(map).toHaveAttribute("data-zoom", "13");
    expect(screen.getByText("The pin marks Fitzroy, VIC, not the venue’s exact spot.")).toBeInTheDocument();
  });

  it("leaves the map out when nothing places the event, keeping the address and link", async () => {
    const event: SheltuhEvent = { ...sample("neon-static"), coordinates: undefined, suburb: "Nowhereville" };
    const { container } = render(<EventLocation event={event} />);
    nearScreen();
    await waitFor(() => expect(container.querySelector("[data-event-map]")).toBeNull());
    expect(loader.loads).toBe(1);
    expect(screen.getByRole("link", { name: OPEN_IN_MAPS })).toBeInTheDocument();
    expect(screen.getByText("Warehouse 9")).toBeInTheDocument();
  });

  it("leaves the map out where the browser can't tell when it's near", async () => {
    Reflect.deleteProperty(window, "IntersectionObserver");
    const { container } = render(<EventLocation event={sample("neon-static")} />);
    await waitFor(() => expect(container.querySelector("[data-event-map]")).toBeNull());
    expect(screen.getByRole("link", { name: OPEN_IN_MAPS })).toBeInTheDocument();
    expect(loader.loads).toBe(0);
  });

  it("shows the suburb when there's no street address", () => {
    const event: SheltuhEvent = { ...sample("neon-static"), venueAddress: "" };
    render(<EventLocation event={event} />);
    expect(screen.getByText("Collingwood, VIC")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: OPEN_IN_MAPS })).toHaveAccessibleName(
      "Open in Maps: directions to Warehouse 9, Collingwood, VIC (opens Google Maps in a new tab)",
    );
  });

  it("isn't there at all with no venue, address or suburb", () => {
    const event: SheltuhEvent = { ...sample("neon-static"), venueName: " ", venueAddress: "", suburb: "" };
    render(<EventLocation event={event} />);
    expect(screen.queryByRole("region", { name: "Location" })).toBeNull();
    expect(screen.queryByRole("link", { name: OPEN_IN_MAPS })).toBeNull();
  });
});
