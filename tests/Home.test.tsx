// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/components/home/Home";
import { sampleEvents } from "@/lib/sample-events";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wed 21 Oct 2026, 12:00 AEDT.
  vi.setSystemTime(new Date("2026-10-21T01:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("Home (demo data, Wed 21 Oct 2026)", () => {
  it("reads as one outline: a single h1, then the sections in order", async () => {
    render(<Home />);
    await settle();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your next thing.");
    // The brief's order (mobile-redesign.md §6.3.1): Trending and Coming up are one slot, and Free &
    // low-cost and the guide card (After dark) have left the home (the latter is at the end of /events).
    // Refinement (22 Oct 2026): the category chips are a labelled nav under the search, with no heading.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "This weekend",
      "Popular right now",
      "What else?",
      "See who’s going. Find your people.",
      "Bring your event to life",
    ]);
    expect(screen.getByRole("heading", { level: 2, name: "See who’s going. Find your people." }).closest("#find-your-people")).not.toBeNull();
    expect(screen.getByRole("search", { name: "Search events" })).toBeInTheDocument();
  });

  it("puts the category row between the hero and the first event section, each chip to its /events filter", async () => {
    render(<Home />);
    await settle();
    const hero = screen.getByRole("region", { name: "Find your next thing." });
    const categories = screen.getByRole("navigation", { name: "Browse by category" });
    const weekend = screen.getByRole("region", { name: "This weekend" });
    expect(hero.compareDocumentPosition(categories) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(categories.compareDocumentPosition(weekend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing else in between: the next section after the hero is This weekend.
    const sections = Array.from(document.querySelectorAll("section")).filter((el) => el.hasAttribute("aria-labelledby"));
    expect(sections.indexOf(weekend) - sections.indexOf(hero)).toBe(1);
    expect(hero.nextElementSibling).toBe(categories);
    const links = within(categories).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/events",
      "/events?category=live-music",
      "/events?category=art",
      "/events?category=workshop",
      "/events?category=pop-up",
      "/events?category=theatre",
      "/events?pricing=free",
    ]);
  });

  it("has no Up next; every card is an upcoming event (demo data includes ended ones, which are nowhere)", async () => {
    render(<Home />);
    await settle();
    const now = Date.now();
    expect(screen.queryByRole("region", { name: "Up next" })).not.toBeInTheDocument();
    expect(screen.queryByText("Neon Static")).not.toBeInTheDocument();
    const slugs = screen
      .getAllByRole("link")
      .map((a) => /^\/events\/([^?#/]+)$/.exec(a.getAttribute("href") ?? "")?.[1])
      .filter((slug): slug is string => slug !== undefined);
    expect(slugs.length).toBeGreaterThan(5);
    for (const slug of slugs) {
      const sample = sampleEvents.find((e) => e.slug === slug);
      expect(Date.parse(sample?.endsAt ?? sample?.startsAt ?? "")).toBeGreaterThan(now);
    }
  });

  it("shows each event at most once", async () => {
    render(<Home />);
    await settle();
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => /^\/events\/[^?#]+$/.test(href));
    // This weekend's cards plus Popular right now's six.
    expect(hrefs.length).toBeGreaterThan(6);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("labels every demo count a sample, repeats no page-level demo notice, and every quick-buy link says 'Buy tickets' ('Get free tickets', or an external event's 'Get tickets'), as live", async () => {
    const { container } = render(<Home />);
    await settle();
    // The page's one sample-data disclosure is the layout's DemoBanner (not rendered here): no other notice.
    expect(screen.queryByRole("note")).toBeNull();
    const counts = Array.from(container.querySelectorAll("[data-event-card] [data-card-secondary]")).filter((el) => /going/.test(el.textContent ?? ""));
    expect(counts.length).toBeGreaterThan(3);
    for (const count of counts) expect(count).toHaveTextContent(/ · \d+ going \(sample\)$/);
    // The band's example is a real sample count from a card on the page, labelled too.
    const example = container.querySelector("[data-community-example]");
    expect(example?.querySelector("[data-community-count]")).toHaveTextContent(/^\d+ people going$/);
    expect(example?.querySelector("[data-community-note]")).toHaveTextContent(/^Example event · Sample count$/);
    const quick = screen.getAllByRole("link", { name: /tickets for/ });
    expect(quick.length).toBeGreaterThan(5);
    for (const link of quick) {
      expect(link.getAttribute("href")).toMatch(/^\/events\/[^/]+#tickets$/);
      // A9: an external event's card says "Get tickets" (nothing is bought on Sheltüh).
      expect(link).toHaveAccessibleName(/^(?:Buy tickets|Get free tickets|Get tickets) for /);
    }
  });

  it("shows every section at load: nothing waits for a scroll to appear", async () => {
    const { container } = render(<Home />);
    await settle();
    expect(container.querySelector("[data-reveal], [data-reveal-stagger], .reveal-pending")).toBeNull();
  });

  it("puts the orange community band outside the page container; the only orange buttons are the cards' quick buy", async () => {
    const { container } = render(<Home />);
    await settle();
    const band = container.querySelector("[data-surface='signal']");
    expect(band?.closest(".max-w-6xl")).toBeNull();
    // The seated demo event's quick buy is "Choose seats" (orange). The sold-out one's "Join waitlist" is the
    // outline button: a waitlist isn't a purchase (mobile-redesign.md §6.2.3).
    const quickBuy = screen.getAllByRole("link", { name: /(?:tickets|Choose seats) for/ });
    const waitlist = screen.getAllByRole("link", { name: /Join waitlist for/ });
    for (const link of waitlist) expect(link).toHaveClass("btn-outline");
    const orange = Array.from(container.querySelectorAll(".btn-signal"));
    // Every other card quick-buy is orange (black label), and the hero's search submit: the hero's main
    // action is the search (owner feedback, 22 Oct 2026), whose submit is orange since the owner round of
    // 24 Oct 2026 (the Eventbrite-style bar). "Explore all events" is a text link.
    const searchSubmit = screen.getByRole("search", { name: "Search events" }).querySelector("button[type='submit']");
    expect(orange).toHaveLength(quickBuy.length + 1);
    expect(orange).toContain(searchSubmit);
    expect(orange.filter((el) => el !== searchSubmit && !quickBuy.includes(el as HTMLElement))).toEqual([]);
    // Never an orange button on the orange band.
    expect(band?.querySelector(".btn-signal")).toBeNull();
  });
});
