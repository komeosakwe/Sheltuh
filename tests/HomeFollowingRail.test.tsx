// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeEventSections from "@/components/home/HomeEventSections";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import type { GetToken } from "@/lib/api/client";
import type { TrendingItem } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
const loadHomeTrending = vi.fn<(now: Date) => Promise<TrendingItem[]>>();
const loadHomeFollowing = vi.fn<(getToken: GetToken, now: Date) => Promise<SheltuhEvent[]>>();
vi.mock("@/lib/home-events", () => ({
  loadHomeEvents: (now: Date) => loadHomeEvents(now),
  loadHomeTrending: (now: Date) => loadHomeTrending(now),
  loadHomeFollowing: (getToken: GetToken, now: Date) => loadHomeFollowing(getToken, now),
}));
vi.mock("@/lib/api/going", () => ({ getGoingSummary: vi.fn(() => new Promise(() => {})) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

const NEXT = event("next", "2026-10-22T08:00:00.000Z");
const SAT = event("sat", "2026-10-24T08:00:00.000Z");
const T = Array.from({ length: 4 }, (_, i) => event(`t${i}`, `2026-11-2${i}T08:00:00.000Z`));
const FOLLOWED = event("followed", "2026-11-05T08:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T01:00:00.000Z"));
  loadHomeEvents.mockReset().mockResolvedValue([NEXT, SAT, ...T]);
  loadHomeTrending.mockReset().mockResolvedValue(T.map((e) => ({ event: e, signal: { kind: "popular" } })));
  loadHomeFollowing.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("home: From organisers you follow", () => {
  it("signed in with follows: right after This weekend, before Trending, linking to the follows page", async () => {
    loadHomeFollowing.mockResolvedValue([FOLLOWED, T[0]]);
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>
        <HomeEventsProvider>
          <HomeEventSections />
        </HomeEventsProvider>
      </FakeAuthProvider>,
    );
    await settle();
    const rail = await screen.findByRole("region", { name: "From organisers you follow" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("From organisers you follow")).toBe(headings.indexOf("This weekend") + 1);
    expect(headings.indexOf("Trending")).toBe(headings.indexOf("From organisers you follow") + 1);
    expect(within(rail).getByRole("link", { name: /^Event followed/ })).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "See all organisers you follow" })).toHaveAttribute("href", "/following");
    // T0 moved up into the rail: Trending doesn't repeat it.
    const trending = screen.getByRole("region", { name: "Trending" });
    expect(within(trending).queryByRole("link", { name: /^Event t0/ })).toBeNull();
  });

  it("hidden when empty, and when its load fails", async () => {
    loadHomeFollowing.mockRejectedValue(new Error("nope"));
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>
        <HomeEventsProvider>
          <HomeEventSections />
        </HomeEventsProvider>
      </FakeAuthProvider>,
    );
    await settle();
    await screen.findByRole("region", { name: "Trending" });
    expect(screen.queryByRole("region", { name: "From organisers you follow" })).toBeNull();
  });

  it("signed out: never asked for", async () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", email: undefined })}>
        <HomeEventsProvider>
          <HomeEventSections />
        </HomeEventsProvider>
      </FakeAuthProvider>,
    );
    await settle();
    await screen.findByRole("region", { name: "Trending" });
    expect(loadHomeFollowing).not.toHaveBeenCalled();
  });

  it("waits for the session to be known before splitting the sections", async () => {
    loadHomeFollowing.mockResolvedValue([FOLLOWED]);
    const { rerender } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "loading" })}>
        <HomeEventsProvider>
          <HomeEventSections />
        </HomeEventsProvider>
      </FakeAuthProvider>,
    );
    await settle();
    expect(loadHomeEvents).not.toHaveBeenCalled();
    rerender(
      <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>
        <HomeEventsProvider>
          <HomeEventSections />
        </HomeEventsProvider>
      </FakeAuthProvider>,
    );
    await settle();
    expect(await screen.findByRole("region", { name: "From organisers you follow" })).toBeInTheDocument();
    expect(loadHomeEvents).toHaveBeenCalledTimes(1);
  });
});
