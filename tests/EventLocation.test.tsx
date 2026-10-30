// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import type { EventLocationLeafletProps } from "@/components/events/EventLocationLeaflet";
import EventLocation from "@/components/events/EventLocation";
import { appleMapsHref, directionsHref } from "@/lib/maps";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The event page's Location section (owner request, 26 Oct 2026): the venue,
 * a small decorative map loaded only as it nears the screen, and the Google
 * Maps and Apple Maps links (owner decision A-D4, 27 Oct 2026). Leaflet itself is stood in for (e2e/event-page.spec.ts runs the real
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

const GOOGLE_MAPS = /^Google Maps: directions to /;
const APPLE_MAPS = /^Apple Maps: /;

describe("EventLocation", () => {
  it("sits after About and Who's Going, before Good to know, on the event page (owner's order, 30 Oct 2026)", () => {
    render(<EventDetailsView event={sample("neon-static")} demo />);
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => (h.textContent ?? "").replace(/\u2019/g, "'"));
    const about = headings.indexOf("About this event");
    expect(about).toBeGreaterThanOrEqual(0);
    // Refunds sit between Location and Good to know, but as a labelled list, not a heading.
    expect(headings.slice(about, about + 4)).toEqual(["About this event", "Who's going", "Location", "Good to know"]);
  });

  it("names the venue and address, and links them to Google Maps and Apple Maps, the named controls", () => {
    const event = sample("neon-static");
    render(<EventLocation event={event} />);
    const region = screen.getByRole("region", { name: "Location" });
    expect(within(region).getByText("Warehouse 9")).toHaveClass("font-semibold");
    expect(within(region).getByText("9 Rupert Street, Collingwood VIC 3066")).toBeInTheDocument();

    const google = within(region).getByRole("link", { name: GOOGLE_MAPS });
    expect(google).toHaveAccessibleName(
      "Google Maps: directions to Warehouse 9, 9 Rupert Street, Collingwood VIC 3066 (opens in a new tab)",
    );
    expect(google).toHaveTextContent("Google Maps");
    expect(google).toHaveAttribute("href", directionsHref(event));
    expect(google).toHaveAttribute("href", expect.stringMatching(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/));
    expect(google).toHaveAttribute("target", "_blank");
    expect(google).toHaveAttribute("rel", "noopener noreferrer");

    // Always both, whatever the device: no user-agent sniffing.
    const apple = within(region).getByRole("link", { name: APPLE_MAPS });
    expect(apple).toHaveAccessibleName(
      "Apple Maps: directions to Warehouse 9, 9 Rupert Street, Collingwood VIC 3066 (opens in a new tab)",
    );
    expect(apple).toHaveTextContent("Apple Maps");
    expect(apple).toHaveAttribute("href", "https://maps.apple.com/?daddr=9%20Rupert%20Street%2C%20Collingwood%20VIC%203066");
    expect(apple).toHaveAttribute("target", "_blank");
    expect(apple).toHaveAttribute("rel", "noopener noreferrer");
    // Both 44px tall.
    expect(google).toHaveClass("min-h-11");
    expect(apple).toHaveClass("min-h-11");
    // The map's own tap target isn't a third link to assistive technology or the keyboard.
    expect(within(region).getAllByRole("link")).toHaveLength(2);

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
    expect(screen.getByRole("link", { name: GOOGLE_MAPS })).toBeInTheDocument();
    expect(screen.getByText("Warehouse 9")).toBeInTheDocument();
  });

  it("leaves the map out where the browser can't tell when it's near", async () => {
    Reflect.deleteProperty(window, "IntersectionObserver");
    const { container } = render(<EventLocation event={sample("neon-static")} />);
    await waitFor(() => expect(container.querySelector("[data-event-map]")).toBeNull());
    expect(screen.getByRole("link", { name: GOOGLE_MAPS })).toBeInTheDocument();
    expect(loader.loads).toBe(0);
  });

  it("shows the suburb when there's no street address", () => {
    const event: SheltuhEvent = { ...sample("neon-static"), venueAddress: "" };
    render(<EventLocation event={event} />);
    expect(screen.getByText("Collingwood, VIC")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: GOOGLE_MAPS })).toHaveAccessibleName(
      "Google Maps: directions to Warehouse 9, Collingwood, VIC (opens in a new tab)",
    );
    expect(screen.getByRole("link", { name: APPLE_MAPS })).toHaveAttribute(
      "href",
      "https://maps.apple.com/?daddr=Warehouse%209%2C%20Collingwood",
    );
  });

  it("isn't there at all with no venue, address or suburb", () => {
    const event: SheltuhEvent = { ...sample("neon-static"), venueName: " ", venueAddress: "", suburb: "" };
    render(<EventLocation event={event} />);
    expect(screen.queryByRole("region", { name: "Location" })).toBeNull();
    expect(screen.queryByRole("link", { name: GOOGLE_MAPS })).toBeNull();
    expect(screen.queryByRole("link", { name: APPLE_MAPS })).toBeNull();
  });
  it("with a linked Google place and the organiser's pin: Google by place id, Apple at the pin, and the pin exact", async () => {
    const pin = { lat: -37.80412, lng: 144.98377 };
    const event: SheltuhEvent = {
      ...sample("fitzroy-poetry-and-noise"),
      venuePlaceId: "ChIJ_test_place_id_123",
      venuePinned: true,
      coordinates: pin,
    };
    render(<EventLocation event={event} />);
    const venue = [event.venueName, event.venueAddress].join(", ");

    const google = screen.getByRole("link", { name: GOOGLE_MAPS });
    expect(google).toHaveAttribute(
      "href",
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue)}&destination_place_id=ChIJ_test_place_id_123`,
    );
    const apple = screen.getByRole("link", { name: APPLE_MAPS });
    expect(apple).toHaveAttribute("href", appleMapsHref(event));
    expect(apple).toHaveAttribute("href", `https://maps.apple.com/?ll=-37.80412,144.98377&q=${encodeURIComponent(event.venueName)}`);
    // A spot on the map, not directions.
    expect(apple).toHaveAccessibleName(`Apple Maps: ${venue} (opens in a new tab)`);

    // The organiser's pin is the venue's spot: street level, no suburb table, no "approximate" note.
    nearScreen();
    const map = await screen.findByTestId("leaflet");
    expect(map).toHaveAttribute("data-lat", String(pin.lat));
    expect(map).toHaveAttribute("data-lng", String(pin.lng));
    expect(map).toHaveAttribute("data-zoom", "15");
    expect(loader.loads).toBe(0);
    expect(screen.queryByText(/The pin marks/)).toBeNull();
  });
});
