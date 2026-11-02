// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeEventSections from "@/components/home/HomeEventSections";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import HomeSwipeEntry from "@/components/home/HomeSwipeEntry";
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
const COMING = Array.from({ length: 4 }, (_, i) => event(`c${i}`, `2026-11-0${i + 1}T08:00:00.000Z`));
const ENDED = event("ended", "2026-10-01T08:00:00.000Z");
const RECENT = event("recent", "2026-10-19T08:00:00.000Z");

/** A phone-width (or wider) viewport: only the phone query matches. */
function stubViewport(phone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: phone && query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  loadHomeEvents.mockReset().mockResolvedValue([ENDED, SAT, ...COMING]);
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

describe("the phone entry card", () => {
  it("is the first event's photo, 'Swipe through events' and the count, linking to /swipe", () => {
    const { container } = render(<HomeSwipeEntry events={[SAT, ...COMING]} />);
    const link = screen.getByRole("link", { name: "Swipe through events" });
    expect(link).toHaveAttribute("href", "/swipe");
    expect(screen.getByRole("heading", { level: 2 })).toContainElement(link);
    expect(container.querySelector("[data-swipe-count]")).toHaveTextContent("5 events");
    expect(container.querySelector("img")).toHaveAttribute("src", "https://img.example/sat.jpg");
  });

  it("rings the whole card when its link has the keyboard focus", () => {
    const { container } = render(<HomeSwipeEntry events={[SAT]} />);
    expect(container.querySelector("[data-swipe-entry]")).toHaveClass("has-[a:focus-visible]:outline-2", "has-[a:focus-visible]:outline-foreground");
  });

  it("says '1 event' for one, and shows the generated poster art without a photo", () => {
    const { container } = render(<HomeSwipeEntry events={[COMING[0]]} />);
    expect(container.querySelector("[data-swipe-count]")).toHaveTextContent("1 event");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders nothing without events", () => {
    const { container } = render(<HomeSwipeEntry events={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the home on a phone", () => {
  it("replaces every rail with the one entry card (upcoming events only, counted like the feed)", async () => {
    stubViewport(true);
    loadHomeRecent.mockResolvedValue([RECENT]);
    const { container } = renderSections();
    await flush();
    expect(screen.getByRole("link", { name: "Swipe through events" })).toHaveAttribute("href", "/swipe");
    // This weekend (1) + Coming up (4); the ended and the recently-on events aren't counted.
    expect(container.querySelector("[data-swipe-count]")).toHaveTextContent("5 events");
    // A plain way to the full list under the card.
    expect(screen.getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-event-card]")).toHaveLength(0);
    for (const name of ["This weekend", "Coming up", "Popular right now", "Recently on"]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
  });

  it("still holds a loading skeleton for both widths and announces the load", () => {
    stubViewport(true);
    loadHomeEvents.mockReturnValue(new Promise(() => {}));
    const { container } = renderSections();
    expect(screen.getByRole("status")).toHaveTextContent("Loading events…");
    // The rails' skeleton is hidden by CSS below 640px; the entry card's shape shows instead.
    expect(container.querySelector("[aria-hidden='true'].hidden.sm\\:block")).not.toBeNull();
    expect(container.querySelector("[data-swipe-entry-skeleton]")).toHaveClass("sm:hidden");
    expect(screen.queryByRole("link", { name: "Swipe through events" })).not.toBeInTheDocument();
  });

  it("keeps the error with Try again, and focuses the entry card's link once it loads", async () => {
    stubViewport(true);
    loadHomeEvents.mockRejectedValueOnce(new Error("down"));
    renderSections();
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load events");
    expect(screen.queryByRole("link", { name: "Swipe through events" })).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    fireEvent.click(button);
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Swipe through events" })).toHaveFocus();
  });

  it("keeps the empty state with nothing upcoming, even when events ended recently", async () => {
    stubViewport(true);
    loadHomeEvents.mockResolvedValue([ENDED]);
    loadHomeRecent.mockResolvedValue([RECENT]);
    renderSections();
    await flush();
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("link", { name: "Swipe through events" })).not.toBeInTheDocument();
  });
});

describe("the home from 640px up", () => {
  it("keeps the rails and has no entry card", async () => {
    stubViewport(false);
    loadHomeRecent.mockResolvedValue([RECENT]);
    const { container } = renderSections();
    await flush();
    expect(screen.queryByRole("link", { name: "Swipe through events" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["This weekend", "Coming up", "Recently on"]);
    expect(container.querySelectorAll("section[data-home-section]")).toHaveLength(3);
  });
});
