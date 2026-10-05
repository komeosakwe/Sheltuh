// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PhoneEventSections from "@/components/home/phone/PhoneEventSections";
import type { SheltuhEvent } from "@/lib/types";

const loadHomeEvents = vi.fn<() => Promise<SheltuhEvent[]>>();
vi.mock("@/lib/home-events", () => ({ loadHomeEvents: () => loadHomeEvents() }));

function stubViewport(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function event(id: string, startsAt: string, priceCents = 3000): SheltuhEvent {
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "art",
    suburb: "Fitzroy",
    venueName: "Venue",
    venueAddress: "1 St",
    startsAt,
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000", primary: "#fff", secondary: "#f00" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

// Now: 30 Sep 2026. Up next + 6 coming up, 2 more in October, 2 free, and one that has ended.
const EVENTS = [
  event("ended", "2026-09-20T08:00:00.000Z", 0),
  ...Array.from({ length: 7 }, (_, i) => event(`soon${i}`, `2026-10-0${1 + i}T08:00:00.000Z`)),
  event("oct-a", "2026-10-20T08:00:00.000Z", 0),
  event("oct-b", "2026-10-21T08:00:00.000Z", 0),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T02:00:00.000Z"));
  loadHomeEvents.mockReset();
  stubViewport(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = () => act(() => Promise.resolve());

describe("PhoneEventSections", () => {
  it("while loading: announces it and holds the space of Up next and Coming up", () => {
    loadHomeEvents.mockReturnValue(new Promise(() => {}));
    render(<PhoneEventSections guide={<p>Guide slot</p>} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    expect(screen.getByRole("heading", { name: "Coming up in Melbourne" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Event/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /What’s on/ })).not.toBeInTheDocument();
    expect(screen.getByText("Guide slot")).toBeInTheDocument();
  });

  it("when loaded on a phone: Up next, Coming up (6), What's on, Free & low-cost, with ended events dropped", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    render(<PhoneEventSections guide={<p>Guide slot</p>} />);
    await flush();

    expect(screen.getByRole("status")).toHaveTextContent("");
    const upNext = screen.getByRole("region", { name: "Up next" });
    expect(within(upNext).getByRole("link")).toHaveAttribute("href", "/events/soon0");

    const coming = screen.getByRole("list", { name: "Coming up in Melbourne" });
    expect(within(coming).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(
      [1, 2, 3, 4, 5, 6].map((i) => `/events/soon${i}`),
    );
    const month = screen.getByRole("list", { name: "What’s on in October" });
    expect(within(month).getAllByRole("link")).toHaveLength(2);
    const free = screen.getByRole("list", { name: "Free & low-cost" });
    expect(within(free).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/events/oct-a", "/events/oct-b"]);
    expect(screen.getByRole("link", { name: "See all free events" })).toHaveAttribute("href", "/events?pricing=free");

    expect(screen.queryByText("Event ended")).not.toBeInTheDocument();
    // The guide sits between What's on and Free & low-cost.
    const order = [month, screen.getByText("Guide slot"), free];
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("on wider screens (tree hidden) renders no cards", async () => {
    stubViewport(false);
    loadHomeEvents.mockResolvedValue(EVENTS);
    render(<PhoneEventSections />);
    await flush();
    expect(screen.queryAllByRole("link", { name: /Event soon/ })).toHaveLength(0);
  });

  it("on error: an alert and Try again, which loads again; the other event sections are hidden", async () => {
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    render(<PhoneEventSections guide={<p>Guide slot</p>} />);
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load events.");
    expect(screen.queryByRole("heading", { name: "Coming up in Melbourne" })).not.toBeInTheDocument();
    expect(screen.getByText("Guide slot")).toBeInTheDocument();

    loadHomeEvents.mockResolvedValueOnce(EVENTS);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    await flush();
    expect(loadHomeEvents).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Coming up in Melbourne" })).toBeInTheDocument();
  });

  it("when nothing is upcoming: says so and hides the other event sections", async () => {
    loadHomeEvents.mockResolvedValue([event("ended", "2026-09-20T08:00:00.000Z", 0)]);
    render(<PhoneEventSections />);
    await flush();
    expect(screen.getByText("No events have been published yet. Check back soon.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Coming up in Melbourne" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /What’s on/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Free & low-cost" })).not.toBeInTheDocument();
  });

  it("demo mode says the listings are samples", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    render(<PhoneEventSections />);
    await flush();
    expect(screen.getByRole("note")).toHaveTextContent("Sample listings, nothing here is a real booking.");
  });
});
