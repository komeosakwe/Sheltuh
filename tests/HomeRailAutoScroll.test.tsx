// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeRailItem } from "@/components/home/HomeRail";
import HomeRailSection from "@/components/home/HomeRailSection";
import { AUTO_SCROLL_INTERVAL } from "@/components/home/useRailAutoScroll";

/**
 * The home rails' auto-scroll (owner, 23 Oct 2026: "make them automatically
 * scroll to the left or right"): a card every 4 seconds, back to the start at
 * the end, held still while the visitor is busy with the rail, stopped for
 * good when they scroll it themselves, with a Pause/Play button (WCAG 2.2.2)
 * and nothing at all under reduced motion. jsdom has no layout, so the rail
 * gets fake scroll metrics and 256px cards.
 */

const CARD = 256;

function stubMotion(ok: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("no-preference") ? ok : !ok && query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

/** A controllable IntersectionObserver: the test says when the rail is on or off screen. */
const observers: IntersectionObserverCallback[] = [];
class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    observers.push(callback);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}
function setOnScreen(isIntersecting: boolean) {
  act(() => {
    for (const callback of observers) callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}

function setMetrics(el: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: Record<string, number>) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  el.scrollLeft = scrollLeft;
  act(() => void fireEvent.scroll(el));
}

function renderSection(count: number) {
  return render(
    <HomeRailSection id="home-popular" title="Popular right now" link={{ href: "/events", label: "All events" }} count={count}>
      {Array.from({ length: count }, (_, i) => (
        <HomeRailItem key={i}>
          <a href={`#e${i}`}>Event {i}</a>
        </HomeRailItem>
      ))}
    </HomeRailSection>,
  );
}

const rail = () => screen.getByRole("list", { name: "Popular right now" });
const pause = () => screen.getByRole("button", { name: "Pause auto-scroll: Popular right now" });
const play = () => screen.getByRole("button", { name: "Play auto-scroll: Popular right now" });
const toggle = () => screen.queryByRole("button", { name: /auto-scroll: Popular right now$/ });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** jsdom never matches :focus-visible: make whatever has focus keyboard focus (as Tab would). */
function keyboardFocusMode() {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
    return selector === ":focus-visible" ? this === document.activeElement : matches.call(this, selector);
  });
}

/** A long rail, overflowing, at its start. */
function renderOverflowing(scrollLeft = 0) {
  const view = renderSection(6);
  setMetrics(rail(), { scrollWidth: 3000, clientWidth: 1000, scrollLeft });
  return view;
}

