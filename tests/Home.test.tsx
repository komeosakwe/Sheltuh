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
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "This weekend",
      "Trending",
      "Coming up near you",
      "Only in the city",
      // With no Up next claiming one, two cheap events are left for Free & low-cost.
      "Free & low-cost",
      "Explore by category",
      "Find your people",
      "Bring your event to life",
    ]);
    expect(screen.getByRole("search", { name: "Search events" })).toBeInTheDocument();
  });

  it("has no Up next: the soonest event is a card in the sections; ended events are nowhere (demo data includes them)", async () => {
    render(<Home />);
    await settle();
    const now = Date.now();
    const soonest = [...sampleEvents]
      .filter((e) => Date.parse(e.startsAt) > now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    expect(screen.queryByRole("region", { name: "Up next" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(`^${soonest.title} `) })).toHaveAttribute("href", `/events/${soonest.slug}`);
    expect(screen.queryByText("Neon Static")).not.toBeInTheDocument();
  });

  it("shows each event at most once", async () => {
    render(<Home />);
    await settle();
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => /^\/events\/[^?#]+$/.test(href));
    expect(hrefs.length).toBeGreaterThan(8);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("labels the external demo events by where tickets are sold", async () => {
    render(<Home />);
    await settle();
    expect(screen.getByText("Tickets on Humanitix")).toBeInTheDocument();
    // A free external event: "Free", then where (mobile-redesign.md §6.2.3 row 2).
    expect(screen.getByText("Tickets on the organiser's site").previousElementSibling).toHaveTextContent("Free");
  });

  it("says the listings are samples, and every quick-buy link says 'Buy tickets' (or 'Get free tickets'), as live", async () => {
    render(<Home />);
    await settle();
    expect(screen.getByRole("note")).toHaveTextContent("Demo — sample events");
    const quick = screen.getAllByRole("link", { name: /tickets for/ });
    expect(quick.length).toBeGreaterThan(5);
    for (const link of quick) {
      expect(link.getAttribute("href")).toMatch(/^\/events\/[^/]+#tickets$/);
      expect(link).toHaveAccessibleName(/^(?:Buy tickets|Get free tickets) for /);
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
