// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeEventSections from "@/components/home/HomeEventSections";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import { PHONE_QUERY } from "@/components/ui/useIsPhone";
import type { TrendingItem } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";

const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
const loadHomeTrending = vi.fn<(now: Date) => Promise<TrendingItem[]>>();
const loadHomeRecent = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
vi.mock("@/lib/home-events", () => ({
  loadHomeEvents: (now: Date) => loadHomeEvents(now),
  loadHomeTrending: (now: Date) => loadHomeTrending(now),
  loadHomeRecent: (now: Date) => loadHomeRecent(now),
}));
vi.mock("@/lib/api/going", () => ({ getGoingSummary: vi.fn(() => new Promise(() => {})) }));

function event(id: string, startsAt: string, overrides: Partial<SheltuhEvent> = {}): SheltuhEvent {
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
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    imageUrl: `https://img.example/${id}.jpg`,
    ...overrides,
  };
}

// Now: Wed 21 Oct 2026, 12:00 AEDT. This weekend is Fri 23 – Sun 25 Oct.
const NOW = "2026-10-21T01:00:00.000Z";
const SAT = event("sat", "2026-10-24T08:00:00.000Z");
const SUN = event("sun", "2026-10-25T02:00:00.000Z");
const COMING = Array.from({ length: 4 }, (_, i) => event(`c${i}`, `2026-11-0${i + 1}T08:00:00.000Z`));
const ENDED = event("ended", "2026-10-01T08:00:00.000Z");
const RECENT = event("recent", "2026-10-19T08:00:00.000Z");

