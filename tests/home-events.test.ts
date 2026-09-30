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

const { loadHomeEvents, HOME_EVENT_LIMIT } = await import("@/lib/home-events");

function item(id: string): PublicEvent {
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
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T12:00:00.000Z",
    organiserName: "Org",
    ticketTypes: [],
  };
}

beforeEach(() => {
  listPublicEvents.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("loadHomeEvents (live)", () => {
  it("shares one request set between callers that overlap (desktop preview + phone sections)", async () => {
    listPublicEvents.mockResolvedValue({ items: [item("a")], nextCursor: undefined });
    const [first, second] = await Promise.all([loadHomeEvents(), loadHomeEvents()]);
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.map((e) => e.id)).toEqual(["a"]);
  });

  it("loads afresh once the previous load has settled, including after a failure (retry)", async () => {
    listPublicEvents.mockRejectedValueOnce(new Error("down"));
    await expect(loadHomeEvents()).rejects.toThrow("down");
    listPublicEvents.mockResolvedValueOnce({ items: [item("b")], nextCursor: undefined });
    await expect(loadHomeEvents()).resolves.toHaveLength(1);
    expect(listPublicEvents).toHaveBeenCalledTimes(2);
  });

  it("pages until it has enough for the home page, then stops", async () => {
    const page = (n: number) => ({ items: Array.from({ length: 10 }, (_, i) => item(`p${n}-${i}`)), nextCursor: `c${n}` });
    listPublicEvents.mockResolvedValueOnce(page(1)).mockResolvedValueOnce(page(2)).mockResolvedValueOnce(page(3));
    const events = await loadHomeEvents();
    expect(listPublicEvents).toHaveBeenCalledTimes(3);
    expect(events).toHaveLength(HOME_EVENT_LIMIT);
  });
});
