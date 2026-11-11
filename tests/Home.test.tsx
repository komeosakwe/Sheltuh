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
      // The demo's events that ended in the last 14 days (before Wed 21 Oct), last of the event sections.
      "Recently on",
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

  it("has no Up next; every card outside Recently on is an upcoming event, and every one in it ended in the last 14 days", async () => {
    render(<Home />);
    await settle();
    const now = Date.now();
    expect(screen.queryByRole("region", { name: "Up next" })).not.toBeInTheDocument();
    expect(screen.queryByText("Neon Static")).not.toBeInTheDocument();
    const recent = screen.getByRole("region", { name: "Recently on" });
    const sampleOf = (a: HTMLElement) => sampleEvents.find((e) => e.slug === /^\/events\/([^?#/]+)$/.exec(a.getAttribute("href") ?? "")?.[1]);
    const recentSamples = within(recent).getAllByRole("link").map(sampleOf).filter((e) => e !== undefined);
    expect(recentSamples.length).toBeGreaterThan(0);
    for (const sample of recentSamples) {
      const ended = Date.parse(sample.endsAt ?? sample.startsAt);
      expect(ended).toBeLessThanOrEqual(now);
      expect(ended).toBeGreaterThan(now - 14 * 86_400_000);
    }
    const slugs = screen
      .getAllByRole("link")
      .filter((a) => !recent.contains(a))
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
    // Each card's main link (a This weekend card's "Open" arrow goes to the same page as its title).
    const hrefs = Array.from(document.querySelectorAll("[data-card-link]"))
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => /^\/events\/[^?#]+$/.test(href));
    // This weekend's cards plus Popular right now's six.
    expect(hrefs.length).toBeGreaterThan(6);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  // The redesign's card (the rules' Cards board) has no ticket button: the card opens the event, and
  // its all-inclusive price is an orange label inside the card's link, never a control.
  it("labels every demo count a sample, repeats no page-level demo notice, and gives every card a price label instead of a ticket button", async () => {
    const { container } = render(<Home />);
    await settle();
    // The page's one sample-data disclosure is the layout's DemoBanner (not rendered here): no other notice.
    expect(screen.queryByRole("note")).toBeNull();
    // The one event card's counts are bare ("12 going"): the layout's DemoBanner says the page is sample
    // data (visual QA, PR 1). This weekend's own cards (until PR 3) still label theirs.
    const counts = Array.from(container.querySelectorAll("[data-event-card]:not([data-variant='weekend']) [data-card-going]"));
    expect(counts.length).toBeGreaterThan(3);
    for (const count of counts) expect(count).toHaveTextContent(/^\d+ going$/);
    const weekendCounts = Array.from(container.querySelectorAll("[data-event-card][data-variant='weekend'] [data-card-going]"));
    for (const count of weekendCounts) expect(count).toHaveTextContent(/\d+ going \(sample\)/);
    // The band's example is a real sample count from a card on the page, labelled too.
    const example = container.querySelector("[data-community-example]");
    expect(example?.querySelector("[data-community-count]")).toHaveTextContent(/^\d+ people going$/);
    expect(example?.querySelector("[data-community-note]")).toHaveTextContent(/^Example event · Sample count$/);
    expect(screen.queryAllByRole("link", { name: /(?:tickets|Choose seats|Join waitlist) for/ })).toEqual([]);
    const prices = Array.from(container.querySelectorAll("[data-event-card] [data-price-tag='signal']"));
    expect(prices.length).toBeGreaterThan(5);
    for (const price of prices) {
      expect(price).toHaveTextContent(/^(?:From )?A\$[\d.]+(?: for \d+)?$|^Free$|^Buy tickets$/);
      expect(price.closest("a, button")).toBeNull();
    }
  });

  it("shows every section at load: nothing waits for a scroll to appear", async () => {
    const { container } = render(<Home />);
    await settle();
    expect(container.querySelector("[data-reveal], [data-reveal-stagger], .reveal-pending")).toBeNull();
  });

  it("puts the orange community band outside the page container; the only orange button is the hero's search", async () => {
    const { container } = render(<Home />);
    await settle();
    const band = container.querySelector("[data-surface='signal']");
    expect(band?.closest(".max-w-6xl")).toBeNull();
    // On 21 Oct the sold-out demo event is This weekend's: its price line says Sold out, and no card
    // anywhere has a ticket button (the redesign's card is one link; its price is a label).
    const weekend = container.querySelector("#home-weekend-rail");
    expect(weekend?.querySelector("[data-card-state='sold-out'] [data-card-foot]")).toHaveTextContent("Sold out");
    expect(weekend?.querySelector(".btn-signal")).toBeNull();
    const orange = Array.from(container.querySelectorAll(".btn-signal"));
    // The hero's search submit: the hero's main action is the search (owner feedback, 22 Oct 2026), whose
    // submit is orange since the owner round of 24 Oct 2026 (the Eventbrite-style bar). "Explore all
    // events" is a text link.
    const searchSubmit = screen.getByRole("search", { name: "Search events" }).querySelector("button[type='submit']");
    expect(orange).toEqual([searchSubmit]);
    // Never an orange button on the orange band.
    expect(band?.querySelector(".btn-signal")).toBeNull();
  });
});
