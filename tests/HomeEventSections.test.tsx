// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeEventSections from "@/components/home/HomeEventSections";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import type { TrendingItem } from "@/lib/home-sections";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";

const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
const loadHomeTrending = vi.fn<(now: Date) => Promise<TrendingItem[]>>();
vi.mock("@/lib/home-events", () => ({
  loadHomeEvents: (now: Date) => loadHomeEvents(now),
  loadHomeTrending: (now: Date) => loadHomeTrending(now),
}));
vi.mock("@/lib/api/going", () => ({ getGoingSummary: vi.fn(() => new Promise(() => {})) }));
// The suburb table, loaded only for a visitor with a saved suburb (owner decision D5).
const loadLocation = vi.fn();
vi.mock("@/lib/location-loader", () => ({ loadLocation: () => loadLocation() }));

function event(id: string, startsAt: string, priceCents = 3000): SheltuhEvent {
  return {
    id,
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
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

// Now: Wed 21 Oct 2026, 12:00 AEDT. This weekend is Fri 23 – Sun 25 Oct.
const NOW = "2026-10-21T01:00:00.000Z";
const NEXT = event("next", "2026-10-22T08:00:00.000Z");
const SAT = event("sat", "2026-10-24T08:00:00.000Z");
const SUN = event("sun", "2026-10-25T02:00:00.000Z", 0);
const COMING = Array.from({ length: 7 }, (_, i) => event(`c${i}`, `2026-11-0${i + 1}T08:00:00.000Z`));
const T = Array.from({ length: 3 }, (_, i) => event(`t${i}`, `2026-11-2${i}T08:00:00.000Z`));
const ENDED = event("ended", "2026-10-01T08:00:00.000Z", 0);
const EVENTS = [ENDED, NEXT, SAT, SUN, ...COMING, ...T];
// Trending lists a weekend event too: de-duplication drops it.
const TRENDING: TrendingItem[] = [NEXT, SAT, ...T].map((e) => ({ event: e, signal: { kind: "going", count: 15 } }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  loadHomeEvents.mockReset();
  loadHomeTrending.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flush = () => act(() => Promise.resolve());

function renderHome() {
  return render(
    <HomeEventsProvider>
      <HomeEventSections />
    </HomeEventsProvider>,
  );
}

/** Every card's main link (not See all, Save or quick-buy links). */
const cardHrefs = () =>
  screen
    .queryAllByRole("link")
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) => /^\/events\/[^?#]+$/.test(href));

describe("the home's event sections", () => {
  it("while loading: announces it and holds one skeleton section of rail cards", () => {
    loadHomeEvents.mockReturnValue(new Promise(() => {}));
    const { container } = renderHome();
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    const skeleton = container.querySelector("[aria-hidden='true'].mt-6");
    // A rail of placeholders like the loaded rails (owner, 23 Oct 2026: rails at every width): six,
    // enough for a wide screen, clipped rather than scrolled; each with the rail card's media box (4:3
    // at every width since the owner's "the pictures still way too big", 23 Oct 2026).
    expect(skeleton?.querySelectorAll(".aspect-\\[4\\/3\\]")).toHaveLength(6);
    expect(skeleton?.querySelector(".overflow-hidden")).toHaveClass("flex");
    expect(screen.queryByRole("heading", { name: "This weekend" })).not.toBeInTheDocument();
    expect(cardHrefs()).toEqual([]);
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(0);
  });

  it("when loaded: This weekend, then Popular right now (trending merged with Coming up), in order; no Up next", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockResolvedValue(TRENDING);
    const { container } = renderHome();
    await flush();

    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByRole("region", { name: "Up next" })).not.toBeInTheDocument();
    // The soonest event is a card like any other (in Coming up), with its ticket action.
    expect(screen.getByRole("link", { name: "Buy tickets for Event next" })).toHaveAttribute("href", "/events/next#tickets");
    // Every card is the rail EventCard.
    const cards = container.querySelectorAll("[data-event-card]");
    expect(cards.length).toBe(6);
    for (const card of cards) expect(card).toHaveAttribute("data-variant", "rail");

    const weekend = screen.getByRole("region", { name: "This weekend" });
    expect(weekend).toHaveTextContent("Fri 23 – Sun 25 Oct");
    const weekendList = screen.getByRole("list", { name: "This weekend" });
    expect(within(weekendList).getAllByRole("listitem")).toHaveLength(2);
    // Two cards: a pair, a two-column grid of wide cards from 1024px (owner, 23 Oct 2026, layout polish).
    expect(weekendList).toHaveAttribute("data-rail-layout", "pair");
    for (const card of weekendList.querySelectorAll("[data-event-card]")) expect(card).toHaveAttribute("data-wide", "");
    // A8: /events isn't filtered to the weekend, so the link says where it goes.
    expect(within(weekend).getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    expect(within(weekend).queryByRole("link", { name: /^See all/ })).toBeNull();

    // The soonest event (no longer Up next's) stays popular; the weekend one is claimed above.
    const popular = screen.getByRole("region", { name: "Popular right now" });
    const popularList = screen.getByRole("list", { name: "Popular right now" });
    expect(within(popularList).getAllByRole("listitem")).toHaveLength(4);
    // Four cards: an ordinary rail, never wide.
    expect(popularList).toHaveAttribute("data-rail-layout", "rail");
    expect(popularList.querySelectorAll("[data-wide]")).toHaveLength(0);
    // Nor sorted by popularity: "All events" too (A8).
    expect(within(popular).getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    // Demo cards show the labelled sample's count (mobile-redesign.md §6.2.5; demo trending ranks by
    // that same count). Live cards show the server's count: tests/EventCard.test.tsx.
    expect(popularList).toHaveTextContent(`${getSampleGoing("t0").count} going`);

    // Trending and Coming up are one slot now; Free & low-cost has left the home (§6.3.1).
    for (const name of ["Trending", "Coming up near you", "Coming up", "Free & low-cost"]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "This weekend",
      "Popular right now",
    ]);
    expect(weekend.compareDocumentPosition(popular) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Event ended")).not.toBeInTheDocument();
  });

  it("shows each event at most once across the page", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockResolvedValue(TRENDING);
    renderHome();
    await flush();
    const hrefs = cardHrefs();
    // Two sections now (This weekend, Popular right now): 2 + 4 cards.
    expect(hrefs).toHaveLength(6);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("titles the slot Coming up when trending data is missing or thin, silently, and never calls those events popular", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockRejectedValue(new Error("no such endpoint"));
    const { container } = renderHome();
    await flush();
    expect(screen.queryByRole("heading", { name: "Popular right now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const coming = screen.getByRole("list", { name: "Coming up" });
    expect(within(coming).getAllByRole("listitem")).toHaveLength(6);
    // No trending signal on any card ("Popular this week", "Just announced", a going count).
    expect(container).not.toHaveTextContent(/Popular this week|Just announced/);
  });

  it("dedupes across sections: an event shown in This weekend isn't repeated in Popular", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    // Every trending item is also a weekend event or the soonest: only NEXT and T are left for Popular.
    loadHomeTrending.mockResolvedValue(TRENDING);
    renderHome();
    await flush();
    const weekend = screen.getByRole("list", { name: "This weekend" });
    const popular = screen.getByRole("list", { name: "Popular right now" });
    expect(within(weekend).getByRole("link", { name: /^Event sat / })).toBeInTheDocument();
    expect(within(popular).queryByRole("link", { name: /^Event sat / })).toBeNull();
  });

  it("hides a section with no cards: nothing renders for an empty Popular / Coming up slot", async () => {
    // One weekend event, one more later: too few for Coming up (needs two), and no trending.
    loadHomeEvents.mockResolvedValue([SAT, COMING[0]]);
    const { container } = renderHome();
    await flush();
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: /Coming up|Popular/ })).not.toBeInTheDocument();
    // No empty lists anywhere.
    for (const list of screen.getAllByRole("list")) expect(within(list).queryAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("This weekend with nothing on (before the weekend): the heading and a note, no cards and so no See all", async () => {
    loadHomeEvents.mockResolvedValue([NEXT, ...COMING]);
    renderHome();
    await flush();
    const weekend = screen.getByRole("region", { name: "This weekend" });
    expect(weekend).toHaveTextContent("Nothing listed for this weekend yet. New events are added through the week.");
    expect(within(weekend).queryByRole("list")).not.toBeInTheDocument();
    // "See all" shows only beside cards (mobile-redesign.md §6.3.4); the dates note stays.
    expect(within(weekend).queryByRole("link")).toBeNull();
    expect(weekend).toHaveTextContent("Fri 23 – Sun 25 Oct");
  });

  it("on error: an alert with Try again in the first section's place, which loads again; the event sections are hidden", async () => {
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderHome();
    await flush();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load events. Check your connection and try again.");
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();

    loadHomeEvents.mockResolvedValueOnce(EVENTS);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    await flush();
    expect(loadHomeEvents).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Coming up" })).toBeInTheDocument();
  });

  it("Try again keeps the error box and its focused button (busy) while loading, then moves focus to the first section's heading", async () => {
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderHome();
    await flush();

    let resolve: (events: SheltuhEvent[]) => void = () => {};
    loadHomeEvents.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);

    // Still mounted, still focused, marked busy and relabelled; a second click does nothing.
    expect(button).toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent("Trying again…");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    fireEvent.click(button);
    expect(loadHomeEvents).toHaveBeenCalledTimes(2);

    await act(async () => resolve(EVENTS));
    const heading = screen.getByRole("heading", { level: 2, name: "This weekend" });
    expect(heading).toHaveAttribute("id", "home-weekend");
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed Try again keeps focus on the button, ends busy, and re-announces the alert", async () => {
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderHome();
    await flush();
    const firstAlert = screen.getByRole("alert");

    loadHomeEvents.mockRejectedValueOnce(new Error("still down"));
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);
    await flush();

    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).toHaveTextContent("Try again");
    // A new alert element: screen readers announce it again.
    const alert = screen.getByRole("alert");
    expect(alert).not.toBe(firstAlert);
    expect(alert).toHaveTextContent("Couldn’t load events. Check your connection and try again.");
  });

  it("doesn't move focus on load when there was no retry", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    renderHome();
    await flush();
    expect(document.activeElement).toBe(document.body);
  });

  it("when nothing is upcoming: says so in the first section's place and hides every event section", async () => {
    loadHomeEvents.mockResolvedValue([ENDED]);
    renderHome();
    await flush();
    expect(screen.getByText("No events have been published yet. Check back soon.")).toBeInTheDocument();
    for (const name of ["This weekend", "Coming up", "Popular right now"]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
  });

  it("passes one `now` to both loaders", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    renderHome();
    await flush();
    expect(loadHomeEvents.mock.calls[0][0]).toBe(loadHomeTrending.mock.calls[0][0]);
    expect(loadHomeEvents.mock.calls[0][0].toISOString()).toBe(NOW);
  });
});

describe("the home with a saved suburb (owner decision D5, browser-only)", () => {
  const PERTH_SAT = { ...event("perth-sat", "2026-10-24T11:00:00.000Z"), state: "WA" as const, timeZone: "Australia/Perth" as const };

  afterEach(() => localStorage.clear());

  it("lists the saved suburb's state first in each section; the location goes nowhere but the suburb table", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth" }));
    const findLocality = vi.fn(() => ({ name: "Perth", state: "WA", lat: -31.95, lng: 115.86 }));
    loadLocation.mockResolvedValue({ findLocality });
    loadHomeEvents.mockResolvedValue([SAT, SUN, PERTH_SAT]);
    renderHome();
    await flush();
    await flush();
    const weekend = within(screen.getByRole("list", { name: "This weekend" }));
    expect(weekend.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Event perth-sat",
      "Event sat",
      "Event sun",
    ]);
    expect(findLocality).toHaveBeenCalledWith("Perth");
    // The suburb isn't sent with the events' requests.
    expect(loadHomeEvents).toHaveBeenCalledWith(expect.any(Date));
  });

  it("without one: soonest first, Australia-wide, and the suburb table isn't loaded", async () => {
    loadHomeEvents.mockResolvedValue([SAT, SUN, PERTH_SAT]);
    renderHome();
    await flush();
    const weekend = within(screen.getByRole("list", { name: "This weekend" }));
    expect(weekend.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Event sat",
      "Event perth-sat",
      "Event sun",
    ]);
    expect(loadLocation).not.toHaveBeenCalled();
  });

  it("if the table can't load: the usual order, no error", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth" }));
    loadLocation.mockRejectedValue(new Error("chunk failed"));
    loadHomeEvents.mockResolvedValue([SAT, SUN, PERTH_SAT]);
    renderHome();
    await flush();
    await flush();
    const weekend = within(screen.getByRole("list", { name: "This weekend" }));
    expect(weekend.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Event sat");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
