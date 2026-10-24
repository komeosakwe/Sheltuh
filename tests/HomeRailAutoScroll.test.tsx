// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeRailItem } from "@/components/home/HomeRail";
import HomeRailSection from "@/components/home/HomeRailSection";
import { DRIFT_PX_PER_SEC, POINTER_RESUME_MS, REST_MS, SETTLE_MS, TOUCH_RESUME_MS } from "@/components/home/useRailAutoScroll";

/**
 * The home rails' auto-scroll (owner, 23 Oct 2026: "make them automatically
 * scroll", "as smooth as the very initial one done to simulate DICE"; 24 Oct
 * 2026: "make it go from one end of screen to next"): an endless marquee,
 * 60px a second, frame by frame, looping seamlessly on copies of the
 * cards with no end and no way back; held still while the visitor is busy
 * with the rail, stopped for good (an ordinary rail again) when they scroll
 * it themselves, with a Pause/Play button (WCAG 2.2.2) and nothing at all
 * under reduced motion.
 *
 * jsdom has no layout, so the rail gets fake scroll metrics and 256px cards
 * laid side by side (copies too, after the real cards); and it has no
 * frames, so requestAnimationFrame is driven here: `run(ms, frameMs)`
 * advances the fake timers and the frame clock together, like a browser at
 * that frame rate.
 */

const CARD = 256;
/** jsdom's list padding: the rail's start inset. */
const INSET = 40;
/** Stands in for the rail's end spacer. */
const END = 20;
const VIEW = 1000;
/** One set of six cards: the loop's period. */
const SET = 6 * CARD;
/** Where the loop wraps: one set past the first card. */
const SEAM = INSET + SET;

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

/** Requested frames, run by `run`: each gets the frame clock's time, as a browser passes it. */
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let clock = 0;
function stubFrames() {
  frames.clear();
  nextFrame = 1;
  clock = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => void frames.delete(id));
}
/** Lets `ms` pass in frames of `frameMs` (60Hz by default), calling `onFrame` after each. */
function run(ms: number, frameMs = 16, onFrame?: () => void) {
  act(() => {
    for (let elapsed = 0; elapsed < ms; elapsed += frameMs) {
      vi.advanceTimersByTime(frameMs);
      clock += frameMs;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(clock);
      onFrame?.();
    }
  });
}
/** Frames something (the drift) has asked for and not yet had. */
const framesPending = () => frames.size;

/** A controllable IntersectionObserver: the test says when the rail is on or off screen. */
const observers: IntersectionObserverCallback[] = [];
class FakeObserver {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(callback);
  }
  observe() {}
  disconnect() {
    const i = observers.indexOf(this.callback);
    if (i >= 0) observers.splice(i, 1);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
function setOnScreen(isIntersecting: boolean) {
  act(() => {
    for (const callback of [...observers]) callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}

/**
 * The rail's metrics: `clientWidth`, and a `scrollWidth` that follows the
 * cards in it (the inset, every card, copies too, and the end spacer) unless
 * one is given. Fires the scroll and resize a browser would.
 */
function setMetrics(el: HTMLElement, { clientWidth, scrollLeft, scrollWidth }: { clientWidth: number; scrollLeft: number; scrollWidth?: number }) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => scrollWidth ?? INSET + el.children.length * CARD + END });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  el.scrollLeft = scrollLeft;
  act(() => {
    fireEvent.scroll(el);
    window.dispatchEvent(new Event("resize"));
  });
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
const snap = () => rail().style.scrollSnapType;
/** The copies of the cards in the DOM (hidden from the accessibility tree, so not found by role). */
const copies = (list: HTMLElement = rail()) => Array.from(list.querySelectorAll(":scope > li[data-rail-clone]"));

/** `actual` within `tolerance` pixels of `expected`. */
function expectNear(actual: number, expected: number, tolerance = 1) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
}

/** jsdom never matches :focus-visible: make whatever has focus keyboard focus (as Tab would). */
function keyboardFocusMode() {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
    return selector === ":focus-visible" ? this === document.activeElement : matches.call(this, selector);
  });
}

/**
 * A rail of `count` cards (six: one set is 1536px, wider than the 1000px
 * rail), overflowing, at `scrollLeft`: measured (on the resize), its copies
 * rendered, and past its first frame (which only reads the clock).
 */
