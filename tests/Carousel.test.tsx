// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Carousel, { CarouselItem } from "@/components/ui/Carousel";

/** jsdom has no layout, so give the rail fake scroll metrics. */
function setMetrics(el: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: Record<string, number>) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  el.scrollLeft = scrollLeft;
}

/** The fake device the matchMedia stub answers for. */
const media = { reducedMotion: false, finePointer: true, wide: true };
const mediaListeners = new Set<() => void>();

function mediaMatches(query: string): boolean {
  // "(min-width: 40rem)": sm and up, where the events are a rail (not a list).
  if (query.includes("min-width")) return media.wide;
  // The drift's combined query matches only with a fine pointer and no
  // reduced-motion preference; the arrows ask about reduced motion on its own.
  if (query.includes("pointer: fine")) return media.finePointer && !media.reducedMotion;
  return media.reducedMotion && query.includes("prefers-reduced-motion");
}

/**
 * `finePointer` is a mouse-driven device (hover: hover, pointer: fine); `wide`
 * is a viewport at least sm (640px) wide.
 */
function stubMatchMedia(reducedMotion: boolean, finePointer = true, wide = true) {
  Object.assign(media, { reducedMotion, finePointer, wide });
  mediaListeners.clear();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return mediaMatches(query);
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
}

/** Resize across the sm breakpoint: the media queries change and say so. */
function resizeAcrossSm(wide: boolean) {
  media.wide = wide;
  act(() => mediaListeners.forEach((listener) => listener()));
}

function renderCarousel(props: { autoScroll?: boolean } = {}) {
  return render(
    <Carousel label="Events" {...props}>
      <CarouselItem>one</CarouselItem>
      <CarouselItem>two</CarouselItem>
    </Carousel>,
  );
}

beforeEach(() => {
  // Never run the animation loop for real in these tests.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  Element.prototype.scrollBy = vi.fn() as unknown as typeof Element.prototype.scrollBy;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Remove the stub so other tests see jsdom's real (absent) matchMedia.
  Reflect.deleteProperty(window, "matchMedia");
});

describe("Carousel arrows", () => {
  it("are labelled, and stay focusable (aria-disabled) at the ends", () => {
    stubMatchMedia(false);
    renderCarousel();
    const region = screen.getByRole("region", { name: "Events" });
    setMetrics(region, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0 });
    act(() => void fireEvent.scroll(region));

    const prev = screen.getByRole("button", { name: "Previous events" });
    const next = screen.getByRole("button", { name: "Next events" });
    expect(prev).toHaveAttribute("aria-disabled", "true");
    expect(prev).not.toBeDisabled(); // still in the tab order
    expect(next).toHaveAttribute("aria-disabled", "false");

    setMetrics(region, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 2000 });
    act(() => void fireEvent.scroll(region));
    expect(prev).toHaveAttribute("aria-disabled", "false");
    expect(next).toHaveAttribute("aria-disabled", "true");
  });

  it("scroll by about a screen, and do nothing when disabled", () => {
    stubMatchMedia(false);
    renderCarousel();
    const region = screen.getByRole("region", { name: "Events" });
    setMetrics(region, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0 });
    act(() => void fireEvent.scroll(region));

    fireEvent.click(screen.getByRole("button", { name: "Previous events" })); // disabled at the start
    expect(region.scrollBy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Next events" }));
    expect(region.scrollBy).toHaveBeenCalledWith({ left: 800, behavior: "smooth" });
  });

  it("jump instead of animating for people who prefer reduced motion", () => {
    stubMatchMedia(true);
    renderCarousel();
    const region = screen.getByRole("region", { name: "Events" });
    setMetrics(region, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0 });
    act(() => void fireEvent.scroll(region));
    fireEvent.click(screen.getByRole("button", { name: "Next events" }));
    expect(region.scrollBy).toHaveBeenCalledWith({ left: 800, behavior: "auto" });
  });
});

