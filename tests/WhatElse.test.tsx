// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOME_WHAT_ELSE } from "@/components/home/home-content";
import WhatElse from "@/components/home/WhatElse";

/** "What else?", restored at the owner's request (23 Oct 2026), with its highlight that follows the scroll. */

let observed: Element[] = [];
let notify: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | null = null;
let rootMargin = "";

class FakeObserver {
  constructor(cb: (entries: { target: Element; isIntersecting: boolean }[]) => void, options?: { rootMargin?: string }) {
    notify = cb;
    rootMargin = options?.rootMargin ?? "";
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {
    observed = [];
  }
}

beforeEach(() => {
  observed = [];
  notify = null;
  window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "IntersectionObserver");
});

const items = () => within(screen.getByRole("list")).getAllByRole("listitem");

describe("WhatElse", () => {
  it("is a section named by its big uppercase h2, with the three promises as a list of h3s and notes", () => {
    render(<WhatElse />);
    const region = screen.getByRole("region", { name: "What else?" });
    expect(within(region).getByRole("heading", { level: 2 })).toHaveClass("display-lg");
    expect(within(region).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Every organiser checked by a person",
      "Only the good stuff",
      "See who’s going",
    ]);
    for (const h3 of within(region).getAllByRole("heading", { level: 3 })) expect(h3).toHaveClass("uppercase");
    expect(items().map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Curated, not scraped.",
      "Hand-picked music, art and pop-ups worth leaving the house for.",
      "Ticket holders can show they’re going. Make a free profile to see who.",
    ]);
  });

  it("starts with the first item in black and the rest muted but readable (a token colour, never faded out)", () => {
    render(<WhatElse />);
    expect(items().map((li) => li.getAttribute("data-active"))).toEqual(["true", "false", "false"]);
    expect(items()[0]).toHaveClass("text-foreground");
    for (const li of items().slice(1)) {
      expect(li).toHaveClass("text-muted");
      expect(li.className).not.toMatch(/opacity/);
    }
  });

  it("lights each item in turn as it crosses the middle of the screen, and under the pointer", () => {
    render(<WhatElse />);
    expect(rootMargin).toBe("-45% 0px -45% 0px");
    expect(observed).toEqual(items());
    act(() => notify?.([{ target: items()[2], isIntersecting: true }]));
    expect(items().map((li) => li.getAttribute("data-active"))).toEqual(["false", "false", "true"]);
    act(() => notify?.([{ target: items()[1], isIntersecting: false }]));
    expect(items()[2]).toHaveAttribute("data-active", "true");
    fireEvent.mouseEnter(items()[1]);
    expect(items()[1]).toHaveClass("text-foreground");
    expect(items()[2]).toHaveClass("text-muted");
  });

  it("goes back to the item the scroll picked when the pointer leaves, and keeps following the scroll", () => {
    render(<WhatElse />);
    act(() => notify?.([{ target: items()[2], isIntersecting: true }]));
    fireEvent.mouseEnter(items()[0]);
    expect(items().map((li) => li.getAttribute("data-active"))).toEqual(["true", "false", "false"]);
    fireEvent.mouseLeave(items()[0]);
    expect(items().map((li) => li.getAttribute("data-active"))).toEqual(["false", "false", "true"]);
    // Scrolling while the pointer rests on an item: the hover wins until it leaves.
    fireEvent.mouseEnter(items()[0]);
    act(() => notify?.([{ target: items()[1], isIntersecting: true }]));
    expect(items()[0]).toHaveAttribute("data-active", "true");
    fireEvent.mouseLeave(items()[0]);
    expect(items()[1]).toHaveAttribute("data-active", "true");
  });

  it("shows the highlighted item's photo beside the list from 1024px (decorative), easing only when motion is welcome", () => {
    const { container } = render(<WhatElse />);
    const panel = container.querySelector("[aria-hidden='true']");
    expect(panel).toHaveClass("hidden", "lg:block");
    const photos = Array.from(panel?.children ?? []);
    expect(photos).toHaveLength(HOME_WHAT_ELSE.length);
    expect(photos.map((p) => p.classList.contains("opacity-100"))).toEqual([true, false, false]);
    for (const photo of photos) expect(photo.className).toMatch(/motion-safe:transition-opacity/);
    act(() => notify?.([{ target: items()[1], isIntersecting: true }]));
    expect(photos.map((p) => p.classList.contains("opacity-100"))).toEqual([false, true, false]);
  });
});