function renderOverflowing(scrollLeft = 0, count = 6, clientWidth = VIEW) {
  const view = renderSection(count);
  setMetrics(rail(), { clientWidth, scrollLeft });
  run(16);
  return view;
}

/** The rail's movement in each frame over `ms`. */
function moves(ms: number, frameMs = 16): number[] {
  const out: number[] = [];
  let previous = rail().scrollLeft;
  run(ms, frameMs, () => {
    out.push(rail().scrollLeft - previous);
    previous = rail().scrollLeft;
  });
  return out;
}
/** The browser's smooth glide arriving at `left`: scroll events on the way, then scrollend. */
function glideTo(left: number) {
  act(() => {
    rail().scrollLeft = (rail().scrollLeft + left) / 2;
    fireEvent.scroll(rail());
    rail().scrollLeft = left;
    fireEvent.scroll(rail());
    rail().dispatchEvent(new Event("scrollend"));
  });
}
/** About one 60Hz frame's worth of drift (0.96px), as every frame should move. */
const oneFrame = (d: number) => d > 0.9 && d < 1;

let scrollBy: ReturnType<typeof vi.fn>;
let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  stubFrames();
  scrollBy = vi.fn();
  scrollTo = vi.fn();
  Element.prototype.scrollBy = scrollBy as unknown as typeof Element.prototype.scrollBy;
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  // Cards side by side from the rail's start inset (jsdom's list padding), copies after the real
  // ones, moving as it scrolls.
  vi.spyOn(HTMLLIElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLLIElement) {
    const list = this.parentElement;
    const index = list ? Array.from(list.children).indexOf(this) : 0;
    const inset = list ? parseFloat(getComputedStyle(list).paddingInlineStart) || 0 : 0;
    const left = inset + index * CARD - (list?.scrollLeft ?? 0);
    return { left, right: left + CARD, width: CARD, top: 0, bottom: 300, height: 300, x: left, y: 0 } as DOMRect;
  });
  stubMotion(true);
});
afterEach(() => {
  cleanup();
  observers.length = 0;
  frames.clear();
  Reflect.deleteProperty(document, "visibilityState");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("home rail auto-scroll: the marquee", () => {
  it("drifts continuously, 60px a second, a little every frame (no card steps), with snapping off", () => {
    renderOverflowing();
    expect(getComputedStyle(rail()).paddingInlineStart).toBe(`${INSET}px`);
    expect(DRIFT_PX_PER_SEC).toBe(60);
    expect(snap()).toBe("none");
    expect(moves(1008).every(oneFrame)).toBe(true);
    expectNear(rail().scrollLeft, 60);
    run(1008);
    expectNear(rail().scrollLeft, 120);
    // Its own frames: never the browser's smooth scrolling.
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("keeps the same speed at a higher frame rate, and doesn't stall where the engine rounds scrollLeft", () => {
    renderOverflowing();
    // An engine that keeps whole pixels, at ~144Hz: 7ms frames are 0.42px each.
    let stored = rail().scrollLeft;
    Object.defineProperty(rail(), "scrollLeft", {
      configurable: true,
      get: () => stored,
      set: (value: number) => void (stored = Math.floor(value)),
    });
    run(2002, 7);
    expectNear(rail().scrollLeft, 120);
  });

  it("is timed by the clock: a long frame moves it as far as that time would, up to 100ms' worth", () => {
    renderOverflowing();
    run(50, 50);
    expect(rail().scrollLeft).toBeCloseTo(3, 5);
    run(500, 500);
    expect(rail().scrollLeft).toBeCloseTo(9, 5);
  });

  it("renders one set of copies after the real cards, aria-hidden and out of the tab order: the list's items and links are the real ones only", () => {
    renderOverflowing();
    const all = Array.from(rail().children);
    expect(all).toHaveLength(12);
    expect(copies()).toEqual(all.slice(6));
    for (const [i, copy] of copies().entries()) {
      expect(copy).toHaveAttribute("aria-hidden", "true");
      expect(copy).not.toHaveAttribute("inert");
      // Clickable like the real card (the same link), but never a tab stop.
      expect(copy.querySelector("a")).toHaveAttribute("href", `#e${i}`);
      expect(copy.querySelector("a")).toHaveAttribute("tabindex", "-1");
      expect(copy.textContent).toBe(`Event ${i}`);
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getAllByRole("link", { name: /^Event \d$/ })).toHaveLength(6);
    // The real cards are untouched.
    for (const card of all.slice(0, 6)) {
      expect(card).not.toHaveAttribute("aria-hidden");
      expect(card).not.toHaveAttribute("inert");
      expect(card.querySelector("a")).not.toHaveAttribute("tabindex");
    }
  });

  it("takes every focusable thing in a copy out of the tab order, including ones that appear later, and leaves the real cards alone", () => {
    const items = (extra: boolean) =>
      Array.from({ length: 6 }, (_, i) => (
        <HomeRailItem key={i}>
          <div>
            <a href={`#e${i}`}>Event {i}</a>
            <button type="button">Save {i}</button>
            <span tabIndex={0}>Note {i}</span>
            {extra && <a href={`#t${i}`}>Tickets {i}</a>}
          </div>
        </HomeRailItem>
      ));
    const view = render(
      <HomeRailSection id="home-popular" title="Popular right now" count={6}>
        {items(false)}
      </HomeRailSection>,
    );
    setMetrics(rail(), { clientWidth: VIEW, scrollLeft: 0 });
    const tabbable = (li: Element) =>
      Array.from(li.querySelectorAll<HTMLElement>("a[href], button, [tabindex]")).map((el) => el.getAttribute("tabindex"));
    expect(copies()).toHaveLength(6);
    for (const copy of copies()) expect(tabbable(copy)).toEqual(["-1", "-1", "-1"]);
    // A card re-rendering with a new action: in the copies it's out of the tab order too.
    view.rerender(
      <HomeRailSection id="home-popular" title="Popular right now" count={6}>
        {items(true)}
      </HomeRailSection>,
    );
    act(() => void vi.advanceTimersByTime(0));
    return Promise.resolve().then(() => {
      for (const copy of copies()) expect(tabbable(copy)).toEqual(["-1", "-1", "-1", "-1"]);
      // The real cards keep their tab stops.
      const real = Array.from(rail().children).slice(0, 6);
      for (const card of real) expect(tabbable(card)).toEqual([null, null, "0", null]);
    });
  });

  it("renders as many sets of copies as it takes to fill the rail past the seam", () => {
    // Four cards (1024px) in a 1050px rail: it overflows (the inset and end spacer), and one set of copies wouldn't fill it.
    renderOverflowing(0, 4, 1050);
    expect(copies()).toHaveLength(8);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("loops seamlessly: one set's width past the first card it moves back exactly one set, never a step backwards on screen", () => {
    renderOverflowing(SEAM - 30);
    const lefts: number[] = [rail().scrollLeft];
    run(3008, 16, () => lefts.push(rail().scrollLeft));
    const steps = lefts.slice(1).map((left, i) => left - lefts[i]);
    // Exactly one wrap in these three seconds, by exactly one set less one frame's drift.
    const wraps = steps.filter((d) => d < 0);
    expect(wraps).toHaveLength(1);
    expectNear(wraps[0] + SET, 0.96, 0.05);
    // Unwrapped, every frame is one frame's drift on: the same picture, moving steadily.
    expect(steps.map((d) => (d < 0 ? d + SET : d)).every(oneFrame)).toBe(true);
    // Never back before the first card (the inset doesn't come back): the cards fill the rail edge to edge.
    expect(Math.min(...lefts)).toBeGreaterThanOrEqual(INSET);
    // The card at the left edge only ever gives way to the next one in turn (5, then the copy of 0, shown as 0, then 1).
    const atLeft = lefts.map((left) => Math.floor((left - INSET) / CARD) % 6);
    const order = atLeft.filter((card, i) => i === 0 || card !== atLeft[i - 1]);
    expect(order).toEqual([5, 0]);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("never stops: no hold at an end and no way back, for as long as it runs", () => {
    renderOverflowing();
    let travelled = 0;
    let previous = rail().scrollLeft;
    let lowest = Infinity;
    let highest = -Infinity;
    // 30 seconds in 100ms frames (the longest a frame counts for, to keep the test quick): 1800px, past the seam.
    let wraps = 0;
    run(30_000, 100, () => {
      const d = rail().scrollLeft - previous;
      if (d < 0) wraps += 1;
      travelled += d < 0 ? d + SET : d;
      previous = rail().scrollLeft;
      lowest = Math.min(lowest, previous);
      highest = Math.max(highest, previous);
    });
    expectNear(travelled, 1800, 1);
    expect(wraps).toBe(1);
    // Always within the real cards' set and its seam: the copies are only ever shown as the seam passes.
    expect(highest).toBeLessThan(SEAM);
    expect(lowest).toBeGreaterThanOrEqual(0);
    expect(pause()).toBeInTheDocument();
  });

  it("carries on from wherever something else (a script) put the rail", () => {
    renderOverflowing();
    run(1008);
    rail().scrollLeft = 700;
    run(1008);
    expectNear(rail().scrollLeft, 760);
    expect(pause()).toBeInTheDocument();
  });
});

describe("home rail auto-scroll: holding still", () => {
  it("holds still while the pointer is over the rail (no frames at all), then carries on from the same spot without a jump", () => {
    renderOverflowing();
    run(1008);
    fireEvent.pointerEnter(rail(), { pointerType: "mouse" });
    expect(framesPending()).toBe(0);
    const held = rail().scrollLeft;
    run(10_000);
    expect(rail().scrollLeft).toBe(held);
    fireEvent.pointerLeave(rail(), { pointerType: "mouse" });
    run(POINTER_RESUME_MS);
    expect(rail().scrollLeft).toBe(held);
    expect(moves(496).every(oneFrame)).toBe(true);
    expect(pause()).toBeInTheDocument();
    // Snapping stays off through a hold: turning it on would pull the rail to a card.
    expect(snap()).toBe("none");
    expect(copies()).toHaveLength(6);
  });

  it("holds still while keyboard focus is in the rail or on its arrows, but not on Pause/Play itself", () => {
    renderOverflowing();
    keyboardFocusMode();
    act(() => screen.getByRole("link", { name: "Event 1" }).focus());
    let held = rail().scrollLeft;
    run(5000);
    expect(rail().scrollLeft).toBe(held);
    act(() => screen.getByRole("button", { name: "Next events: Popular right now" }).focus());
    run(5000);
    expect(rail().scrollLeft).toBe(held);
    // On the toggle it keeps moving, so Play from the keyboard plays.
    act(() => pause().focus());
    run(1008);
    expect(rail().scrollLeft).toBeGreaterThan(held + 50);
    held = rail().scrollLeft;
    act(() => pause().blur());
    run(POINTER_RESUME_MS + 1008);
    expect(rail().scrollLeft).toBeGreaterThan(held + 50);
  });

  it("isn't held by pointer focus (a click focuses too)", () => {
    renderOverflowing();
    act(() => screen.getByRole("link", { name: "Event 1" }).focus());
    run(1008);
    expectNear(rail().scrollLeft, 60);
  });

  it("holds still during a touch that doesn't scroll the rail (a tap, or the page scrolling past), then carries on", () => {
    renderOverflowing();
    run(1008);
    const held = rail().scrollLeft;
    fireEvent.touchStart(rail());
    run(5000);
    expect(rail().scrollLeft).toBe(held);
    fireEvent.touchEnd(rail());
    run(TOUCH_RESUME_MS);
    expect(rail().scrollLeft).toBe(held);
    run(1008);
    expectNear(rail().scrollLeft, held + 60);
    expect(pause()).toBeInTheDocument();
  });

  it("holds still while the tab is hidden", () => {
    renderOverflowing();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(framesPending()).toBe(0);
    run(5000);
    expect(rail().scrollLeft).toBe(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    run(1024);
    expectNear(rail().scrollLeft, 60);
  });

  it("holds still while the rail is off screen, and starts when it comes on", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    renderOverflowing();
    // Not reported on screen yet: nothing moves.
    run(5000);
    expect(rail().scrollLeft).toBe(0);
    setOnScreen(true);
    run(1024);
    expectNear(rail().scrollLeft, 60);
    setOnScreen(false);
    expect(framesPending()).toBe(0);
    const held = rail().scrollLeft;
    run(5000);
    expect(rail().scrollLeft).toBe(held);
  });
});

describe("home rail auto-scroll: the visitor takes over", () => {
  it.each([
    [
      "a swipe (the rail scrolls during a touch)",
      (el: HTMLElement) => {
        fireEvent.touchStart(el);
        el.scrollLeft += 120;
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
        el.scrollLeft += 40;
        fireEvent.scroll(el);
      },
    ],
    [
      "dragging a scrollbar (a press on the rail itself, then it scrolls)",
      (el: HTMLElement) => {
        fireEvent.pointerDown(el, { pointerType: "mouse" });
        el.scrollLeft += 80;
        fireEvent.scroll(el);
        fireEvent.pointerUp(window, { pointerType: "mouse" });
      },
    ],
    ["an arrow button", () => void fireEvent.click(screen.getByRole("button", { name: "Next events: Popular right now" }))],
  ])("stops for the rest of the page view, settles on a card with snapping back on, and the copies go: %s", (_label, scrollIt) => {
    renderOverflowing();
    run(1008);
    act(() => scrollIt(rail()));
    expect(play()).toBeInTheDocument();
    expect(framesPending()).toBe(0);
    // Snapping stays off while the visitor's scroll plays out (turning it on between two cards
    // would make the rail jump to one); at rest it glides onto the nearest card, and snapping
    // comes back on there.
    expect(snap()).toBe("none");
    const nearest = Math.round(rail().scrollLeft / CARD) * CARD;
    run(REST_MS + 16);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: nearest, behavior: "smooth" });
    expect(snap()).toBe("none");
    expect(copies()).toHaveLength(6);
    glideTo(nearest);
    expect(snap()).toBe("");
    // No copy in view (the rail is near the start): they go, and the rail stays exactly where it is.
    expect(copies()).toHaveLength(0);
    expect(rail().scrollLeft).toBe(nearest);
    const left = rail().scrollLeft;
    run(20_000);
    expect(rail().scrollLeft).toBe(left);
    // Play starts it again, from there, with its copies back.
    fireEvent.click(play());
    expect(pause()).toBeInTheDocument();
    expect(snap()).toBe("none");
    expect(copies()).toHaveLength(6);
    run(1024);
    expectNear(rail().scrollLeft, left + 60);
  });

  it("with copies in view, keeps them (out of the tab order) rather than jump; a view wholly in them moves back one set, and then they go", () => {
    // Straddling the seam: the last real cards on the left, the first copies on the right.
    renderOverflowing(SEAM - 300);
    fireEvent.wheel(rail(), { deltaX: 40, deltaY: 0 });
    run(REST_MS + 16);
    // The nearest card's start is card 5's (1280).
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 5 * CARD, behavior: "smooth" });
    glideTo(5 * CARD);
    expect(snap()).toBe("");
    expect(play()).toBeInTheDocument();
    // Copies in view: taking them away would change what's on screen, so they stay, still hidden and out of the tab order.
    expect(copies()).toHaveLength(6);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(rail().scrollLeft).toBe(5 * CARD);

    // The visitor swipes on, onto the second copy (wholly in the copies): one set back is the same
    // picture, so it moves there, onto the real cards, and the copies are out of view and go.
    act(() => {
      fireEvent.touchStart(rail());
      rail().scrollLeft = 7 * CARD;
      fireEvent.scroll(rail());
      fireEvent.touchEnd(window);
      rail().dispatchEvent(new Event("scrollend"));
    });
    expect(rail().scrollLeft).toBe(7 * CARD - SET);
    expect(copies()).toHaveLength(0);
    expect(framesPending()).toBe(0);
  });

  it("with copies in view, they go at a later rest once none is in view", () => {
    renderOverflowing(SEAM - 300);
    fireEvent.wheel(rail(), { deltaX: 40, deltaY: 0 });
    run(REST_MS + 16);
    glideTo(5 * CARD);
    expect(copies()).toHaveLength(6);
    // The visitor scrolls back (no scrollend from this engine: the rest is a pause in scroll events).
    act(() => {
      rail().scrollLeft = 2 * CARD;
      fireEvent.scroll(rail());
    });
    expect(copies()).toHaveLength(6);
    run(REST_MS + 16);
    expect(copies()).toHaveLength(0);
    expect(rail().scrollLeft).toBe(2 * CARD);
  });

  it("doesn't glide while the visitor's finger is still down, only once it lifts and the rail is at rest", () => {
    renderOverflowing();
    run(1008);
    fireEvent.touchStart(rail());
    rail().scrollLeft += 100;
    act(() => void fireEvent.scroll(rail()));
    expect(play()).toBeInTheDocument();
    run(5000);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(snap()).toBe("none");
    fireEvent.touchEnd(rail());
    run(REST_MS + 16);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: CARD, behavior: "smooth" });
    // No scrollend from this engine: snapping comes back on anyway once the glide has had its time.
    run(SETTLE_MS);
    expect(snap()).toBe("");
  });

  it("an arrow pressed mid-drift pages from the nearest card's start, so it lands on a card, and nothing cuts its scroll short", () => {
    renderOverflowing();
    run(1008);
    const left = rail().scrollLeft;
    fireEvent.click(screen.getByRole("button", { name: "Next events: Popular right now" }));
    // Three whole 256px cards fit (1000px less the 40px inset), from card 0's start.
    expect(scrollBy).toHaveBeenCalledWith({ left: 3 * CARD - left, behavior: "smooth" });
    expect(play()).toBeInTheDocument();
    // The drift's last write reporting in late (a scroll and a scrollend where the rail already
    // was) isn't the page scroll's end: no glide back to the nearest card from here.
    act(() => {
      fireEvent.scroll(rail());
      rail().dispatchEvent(new Event("scrollend"));
    });
    expect(scrollTo).not.toHaveBeenCalled();
    // The page scroll plays out and lands on card 3: already on a card, so snapping just comes back.
    act(() => {
      rail().scrollLeft = 400;
      fireEvent.scroll(rail());
    });
    expect(snap()).toBe("none");
    glideTo(3 * CARD);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(snap()).toBe("");
  });

  it("an arrow pressed during a hand-over's settle still leaves snapping on at the end", () => {
    renderOverflowing();
    run(1008);
    fireEvent.wheel(rail(), { deltaX: 40, deltaY: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Next events: Popular right now" }));
    act(() => {
      rail().scrollLeft = 3 * CARD;
      fireEvent.scroll(rail());
    });
    glideTo(3 * CARD);
    expect(snap()).toBe("");
  });

  it("isn't stopped by its own movement, even just after a key press in the section or during a press on the rail", () => {
    renderOverflowing();
    fireEvent.keyDown(screen.getByRole("link", { name: "All events" }), { key: "Tab" });
    fireEvent.pointerDown(rail(), { pointerType: "mouse" });
    // A scroll event for every frame the drift writes, as a browser fires them.
    run(512, 16, () => void fireEvent.scroll(rail()));
    fireEvent.pointerUp(window, { pointerType: "mouse" });
    expect(pause()).toBeInTheDocument();
    expect(snap()).toBe("none");
    expectNear(rail().scrollLeft, 30);
  });

  it("isn't stopped by its own wrap at the seam, even just after a key press in the section", () => {
    renderOverflowing(SEAM - 10);
    fireEvent.keyDown(screen.getByRole("link", { name: "All events" }), { key: "Tab" });
    run(512, 16, () => void fireEvent.scroll(rail()));
    expect(pause()).toBeInTheDocument();
    expect(rail().scrollLeft).toBeLessThan(SEAM - SET + 30);
  });

  it("isn't stopped by a vertical wheel over the rail (the page scrolling past)", () => {
    renderOverflowing();
    fireEvent.wheel(rail(), { deltaX: 0, deltaY: 80 });
    run(1008);
    expect(pause()).toBeInTheDocument();
    expectNear(rail().scrollLeft, 60);
  });
});

describe("home rail auto-scroll: Pause/Play", () => {
  it("Pause freezes the marquee exactly where it is (no settling, snapping still off, copies kept); Play carries on from there", () => {
    renderOverflowing();
    run(2000);
    const button = pause();
    expect(button).toHaveAttribute("aria-controls", "home-popular-rail");
    expect(button).toHaveAttribute("type", "button");
    // A 44px target at every width (not `hidden` on phones, unlike the arrows), and hidden under reduced motion by CSS too.
    expect(button).toHaveClass("flex", "size-11", "motion-reduce:hidden");
    expect(button).not.toHaveClass("hidden");
    // Label switching, not aria-pressed too (one or the other).
    expect(button).not.toHaveAttribute("aria-pressed");

    const held = rail().scrollLeft;
    fireEvent.click(button);
    expect(play()).toBe(button);
    expect(framesPending()).toBe(0);
    run(10_000);
    expect(rail().scrollLeft).toBe(held);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(snap()).toBe("none");
    expect(copies()).toHaveLength(6);

    fireEvent.click(play());
    expect(pause()).toBe(button);
    // The first frame only reads the clock; then on at the same speed, from the same (fractional) spot.
    run(16);
    expect(rail().scrollLeft).toBe(held);
    expect(moves(1008).every(oneFrame)).toBe(true);
    expectNear(rail().scrollLeft, held + 60);
  });

  it("Pause at the seam and Play carry on through the wrap without a jump", () => {
    renderOverflowing(SEAM - 5);
    fireEvent.click(pause());
    run(5000);
    fireEvent.click(play());
    run(16);
    const steps = moves(512);
    expect(steps.map((d) => (d < 0 ? d + SET : d)).every(oneFrame)).toBe(true);
    expect(steps.filter((d) => d < 0)).toHaveLength(1);
  });

  it("a paused rail the visitor scrolls is theirs: it settles on a card and becomes an ordinary rail", () => {
    renderOverflowing(200);
    fireEvent.click(pause());
    fireEvent.wheel(rail(), { deltaX: 40, deltaY: 0 });
    expect(play()).toBeInTheDocument();
    run(REST_MS + 16);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: CARD, behavior: "smooth" });
    glideTo(CARD);
    expect(snap()).toBe("");
    expect(copies()).toHaveLength(0);
    run(5000);
    expect(rail().scrollLeft).toBe(CARD);
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
    const [a, b] = screen.getAllByRole("list");
    for (const list of [a, b]) setMetrics(list, { clientWidth: VIEW, scrollLeft: 0 });
    run(16);
    fireEvent.click(screen.getByRole("button", { name: "Pause auto-scroll: Coming up" }));
    expect(screen.getByRole("button", { name: "Play auto-scroll: Coming up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause auto-scroll: From organisers you follow" })).toBeInTheDocument();
    run(1024);
    expect(a.scrollLeft).toBe(0);
    expectNear(b.scrollLeft, 60);
    expect(copies(a)).toHaveLength(6);
    expect(copies(b)).toHaveLength(6);
  });
});

describe("home rail auto-scroll: where it never runs", () => {
  it("never moves, and has no button and no copies, for people who prefer reduced motion", () => {
    stubMotion(false);
    renderOverflowing();
    expect(toggle()).toBeNull();
    // The arrows stay.
    expect(screen.getByRole("button", { name: "Next events: Popular right now" })).toBeInTheDocument();
    expect(framesPending()).toBe(0);
    run(5000);
    expect(rail().scrollLeft).toBe(0);
    expect(snap()).toBe("");
    expect(copies()).toHaveLength(0);
  });

  it("the server render has the button for a long rail (so the head doesn't shift), hidden by CSS under reduced motion, and no copies", () => {
    const html = renderToString(
      <HomeRailSection id="home-popular" title="Popular right now" count={6}>
        <HomeRailItem>
          <a href="#e">Event</a>
        </HomeRailItem>
      </HomeRailSection>,
    );
    expect(html).toContain('aria-label="Pause auto-scroll: Popular right now"');
    expect(html).toMatch(/data-rail-autoscroll-toggle=""[^>]*class="[^"]*motion-reduce:hidden/);
    expect(html).not.toContain("data-rail-clone");
  });

  it("never runs on a pair (one or two cards), even when it overflows on a narrow screen", () => {
    renderSection(2);
    setMetrics(rail(), { clientWidth: 390, scrollLeft: 0, scrollWidth: 700 });
    run(32);
    // The arrows arrive (it overflows), the auto-scroll doesn't.
    expect(screen.getByRole("button", { name: "Next events: Popular right now" })).toBeInTheDocument();
    expect(toggle()).toBeNull();
    run(5000);
    expect(rail().scrollLeft).toBe(0);
    expect(snap()).toBe("");
    expect(copies()).toHaveLength(0);
  });

  it("never runs on a rail that doesn't overflow", () => {
    renderSection(4);
    setMetrics(rail(), { clientWidth: 1280, scrollLeft: 0 });
    run(32);
    expect(toggle()).toBeNull();
    run(5000);
    expect(rail().scrollLeft).toBe(0);
    expect(copies()).toHaveLength(0);
  });

  it("leaves no frame or timer behind when it unmounts", () => {
    const { unmount } = renderOverflowing();
    expect(framesPending()).toBeGreaterThan(0);
    fireEvent.pointerLeave(rail(), { pointerType: "mouse" }); // a resume timer waiting
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(framesPending()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind when it unmounts during a hand-over's settle", () => {
    const { unmount } = renderOverflowing(100);
    fireEvent.wheel(rail(), { deltaX: 40, deltaY: 0 });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(framesPending()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
