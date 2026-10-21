import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/lib/api/public-events";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const listPublicEvents = vi.fn();
vi.mock("@/lib/api/public-events", () => ({
  listPublicEvents: (...args: unknown[]) => listPublicEvents(...args),
}));

const { loadHomeEvents, loadHomeTrending, HOME_EVENT_LIMIT, HOME_WEEKEND_TOP_UP_LIMIT } = await import(
  "@/lib/home-events"
);

// Wed 21 Oct 2026, 12:00 AEDT. This weekend ends Sun 25 Oct 23:59:59.999 AEDT (12:59:59.999Z).
const NOW = new Date("2026-10-21T01:00:00.000Z");

function item(id: string, startsAt = "2026-12-01T09:00:00.000Z", endsAt = "2026-12-01T12:00:00.000Z"): PublicEvent {
  return {
    organiserId: "org",
    eventId: id,
    slug: id,
    title: id,
    description: "d",
    category: "art",
    venueName: "v",
    venueAddress: "a",
    suburb: "s",
    startsAt,
    endsAt,
    organiserName: "Org",
    ticketTypes: [],
  };
}

beforeEach(() => {
  listPublicEvents.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("loadHomeEvents (live)", () => {
  it("makes one request for upcoming events, with a limit, when the page reaches past the weekend", async () => {
    listPublicEvents.mockResolvedValue({ items: [item("a", "2026-10-22T08:00:00.000Z"), item("b")], nextCursor: "c1" });
    const events = await loadHomeEvents(NOW);
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    expect(listPublicEvents).toHaveBeenCalledWith({ upcoming: true, limit: HOME_EVENT_LIMIT });
    expect(HOME_EVENT_LIMIT).toBeLessThanOrEqual(50); // the server's maximum
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("makes no second request when there are no more pages", async () => {
    listPublicEvents.mockResolvedValue({ items: [item("a", "2026-10-22T08:00:00.000Z")], nextCursor: undefined });
    await loadHomeEvents(NOW);
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
  });

  it("tops up from the weekend's first day when the page stops before the weekend is over, merging by id", async () => {
    listPublicEvents
      .mockResolvedValueOnce({
        items: [item("a", "2026-10-21T08:00:00.000Z"), item("b", "2026-10-22T08:00:00.000Z")],
        nextCursor: "c1",
      })
      .mockResolvedValueOnce({
        items: [item("b", "2026-10-22T08:00:00.000Z"), item("sat", "2026-10-24T08:00:00.000Z")],
        nextCursor: undefined,
      });
    const events = await loadHomeEvents(NOW);
    expect(listPublicEvents).toHaveBeenCalledTimes(2);
    // Friday 23 Oct, Melbourne's date.
    expect(listPublicEvents.mock.calls[1][0]).toEqual({
      upcoming: true,
      onOrAfter: "2026-10-23",
      limit: HOME_WEEKEND_TOP_UP_LIMIT,
    });
    expect(events.map((e) => e.id)).toEqual(["a", "b", "sat"]);
  });

  it("drops anything that has ended by now (a tab left open), soonest first", async () => {
    listPublicEvents.mockResolvedValue({
      items: [item("later"), item("over", "2026-10-20T08:00:00.000Z", "2026-10-20T12:00:00.000Z")],
      nextCursor: undefined,
    });
    expect((await loadHomeEvents(NOW)).map((e) => e.id)).toEqual(["later"]);
  });

  it("rejects when the request fails (the page shows its error and Try again)", async () => {
    listPublicEvents.mockRejectedValue(new Error("down"));
    await expect(loadHomeEvents(NOW)).rejects.toThrow("down");
  });
});

describe("loadHomeTrending (live)", () => {
  it("has no trending API yet, so returns nothing (and makes no request): the section stays hidden", async () => {
    await expect(loadHomeTrending(NOW)).resolves.toEqual([]);
    expect(listPublicEvents).not.toHaveBeenCalled();
  });
});
