// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const { default: SceneMap, MAP_PAGES_PER_LOAD } = await import("@/components/SceneMap");

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
  Reflect.deleteProperty(window, "matchMedia");
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

/** A desktop-width window (useIsDesktop): the arrival pick is desktop only. */
function asDesktop() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query === "(min-width: 64rem)", media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
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

  it("when the last page takes Load more away, focus goes to the first new event, even pressed before the last render's effects ran", async () => {
    for (let n = 0; n < MAP_PAGES_PER_LOAD; n++) listPublicEvents.mockResolvedValueOnce(page(n, 1, `c${n + 1}`));
    listPublicEvents.mockResolvedValueOnce(page(MAP_PAGES_PER_LOAD, 1));
    const { container } = render(<SceneMap />);
    // React runs a non-urgent render's effects in a later task once the render has used up its
    // ~5ms slice (a busy machine, a slow phone), so a press can land between the list appearing
    // and its effects running. Every clock read costs 10ms here, from the first load to the
    // press, so React always yields there, and the press is made the moment the button shows.
    const now = performance.now.bind(performance);
    let skew = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now() + (skew += 10));
    try {
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          const more = screen.queryByRole("button", { name: "Load more events" });
          if (!more) return;
          observer.disconnect();
          more.focus();
          fireEvent.click(more);
          clock.mockRestore();
          resolve();
        });
        observer.observe(container, { childList: true, subtree: true });
      });
    } finally {
      clock.mockRestore();
    }
    await waitFor(() => expect(screen.queryByRole("button", { name: /Load more events|Loading/ })).toBeNull());
    await waitFor(() => expect(document.activeElement).toHaveAttribute("href", `/events/event-${MAP_PAGES_PER_LOAD}`));
  });

  // Code review (PR 5): a radius can hold only a few of the events read so far. Nearby reads on by
  // itself, once (4 more pages), then says what it found "so far" and leaves the rest to Load more.
  // Code review (PR 47): Nearby's automatic load is not a press of Load more, so even when it reads
  // the last page (the button goes away), focus stays where it was.
  it("an automatic Nearby load that reads the last page doesn't move focus", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth", state: "WA" }));
    try {
      for (let n = 0; n < 4; n++) listPublicEvents.mockResolvedValueOnce(page(n * 50, 50, `c${n + 1}`));
      listPublicEvents.mockResolvedValueOnce(page(200, 50));
      render(<SceneMap />);
      await waitFor(() => expect(listPublicEvents).toHaveBeenCalledTimes(5), { timeout: 10_000 });
      await waitFor(() => expect(screen.queryByRole("button", { name: /Load more events|Loading/ })).toBeNull(), { timeout: 10_000 });
      // Let any focus effect run.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
    } finally {
      localStorage.removeItem("sheltuh:near:v1");
    }
  }, 30_000);

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

  // CodeRabbit (PR 43): arriving, nothing near in the first pages; the read-on brings one: it opens then.
  it("on arrival, opens the nearest event that Nearby's own read-on brings in", async () => {
    asDesktop();
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth", state: "WA" }));
    try {
      for (let n = 0; n < 4; n++) listPublicEvents.mockResolvedValueOnce(page(n * 50, 50, `c${n + 1}`));
      const perth = page(200, 1);
      perth.items[0] = { ...perth.items[0], title: "Perth Show", suburb: "Perth", state: "WA", timeZone: "Australia/Perth" };
      listPublicEvents.mockResolvedValueOnce(perth);
      render(<SceneMap />);
      await waitFor(() => expect(listPublicEvents).toHaveBeenCalledTimes(5), { timeout: 10_000 });
      await waitFor(() => expect(screen.getAllByRole("region", { name: "Selected event" }).length).toBeGreaterThan(0), {
        timeout: 10_000,
      });
      expect(screen.getAllByRole("region", { name: "Selected event" })[0]).toHaveTextContent("Perth Show");
    } finally {
      localStorage.removeItem("sheltuh:near:v1");
    }
  }, 30_000);

  // CodeRabbit (PR 43): a card picked and dismissed while the read-on loads isn't replaced by one opening by itself.
  it("on arrival, a pick made while the read-on loads ends it: nothing opens by itself when the load lands", async () => {
    asDesktop();
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth", state: "WA" }));
    try {
      for (let n = 0; n < 4; n++) listPublicEvents.mockResolvedValueOnce(page(n * 50, 50, `c${n + 1}`));
      const perth = page(200, 1);
      perth.items[0] = { ...perth.items[0], title: "Perth Show", suburb: "Perth", state: "WA", timeZone: "Australia/Perth" };
      let land: (value: typeof perth) => void = () => {};
      listPublicEvents.mockReturnValueOnce(new Promise<typeof perth>((resolve) => (land = resolve)));
      render(<SceneMap />);
      await waitFor(() => expect(listPublicEvents).toHaveBeenCalledTimes(5), { timeout: 10_000 });
      // Show all of Australia, then pick one and dismiss it, while the read-on is still out.
      fireEvent.click(screen.getByRole("button", { name: "Show all of Australia" }));
      fireEvent.click((await screen.findAllByRole("button", { name: /^Locate Event 0 on the map$/ }))[0]);
      await waitFor(() => expect(screen.getAllByRole("region", { name: "Selected event" }).length).toBeGreaterThan(0));
      fireEvent.click(screen.getAllByRole("button", { name: "Dismiss selected event" })[0]);
      await waitFor(() => expect(screen.queryByRole("region", { name: "Selected event" })).toBeNull());
      await act(async () => {
        land(perth);
        await Promise.resolve();
      });
      await screen.findAllByText("Perth Show", undefined, { timeout: 10_000 });
      expect(screen.queryByRole("region", { name: "Selected event" })).toBeNull();
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
