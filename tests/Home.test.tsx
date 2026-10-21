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
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Where is your Sheltüh?");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Browse by category",
      "Up next",
      "This weekend",
      "Trending",
      "Coming up near you",
      "Only in the city",
      // Free & low-cost is hidden: fewer than two cheap events are left after the sections above.
      "Find your people",
      "Bring your event to life",
    ]);
    expect(screen.getByRole("search", { name: "Search events" })).toBeInTheDocument();
  });

  it("features the soonest event that hasn't started (demo data includes past events)", async () => {
    render(<Home />);
    await settle();
    const now = Date.now();
    const soonest = [...sampleEvents]
      .filter((e) => Date.parse(e.startsAt) > now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    expect(screen.getByRole("region", { name: "Up next" })).toHaveTextContent(soonest.title);
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
    expect(screen.getByText("Free · Tickets on the organiser's site")).toBeInTheDocument();
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

  it("puts the orange community band outside the page container; orange buttons are the hero CTA and the cards' quick buy only", async () => {
    const { container } = render(<Home />);
    await settle();
    const band = container.querySelector("[data-surface='signal']");
    expect(band?.closest(".max-w-6xl")).toBeNull();
    const quickBuy = screen.getAllByRole("link", { name: /tickets for/ });
    const orange = Array.from(container.querySelectorAll(".btn-signal"));
    // Owner decision 6: every card quick-buy is orange (black label); otherwise only Explore events.
    expect(orange).toHaveLength(quickBuy.length + 1);
    expect(orange.filter((el) => !quickBuy.includes(el as HTMLElement)).map((el) => el.textContent)).toEqual([
      "Explore events",
    ]);
    // Never an orange button on the orange band.
    expect(band?.querySelector(".btn-signal")).toBeNull();
  });
});
