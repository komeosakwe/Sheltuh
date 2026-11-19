// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventResults from "@/components/EventResults";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

// The sample events are dated Sept–Nov 2026, and an ended event gets no quick buy: read them before then.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** n distinct events, cloned from the samples with unique ids/slugs/titles. */
function events(n: number): SheltuhEvent[] {
  return Array.from({ length: n }, (_, i) => {
    const base = sampleEvents[i % sampleEvents.length];
    return { ...base, id: `t-${i}`, slug: `t-${i}`, title: `Test event ${i}` };
  });
}

describe("EventResults (the rules' Layout board: one grid of event cards)", () => {
  it("shows every event exactly once, however many there are, in the order given", () => {
    render(<EventResults events={events(30)} />);
    const list = screen.getByRole("list", { name: "Events" });
    const titles = within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(Array.from({ length: 30 }, (_, i) => `Test event ${i}`));
  });

  it("is a two-column grid on phones and tablets and four from 1024px, with the rules' gutters, and no carousel", () => {
    render(<EventResults events={events(3)} />);
    const list = screen.getByRole("list", { name: "Events" });
    expect(list).toHaveClass("grid", "grid-cols-2", "lg:grid-cols-4", "gap-x-4", "md:gap-x-6", "lg:gap-x-8", "gap-y-8");
    expect(list.className).not.toMatch(/sm:grid-cols-3/);
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("region", { name: "Events" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause|Play|Next events|Previous events/ })).toBeNull();
  });

  it("shows every card from the start: nothing waits for a scroll (mobile-redesign.md §8.1)", () => {
    render(<EventResults events={events(2)} />);
    const list = screen.getByRole("list", { name: "Events" });
    expect(list).not.toHaveAttribute("data-reveal-stagger");
    expect(list.querySelector("[data-reveal]")).toBeNull();
  });

  it("uses the one card", () => {
    const { container } = render(<EventResults events={events(2)} />);
    expect(container.querySelectorAll("[data-event-card]")).toHaveLength(2);
  });

  // The redesign's card has no ticket button: the card opens the event, and its price is an orange label.
  it("makes each card one link to its event, with its all-inclusive price as a label", () => {
    const [paid] = events(1);
    const { container } = render(<EventResults events={[paid]} />);
    expect(screen.getByRole("link", { name: paid.title })).toHaveAttribute("href", `/events/${paid.slug}`);
    expect(screen.queryByRole("link", { name: `Buy tickets for ${paid.title}` })).toBeNull();
    expect(container.querySelector("[data-price-tag='signal']")).toHaveTextContent(/A\$/);
  });

  it("with a heading, puts a visually hidden h2 above the grid, so the tiles' h3 titles sit under it", () => {
    render(<EventResults events={events(2)} heading="Events" />);
    const h2 = screen.getByRole("heading", { level: 2, name: "Events" });
    expect(h2).toHaveClass("sr-only");
    const list = screen.getByRole("list", { name: "Events" });
    expect(h2.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(list).getAllByRole("heading", { level: 3 })).toHaveLength(2);
  });

  it("has no heading of its own unless asked (a page with its own section heading)", () => {
    render(<EventResults events={events(1)} />);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("copes with no events at all", () => {
    render(<EventResults events={[]} />);
    expect(within(screen.getByRole("list", { name: "Events" })).queryAllByRole("listitem")).toHaveLength(0);
  });
});
