// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeEventsProvider, useHomeEvents } from "@/components/home/HomeEventsProvider";
import { clearStoredNear, writeStoredNear } from "@/lib/near-storage";
import type { SheltuhEvent } from "@/lib/types";

/**
 * Redesign PR 2: one location everywhere. A place chosen in the search bar's location menu is
 * remembered at once, and the home's sections put that state's events first without a reload
 * (owner decision D5), and without loading the events again.
 */

const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
vi.mock("@/lib/home-events", () => ({
  loadHomeFeed: async (now: Date) => ({ events: await loadHomeEvents(now), complete: true }),
  loadHomeTrending: () => Promise.resolve([]),
  loadHomeFollowing: () => Promise.resolve([]),
}));

function event(id: string, startsAt: string, state: "VIC" | "QLD"): SheltuhEvent {
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "live-music",
    suburb: state === "VIC" ? "Fitzroy" : "Fortitude Valley",
    state,
    timeZone: state === "VIC" ? "Australia/Melbourne" : "Australia/Brisbane",
    venueName: "V",
    venueAddress: "1 St",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
    organiserId: "org-1",
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 2400, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

const NOW = "2026-11-11T01:00:00.000Z";
const VIC = event("vic", "2026-11-25T08:00:00.000Z", "VIC");
const QLD = event("qld", "2026-11-26T08:00:00.000Z", "QLD");

/** The popular (or Coming up) section's events, in order. */
function Probe() {
  const { state } = useHomeEvents();
  if (state.status !== "ready") return <p>loading</p>;
  const items = state.sections.popular?.kind === "popular"
    ? state.sections.popular.items.map(({ event: e }) => e.id)
    : (state.sections.popular?.items ?? []).map((e) => e.id);
  return <p data-testid="order">{items.join(",")}</p>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  loadHomeEvents.mockReset().mockResolvedValue([VIC, QLD]);
  clearStoredNear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe("HomeEventsProvider and the saved suburb", () => {
  it("re-orders the sections when a place is chosen, without loading again", async () => {
    render(
      <HomeEventsProvider>
        <Probe />
      </HomeEventsProvider>,
    );
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    expect(screen.getByTestId("order")).toHaveTextContent("vic,qld");
    act(() => {
      writeStoredNear("Brisbane City", "QLD");
    });
    expect(screen.getByTestId("order")).toHaveTextContent("qld,vic");
    act(() => {
      clearStoredNear();
    });
    expect(screen.getByTestId("order")).toHaveTextContent("vic,qld");
    expect(loadHomeEvents).toHaveBeenCalledTimes(1);
  });
});
