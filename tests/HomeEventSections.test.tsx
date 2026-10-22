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
const FREE = [event("free-a", "2026-12-01T08:00:00.000Z", 0), event("free-b", "2026-12-02T08:00:00.000Z", 1000)];
const ENDED = event("ended", "2026-10-01T08:00:00.000Z", 0);
const EVENTS = [ENDED, NEXT, SAT, SUN, ...COMING, ...T, ...FREE];
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
      <HomeEventSections guide={<p>Guide slot</p>} />
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
  it("while loading: announces it, holds one skeleton section of rail cards, and shows the static slot", () => {
    loadHomeEvents.mockReturnValue(new Promise(() => {}));
    const { container } = renderHome();
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    const skeleton = container.querySelector("[aria-hidden='true'].mt-8");
    expect(skeleton?.querySelectorAll("[data-variant], .aspect-\\[4\\/5\\]")).toHaveLength(3);
    expect(screen.queryByRole("heading", { name: "This weekend" })).not.toBeInTheDocument();
    expect(cardHrefs()).toEqual([]);
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(0);
    expect(screen.getByText("Guide slot")).toBeInTheDocument();
  });

  it("when loaded: This weekend, Trending, Coming up, the guide, Free & low-cost, in order; no Up next", async () => {
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
    expect(cards.length).toBeGreaterThan(10);
    for (const card of cards) expect(card).toHaveAttribute("data-variant", "rail");

    const weekend = screen.getByRole("region", { name: "This weekend" });
    expect(weekend).toHaveTextContent("Fri 23 – Sun 25 Oct");
    const weekendList = screen.getByRole("list", { name: "This weekend" });
    expect(within(weekendList).getAllByRole("listitem")).toHaveLength(2);

    // The soonest event (no longer Up next's) stays trending; the weekend one is claimed above.
    const trending = screen.getByRole("list", { name: "Trending" });
    expect(within(trending).getAllByRole("listitem")).toHaveLength(4);
    // Demo cards show the labelled sample's count (mobile-redesign.md §6.2.5; demo trending ranks by
    // that same count). Live cards show the server's count: tests/EventCard.test.tsx.
    expect(trending).toHaveTextContent(`${getSampleGoing("t0").count} going`);

    const coming = screen.getByRole("list", { name: "Coming up near you" });
    expect(within(coming).getAllByRole("listitem")).toHaveLength(6);
    const free = screen.getByRole("list", { name: "Free & low-cost" });
    expect(within(free).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: "See all free events" })).toHaveAttribute("href", "/events?pricing=free");

    const order = [weekend, trending, coming, screen.getByText("Guide slot"), free];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText("Event ended")).not.toBeInTheDocument();
  });

  it("shows each event at most once across the page", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockResolvedValue(TRENDING);
    renderHome();
    await flush();
    const hrefs = cardHrefs();
    expect(hrefs.length).toBeGreaterThan(10);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("hides Trending when there's no trending data (live has no API yet), silently", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockRejectedValue(new Error("no such endpoint"));
    renderHome();
    await flush();
    expect(screen.queryByRole("heading", { name: "Trending" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Coming up near you" })).toBeInTheDocument();
  });

  it("This weekend with nothing on (before the weekend): the heading, See all and a note, no cards", async () => {
    loadHomeEvents.mockResolvedValue([NEXT, ...COMING]);
    renderHome();
    await flush();
    const weekend = screen.getByRole("region", { name: "This weekend" });
    expect(weekend).toHaveTextContent("Nothing listed for this weekend yet. New events are added through the week.");
    expect(within(weekend).queryByRole("list")).not.toBeInTheDocument();
    expect(within(weekend).getByRole("link", { name: "See all events" })).toHaveAttribute("href", "/events");
  });

  it("on error: an alert with Try again in the first section's place, which loads again; the event sections are hidden", async () => {
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderHome();
    await flush();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load events. Check your connection and try again.");
    // The alert comes before the static guide slot (the first slot).
    expect(alert.compareDocumentPosition(screen.getByText("Guide slot")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Coming up near you" })).not.toBeInTheDocument();
    expect(screen.getByText("Guide slot")).toBeInTheDocument();

    loadHomeEvents.mockResolvedValueOnce(EVENTS);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    await flush();
    expect(loadHomeEvents).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Coming up near you" })).toBeInTheDocument();
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
    for (const name of ["This weekend", "Coming up near you", "Trending", "Free & low-cost"]) {
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