describe("Carousel auto-drift controls", () => {
  it("offers a Pause/Play button that toggles, so moving content can be stopped (WCAG 2.2.2)", () => {
    stubMatchMedia(false);
    renderCarousel({ autoScroll: true });
    const pause = screen.getByRole("button", { name: /^pause automatic scrolling/i });
    fireEvent.click(pause);
    const play = screen.getByRole("button", { name: /^play automatic scrolling/i });
    fireEvent.click(play);
    expect(screen.getByRole("button", { name: /^pause automatic scrolling/i })).toBeInTheDocument();
  });

  it("stops for good when the carousel is clicked, until Play is pressed", () => {
    stubMatchMedia(false);
    renderCarousel({ autoScroll: true });
    fireEvent.click(screen.getByRole("region", { name: "Events" }));
    expect(screen.getByRole("button", { name: /^play automatic scrolling/i })).toBeInTheDocument();
  });

  it("clicking an arrow also stops the drift", () => {
    stubMatchMedia(false);
    renderCarousel({ autoScroll: true });
    fireEvent.click(screen.getByRole("button", { name: "Next events" }));
    expect(screen.getByRole("button", { name: /^play automatic scrolling/i })).toBeInTheDocument();
  });

  it("has no drift and no Pause button for people who prefer reduced motion", () => {
    stubMatchMedia(true);
    renderCarousel({ autoScroll: true });
    expect(screen.queryByRole("button", { name: /automatic scrolling/i })).not.toBeInTheDocument();
  });

  it("has no drift and no Pause button on a coarse pointer (phones, touch screens)", () => {
    stubMatchMedia(false, false);
    renderCarousel({ autoScroll: true });
    expect(screen.queryByRole("button", { name: /automatic scrolling/i })).not.toBeInTheDocument();
  });

  it("is a keyboard-scrollable region from sm up", () => {
    stubMatchMedia(false);
    renderCarousel({ autoScroll: true });
    expect(screen.getByRole("region", { name: "Events" })).toHaveAttribute("tabindex", "0");
  });

  it("has no Pause button when auto-scroll isn't requested", () => {
    stubMatchMedia(false);
    renderCarousel();
    expect(screen.queryByRole("button", { name: /automatic scrolling/i })).not.toBeInTheDocument();
  });
});


