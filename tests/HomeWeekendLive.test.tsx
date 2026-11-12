// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeEventSections from "@/components/home/HomeEventSections";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import type { TrendingItem } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";

/**
 * Live This weekend (owner's mockup, 8 Nov 2026): a weekend card's going strip shows the server's
 * thresholded trending count when that event is also trending with one, and nothing otherwise. No
 * faces live (list payloads carry no names).
 */

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
const loadHomeTrending = vi.fn<(now: Date) => Promise<TrendingItem[]>>();
vi.mock("@/lib/home-events", () => ({
  loadHomeFeed: async (now: Date) => ({ events: await loadHomeEvents(now), complete: true }),
  loadHomeTrending: (now: Date) => loadHomeTrending(now),
  loadHomeFollowing: () => Promise.resolve([]),
}));
vi.mock("@/lib/location-loader", () => ({ loadLocation: vi.fn() }));

function event(id: string, startsAt: string): SheltuhEvent {
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "live-music",
    suburb: "Coburg North",
    venueName: "INTERCONNECT STUDIO",
    venueAddress: "16 Catherine St",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
    organiserId: "org-1",
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 2400, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

// Wed 11 Nov 2026, 12:00 AEDT: This weekend is Fri 13 – Sun 15 Nov.
const NOW = "2026-11-11T01:00:00.000Z";
const SAT = event("sat", "2026-11-14T06:00:00.000Z");
const SUN = event("sun", "2026-11-15T08:00:00.000Z");
const LATER = event("later", "2026-11-25T08:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  loadHomeEvents.mockReset().mockResolvedValue([SAT, SUN, LATER]);
  loadHomeTrending.mockReset().mockResolvedValue([{ event: SAT, signal: { kind: "going", count: 42 } }]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("This weekend, live", () => {
  it("gives a trending weekend event its going count, and the others none, in This weekend and All events alike", async () => {
    render(
      <HomeEventsProvider>
        <HomeEventSections />
      </HomeEventsProvider>,
    );
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    const section = screen.getByRole("region", { name: "This weekend" });
    expect(within(section).getByText("Fri 13 – Sun 15 Nov")).toBeInTheDocument();
    for (const list of [screen.getByRole("list", { name: "This weekend" }), screen.getByRole("list", { name: "All events" })]) {
      const cards = Array.from(list.querySelectorAll<HTMLElement>("[data-event-card]"));
      const sat = cards.find((card) => card.querySelector("h3")?.textContent === "Event sat") as HTMLElement;
      const sun = cards.find((card) => card.querySelector("h3")?.textContent === "Event sun") as HTMLElement;
      expect(sat.querySelector("[data-card-going]")).toHaveTextContent(/^42 going$/);
      // Live list payloads carry no names: no faces.
      expect(sat.querySelector("[data-card-faces]")).toBeNull();
      expect(sun.querySelector("[data-card-going]")).toBeNull();
      // The card's one link is its title.
      expect(within(sat).getByRole("link", { name: "Event sat" })).toHaveAttribute("href", "/events/sat");
    }
  });
});
