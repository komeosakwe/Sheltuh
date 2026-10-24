// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeRailItem } from "@/components/home/HomeRail";
import HomeRailSection from "@/components/home/HomeRailSection";
import { railPageStep } from "@/components/home/RailArrows";

/**
 * The home rails' Previous/Next buttons (the original carousel's arrows,
 * reinstated with the horizontal scrolling, owner 23 Oct 2026). jsdom has no
 * layout, so the rail gets fake scroll metrics.
 */

function setMetrics(el: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: Record<string, number>) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  el.scrollLeft = scrollLeft;
  act(() => void fireEvent.scroll(el));
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("no-preference") ? !reduce : reduce && query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function renderSection(count: number, props: { empty?: boolean } = {}) {
  return render(
    <HomeRailSection
      id="home-popular"
      title="Popular right now"
      link={{ href: "/events", label: "All events" }}
      count={props.empty ? 0 : count}
      empty={props.empty ? <p>Nothing listed</p> : undefined}
    >
      {Array.from({ length: count }, (_, i) => (
        <HomeRailItem key={i}>
          <a href={`#e${i}`}>Event {i}</a>
        </HomeRailItem>
      ))}
    </HomeRailSection>,
  );
}

const rail = () => screen.getByRole("list", { name: "Popular right now" });
const prev = () => screen.getByRole("button", { name: "Previous events: Popular right now" });
const next = () => screen.getByRole("button", { name: "Next events: Popular right now" });

beforeEach(() => {
  Element.prototype.scrollBy = vi.fn() as unknown as typeof Element.prototype.scrollBy;
  stubReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HomeRailSection", () => {
  it("is a named region with its head in the page column and a full-width rail the buttons control", () => {
    const { container } = renderSection(6);
    const region = screen.getByRole("region", { name: "Popular right now" });
    expect(region).toHaveAttribute("data-home-section");
    const head = screen.getByRole("heading", { level: 2, name: "Popular right now" });
    expect(head.closest(".max-w-6xl")).not.toBeNull();
    expect(rail().closest(".max-w-6xl")).toBeNull();
    expect(rail()).toHaveAttribute("id", "home-popular-rail");
    expect(next()).toHaveAttribute("aria-controls", "home-popular-rail");
    expect(prev()).toHaveAttribute("aria-controls", "home-popular-rail");
    // Head order: the link, the auto-scroll's Pause (tests/HomeRailAutoScroll.test.tsx), then Previous, then Next (and then the cards).
    const controls = Array.from(container.querySelectorAll("a, button")).map((el) => el.textContent || el.getAttribute("aria-label"));
    expect(controls.slice(0, 4)).toEqual([
      "All events",
      "Pause auto-scroll: Popular right now",
      "Previous events: Popular right now",
      "Next events: Popular right now",
    ]);
  });

  it("buttons show from 640px only (a swipe is the control on phones), as 44px targets", () => {
    renderSection(6);
    for (const button of [prev(), next()]) expect(button).toHaveClass("hidden", "sm:flex", "size-11");
  });

  it("a long rail has its buttons in the first render (no head shift on hydration); a short one gets none until it overflows", () => {
    renderSection(6);
    expect(next()).toHaveAttribute("aria-disabled", "false");
    expect(prev()).toHaveAttribute("aria-disabled", "true");
    cleanup();

    renderSection(2);
    expect(screen.queryByRole("button")).toBeNull();
    // Two cards on a narrow screen can still overflow: the buttons arrive once measured.
    setMetrics(rail(), { scrollWidth: 700, clientWidth: 640, scrollLeft: 0 });
    expect(next()).toBeInTheDocument();
  });

  it("drops the buttons when nothing overflows (two cards on a wide screen)", () => {
    renderSection(6);
    setMetrics(rail(), { scrollWidth: 1280, clientWidth: 1280, scrollLeft: 0 });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("disables each end's button with aria-disabled, so it stays focusable, and follows the scroll", () => {
    renderSection(6);
    setMetrics(rail(), { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0 });
    expect(prev()).toHaveAttribute("aria-disabled", "true");
    expect(prev()).not.toBeDisabled();
    expect(next()).toHaveAttribute("aria-disabled", "false");

    setMetrics(rail(), { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 2000 });
    expect(prev()).toHaveAttribute("aria-disabled", "false");
    expect(next()).toHaveAttribute("aria-disabled", "true");
    next().focus();
    fireEvent.click(next());
    expect(next()).toHaveFocus();
    expect(rail().scrollBy).not.toHaveBeenCalled();
  });

  it("pages smoothly, and instantly for people who prefer reduced motion", () => {
    renderSection(6);
    setMetrics(rail(), { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 500 });
    fireEvent.click(next());
    // No card sizes in jsdom: most of the rail's width.
    expect(rail().scrollBy).toHaveBeenLastCalledWith({ left: 800, behavior: "smooth" });
    fireEvent.click(prev());
    expect(rail().scrollBy).toHaveBeenLastCalledWith({ left: -800, behavior: "smooth" });

    stubReducedMotion(true);
    fireEvent.click(next());
    expect(rail().scrollBy).toHaveBeenLastCalledWith({ left: 800, behavior: "auto" });
  });

  it("with `empty`, shows the line instead of a rail, and no buttons", () => {
    renderSection(0, { empty: true });
    const region = screen.getByRole("region", { name: "Popular right now" });
    expect(within(region).getByText("Nothing listed")).toBeInTheDocument();
    expect(within(region).queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("railPageStep", () => {
  it("moves by every card wholly in view, so the peeking card becomes the first", () => {
    const el = document.createElement("ul");
    const li = document.createElement("li");
    el.append(li);
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 1280 });
    vi.spyOn(li, "getBoundingClientRect").mockReturnValue({ width: 256 } as DOMRect);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ paddingInlineStart: "96px", columnGap: "24px" } as CSSStyleDeclaration);
    // 1280 − 96 = 1184px of rail in view: 4 whole 256px cards (+ 24px gaps), and part of a fifth.
    expect(railPageStep(el)).toBe(4 * 280);
  });

  it("moves at least one card on a narrow rail", () => {
    const el = document.createElement("ul");
    const li = document.createElement("li");
    el.append(li);
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 300 });
    vi.spyOn(li, "getBoundingClientRect").mockReturnValue({ width: 256 } as DOMRect);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ paddingInlineStart: "32px", columnGap: "24px" } as CSSStyleDeclaration);
    expect(railPageStep(el)).toBe(280);
  });
});