describe("Carousel drift behaviour (animation frames stepped by hand)", () => {
  let frames: FrameRequestCallback[] = [];
  let clock = 0;
  const runFrame = (ms = 16) => {
    const pending = frames;
    frames = [];
    clock += ms;
    // In act(): a frame can change React state (e.g. the button flips to Play at the end).
    act(() => pending.forEach((cb) => cb(clock)));
  };

  class VisibleObserver {
    constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() {
      this.cb([{ isIntersecting: true }]); // on screen as soon as it's watched
    }
    disconnect() {}
  }

  const proto = HTMLElement.prototype;
  const original = {
    scrollWidth: Object.getOwnPropertyDescriptor(proto, "scrollWidth"),
    clientWidth: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
    offsetLeft: Object.getOwnPropertyDescriptor(proto, "offsetLeft"),
  };

  beforeEach(() => {
    frames = [];
    clock = 0;
    // Like a browser: each frame has an id, and cancelling it drops the callback.
    const byId = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      nextId += 1;
      byId.set(nextId, cb);
      frames.push(cb);
      return nextId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      const cb = byId.get(id);
      byId.delete(id);
      frames = frames.filter((frame) => frame !== cb);
    });
    window.IntersectionObserver = VisibleObserver as unknown as typeof IntersectionObserver;
    // A 3000px-wide rail in a 1000px window (max scroll 2000); the middle card sits at 1500px.
    Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => 3000 });
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 1000 });
    Object.defineProperty(proto, "offsetLeft", { configurable: true, get: () => 1500 });
    stubMatchMedia(false);
  });

  afterEach(() => {
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else Reflect.deleteProperty(proto, name);
    }
    Reflect.deleteProperty(window, "IntersectionObserver");
  });

  const rail = () => screen.getByRole("region", { name: "Events" });
  const wrapper = () => rail().parentElement as HTMLElement;
  const pauseButton = () => screen.getByRole("button", { name: /^pause automatic scrolling/i });
  const playButton = () => screen.getByRole("button", { name: /^play automatic scrolling/i });

  it("opens on a whole card part-way along, then slides toward the start once it is on screen", () => {
    renderCarousel({ autoScroll: true });
    expect(rail().scrollLeft).toBe(1500);
    runFrame();
    runFrame();
    expect(rail().scrollLeft).toBeLessThan(1500);
    expect(rail().scrollLeft).toBeGreaterThan(1490); // ~60px/s, one 16ms frame
  });

  it("below sm it's a plain list: no arrows, no Pause, not a tab stop, no drift", () => {
    stubMatchMedia(false, true, false);
    renderCarousel({ autoScroll: true });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(rail()).not.toHaveAttribute("tabindex");
    expect(rail().scrollLeft).toBe(0); // no jump to a middle card
    expect(frames).toHaveLength(0); // no drift loop, and no arrow-state work either
  });

  it("resizing to sm and up brings the rail back (arrows, Pause, drift), and back down removes it", () => {
    stubMatchMedia(false, true, false);
    renderCarousel({ autoScroll: true });
    resizeAcrossSm(true);
    expect(screen.getByRole("button", { name: "Next events" })).toBeInTheDocument();
    expect(pauseButton()).toBeInTheDocument();
    expect(rail().scrollLeft).toBe(1500); // opens part-way along, as on load
    runFrame();
    runFrame();
    expect(rail().scrollLeft).toBeLessThan(1500);

    resizeAcrossSm(false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    runFrame();
    expect(frames).toHaveLength(0); // the loop wound down
  });

  it("on a touch screen it opens at the first (soonest) card and never animates", () => {
    stubMatchMedia(false, false);
    renderCarousel({ autoScroll: true });
    expect(rail().scrollLeft).toBe(0);
    runFrame(); // only the one-off arrow-state frame is pending
    runFrame();
    expect(frames).toHaveLength(0);
    expect(rail().scrollLeft).toBe(0);
  });

  it("Pause ends the animation loop instead of spinning at 60fps", () => {
    renderCarousel({ autoScroll: true });
    runFrame();
    fireEvent.click(pauseButton());
    const held = rail().scrollLeft;
    runFrame();
    expect(frames).toHaveLength(0); // nothing scheduled: the loop wound down
    expect(rail().scrollLeft).toBe(held);
  });

  it("Play starts it moving again", () => {
    renderCarousel({ autoScroll: true });
    runFrame();
    fireEvent.click(pauseButton());
    runFrame();
    const held = rail().scrollLeft;
    fireEvent.click(playButton());
    expect(frames.length).toBeGreaterThan(0);
    runFrame();
    runFrame();
    expect(rail().scrollLeft).toBeLessThan(held);
  });

  it("stops at the far end for good, and the button flips to Play", () => {
    renderCarousel({ autoScroll: true });
    for (let i = 0; i < 400 && frames.length > 0; i += 1) runFrame(100);
    expect(rail().scrollLeft).toBe(0);
    expect(frames).toHaveLength(0);
    expect(playButton()).toBeInTheDocument();
  });

  it("Play at the far end replays from the other end (it doesn't instantly stop again)", () => {
    renderCarousel({ autoScroll: true });
    for (let i = 0; i < 400 && frames.length > 0; i += 1) runFrame(100);
    fireEvent.click(playButton());
    expect(rail().scrollLeft).toBe(2000);
    runFrame();
    runFrame();
    expect(rail().scrollLeft).toBeLessThan(2000);
    expect(pauseButton()).toBeInTheDocument();
  });

  it("a mouse moving over it pauses the drift, but a touch does not", () => {
    renderCarousel({ autoScroll: true });
    runFrame();
    const touch = new Event("pointermove", { bubbles: true });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    wrapper().dispatchEvent(touch);
    runFrame();
    expect(frames.length).toBeGreaterThan(0); // still drifting

    const mouse = new Event("pointermove", { bubbles: true });
    Object.defineProperty(mouse, "pointerType", { value: "mouse" });
    wrapper().dispatchEvent(mouse);
    runFrame();
    expect(frames).toHaveLength(0); // paused
  });

  it("keyboard focus inside it pauses the drift", () => {
    renderCarousel({ autoScroll: true });
    runFrame();
    vi.spyOn(rail(), "matches").mockImplementation((selector) => selector === ":focus-visible");
    fireEvent.focusIn(rail());
    runFrame();
    expect(frames).toHaveLength(0);
  });

  it("but focus from a mouse click (not :focus-visible) doesn't leave it stuck", () => {
    renderCarousel({ autoScroll: true });
    runFrame();
    vi.spyOn(rail(), "matches").mockReturnValue(false);
    fireEvent.focusIn(rail());
    runFrame();
    expect(frames.length).toBeGreaterThan(0);
  });

  it("vertical page scrolling over it never pauses it (only a sideways wheel does)", () => {
    renderCarousel({ autoScroll: true });
    runFrame();
    fireEvent.wheel(rail(), { deltaX: 0, deltaY: 120 });
    runFrame();
    expect(frames.length).toBeGreaterThan(0);
    fireEvent.wheel(rail(), { deltaX: 120, deltaY: 0 });
    runFrame();
    expect(frames).toHaveLength(0);
  });
});
