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
let complete = true;
vi.mock("@/lib/home-events", () => ({
  loadHomeFeed: async (now: Date) => ({ events: await loadHomeEvents(now), complete }),
  loadHomeTrending: (now: Date) => loadHomeTrending(now),
  loadHomeFollowing: () => Promise.resolve([]),
}));
vi.mock("@/lib/api/going", () => ({ getGoingSummary: vi.fn(() => new Promise(() => {})) }));
// The suburb table: the home never loads it (the saved suburb's state is stored with it), so any call is a bug.
const loadLocation = vi.fn();
vi.mock("@/lib/location-loader", () => ({ loadLocation: () => loadLocation() }));

function event(id: string, startsAt: string, priceCents = 3000, category: SheltuhEvent["category"] = "art"): SheltuhEvent {
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category,
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
const SAT = event("sat", "2026-10-24T08:00:00.000Z", 3000, "live-music");
const SUN = event("sun", "2026-10-25T02:00:00.000Z", 0);
const COMING = Array.from({ length: 7 }, (_, i) => event(`c${i}`, `2026-11-0${i + 1}T08:00:00.000Z`));
const T = Array.from({ length: 3 }, (_, i) => event(`t${i}`, `2026-11-2${i}T08:00:00.000Z`));
const ENDED = event("ended", "2026-10-01T08:00:00.000Z", 0);
const EVENTS = [ENDED, NEXT, SAT, SUN, ...COMING, ...T];
const UPCOMING = EVENTS.length - 1;
const trend = (e: SheltuhEvent): TrendingItem => ({ event: e, signal: { kind: "going", count: 15 } });
// Trending lists a weekend event too: the carousel claims first, so This weekend doesn't repeat it.
const TRENDING: TrendingItem[] = [NEXT, SAT, ...T].map(trend);
// Trending well after the weekend only: the carousel takes these, This weekend keeps both of its.
const TRENDING_LATER: TrendingItem[] = T.map(trend);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  complete = true;
  loadHomeEvents.mockReset();
  loadHomeTrending.mockReset().mockResolvedValue([]);
  loadLocation.mockReset();
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

/** The page's own load status (All events has its own, for filter changes). */
const pageStatus = () => screen.getAllByRole("status")[0];
const carousel = () => document.querySelector<HTMLElement>("[data-featured-carousel]");
/** The carousel's events, in slide order (each slide's title). */
const slideTitles = () =>
  Array.from(carousel()?.querySelectorAll("[data-slide] h3") ?? []).map((h) => h.textContent);
/** A listing's card titles, in order. */
const titlesIn = (name: string) =>
  within(screen.getByRole("list", { name })).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

describe("the home's event sections (redesign PR 3)", () => {
  it("while loading: announces it, holds the carousel's and a grid's placeholders, and already shows the chips", () => {
    loadHomeEvents.mockReturnValue(new Promise(() => {}));
    const { container } = renderHome();
    expect(pageStatus()).toHaveTextContent("Loading events…");
    expect(container.querySelector("[data-home-loading][aria-hidden='true']")).toHaveClass("aspect-[4/5]", "sm:aspect-video", "lg:aspect-[5/2]");
    const grid = container.querySelector("[data-home-grid-loading][aria-hidden='true']");
    expect(grid?.querySelectorAll(".aspect-\\[4\\/3\\]")).toHaveLength(4);
    expect(screen.getByRole("group", { name: "Browse by category" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-card-link]")).toHaveLength(0);
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(0);
  });

  it("when loaded: the carousel (Popular right now), the chips, This weekend, then All events, in order", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockResolvedValue(TRENDING);
    renderHome();
    await flush();

    expect(pageStatus()).toHaveTextContent("");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Popular right now",
      "This weekend",
      "All events",
    ]);
    // The carousel is named by a visually hidden h2; its slides are the trending events, in the
    // server's order: it claims first.
    expect(screen.getByRole("heading", { level: 2, name: "Popular right now" })).toHaveClass("sr-only");
    expect(slideTitles()).toEqual(["Event next", "Event sat", "Event t0", "Event t1", "Event t2"]);
    const chips = screen.getByRole("group", { name: "Browse by category" });
    expect((carousel()?.compareDocumentPosition(chips) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const weekend = screen.getByRole("region", { name: "This weekend" });
    expect(chips.compareDocumentPosition(weekend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // This weekend: the one EventCard (the old WeekendCard is gone), the dates as its note, and a
    // link to the one listing with a weekend filter (Nearby's).
    // Saturday's is in the carousel already.
    expect(titlesIn("This weekend")).toEqual(["Event sun"]);
    for (const card of weekend.querySelectorAll("[data-event-card]")) expect(card).toHaveAttribute("data-variant", "grid");
    expect(within(weekend).getByText("Fri 23 – Sun 25 Oct")).toBeInTheDocument();
    expect(within(weekend).getByRole("link", { name: "See all this weekend" })).toHaveAttribute("href", "/map?time=weekend");
    // A sideways row on phones, the grid from 640px.
    expect(screen.getByRole("list", { name: "This weekend" })).toHaveClass("flex", "overflow-x-auto", "sm:grid", "sm:grid-cols-2", "xl:grid-cols-4");

    // All events: every upcoming event, soonest first with This weekend's last (so its first page
    // doesn't repeat them), the first eight, and its count (the load was complete).
    const all = screen.getByRole("region", { name: "All events" });
    expect(within(all).getByText(`${UPCOMING} upcoming · Across Australia`)).toBeInTheDocument();
    expect(titlesIn("All events")).toEqual([NEXT, SAT, ...COMING.slice(0, 6)].map((e) => e.title));
    expect(within(all).getByRole("link", { name: "See all events" })).toHaveAttribute("href", "/events");
    expect(within(all).getByRole("button", { name: "Show more events" })).toBeInTheDocument();
    expect(screen.queryByText("Event ended")).not.toBeInTheDocument();
    // No rails, marquee, What else? or Recently on.
    for (const name of ["Recently on", "What else?", "Coming up"]) expect(screen.queryByRole("heading", { name })).toBeNull();
    expect(document.querySelector("[data-rail-clone], [data-rail-layout]")).toBeNull();
  });

  it("never repeats an event between the carousel and This weekend; All events lists each upcoming event once, This weekend's last", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockResolvedValue(TRENDING);
    renderHome();
    await flush();
    const above = [...slideTitles(), ...titlesIn("This weekend")];
    expect(new Set(above).size).toBe(above.length);
    fireEvent.click(screen.getByRole("button", { name: "Show more events" }));
    const all = titlesIn("All events");
    expect(all).toHaveLength(UPCOMING);
    expect(new Set(all).size).toBe(all.length);
    expect(all.at(-1)).toBe("Event sun");
  });

  it("gives cards the real going counts the page has: the trending ones, live or demo alike", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockResolvedValue(TRENDING);
    renderHome();
    await flush();
    // Demo (this suite has no API): every card shows its labelled sample's count, as before.
    const all = screen.getByRole("list", { name: "All events" });
    expect(all).toHaveTextContent(`${getSampleGoing("next").count} going`);
  });

  it("titles the carousel Coming up when trending data is missing or thin, silently, and never calls those events popular", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockRejectedValue(new Error("no such endpoint"));
    const { container } = renderHome();
    await flush();
    expect(screen.queryByRole("heading", { name: "Popular right now" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Coming up" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // At most five slides.
    expect(slideTitles()).toHaveLength(5);
    expect(container).not.toHaveTextContent(/Popular this week|Just announced|Featured/);
  });

  it("a section with no cards renders nothing: with no trending, the carousel's Coming up takes the soonest, This weekend's included", async () => {
    loadHomeEvents.mockResolvedValue([SAT, COMING[0]]);
    const { container } = renderHome();
    await flush();
    expect(slideTitles()).toEqual(["Event sat", "Event c0"]);
    expect(screen.queryByRole("region", { name: "This weekend" })).toBeNull();
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(2);
    for (const list of screen.getAllByRole("list")) expect(within(list).queryAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("a lone event: one slide and no controls", async () => {
    loadHomeEvents.mockResolvedValue([COMING[0]]);
    renderHome();
    await flush();
    expect(slideTitles()).toEqual(["Event c0"]);
    expect(screen.queryByRole("button", { name: "Next slide" })).toBeNull();
  });

  it("nothing this weekend but events later: no dead end, the next ones are in the carousel and All events", async () => {
    loadHomeEvents.mockResolvedValue([COMING[0]]);
    renderHome();
    await flush();
    expect(screen.queryByRole("heading", { name: "This weekend" })).not.toBeInTheDocument();
    expect(screen.queryByText("No events yet.")).not.toBeInTheDocument();
    expect(slideTitles()).toEqual(["Event c0"]);
    expect(titlesIn("All events")).toEqual(["Event c0"]);
  });

  it("a saved state with none of its events upcoming: Coming up across Australia, never empty", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth", state: "WA" }));
    try {
      loadHomeEvents.mockResolvedValue([COMING[0]]);
      renderHome();
      await flush();
      expect(screen.getByRole("heading", { level: 2, name: "Coming up across Australia" })).toBeInTheDocument();
      expect(slideTitles()).toHaveLength(1);
    } finally {
      localStorage.clear();
    }
  });

  it("the chips narrow This weekend and All events (not the carousel); a section left empty hides, All events says so", async () => {
    loadHomeEvents.mockResolvedValue(EVENTS);
    loadHomeTrending.mockResolvedValue(TRENDING_LATER);
    renderHome();
    await flush();
    const slides = slideTitles();

    fireEvent.click(screen.getByRole("button", { name: "Live music" }));
    expect(titlesIn("This weekend")).toEqual(["Event sat"]);
    expect(titlesIn("All events")).toEqual(["Event sat"]);
    expect(screen.getByRole("region", { name: "All events" })).toHaveTextContent("1 upcoming · Across Australia");
    // The change is announced (a moment later), and the dropdown agrees with the chip.
    await act(() => new Promise((r) => setTimeout(r, 150)));
    expect(within(screen.getByRole("region", { name: "All events" })).getByRole("status")).toHaveTextContent("1 event matches");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("live-music");
    expect(slideTitles()).toEqual(slides);

    fireEvent.click(screen.getByRole("button", { name: "Theatre" }));
    expect(screen.queryByRole("region", { name: "This weekend" })).toBeNull();
    const all = screen.getByRole("region", { name: "All events" });
    expect(within(all).getByText("No events match your filters")).toBeInTheDocument();
    fireEvent.click(within(all).getAllByRole("button", { name: "Reset filters" }).at(-1) as HTMLElement);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(titlesIn("This weekend")).toEqual(["Event sat", "Event sun"]);
    // The button it was on has gone: focus is on the section's heading.
    expect(screen.getByRole("heading", { level: 2, name: "All events" })).toHaveFocus();
  });

  it("on error: an alert with Try again in the first section's place, which loads again; the event sections and chips are hidden", async () => {
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderHome();
    await flush();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load events. Check your connection and try again.");
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Browse by category" })).toBeNull();

    loadHomeEvents.mockResolvedValueOnce(EVENTS);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pageStatus()).toHaveTextContent("Loading events…");
    await flush();
    expect(loadHomeEvents).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Coming up" })).toBeInTheDocument();
  });

  it("Try again keeps the error box and its focused button (busy) while loading, then moves focus to the first section", async () => {
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderHome();
    await flush();

    let resolve: (events: SheltuhEvent[]) => void = () => {};
    loadHomeEvents.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);

    expect(button).toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent("Trying again…");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(pageStatus()).toHaveTextContent("Loading events…");
    fireEvent.click(button);
    expect(loadHomeEvents).toHaveBeenCalledTimes(2);

    await act(async () => resolve(EVENTS));
    // The first section is the carousel: it takes focus (tabIndex -1), outlined as a whole.
    const first = carousel();
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(first).toHaveFocus();
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

  it("when nothing is upcoming: says so in the first section's place and hides every event section and the chips", async () => {
    loadHomeEvents.mockResolvedValue([ENDED]);
    const { container } = renderHome();
    await flush();
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Browse by category" })).toBeNull();
  });

  it("says 'Across Australia' without a count when the home didn't load every upcoming event", async () => {
    complete = false;
    loadHomeEvents.mockResolvedValue(EVENTS);
    renderHome();
    await flush();
    const all = screen.getByRole("region", { name: "All events" });
    expect(all.querySelector("[data-section-note]")).toHaveTextContent(/^Across Australia$/);
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

  // Trending far later, so the carousel takes those and This weekend keeps the weekend's three.
  const FAR = Array.from({ length: 3 }, (_, i) => event(`far${i}`, `2026-12-1${i}T08:00:00.000Z`));
  beforeEach(() => loadHomeTrending.mockResolvedValue(FAR.map(trend)));
  afterEach(() => localStorage.clear());
  /** All events less the carousel's far-off ones: This weekend's, last, in their order. */
  const allButFar = () => titlesIn("All events").filter((t) => !t.startsWith("Event far"));

  it("lists the saved suburb's state first in This weekend and All events, read from storage without the suburb table", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth", state: "WA" }));
    loadHomeEvents.mockResolvedValue([SAT, SUN, PERTH_SAT, ...FAR]);
    renderHome();
    await flush();
    expect(titlesIn("This weekend")).toEqual(["Event perth-sat", "Event sat", "Event sun"]);
    expect(allButFar()).toEqual(["Event perth-sat", "Event sat", "Event sun"]);
    // Nothing waits on the ~15k-row table: it isn't loaded at all.
    expect(loadLocation).not.toHaveBeenCalled();
    // The suburb isn't sent with the events' requests.
    expect(loadHomeEvents).toHaveBeenCalledWith(expect.any(Date));
  });

  it("an entry saved before the state was: the state code its name ends with", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Kensington WA" }));
    loadHomeEvents.mockResolvedValue([SAT, SUN, PERTH_SAT, ...FAR]);
    renderHome();
    await flush();
    expect(titlesIn("This weekend")[0]).toBe("Event perth-sat");
    expect(loadLocation).not.toHaveBeenCalled();
  });

  it("without one: soonest first, Australia-wide, and the suburb table isn't loaded", async () => {
    loadHomeEvents.mockResolvedValue([SAT, SUN, PERTH_SAT, ...FAR]);
    renderHome();
    await flush();
    expect(titlesIn("This weekend")).toEqual(["Event sat", "Event perth-sat", "Event sun"]);
    expect(allButFar()).toEqual(["Event sat", "Event perth-sat", "Event sun"]);
    expect(loadLocation).not.toHaveBeenCalled();
  });

  it("a bare name saved without a state: the usual order, at once, with no table load and no error", async () => {
    localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth" }));
    loadLocation.mockReturnValue(new Promise(() => {}));
    loadHomeEvents.mockResolvedValue([SAT, SUN, PERTH_SAT, ...FAR]);
    renderHome();
    await flush();
    expect(titlesIn("This weekend")[0]).toBe("Event sat");
    expect(loadLocation).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
