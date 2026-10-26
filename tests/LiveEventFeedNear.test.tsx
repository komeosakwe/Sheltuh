// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveEventFeed from "@/components/LiveEventFeed";
import type { PublicEvent } from "@/lib/api/public-events";
import { findLocality, type Locality } from "@/lib/location";
import { EVENT_CATEGORIES } from "@/lib/types";

const listPublicEvents = vi.fn();
vi.mock("@/lib/api/public-events", () => ({
  listPublicEvents: (...args: unknown[]) => listPublicEvents(...args),
}));

afterEach(cleanup);

function place(name: string): Locality {
  const found = findLocality(name);
  if (!found) throw new Error(`fixture suburb not in the table: ${name}`);
  return found;
}
const FITZROY = place("Fitzroy");
beforeEach(() => {
  listPublicEvents.mockReset();
});

function makeEvent(id: string, suburb: string, startsAt: string): PublicEvent {
  return {
    organiserId: `org-${id}`,
    eventId: id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "live-music",
    venueName: "v",
    venueAddress: "a",
    suburb,
    startsAt,
    endsAt: startsAt,
    organiserName: "Org",
    ticketTypes: [{ id: "t1", name: "GA", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

// Each band: its visible h2, then an unnamed list (the heading names it; no region landmark per band).
const bandTitles = () =>
  [...document.querySelectorAll<HTMLElement>("[data-near-band]")].map((band) => {
    expect(band.tagName).toBe("DIV");
    const list = within(band).getByRole("list");
    expect(list).not.toHaveAttribute("aria-label");
    return [
      within(band).getByRole("heading", { level: 2 }).textContent,
      within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim()),
    ];
  });

describe("LiveEventFeed — near a suburb (ordered in the browser)", () => {
  it("never sends the suburb or any coordinates to the API", async () => {
    listPublicEvents.mockResolvedValue({ items: [makeEvent("a", "Fitzroy", "2026-12-01T09:00:00.000Z")], nextCursor: undefined });
    render(<LiveEventFeed categories={EVENT_CATEGORIES} query="jazz" near={FITZROY} />);
    await screen.findByText("Event a");
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    const [params] = listPublicEvents.mock.calls[0];
    expect(params).toMatchObject({ q: "jazz", upcoming: true, limit: 50 });
    expect(Object.keys(params).sort()).toEqual(["category", "cursor", "limit", "onOrAfter", "pricing", "q", "upcoming"]);
    expect(JSON.stringify(params)).not.toMatch(/near|fitzroy|lat|lng|-37|144\./i);
  });

  it("orders the results in bands, nearest first and soonest within each, with the approximate note", async () => {
    listPublicEvents.mockResolvedValue({
      items: [
        makeEvent("unknown", "Atlantis", "2026-12-01T09:00:00.000Z"),
        makeEvent("footscray", "Footscray", "2026-12-02T09:00:00.000Z"),
        makeEvent("fitzroy-late", "Fitzroy", "2026-12-09T09:00:00.000Z"),
        makeEvent("collingwood", "Collingwood", "2026-12-03T09:00:00.000Z"),
        makeEvent("fitzroy-soon", "Fitzroy", "2026-12-04T09:00:00.000Z"),
      ],
      nextCursor: undefined,
    });
    render(<LiveEventFeed categories={EVENT_CATEGORIES} near={FITZROY} />);
    await screen.findByText("Event unknown");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "In Fitzroy, VIC",
      "Within 5 km",
      "5–15 km",
      "Location not on file",
    ]);
    expect(bandTitles()).toEqual([
      ["In Fitzroy, VIC", ["Event fitzroy-soon", "Event fitzroy-late"]],
      ["Within 5 km", ["Event collingwood"]],
      ["5–15 km", ["Event footscray"]],
      ["Location not on file", ["Event unknown"]],
    ]);
    expect(screen.getByText(/Closest to Fitzroy, VIC first\. Distances are between suburb centres, so they’re approximate\./)).toBeInTheDocument();
    expect(screen.queryByText(/Sorted the 200 soonest/)).toBeNull();
    // Every result is read up front in near mode: no Load more.
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("reads at most 4 pages of 50, then says only the 200 soonest were ordered", async () => {
    let page = 0;
    listPublicEvents.mockImplementation(async () => {
      page += 1;
      return { items: [makeEvent(`p${page}`, "Carlton", `2026-12-0${page}T09:00:00.000Z`)], nextCursor: `cursor-${page}` };
    });
    render(<LiveEventFeed categories={EVENT_CATEGORIES} near={FITZROY} />);
    await screen.findByText("Event p4");
    expect(listPublicEvents).toHaveBeenCalledTimes(4);
    expect(listPublicEvents.mock.calls.map(([params]) => params.cursor)).toEqual([undefined, "cursor-1", "cursor-2", "cursor-3"]);
    expect(screen.getByText(/Sorted the 200 soonest events by distance\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("lists an event that shifts across a page boundary once", async () => {
    listPublicEvents
      .mockResolvedValueOnce({ items: [makeEvent("a", "Fitzroy", "2026-12-01T09:00:00.000Z")], nextCursor: "c1" })
      .mockResolvedValueOnce({
        items: [makeEvent("a", "Fitzroy", "2026-12-01T09:00:00.000Z"), makeEvent("b", "Carlton", "2026-12-02T09:00:00.000Z")],
        nextCursor: undefined,
      });
    render(<LiveEventFeed categories={EVENT_CATEGORIES} near={FITZROY} />);
    await screen.findByText("Event b");
    expect(screen.getAllByText("Event a")).toHaveLength(1);
  });

  it("from a long way off (Perth): every Melbourne event under Over 100 km, unknown ones last", async () => {
    listPublicEvents.mockResolvedValue({
      items: [
        makeEvent("unknown", "Atlantis", "2026-12-01T09:00:00.000Z"),
        makeEvent("yarraville", "Yarraville", "2026-12-02T09:00:00.000Z"),
        makeEvent("fitzroy", "Fitzroy", "2026-12-03T09:00:00.000Z"),
      ],
      nextCursor: undefined,
    });
    render(<LiveEventFeed categories={EVENT_CATEGORIES} near={place("Perth")} />);
    await screen.findByText("Event unknown");
    expect(bandTitles()).toEqual([
      ["Over 100 km", ["Event yarraville", "Event fitzroy"]],
      ["Location not on file", ["Event unknown"]],
    ]);
    expect(screen.getByText(/Closest to Perth, WA first\./)).toBeInTheDocument();
  });

  it("without a suburb: the usual soonest-first list with Load more", async () => {
    listPublicEvents.mockResolvedValue({ items: [makeEvent("a", "Fitzroy", "2026-12-01T09:00:00.000Z")], nextCursor: "c1" });
    render(<LiveEventFeed categories={EVENT_CATEGORIES} />);
    await screen.findByText("Event a");
    await waitFor(() => expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument());
    expect(screen.queryByText(/Closest to/)).toBeNull();
    expect(listPublicEvents.mock.calls[0][0]).not.toHaveProperty("limit", 50);
  });
});
