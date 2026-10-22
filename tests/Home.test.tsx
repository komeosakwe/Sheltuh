// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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
    // low-cost and Only in the city have left the home (the latter is at the end of /events).
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "This weekend",
      "Popular right now",
      "Explore by category",
      "See who’s going before you book.",
      "Bring your event to life",
    ]);
    // Find your people is the band's name for sighted readers (its eyebrow) and its jump target.
    expect(screen.getByText("Find your people").closest("#find-your-people")).not.toBeNull();
    expect(screen.getByRole("search", { name: "Search events" })).toBeInTheDocument();
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

  it("says the listings are samples, and every quick-buy link says 'Buy tickets' ('Get free tickets', or an external event's 'Get tickets'), as live", async () => {
    render(<Home />);
    await settle();
    expect(screen.getByRole("note")).toHaveTextContent("Demo — sample events");
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

  it("puts the orange community band outside the page container; orange buttons are the hero CTA and the cards' quick buy only", async () => {
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
    // Every other card quick-buy is orange (black label); otherwise only Explore events.
    expect(orange).toHaveLength(quickBuy.length + 1);
    expect(orange.filter((el) => !quickBuy.includes(el as HTMLElement)).map((el) => el.textContent)).toEqual([
      "Explore events",
    ]);
    // Never an orange button on the orange band.
    expect(band?.querySelector(".btn-signal")).toBeNull();
  });
});
