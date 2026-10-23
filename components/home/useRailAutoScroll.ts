"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useMotionOk } from "@/components/ui/useMotionOk";

/** One card every 4 seconds (owner, 23 Oct 2026: "make them automatically scroll"). */
export const AUTO_SCROLL_INTERVAL = 4000;
/** Within this many pixels of the end counts as at it (sub-pixel layout and snapping). */
const EDGE = 4;
/** A rail scroll this soon after a key press in the section is the visitor's (Tab bringing a card into view, arrow keys). */
const KEY_SCROLL_WINDOW = 800;
/** Without a measurable card (no layout yet), step by most of the rail's width. */
const STEP_FRACTION = 0.8;
/** Marks the Pause/Play button: focus on it never pauses (so Play from the keyboard plays). */
export const AUTO_SCROLL_TOGGLE_ATTR = "data-rail-autoscroll-toggle";

/** One card's step: its width plus the gap, so a start-aligned rail lands on the next card's start. */
export function railCardStep(el: HTMLElement): number {
  const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
  const card = el.querySelector("li")?.getBoundingClientRect().width ?? 0;
  return card > 0 ? card + gap : el.clientWidth * STEP_FRACTION;
}

/**
 * Moves a rail on by one card, smoothly (mandatory snap settles it on the
 * card's start); at the end, smoothly back to the start. The cards are the
 * real ones: nothing is cloned to make an endless loop.
 */
export function advanceRail(el: HTMLElement): void {
  const max = el.scrollWidth - el.clientWidth;
  if (max <= EDGE) return;
  if (el.scrollLeft >= max - EDGE) el.scrollTo({ left: 0, behavior: "smooth" });
  else el.scrollBy({ left: railCardStep(el), behavior: "smooth" });
}

/** `el.matches(selector)`, true where an old engine doesn't know the selector (treat focus as keyboard focus). */
function matchesSafe(el: Element, selector: string, fallback: boolean): boolean {
  try {
    return el.matches(selector);
  } catch {
    return fallback;
  }
}

const noSubscribe = () => () => {};
/** False on the server and during hydration, true after: the first client render matches the server's. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

export interface RailAutoScroll {
  /** Render the Pause/Play button (see `useRailAutoScroll`). */
  showControl: boolean;
  /** Auto-scroll is on: the button offers Pause. Off (paused, or the visitor scrolled): it offers Play. */
  playing: boolean;
  /** The Pause/Play button's action. */
  toggle: () => void;
  /** The visitor scrolled the rail themselves (e.g. an arrow press): off until Play. */
  stop: () => void;
}

/**
 * A home rail that scrolls itself (owner, 23 Oct 2026, docs/design/mobile-redesign.md):
 * every `AUTO_SCROLL_INTERVAL` it moves on by one card, left to right, and at
 * the end it scrolls back to the start. Only while `enabled` (the caller's
 * rail overflows and is a carousel, never a desktop pair grid) and only for
 * people who haven't asked for reduced motion.
 *
 * It holds still while the pointer is over the rail, while keyboard focus
 * (`:focus-visible`) is anywhere in the section except the Pause/Play button
 * itself, during a touch on the rail, while the rail is off screen and while
 * the tab is hidden, and the 4 seconds start again when that ends. When the
 * visitor scrolls the rail themselves (a swipe, a sideways wheel or
 * trackpad, the keyboard, or an arrow via `stop`) it stops for the rest of
 * the page view; Play starts it again. Moving content needs a way to stop it
 * (WCAG 2.2.2): `showControl` says when to render the Pause/Play button.
 *
 * `showControl` is true in the server render and hydration for a carousel
 * (the server can't know the motion preference, so the button keeps its
 * place in the head and nothing shifts; CSS `motion-reduce:hidden` hides it
 * meanwhile), then only where motion is welcome.
 *
 * `rootRef` is the section (focus and key presses), `railRef` the scroller.
 */
