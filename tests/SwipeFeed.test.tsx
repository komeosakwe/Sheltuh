// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import SwipeFeed from "@/components/swipe/SwipeFeed";
import type { GetToken } from "@/lib/api/client";
import type { TrendingItem } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

// Live, so a signed-in member's followed organisers load; the demo note is checked in its own test.
let apiConfigured = true;
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return apiConfigured;
  },
}));
const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
const loadHomeTrending = vi.fn<(now: Date) => Promise<TrendingItem[]>>();
const loadHomeFollowing = vi.fn<(getToken: GetToken, now: Date) => Promise<SheltuhEvent[]>>();
const loadHomeRecent = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
vi.mock("@/lib/home-events", () => ({
  loadHomeEvents: (now: Date) => loadHomeEvents(now),
  loadHomeTrending: (now: Date) => loadHomeTrending(now),
  loadHomeFollowing: (getToken: GetToken, now: Date) => loadHomeFollowing(getToken, now),
  loadHomeRecent: (now: Date) => loadHomeRecent(now),
}));

function event(id: string, startsAt: string, overrides: Partial<SheltuhEvent> = {}): SheltuhEvent {
  return {
    id,
    organiserId: "org",
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "art",
    suburb: "Fitzroy",
    state: "VIC",
    venueName: "Venue",
    venueAddress: "1 St",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...overrides,
  };
}

// Now: Wed 21 Oct 2026, 12:00 AEDT. This weekend is Fri 23 – Sun 25 Oct.
const NOW = "2026-10-21T01:00:00.000Z";
const SAT = event("sat", "2026-10-24T08:00:00.000Z");
const SUN = event("sun", "2026-10-25T02:00:00.000Z");
const FOLLOWED = event("followed", "2026-11-05T08:00:00.000Z");
const T = Array.from({ length: 3 }, (_, i) => event(`t${i}`, `2026-11-2${i}T08:00:00.000Z`));
const SOON = event("soon", "2026-10-22T08:00:00.000Z");
const ENDED = event("ended", "2026-10-01T08:00:00.000Z");
const RECENT = event("recent", "2026-10-19T08:00:00.000Z");

beforeEach(() => {
  apiConfigured = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  loadHomeEvents.mockReset().mockResolvedValue([ENDED, SOON, SAT, SUN, FOLLOWED, ...T]);
  loadHomeTrending.mockReset().mockResolvedValue([]);
  loadHomeFollowing.mockReset().mockResolvedValue([]);
  loadHomeRecent.mockReset().mockResolvedValue([RECENT]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

function renderFeed(signedIn = false) {
  const feed = (
    <HomeEventsProvider>
      <SwipeFeed />
    </HomeEventsProvider>
  );
  return render(signedIn ? <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>{feed}</FakeAuthProvider> : feed);
}

const titles = () => screen.queryAllByRole("article").map((a) => a.getAttribute("aria-label"));

describe("the swipe feed", () => {
  it("is one focusable main with a hidden h1, and Close to the home in every state", async () => {
    loadHomeEvents.mockReturnValue(new Promise(() => {}));
    renderFeed();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("tabindex", "0");
    expect(main).toHaveClass("h-dvh", "overflow-y-auto", "snap-y", "snap-mandatory");
    expect(main).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1, name: "Events" })).toHaveClass("sr-only");
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Close" })).toHaveClass("size-11");
  });

  it("while loading: announces it and shows no event", () => {
    loadHomeEvents.mockReturnValue(new Promise(() => {}));
    renderFeed();
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    expect(titles()).toEqual([]);
  });

  it("lists This weekend, then Coming up, one article each, once each, upcoming only", async () => {
    renderFeed();
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("");
    // The weekend's events first, then what's coming (no trending data: Coming up, soonest first).
    expect(titles()).toEqual(["Event sat", "Event sun", "Event soon", "Event followed", "Event t0", "Event t1", "Event t2"]);
    expect(new Set(titles()).size).toBe(titles().length);
    // Not the ended event, nor "Recently on".
    expect(screen.queryByRole("article", { name: "Event ended" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Event recent" })).not.toBeInTheDocument();
  });

  it("puts a signed-in member's followed events after This weekend and before Popular right now, each once", async () => {
    loadHomeFollowing.mockResolvedValue([FOLLOWED, SAT]);
    loadHomeTrending.mockResolvedValue([...T, SOON].map((e) => ({ event: e, signal: { kind: "popular" } })));
    renderFeed(true);
    await flush();
    expect(loadHomeFollowing).toHaveBeenCalledTimes(1);
    // SAT is a weekend event, so the following list doesn't repeat it; the trending ones follow, in the server's order.
    expect(titles()).toEqual(["Event sat", "Event sun", "Event followed", "Event t0", "Event t1", "Event t2", "Event soon"]);
  });

  it("each screen: category, the title as an h2, date and time, place, price, View event and Save", async () => {
    renderFeed();
    await flush();
    const screenOne = screen.getByRole("article", { name: "Event sat" });
    expect(within(screenOne).getByRole("heading", { level: 2, name: "Event sat" })).toBeInTheDocument();
    expect(within(screenOne).getByText("Art")).toBeInTheDocument();
    expect(screenOne.querySelector("[data-swipe-date]")).toHaveTextContent(/Sat 24 Oct · 7:00 pm/);
    expect(screenOne).toHaveTextContent("Venue");
    expect(screenOne).toHaveTextContent("Fitzroy, VIC");
    expect(screenOne).toHaveTextContent("incl. booking fee");
    expect(within(screenOne).getByRole("link", { name: "View event" })).toHaveAttribute("href", "/events/sat");
    expect(screenOne).toHaveClass("h-dvh", "snap-start");
  });

  it("shows the Swipe up hint on the first screen only", async () => {
    renderFeed();
    await flush();
    const hints = document.querySelectorAll("[data-swipe-hint]");
    expect(hints).toHaveLength(1);
    expect(screen.getByRole("article", { name: "Event sat" }).contains(hints[0])).toBe(true);
    expect(hints[0]).toHaveTextContent("Swipe up");
  });

  it("with a single event there is nothing to swipe to, so no hint", async () => {
    loadHomeEvents.mockResolvedValue([SAT]);
    loadHomeTrending.mockResolvedValue([]);
    renderFeed();
    await flush();
    expect(titles()).toEqual(["Event sat"]);
    expect(document.querySelector("[data-swipe-hint]")).toBeNull();
  });

  it("empty: says so and links to all events (ended events alone are not a feed)", async () => {
    loadHomeEvents.mockResolvedValue([ENDED]);
    renderFeed();
    await flush();
    expect(titles()).toEqual([]);
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    expect(screen.getByRole("link", { name: "Close" })).toBeInTheDocument();
  });

  it("on error: an alert with Try again, which loads again and returns focus to the feed", async () => {
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderFeed();
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load events. Check your connection and try again.");
    expect(titles()).toEqual([]);

    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    let resolve: (events: SheltuhEvent[]) => void = () => {};
    loadHomeEvents.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(button);
    // The error and its focused button stay (busy) while it loads.
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");

    await act(async () => resolve([SAT, SUN]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(titles()).toEqual(["Event sat", "Event sun"]);
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("demo: a small note says the data is sample data", async () => {
    apiConfigured = false;
    renderFeed();
    await flush();
    expect(screen.getByRole("note")).toHaveTextContent("Demo · Sample data");
  });
});