let scrollBy: ReturnType<typeof vi.fn>;
let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  scrollBy = vi.fn();
  scrollTo = vi.fn();
  Element.prototype.scrollBy = scrollBy as unknown as typeof Element.prototype.scrollBy;
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  vi.spyOn(HTMLLIElement.prototype, "getBoundingClientRect").mockReturnValue({ width: CARD } as DOMRect);
  stubMotion(true);
});
afterEach(() => {
  cleanup();
  observers.length = 0;
  Reflect.deleteProperty(document, "visibilityState");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("home rail auto-scroll", () => {
  it("moves on by one card, smoothly, every 4 seconds", () => {
    renderOverflowing();
    expect(AUTO_SCROLL_INTERVAL).toBe(4000);
    wait(3999);
    expect(scrollBy).not.toHaveBeenCalled();
    wait(1);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.contexts[0]).toBe(rail());
    // One card's width plus the gap (none in jsdom): snapping lands on the next card's start.
    expect(scrollBy).toHaveBeenLastCalledWith({ left: CARD, behavior: "smooth" });
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it("at the end, scrolls smoothly back to the start (no cloned cards)", () => {
    renderOverflowing(2000);
    const cards = screen.getAllByRole("listitem").length;
    wait(4000);
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: "smooth" });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")).toHaveLength(cards);
  });

  it("holds still while the pointer is over the rail, and starts the 4 seconds again when it leaves", () => {
    renderOverflowing();
    wait(2000);
    fireEvent.pointerEnter(rail(), { pointerType: "mouse" });
    wait(10_000);
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.pointerLeave(rail(), { pointerType: "mouse" });
    wait(3999);
    expect(scrollBy).not.toHaveBeenCalled();
    wait(1);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    // Still on: the button offers Pause.
    expect(pause()).toBeInTheDocument();
  });

  it("holds still while keyboard focus is in the rail or on its arrows, but not on Pause/Play itself", () => {
    renderOverflowing();
    keyboardFocusMode();
    act(() => screen.getByRole("link", { name: "Event 1" }).focus());
    wait(10_000);
    expect(scrollBy).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "Next events: Popular right now" }).focus());
    wait(10_000);
    expect(scrollBy).not.toHaveBeenCalled();
    // On the toggle it keeps moving, so Play from the keyboard plays.
    act(() => pause().focus());
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    act(() => pause().blur());
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it("isn't held by pointer focus (a click focuses too)", () => {
    renderOverflowing();
    act(() => screen.getByRole("link", { name: "Event 1" }).focus());
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("holds still during a touch that doesn't scroll the rail (a tap, or the page scrolling past), then carries on", () => {
    renderOverflowing();
    fireEvent.touchStart(rail());
    wait(10_000);
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.touchEnd(rail());
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(pause()).toBeInTheDocument();
  });

  it("holds still while the tab is hidden", () => {
    renderOverflowing();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    wait(10_000);
    expect(scrollBy).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("holds still while the rail is off screen, and starts when it comes on", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    renderOverflowing();
    // Not reported on screen yet: nothing moves.
    wait(10_000);
    expect(scrollBy).not.toHaveBeenCalled();
    setOnScreen(true);
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    setOnScreen(false);
    wait(10_000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "a swipe (the rail scrolls during a touch)",
      (el: HTMLElement) => {
        fireEvent.touchStart(el);
        el.scrollLeft = 120;
        fireEvent.scroll(el);
        fireEvent.touchEnd(el);
      },
    ],
    ["a sideways wheel or trackpad swipe", (el: HTMLElement) => void fireEvent.wheel(el, { deltaX: 40, deltaY: 2 })],
    ["shift + wheel", (el: HTMLElement) => void fireEvent.wheel(el, { deltaY: 40, shiftKey: true })],
    [
      "the keyboard (a key press, then the rail scrolls)",
      (el: HTMLElement) => {
        fireEvent.keyDown(el.querySelector("a") ?? el, { key: "ArrowRight" });
        el.scrollLeft = 120;
        fireEvent.scroll(el);
      },
    ],
    ["an arrow button", () => void fireEvent.click(screen.getByRole("button", { name: "Next events: Popular right now" }))],
  ])("stops for the rest of the page view when the visitor scrolls the rail: %s", (_label, scrollIt) => {
    renderOverflowing();
    act(() => scrollIt(rail()));
    expect(play()).toBeInTheDocument();
    scrollBy.mockClear();
    wait(20_000);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    // Play starts it again.
    fireEvent.click(play());
    expect(pause()).toBeInTheDocument();
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("isn't stopped by a vertical wheel over the rail (the page scrolling past) or by its own steps", () => {
    renderOverflowing();
    fireEvent.wheel(rail(), { deltaX: 0, deltaY: 80 });
    wait(4000);
    // Its own smooth step scrolls the rail: no touch, no key, so it carries on.
    rail().scrollLeft = CARD;
    act(() => void fireEvent.scroll(rail()));
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(pause()).toBeInTheDocument();
  });

  it("Pause stops it and Play restarts it; the button's name says what a press does and names the section", () => {
    renderOverflowing();
    const button = pause();
    expect(button).toHaveAttribute("aria-controls", "home-popular-rail");
    expect(button).toHaveAttribute("type", "button");
    // A 44px target at every width (not `hidden` on phones, unlike the arrows), and hidden under reduced motion by CSS too.
    expect(button).toHaveClass("flex", "size-11", "motion-reduce:hidden");
    expect(button).not.toHaveClass("hidden");
    // Label switching, not aria-pressed too (one or the other).
    expect(button).not.toHaveAttribute("aria-pressed");

    fireEvent.click(button);
    expect(play()).toBe(button);
    wait(20_000);
    expect(scrollBy).not.toHaveBeenCalled();

    fireEvent.click(play());
    expect(pause()).toBe(button);
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("each section's button is its own", () => {
    render(
      <>
        <HomeRailSection id="home-a" title="Coming up" count={6}>
          {Array.from({ length: 6 }, (_, i) => (
            <HomeRailItem key={i}>
              <a href={`#a${i}`}>A {i}</a>
            </HomeRailItem>
          ))}
        </HomeRailSection>
        <HomeRailSection id="home-b" title="From organisers you follow" count={6}>
          {Array.from({ length: 6 }, (_, i) => (
            <HomeRailItem key={i}>
              <a href={`#b${i}`}>B {i}</a>
            </HomeRailItem>
          ))}
        </HomeRailSection>
      </>,
    );
    for (const list of screen.getAllByRole("list")) setMetrics(list, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Pause auto-scroll: Coming up" }));
    expect(screen.getByRole("button", { name: "Play auto-scroll: Coming up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause auto-scroll: From organisers you follow" })).toBeInTheDocument();
    wait(4000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.contexts[0]).toBe(screen.getByRole("list", { name: "From organisers you follow" }));
  });

  it("never moves, and has no button, for people who prefer reduced motion", () => {
    stubMotion(false);
    renderOverflowing();
    expect(toggle()).toBeNull();
    // The arrows stay.
    expect(screen.getByRole("button", { name: "Next events: Popular right now" })).toBeInTheDocument();
    wait(20_000);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("the server render has the button for a long rail (so the head doesn't shift), hidden by CSS under reduced motion", () => {
    const html = renderToString(
      <HomeRailSection id="home-popular" title="Popular right now" count={6}>
        <HomeRailItem>
          <a href="#e">Event</a>
        </HomeRailItem>
      </HomeRailSection>,
    );
    expect(html).toContain('aria-label="Pause auto-scroll: Popular right now"');
    expect(html).toMatch(/data-rail-autoscroll-toggle=""[^>]*class="[^"]*motion-reduce:hidden/);
  });

  it("never runs on a pair (one or two cards), even when it overflows on a narrow screen", () => {
    renderSection(2);
    setMetrics(rail(), { scrollWidth: 700, clientWidth: 390, scrollLeft: 0 });
    // The arrows arrive (it overflows), the auto-scroll doesn't.
    expect(screen.getByRole("button", { name: "Next events: Popular right now" })).toBeInTheDocument();
    expect(toggle()).toBeNull();
    wait(20_000);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("never runs on a rail that doesn't overflow", () => {
    renderSection(4);
    setMetrics(rail(), { scrollWidth: 1280, clientWidth: 1280, scrollLeft: 0 });
    expect(toggle()).toBeNull();
    wait(20_000);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("leaves no timer behind when it unmounts", () => {
    const { unmount } = renderOverflowing();
    wait(1000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    wait(20_000);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