export function useRailAutoScroll({
  rootRef,
  railRef,
  enabled,
}: {
  rootRef: RefObject<HTMLElement | null>;
  railRef: RefObject<HTMLElement | null>;
  enabled: boolean;
}): RailAutoScroll {
  const motionOk = useMotionOk();
  const hydrated = useHydrated();
  const [playing, setPlaying] = useState(true);
  const stop = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((on) => !on), []);
  const active = enabled && motionOk && playing;

  useEffect(() => {
    const root = rootRef.current;
    const rail = railRef.current;
    if (!active || !root || !rail) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const isToggle = (el: Element) => el.closest(`[${AUTO_SCROLL_TOGGLE_ATTR}]`) !== null;
    const keyboardFocused = (el: Element | null) =>
      el instanceof Element && root.contains(el) && !isToggle(el) && matchesSafe(el, ":focus-visible", true);
    let hovering = matchesSafe(rail, ":hover", false);
    let focused = keyboardFocused(document.activeElement);
    let touching = false;
    let visible = typeof IntersectionObserver === "undefined";
    let hidden = document.visibilityState === "hidden";
    let lastKey = -Infinity;

    // The 4 seconds start again whenever a pause ends.
    function schedule() {
      clearTimeout(timer);
      timer = undefined;
      if (!hovering && !focused && !touching && visible && !hidden) timer = setTimeout(tick, AUTO_SCROLL_INTERVAL);
    }
    function tick() {
      if (rail) advanceRail(rail);
      schedule();
    }
    function userScrolled() {
      clearTimeout(timer);
      timer = undefined;
      setPlaying(false);
    }

    // A mouse or pen over the rail. Touch has its own handling (a tap fires pointerenter too).
    const onPointerEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovering = true;
      schedule();
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovering = false;
      schedule();
    };
    // Keyboard focus only: a click focuses a button too, and Play must not stop itself.
    const onFocusIn = (event: FocusEvent) => {
      focused = keyboardFocused(event.target instanceof Element ? event.target : null);
      schedule();
    };
    const onFocusOut = (event: FocusEvent) => {
      // The next focusin (if focus stays in the section) sets it again.
      focused = false;
      if (!(event.relatedTarget instanceof Element && root.contains(event.relatedTarget))) schedule();
    };
    const onKeyDown = () => {
      lastKey = Date.now();
    };
    const onTouchStart = () => {
      touching = true;
      schedule();
    };
    const onTouchEnd = () => {
      touching = false;
      schedule();
    };
    // The rail moving during a touch (a swipe) or straight after a key press is the visitor's doing.
    // Its own smooth steps happen with no touch and no key, so they never count.
    const onScroll = () => {
      if (touching || Date.now() - lastKey < KEY_SCROLL_WINDOW) userScrolled();
    };
    // A sideways wheel or trackpad swipe (shift + wheel too); a vertical one just scrolls the page past.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || (event.shiftKey && event.deltaY !== 0)) userScrolled();
    };
    const onVisibility = () => {
      hidden = document.visibilityState === "hidden";
      schedule();
    };

    rail.addEventListener("pointerenter", onPointerEnter);
    rail.addEventListener("pointerleave", onPointerLeave);
    rail.addEventListener("touchstart", onTouchStart, { passive: true });
    rail.addEventListener("touchend", onTouchEnd, { passive: true });
    rail.addEventListener("touchcancel", onTouchEnd, { passive: true });
    rail.addEventListener("scroll", onScroll, { passive: true });
    rail.addEventListener("wheel", onWheel, { passive: true });
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibility);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            visible = entry.isIntersecting;
            schedule();
          });
    observer?.observe(rail);
    schedule();

    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      rail.removeEventListener("pointerenter", onPointerEnter);
      rail.removeEventListener("pointerleave", onPointerLeave);
      rail.removeEventListener("touchstart", onTouchStart);
      rail.removeEventListener("touchend", onTouchEnd);
      rail.removeEventListener("touchcancel", onTouchEnd);
      rail.removeEventListener("scroll", onScroll);
      rail.removeEventListener("wheel", onWheel);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, rootRef, railRef]);

  return { showControl: enabled && (!hydrated || motionOk), playing, toggle, stop };
}
