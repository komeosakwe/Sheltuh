// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocation } from "@/lib/location-loader";

/*
 * Live /map asks only for upcoming events, 50 a page. Without these it got the
 * API's default: the 20 oldest published events, ended ones included. It
 * reads up to 4 pages at once (owner plan S9: a national map is more than the
 * soonest 50).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/map",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const listPublicEvents = vi.fn().mockResolvedValue({ items: [], nextCursor: undefined });
vi.mock("@/lib/api/public-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/public-events")>()),
  listPublicEvents: (...args: unknown[]) => listPublicEvents(...args),
}));

const { default: SceneMap } = await import("@/components/SceneMap");

// The suburb table (~15k rows) decodes once, here, not inside the first test that places a pin by its suburb.
beforeAll(async () => {
  await loadLocation();
});

afterEach(() => {
  cleanup();
  listPublicEvents.mockReset();
  listPublicEvents.mockResolvedValue({ items: [], nextCursor: undefined });
});

/** A page of `count` upcoming public events in Fitzroy, ids from `from`. */
function page(from: number, count: number, nextCursor?: string) {
  const items = Array.from({ length: count }, (_, i) => {
    const n = from + i;
    return {
      eventId: `evt-${n}`,
      slug: `event-${n}`,
      title: `Event ${n}`,
      description: "d",
      category: "art",
      venueName: "Venue",
      venueAddress: "1 St",
      suburb: "Fitzroy",
      state: "VIC",
      timeZone: "Australia/Melbourne",
      startsAt: new Date(Date.UTC(2030, 0, 1, 0, n)).toISOString(),
      endsAt: new Date(Date.UTC(2030, 0, 1, 3, n)).toISOString(),
      organiserName: "Org",
      ticketTypes: [],
    };
  });
  return { items, nextCursor };
}

describe("live /map loading", () => {
  it("asks for upcoming events only, 50 a page", async () => {
    render(<SceneMap />);
    await waitFor(() => expect(listPublicEvents).toHaveBeenCalled());
    expect(listPublicEvents).toHaveBeenCalledWith({ upcoming: true, limit: 50, cursor: undefined });
  });

  it("reads up to 4 pages of 50 at once, then Load more reads the next 4", async () => {
    for (let n = 0; n < 6; n++) listPublicEvents.mockResolvedValueOnce(page(n * 50, 50, `c${n + 1}`));
    listPublicEvents.mockResolvedValueOnce(page(300, 10));
    render(<SceneMap />);
    // Explicit waits: rendering 200, then 310, rows takes more than waitFor's 1s under a loaded full run.
    await waitFor(() => expect(screen.getAllByText(/^200 upcoming events$/).length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(listPublicEvents.mock.calls.map(([args]) => (args as { cursor?: string }).cursor)).toEqual([
      undefined,
      "c1",
      "c2",
      "c3",
    ]);
    for (const [args] of listPublicEvents.mock.calls) expect(args).toMatchObject({ upcoming: true, limit: 50 });

    fireEvent.click(screen.getByRole("button", { name: "Load more events" }));
    await waitFor(() => expect(screen.getAllByText(/^310 upcoming events$/).length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(listPublicEvents.mock.calls.slice(4).map(([args]) => (args as { cursor?: string }).cursor)).toEqual([
      "c4",
      "c5",
      "c6",
    ]);
    // The last page had no cursor: nothing more to load.
    expect(screen.queryByRole("button", { name: "Load more events" })).toBeNull();
  }, 30_000);
});
