// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeEventSections from "@/components/home/HomeEventSections";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import { PHONE_QUERY } from "@/components/ui/useIsPhone";
import type { SheltuhEvent } from "@/lib/types";

const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
vi.mock("@/lib/home-events", () => ({
  loadHomeEvents: (now: Date) => loadHomeEvents(now),
  loadHomeTrending: () => Promise.resolve([]),
  loadHomeRecent: (now: Date) => loadHomeRecent(now),
}));
const loadHomeRecent = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
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
    ...overrides,
  };
}

const NOW = "2026-10-21T01:00:00.000Z";
const SAT = event("sat", "2026-10-24T08:00:00.000Z", { imageUrl: "https://img.example/sat.jpg" });
const COMING = Array.from({ length: 4 }, (_, i) =>
  event(`c${i}`, `2026-11-0${i + 1}T08:00:00.000Z`, { imageUrl: `https://img.example/c${i}.jpg` }),
);
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
  loadHomeEvents.mockReset().mockResolvedValue([ENDED, SAT, ...COMING]);
  loadHomeRecent.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
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
  it("shows the event screens in place of the rails (upcoming events only, in the feed's order)", async () => {
    stubViewport(true);
    loadHomeRecent.mockResolvedValue([RECENT]);
    const { container } = renderSections();
    await flush();
    const feed = screen.getByRole("feed");
    expect(feed).toHaveAttribute("aria-busy", "false");
    const articles = within(feed).getAllByRole("article");
    // This weekend (1) + Coming up (4); the ended and the recently-on events aren't in it.
    expect(articles.map((a) => a.getAttribute("aria-label"))).toEqual(["Event sat", "Event c0", "Event c1", "Event c2", "Event c3"]);
    articles.forEach((article, i) => {
      expect(article).toHaveAttribute("aria-posinset", String(i + 1));
      expect(article).toHaveAttribute("aria-setsize", "5");
    });
    // Titles are h2s under the page's h1 (the hero's, not rendered here); link names say which event.
    expect(within(feed).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(articles.map((a) => a.getAttribute("aria-label")));
    expect(within(articles[1]).getByRole("link", { name: "View event Event c0" })).toHaveAttribute("href", "/events/c0");
    expect(within(articles[0]).getByText("This weekend")).toBeInTheDocument();
    expect(within(articles[1]).getByText("Coming up")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("5 events");
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-event-card]")).toHaveLength(0);
    for (const name of ["This weekend", "Coming up", "Popular right now", "Recently on"]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
  });

  it("has no entry card, no Close, no Swipe up hint, and no link to /swipe", async () => {
    stubViewport(true);
    const { container } = renderSections();
    await flush();
    expect(screen.queryByText("Swipe through events")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Close/ })).not.toBeInTheDocument();
    expect(container.querySelector("[data-swipe-hint]")).toBeNull();
    expect(container.querySelector("a[href='/swipe']")).toBeNull();
  });

  it("each screen sits under the sticky header: as tall as what's left, snapping flush under it", async () => {
    stubViewport(true);
    renderSections();
    await flush();
    for (const article of screen.getAllByRole("article")) {
      expect(article).toHaveClass("min-h-[calc(100svh-var(--header-h)-env(safe-area-inset-top))]", "-scroll-mt-2");
      expect(article.className).not.toMatch(/(^|\s)h-/);
    }
  });

  it("snaps from the second screen on, so the page never pulls past the hero and search", async () => {
    stubViewport(true);
    renderSections();
    await flush();
    const [first, ...rest] = screen.getAllByRole("article");
    expect(first).not.toHaveClass("snap-start");
    for (const article of rest) expect(article).toHaveClass("snap-start");
    expect(document.querySelector("[data-swipe-end]")).toHaveClass("snap-start");
  });

  it("loads the first photo at once and the rest lazily", async () => {
    stubViewport(true);
    renderSections();
    await flush();
    const loading = screen.getAllByRole("article").map((a) => a.querySelector("img")?.getAttribute("loading"));
    expect(loading).toEqual(["eager", "lazy", "lazy", "lazy", "lazy"]);
  });

  it("ends with That’s everything, All events and Back to top, which scrolls to the top and focuses main", async () => {
    stubViewport(true);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    render(
      <main id="main" tabIndex={-1}>
        <HomeEventsProvider>
          <HomeEventSections />
        </HomeEventsProvider>
      </main>,
    );
    await flush();
    const end = document.querySelector<HTMLElement>("[data-swipe-end]");
    if (!end) throw new Error("no end screen");
    expect(within(end).getByText("That’s everything")).toBeInTheDocument();
    expect(within(end).getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    // After the last event, outside the feed.
    expect(screen.getByRole("feed")).not.toContainElement(end);
    fireEvent.click(within(end).getByRole("button", { name: "Back to top" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    expect(document.getElementById("main")).toHaveFocus();
  });

  it("says '1 event' for one", async () => {
    stubViewport(true);
    loadHomeEvents.mockResolvedValue([COMING[0]]);
    renderSections();
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("1 event");
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("holds a busy feed with a screen-sized skeleton while loading, and announces the load", () => {
    stubViewport(true);
    loadHomeEvents.mockReturnValue(new Promise(() => {}));
    const { container } = renderSections();
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    // The rails' skeleton is hidden by CSS below 640px; one screen's size shows instead.
    expect(container.querySelector("[aria-hidden='true'].hidden.sm\\:block")).not.toBeNull();
    const feed = container.querySelector("[role='feed']");
    expect(feed).toHaveAttribute("aria-busy", "true");
    expect(feed).toHaveClass("sm:hidden");
    expect(container.querySelector("[data-home-feed-loading]")).toHaveClass("min-h-[calc(100svh-var(--header-h)-env(safe-area-inset-top))]");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("keeps the error with Try again, and focuses the first event's link once it loads", async () => {
    stubViewport(true);
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderSections();
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load events");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View event Event sat" })).toHaveFocus();
  });

  it("keeps the empty state with nothing upcoming, even when events ended recently", async () => {
    stubViewport(true);
    loadHomeEvents.mockResolvedValue([ENDED]);
    loadHomeRecent.mockResolvedValue([RECENT]);
    renderSections();
    await flush();
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("feed")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});

describe("snapping the page", () => {
  it("snaps the root element 'y proximity' while the phone feed is mounted, and lets go on unmount", async () => {
    stubViewport(true);
    const { unmount } = renderSections();
    expect(document.documentElement.style.scrollSnapType).toBe("");
    await flush();
    expect(document.documentElement.style.scrollSnapType).toBe("y proximity");
    unmount();
    expect(document.documentElement.style.scrollSnapType).toBe("");
  });

  it("lets go when the window grows to desktop width, and snaps again when it shrinks", async () => {
    const resize = stubViewport(true);
    renderSections();
    await flush();
    expect(document.documentElement.style.scrollSnapType).toBe("y proximity");
    resize(false);
    expect(document.documentElement.style.scrollSnapType).toBe("");
    expect(screen.queryByRole("feed")).not.toBeInTheDocument();
    resize(true);
    expect(document.documentElement.style.scrollSnapType).toBe("y proximity");
  });
});

describe("keeping the place", () => {
  const scrollIntoView = vi.fn();
  const KEY = "sheltuh:home-feed-position";
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      scrollIntoView(this.getAttribute("data-event-id"), arg);
    };
    // jsdom can't navigate; the real Link would.
    document.addEventListener("click", preventNavigation);
  });
  afterEach(() => {
    document.removeEventListener("click", preventNavigation);
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });
  function preventNavigation(e: Event) {
    e.preventDefault();
  }

  it("remembers the event a followed link was on", async () => {
    stubViewport(true);
    renderSections();
    await flush();
    fireEvent.click(screen.getByRole("link", { name: "View event Event c1" }));
    expect(window.sessionStorage.getItem(KEY)).toBe("c1");
    // The browser's own (smooth, too early) scroll restoration is handed to us for this history entry.
    expect(window.history.scrollRestoration).toBe("manual");
  });

  it("scrolls to that event on Back, instantly and once", async () => {
    stubViewport(true);
    window.sessionStorage.setItem(KEY, "c2");
    window.dispatchEvent(new PopStateEvent("popstate"));
    renderSections();
    await flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith("c2", { behavior: "instant", block: "start" });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(window.history.scrollRestoration).toBe("auto");
  });

  it("starts at the top when the home is opened any other way, and forgets the old place", async () => {
    stubViewport(true);
    window.sessionStorage.setItem(KEY, "c2");
    renderSections();
    await flush();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("starts at the top when the remembered event is gone", async () => {
    stubViewport(true);
    window.sessionStorage.setItem(KEY, "gone");
    window.dispatchEvent(new PopStateEvent("popstate"));
    renderSections();
    await flush();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("the home from 640px up", () => {
  it("keeps the rails and has no feed, snap or end screen", async () => {
    stubViewport(false);
    loadHomeRecent.mockResolvedValue([RECENT]);
    const { container } = renderSections();
    await flush();
    expect(screen.queryByRole("feed")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(container.querySelector("[data-swipe-end]")).toBeNull();
    expect(document.documentElement.style.scrollSnapType).toBe("");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["This weekend", "Coming up", "Recently on"]);
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
