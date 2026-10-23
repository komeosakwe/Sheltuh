// @vitest-environment jsdom
import { act, cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommunitySection, { COMMUNITY_DEMO_NOTE, COMMUNITY_LIVE_NOTE } from "@/components/home/CommunitySection";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import type { TrendingItem } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/** Find your people's card in live mode: real counts only, and no one's face or initials. */

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
const loadHomeTrending = vi.fn<(now: Date) => Promise<TrendingItem[]>>();
vi.mock("@/lib/home-events", () => ({
  loadHomeEvents: (now: Date) => loadHomeEvents(now),
  loadHomeTrending: (now: Date) => loadHomeTrending(now),
  loadHomeFollowing: () => Promise.resolve([]),
}));

function event(id: string, startsAt: string): SheltuhEvent {
  return {
    id,
    organiserId: "org",
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "art",
    suburb: "Fitzroy",
    venueName: "Venue",
    venueAddress: "1 St",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

const T = Array.from({ length: 4 }, (_, i) => event(`t${i}`, `2026-11-2${i}T08:00:00.000Z`));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T01:00:00.000Z"));
  loadHomeEvents.mockReset().mockResolvedValue(T);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderLive() {
  const utils = render(
    <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
      <HomeEventsProvider>
        <CommunitySection />
      </HomeEventsProvider>
    </FakeAuthProvider>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

describe("CommunitySection in live mode", () => {
  it("shows a trending event's real going count, with an honest note and plain circles (no initials, no photos)", async () => {
    loadHomeTrending.mockReset().mockResolvedValue([
      { event: T[0], signal: { kind: "popular" } },
      { event: T[1], signal: { kind: "going", count: 22 } },
      { event: T[2], signal: { kind: "popular" } },
      { event: T[3], signal: { kind: "popular" } },
    ]);
    const { container } = await renderLive();
    const card = container.querySelector<HTMLElement>("[data-community-example]");
    if (!card) throw new Error("no example card");
    expect(within(card).getByText("Event t1")).toBeInTheDocument();
    expect(card.querySelector("[data-community-count]")).toHaveTextContent(/^22 people going$/);
    expect(within(card).getByText(COMMUNITY_LIVE_NOTE)).toBeInTheDocument();
    expect(card).not.toHaveTextContent(COMMUNITY_DEMO_NOTE);
    expect(card).not.toHaveTextContent(/sample/i);
    const circles = Array.from(card.querySelector("[data-community-faces]")?.children ?? []);
    expect(circles).toHaveLength(4);
    for (const circle of circles) {
      expect(circle.textContent).toBe("");
      expect(circle.querySelector("img")).toBeNull();
      expect(circle.querySelector("svg")).not.toBeNull();
    }
  });

  it("with no real count to show (no going signals), shows no card and no number", async () => {
    loadHomeTrending.mockReset().mockResolvedValue(T.map((e) => ({ event: e, signal: { kind: "popular" } })));
    const { container } = await renderLive();
    expect(container.querySelector("[data-community-example]")).toBeNull();
    expect(container.querySelector("#find-your-people")?.textContent).not.toMatch(/\d/);
  });
});
