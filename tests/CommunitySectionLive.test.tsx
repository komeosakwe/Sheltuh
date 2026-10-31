// @vitest-environment jsdom
import { act, cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommunitySection, { COMMUNITY_DEMO_NOTE, COMMUNITY_LIVE_NOTE, COMMUNITY_TEASER } from "@/components/home/CommunitySection";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import type { TrendingItem } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/** Find your people's card in live mode: real counts only, and the faces always labelled illustrative (never attendees). */

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
const loadHomeTrending = vi.fn<(now: Date) => Promise<TrendingItem[]>>();
vi.mock("@/lib/home-events", () => ({
  loadHomeEvents: (now: Date) => loadHomeEvents(now),
  loadHomeTrending: (now: Date) => loadHomeTrending(now),
  loadHomeRecent: () => Promise.resolve([]),
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
  it("shows a trending event's real going count, with the illustrative faces and a footnote saying so", async () => {
    loadHomeTrending.mockReset().mockResolvedValue([
      { event: T[0], signal: { kind: "popular" } },
      { event: T[1], signal: { kind: "going", count: 22 } },
      { event: T[2], signal: { kind: "popular" } },
      { event: T[3], signal: { kind: "popular" } },
    ]);
    const { container } = await renderLive();
    const card = container.querySelector<HTMLElement>("[data-community-card][data-community-example]");
    if (!card) throw new Error("no example card");
    expect(within(card).getByText("Event t1")).toBeInTheDocument();
    expect(card.querySelector("[data-community-count]")).toHaveTextContent(/^22 people going$/);
    expect(COMMUNITY_LIVE_NOTE).toBe("Popular right now · Real count · Illustrative photos");
    expect(card.querySelector("[data-community-note]")).toHaveTextContent(COMMUNITY_LIVE_NOTE);
    expect(card).not.toHaveTextContent(COMMUNITY_DEMO_NOTE);
    expect(card).not.toHaveTextContent(/sample/i);
    const faces = card.querySelector("[data-community-faces]");
    expect(faces).toHaveAttribute("aria-hidden", "true");
    const circles = Array.from(faces?.children ?? []);
    expect(circles).toHaveLength(5);
    for (const circle of circles) {
      expect(circle.textContent).toBe("");
      expect(circle.querySelector("img")).toHaveAttribute("alt", "");
    }
  });

  it("with no real count to show (no going signals), the card still shows, with the faces and no number", async () => {
    loadHomeTrending.mockReset().mockResolvedValue(T.map((e) => ({ event: e, signal: { kind: "popular" } })));
    const { container } = await renderLive();
    const card = container.querySelector<HTMLElement>("[data-community-card]");
    if (!card) throw new Error("no card");
    expect(card).not.toHaveAttribute("data-community-example");
    // Never a real event's title beside the faces without its real count.
    for (const e of T) expect(card).not.toHaveTextContent(e.title);
    expect(within(card).getByText(COMMUNITY_TEASER.title)).toBeInTheDocument();
    expect(card.querySelector("[data-community-count]")).toBeNull();
    expect(card.querySelector("[data-community-note]")).toHaveTextContent(/^Illustrative photos$/);
    expect(card.querySelectorAll("[data-community-faces] img")).toHaveLength(5);
    expect(container.querySelector("#find-your-people")?.textContent).not.toMatch(/\d/);
  });

  it("while the events load or when they fail, shows the no-example card (never a number)", async () => {
    loadHomeEvents.mockReset().mockRejectedValue(new Error("down"));
    loadHomeTrending.mockReset().mockRejectedValue(new Error("down"));
    const { container } = await renderLive();
    const card = container.querySelector<HTMLElement>("[data-community-card]");
    expect(card).not.toBeNull();
    expect(card).not.toHaveAttribute("data-community-example");
    expect(container.querySelector("#find-your-people")?.textContent).not.toMatch(/\d/);
  });
});
