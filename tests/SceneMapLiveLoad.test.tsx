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
  // The map (Leaflet) mounts too once there are events: jsdom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

  // Code review (PR 5): a radius can hold only a few of the events read so far. Nearby reads on by
  // itself, once (4 more pages), then says what it found "so far" and leaves the rest to Load more.
  it("with few events within the radius, reads 4 more pages once, then says 'so far' beside Load more", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth", state: "WA" }));
    try {
      for (let n = 0; n < 12; n++) listPublicEvents.mockResolvedValueOnce(page(n * 50, 50, `c${n + 1}`));
      render(<SceneMap />);
      await waitFor(() => expect(listPublicEvents).toHaveBeenCalledTimes(8), { timeout: 10_000 });
      await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "No events found near Perth so far." })).toBeInTheDocument(), {
        timeout: 10_000,
      });
      expect(screen.getAllByRole("status").some((el) => el.textContent === "No events within 25 km of Perth so far.")).toBe(true);
      expect(document.querySelector("[data-map-count]")).toHaveTextContent(/^0 upcoming events within 25 km of Perth so far$/);
      expect(screen.getByRole("button", { name: "Load more events" })).toBeInTheDocument();
      // No more by itself.
      await new Promise<void>((done) => setTimeout(done, 300));
      expect(listPublicEvents).toHaveBeenCalledTimes(8);
    } finally {
      localStorage.removeItem("sheltuh:near:v1");
    }
  }, 30_000);

  // CodeRabbit (PR 43): a failed read-on used to set the whole page's error, and the map and list went.
  it("keeps the loaded events when Nearby's own read-on fails, says so beside Load more, and retries", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth", state: "WA" }));
    try {
      for (let n = 0; n < 4; n++) listPublicEvents.mockResolvedValueOnce(page(n * 50, 50, `c${n + 1}`));
      listPublicEvents.mockRejectedValueOnce(new Error("Network down"));
      render(<SceneMap />);
      const alert = await screen.findByText("Couldn’t load more events: Network down", undefined, { timeout: 10_000 });
      expect(alert.closest("[role='alert']")).not.toBeNull();
      expect(listPublicEvents).toHaveBeenCalledTimes(5);
      // What loaded is still there: the count, the empty-within-radius state, and the rest's strip.
      expect(document.querySelector("[data-map-count]")).toHaveTextContent(/^0 upcoming events within 25 km of Perth so far$/);
      expect(screen.getByRole("button", { name: "Show all of Australia" })).toBeInTheDocument();
      expect(screen.queryByText("Network down")).toBeNull();
      // No read-on by itself after a failure.
      await new Promise<void>((done) => setTimeout(done, 300));
      expect(listPublicEvents).toHaveBeenCalledTimes(5);

      // The retry reads from where the failed one started, and the message goes.
      listPublicEvents.mockResolvedValueOnce(page(200, 10));
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(screen.queryByText(/Couldn’t load more events/)).toBeNull());
      expect((listPublicEvents.mock.calls[5][0] as { cursor?: string }).cursor).toBe("c4");
      await waitFor(() => expect(screen.queryByRole("button", { name: /Load more events|Try again/ })).toBeNull());
    } finally {
      localStorage.removeItem("sheltuh:near:v1");
    }
  }, 30_000);

  it("keeps the loaded events when a Load more fails, with the error beside the button", async () => {
    for (let n = 0; n < 4; n++) listPublicEvents.mockResolvedValueOnce(page(n * 50, 50, `c${n + 1}`));
    listPublicEvents.mockRejectedValueOnce(new Error("Server error"));
    render(<SceneMap />);
    await waitFor(() => expect(screen.getAllByText(/^200 upcoming events$/).length).toBeGreaterThan(0), { timeout: 10_000 });
    const button = screen.getByRole("button", { name: "Load more events" });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load more events: Server error");
    expect(screen.getAllByText(/^200 upcoming events$/).length).toBeGreaterThan(0);
    // The same button, now a retry, keeps focus.
    expect(screen.getByRole("button", { name: "Try again" })).toBe(button);
    expect(document.activeElement).toBe(button);
  }, 30_000);
});
