// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeRailItem } from "@/components/home/HomeRail";
import HomeRailSection from "@/components/home/HomeRailSection";
import {
  DRIFT_PX_PER_SEC,
  END_HOLD_MS,
  POINTER_RESUME_MS,
  REST_MS,
  SETTLE_MS,
  TOUCH_RESUME_MS,
  easeInOutSine,
  returnDuration,
} from "@/components/home/useRailAutoScroll";

/**
 * The home rails' auto-scroll (owner, 23 Oct 2026: "make them automatically
 * scroll", then "as smooth as the very initial one done to simulate DICE"):
 * the original carousel's slow continuous drift, 60px a second, frame by
 * frame; at the far end a 2s hold and an eased glide back to the start;
 * held still while the visitor is busy with the rail, stopped for good when
 * they scroll it themselves, with a Pause/Play button (WCAG 2.2.2) and
 * nothing at all under reduced motion.
 *
 * jsdom has no layout, so the rail gets fake scroll metrics and 256px cards
 * laid side by side; and it has no frames, so requestAnimationFrame is
 * driven here: `run(ms, frameMs)` advances the fake timers and the frame
 * clock together, like a browser at that frame rate.
 */

const CARD = 256;
const MAX = 2000; // scrollWidth 3000 less clientWidth 1000

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
const snap = () => rail().style.scrollSnapType;

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

/** A long rail, overflowing, at `scrollLeft`, after its first frame (which only reads the clock). */
function renderOverflowing(scrollLeft = 0) {
  const view = renderSection(6);
  setMetrics(rail(), { scrollWidth: 3000, clientWidth: 1000, scrollLeft });
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
  // Cards side by side from the rail's start inset (jsdom's list padding, 40px), moving as it scrolls.
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

describe("home rail auto-scroll: the drift", () => {
  it("drifts continuously, 60px a second, a little every frame (no card steps), with snapping off", () => {
    renderOverflowing();
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

  it("at the far end holds 2 seconds, glides back to the start in one eased movement, then drifts on (no cloned cards)", () => {
    renderOverflowing(MAX - 30);
    const cards = screen.getAllByRole("listitem").length;
    run(512);
    expect(rail().scrollLeft).toBe(MAX);
    run(END_HOLD_MS - 600);
    expect(rail().scrollLeft).toBe(MAX);

    // The glide: gentle at first, quicker in the middle, always heading back, never a jump.
    const glide: number[] = [];
    run(END_HOLD_MS, 16, () => glide.push(rail().scrollLeft));
    const start = glide.findIndex((left) => left < MAX);
    expect(start).toBeGreaterThan(0);
    const back = glide.slice(start);
    const steps = back.slice(1).map((left, i) => left - back[i]);
    expect(steps.every((d) => d < 0)).toBe(true);
    const fastest = Math.max(...steps.map(Math.abs));
    expect(Math.abs(steps[0])).toBeLessThan(fastest / 4);
    expect(fastest).toBeLessThan(30);
    expect(returnDuration(MAX)).toBe(2000);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5);

    run(700);
    const atStart = rail().scrollLeft;
    expect(atStart).toBeLessThan(10);
    run(512);
    expectNear(rail().scrollLeft, atStart + 30);
    expect(screen.getAllByRole("listitem")).toHaveLength(cards);
    expect(scrollTo).not.toHaveBeenCalled();
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
  ])("stops for the rest of the page view, then settles on a card with snapping back on: %s", (_label, scrollIt) => {
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
    glideTo(nearest);
    expect(snap()).toBe("");
    const left = rail().scrollLeft;
    run(20_000);
    expect(rail().scrollLeft).toBe(left);
    // Play starts it again, from there.
    fireEvent.click(play());
    expect(pause()).toBeInTheDocument();
    expect(snap()).toBe("none");
    run(1024);
    expectNear(rail().scrollLeft, left + 60);
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
    // Three whole 256px cards fit (1000px less jsdom's 40px list inset), from card 0's start.
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

  it("isn't stopped by a vertical wheel over the rail (the page scrolling past)", () => {
    renderOverflowing();
    fireEvent.wheel(rail(), { deltaX: 0, deltaY: 80 });
    run(1008);
    expect(pause()).toBeInTheDocument();
    expectNear(rail().scrollLeft, 60);
  });
});

describe("home rail auto-scroll: Pause/Play", () => {
  it("Pause stops it and settles it smoothly on the nearest card, then snapping comes back; Play restarts it", () => {
    renderOverflowing();
    run(2000); // about 120px along: the nearest card start is 0 (256 is further)
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
    expect(framesPending()).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: "smooth" });
    // Snapping stays off while it glides there, so nothing fights it, and comes back when it lands.
    expect(snap()).toBe("none");
    glideTo(0);
    expect(snap()).toBe("");
    run(10_000);
    expect(rail().scrollLeft).toBe(0);

    fireEvent.click(play());
    expect(pause()).toBe(button);
    expect(snap()).toBe("none");
    run(1024);
    expectNear(rail().scrollLeft, 60);
  });

  it("Pause past a card's middle settles on the next card; without a scrollend event, snapping comes back anyway", () => {
    renderOverflowing(200);
    fireEvent.click(pause());
    expect(scrollTo).toHaveBeenCalledWith({ left: CARD, behavior: "smooth" });
    run(SETTLE_MS - 16);
    expect(snap()).toBe("none");
    run(16);
    expect(snap()).toBe("");
  });

  it("Pause on a card's start just turns snapping back on", () => {
    renderOverflowing(CARD);
    fireEvent.click(pause());
    expect(scrollTo).not.toHaveBeenCalled();
    expect(snap()).toBe("");
  });

  it("Play at the far end glides straight back to the start", () => {
    renderOverflowing(CARD);
    fireEvent.click(pause());
    rail().scrollLeft = MAX; // the visitor went to the end
    fireEvent.click(play());
    run(512);
    expect(rail().scrollLeft).toBeLessThan(MAX);
    // Back at the start within the glide's time, and drifting on from there.
    run(returnDuration(MAX) - 512);
    expect(rail().scrollLeft).toBeLessThan(5);
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
    for (const list of [a, b]) setMetrics(list, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Pause auto-scroll: Coming up" }));
    expect(screen.getByRole("button", { name: "Play auto-scroll: Coming up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause auto-scroll: From organisers you follow" })).toBeInTheDocument();
    run(1024);
    expect(a.scrollLeft).toBe(0);
    expectNear(b.scrollLeft, 60);
  });
});

describe("home rail auto-scroll: where it never runs", () => {
  it("never moves, and has no button, for people who prefer reduced motion", () => {
    stubMotion(false);
    renderOverflowing();
    expect(toggle()).toBeNull();
    // The arrows stay.
    expect(screen.getByRole("button", { name: "Next events: Popular right now" })).toBeInTheDocument();
    expect(framesPending()).toBe(0);
    run(5000);
    expect(rail().scrollLeft).toBe(0);
    expect(snap()).toBe("");
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
    run(5000);
    expect(rail().scrollLeft).toBe(0);
    expect(snap()).toBe("");
  });

  it("never runs on a rail that doesn't overflow", () => {
    renderSection(4);
    setMetrics(rail(), { scrollWidth: 1280, clientWidth: 1280, scrollLeft: 0 });
    expect(toggle()).toBeNull();
    run(5000);
    expect(rail().scrollLeft).toBe(0);
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

  it("leaves no timer behind when it unmounts during Pause's settle", () => {
    const { unmount } = renderOverflowing(100);
    fireEvent.click(pause());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(framesPending()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