/** A phone-width (or wider) viewport: only the phone query matches. */
function stubViewport(phone: boolean) {
  let matches = phone;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return matches && query === PHONE_QUERY;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  /** Resize across 640px. */
  return (nowPhone: boolean) => {
    matches = nowPhone;
    act(() => listeners.forEach((listener) => listener()));
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  loadHomeEvents.mockReset().mockResolvedValue([ENDED, SAT, SUN, ...COMING]);
  loadHomeTrending.mockReset().mockResolvedValue([]);
  loadHomeRecent.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const flush = () => act(() => Promise.resolve());

function renderSections() {
  return render(
    <HomeEventsProvider>
      <HomeEventSections />
    </HomeEventsProvider>,
  );
}

describe("the home on a phone", () => {
  it("shows the sections as two-column grids of cards, in order, with their titles, note and links", async () => {
    stubViewport(true);
    loadHomeRecent.mockResolvedValue([RECENT]);
    const { container } = renderSections();
    await flush();
    const sections = Array.from(container.querySelectorAll<HTMLElement>("section[data-home-section]"));
    expect(sections.map((s) => within(s).getByRole("heading", { level: 2 }).textContent)).toEqual(["This weekend", "Coming up", "Recently on"]);
    // The weekend's dates, and the same links as the rails.
    expect(within(sections[0]).getByText("Fri 23 – Sun 25 Oct")).toBeInTheDocument();
    for (const section of sections) expect(within(section).getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    // This weekend is its own cards in a sideways rail on phones too (owner's mockup, 8 Nov 2026), named by its heading.
    const weekend = within(sections[0]).getByRole("list");
    expect(weekend).toHaveAccessibleName("This weekend");
    expect(weekend).toHaveClass("flex", "snap-x", "overflow-x-auto");
    expect(within(sections[0]).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Event sat", "Event sun"]);
    // Every other section: grid EventCards in a two-column list named by its heading.
    const list = within(sections[1]).getByRole("list");
    expect(list).toHaveAccessibleName("Coming up");
    expect(list).toHaveClass("grid", "grid-cols-2", "gap-x-4");
    expect(within(sections[1]).getAllByRole("heading", { level: 3 })).toHaveLength(4);
    // Each event once, ended ones aside; recently on says Ended.
    expect(container.querySelectorAll("[data-event-card][data-variant='weekend']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-event-card][data-variant='grid']")).toHaveLength(5);
    expect(container.querySelectorAll("[data-event-card][data-variant='rail']")).toHaveLength(0);
    expect(within(sections[2]).getByText("Ended")).toBeInTheDocument();
    expect(within(sections[0]).getByRole("link", { name: "Event sat" })).toHaveAttribute("href", "/events/sat");
  });

  it("has no feed, event screens, snap, entry card or link to /swipe", async () => {
    stubViewport(true);
    const { container } = renderSections();
    await flush();
    expect(screen.queryByRole("feed")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(container.querySelector("[data-swipe-end]")).toBeNull();
    expect(container.querySelector("a[href='/swipe']")).toBeNull();
    expect(document.documentElement.style.scrollSnapType).toBe("");
  });

  it("has one horizontal rail, This weekend's, which never drifts on a phone: no clones, no Pause, no edge cue", async () => {
    stubViewport(true);
    loadHomeEvents.mockResolvedValue([ENDED, SAT, SUN, ...COMING]);
    const { container } = renderSections();
    await flush();
    expect(container.querySelectorAll("[data-rail-layout]")).toHaveLength(1);
    expect(container.querySelectorAll(".snap-x")).toHaveLength(1);
    expect(container.querySelector("#home-weekend-rail")).not.toBeNull();
    expect(container.querySelector("[data-rail-clone]")).toBeNull();
    expect(screen.queryByRole("button", { name: /^(?:Pause|Play)/ })).toBeNull();
    expect(container.querySelector("[data-scroll-arrow]")).toBeNull();
  });

  it("loads the first row's photos at once and the rest lazily", async () => {
    stubViewport(true);
    const { container } = renderSections();
    await flush();
    const loading = Array.from(container.querySelectorAll("[data-event-card]")).map((c) => c.querySelector("img")?.getAttribute("loading"));
    expect(loading).toEqual(["eager", "eager", "lazy", "lazy", "lazy", "lazy"]);
  });

  it("shows a two-column skeleton of card placeholders while loading, and announces the load", () => {
    stubViewport(true);
    loadHomeEvents.mockReturnValue(new Promise(() => {}));
    const { container } = renderSections();
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    // The rails' skeleton is hidden by CSS below 640px; the grid's shows instead.
    expect(container.querySelector("[aria-hidden='true'].hidden.sm\\:block")).not.toBeNull();
    const skeleton = container.querySelector("[data-home-grid-loading]");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton).toHaveClass("sm:hidden");
    expect(skeleton?.querySelector(".grid-cols-2")).not.toBeNull();
    // The card's 4:3 image box (the rules' card anatomy), four placeholders.
    expect(skeleton?.querySelectorAll(".aspect-\\[4\\/3\\]")).toHaveLength(4);
  });

  it("keeps the error with Try again, and focuses the first section's heading once it loads", async () => {
    stubViewport(true);
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderSections();
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load events");
    expect(screen.queryByRole("heading", { name: "This weekend" })).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "This weekend" })).toHaveFocus();
  });

  it("shows the empty state with nothing upcoming and nothing recent", async () => {
    stubViewport(true);
    loadHomeEvents.mockResolvedValue([ENDED]);
    renderSections();
    await flush();
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    expect(document.querySelector("[data-event-card]")).toBeNull();
  });

  it("shows Recently on alone when only recent events are left, with no empty note", async () => {
    stubViewport(true);
    loadHomeEvents.mockResolvedValue([ENDED]);
    loadHomeRecent.mockResolvedValue([RECENT]);
    renderSections();
    await flush();
    expect(screen.queryByText("No events yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Recently on" })).toBeInTheDocument();
  });

  it("swaps to rails when the window grows past 640px", async () => {
    const resize = stubViewport(true);
    const { container } = renderSections();
    await flush();
    // This weekend is a rail at both widths; Coming up swaps from its grid.
    expect(container.querySelectorAll("[data-home-grid]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-rail-layout]")).toHaveLength(1);
    resize(false);
    expect(container.querySelectorAll("[data-home-grid]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-rail-layout]")).toHaveLength(2);
  });
});

describe("the home from 640px up", () => {
  it("keeps the rails of rail cards", async () => {
    stubViewport(false);
    loadHomeRecent.mockResolvedValue([RECENT]);
    const { container } = renderSections();
    await flush();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["This weekend", "Coming up", "Recently on"]);
    expect(container.querySelectorAll("[data-rail-layout]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-home-grid]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-event-card][data-variant='rail']").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("#home-weekend-rail [data-event-card][data-variant='weekend']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-event-card][data-variant='grid']")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("");
    const loading = Array.from(container.querySelectorAll("[data-event-card] img")).map((img) => img.getAttribute("loading"));
    expect(new Set(loading)).toEqual(new Set(["lazy"]));
  });
});
