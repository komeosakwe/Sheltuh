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
const slugOf = (a: Element) => /^\/events\/([^?#/]+)$/.exec(a.getAttribute("href") ?? "")?.[1];

describe("Home (demo data, Wed 21 Oct 2026; the proposal, redesign PR 3)", () => {
  it("reads as one outline: a single h1, then the sections in the proposal's order", async () => {
    render(<Home />);
    await settle();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your next thing.");
    // Hero, the featured carousel (named by its hidden h2), the chips (a labelled group, no heading),
    // This weekend, All events, Find your people, Bring your event to life.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Popular right now",
      "This weekend",
      "All events",
      "Find your people.",
      "Bring your event to life",
    ]);
    expect(screen.getByRole("heading", { level: 2, name: "Find your people." }).closest("#find-your-people")).not.toBeNull();
    expect(screen.getByRole("search", { name: "Search events" })).toBeInTheDocument();
    // Gone: the rails and their marquee, What else?, Recently on, the hero collage and the old weekend card.
    for (const name of ["What else?", "Recently on", "Coming up"]) expect(screen.queryByRole("heading", { name })).toBeNull();
    expect(document.querySelector("[data-rail-clone], [data-rail-layout], [data-hero-collage], [data-hero-thumb], [data-variant='weekend']")).toBeNull();
  });

  it("puts the carousel under the hero, then the category chips, then This weekend", async () => {
    render(<Home />);
    await settle();
    const hero = screen.getByRole("region", { name: "Find your next thing." });
    const carousel = screen.getByRole("region", { name: "Popular right now" });
    const chips = screen.getByRole("group", { name: "Browse by category" });
    const weekend = screen.getByRole("region", { name: "This weekend" });
    expect(hero.compareDocumentPosition(carousel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(carousel.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chips.compareDocumentPosition(weekend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(chips).getByRole("button", { name: "All events" })).toHaveAttribute("aria-pressed", "true");
  });

  it("every card is an upcoming event, and none is shown twice above All events (which lists each once)", async () => {
    render(<Home />);
    await settle();
    const now = Date.now();
    const all = screen.getByRole("region", { name: "All events" });
    const links = Array.from(document.querySelectorAll("[data-card-link], [data-slide] h3"));
    expect(links.length).toBeGreaterThan(5);
    const above = Array.from(document.querySelectorAll("[data-featured-carousel] [data-slide] h3, [aria-labelledby='home-weekend'] [data-card-link]")).map((el) => el.textContent);
    expect(new Set(above).size).toBe(above.length);
    const allSlugs = within(all).getAllByRole("link").filter((a) => a.hasAttribute("data-card-link")).map(slugOf);
    expect(new Set(allSlugs).size).toBe(allSlugs.length);
    for (const a of document.querySelectorAll("[data-card-link]")) {
      const sample = sampleEvents.find((e) => e.slug === slugOf(a));
      expect(Date.parse(sample?.endsAt ?? sample?.startsAt ?? "")).toBeGreaterThan(now);
    }
  });

  // The redesign's card (the rules' Cards board) has no ticket button: the card opens the event, and
  // its all-inclusive price is an orange label inside the card's link, never a control.
  it("labels no demo count on cards (the layout's DemoBanner does), the band's example as a sample, and gives every card a price label", async () => {
    const { container } = render(<Home />);
    await settle();
    expect(screen.queryByRole("note")).toBeNull();
    const counts = Array.from(container.querySelectorAll("[data-event-card] [data-card-going]"));
    expect(counts.length).toBeGreaterThan(3);
    for (const count of counts) expect(count).toHaveTextContent(/^\d+ going$/);
    const example = container.querySelector("[data-community-example]");
    expect(example?.querySelector("[data-community-count]")).toHaveTextContent(/^\d+ people going · .+$/);
    expect(example?.querySelector("[data-community-note]")).toHaveTextContent(/^Example event · Sample count$/);
    const cards = container.querySelectorAll("[data-event-card]");
    expect(container.querySelectorAll("[data-event-card] a:not([data-card-link])")).toHaveLength(0);
    const prices = Array.from(container.querySelectorAll("[data-event-card] [data-price-tag='signal']"));
    expect(prices.length).toBeGreaterThan(5);
    expect(cards.length).toBeGreaterThan(5);
    for (const price of prices) {
      expect(price).toHaveTextContent(/^(?:From )?A\$[\d.]+(?: for \d+)?$|^Free(?: \+ paid)?$|^Buy tickets$/);
      expect(price.closest("a, button")).toBeNull();
    }
  });

  it("shows every section at load: nothing waits for a scroll to appear", async () => {
    const { container } = render(<Home />);
    await settle();
    expect(container.querySelector("[data-reveal], [data-reveal-stagger], .reveal-pending")).toBeNull();
  });

  it("keeps everything in the 1312px page column; orange buttons are the search and the carousel's ticket actions only, never on the band", async () => {
    const { container } = render(<Home />);
    await settle();
    for (const section of container.querySelectorAll("section")) expect(section.closest(".page-container")).not.toBeNull();
    const band = container.querySelector("[data-surface='signal']");
    expect(band?.querySelector(".btn-signal")).toBeNull();
    const searchSubmit = screen.getByRole("search", { name: "Search events" }).querySelector("button[type='submit']");
    const orange = Array.from(container.querySelectorAll(".btn-signal"));
    expect(orange[0]).toBe(searchSubmit);
    for (const button of orange.slice(1)) {
      expect(button.closest("[data-slide]")).not.toBeNull();
      expect(button).toHaveAccessibleName(/^(Buy tickets|Free tickets|Choose seats): /);
    }
    // One per slide at most, and only the current slide's is reachable (the rest are inert).
    const reachable = orange.slice(1).filter((b) => !b.closest("[inert]"));
    expect(reachable.length).toBeLessThanOrEqual(1);
  });
});
