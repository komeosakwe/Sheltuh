"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useMotionOk } from "@/components/ui/useMotionOk";
import { nearestCardLeft } from "./RailArrows";

/**
 * The drift's speed: the original DICE-style carousel's (components/ui/Carousel.tsx,
 * 29 Sep to 22 Oct 2026; owner, 23 Oct 2026: "as smooth as the very initial one").
 */
export const DRIFT_PX_PER_SEC = 60;
/** At the far end it holds this long, then glides back to the start and drifts on. */
export const END_HOLD_MS = 2000;
/** The glide back: about this fast on average, eased in and out, and never shorter or longer than these. */
const RETURN_PX_PER_SEC = 1000;
export const RETURN_MIN_MS = 1200;
export const RETURN_MAX_MS = 2400;
/** A long frame (a busy main thread) never moves it further than this much time would. */
const MAX_FRAME_MS = 100;
/** After the pointer leaves the rail or keyboard focus leaves the section, it carries on this soon (the original's). */
export const POINTER_RESUME_MS = 600;
/** After a touch that didn't scroll the rail (a tap, the page scrolling past), it carries on this soon (the original's). */
export const TOUCH_RESUME_MS = 2500;
/** Within this many pixels of the end counts as at it (sub-pixel layout). */
const EDGE = 4;
/** A rail position this close to the drift's last write is the drift's own (engines round `scrollLeft`). */
const OWN_SCROLL_SLACK = 1.5;
/** A rail scroll this soon after a key press in the section is the visitor's (Tab bringing a card into view, arrow keys). */
const KEY_SCROLL_WINDOW = 800;
/** Handing over: the rail counts as at rest at `scrollend`, or this long after its last scroll event (engines without `scrollend`). */
export const REST_MS = 150;
/** Handing over: the glide onto a card counts as done after this long if the rail never reports scrolling. */
export const SETTLE_MS = 1000;
/** Marks the Pause/Play button: focus on it never pauses (so Play from the keyboard plays). */
export const AUTO_SCROLL_TOGGLE_ATTR = "data-rail-autoscroll-toggle";

/** Gentle in, gentle out: the glide back to the start. */
export function easeInOutSine(t: number): number {
  return (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t)))) / 2;
}

/** How long the glide back from `distance` pixels takes. */
export function returnDuration(distance: number): number {
  return Math.min(RETURN_MAX_MS, Math.max(RETURN_MIN_MS, (distance / RETURN_PX_PER_SEC) * 1000));
}

/** Scroll snapping off: the drift moves a fraction of a pixel at a time, and mandatory snap would pull it back to a card. */
function snapOff(el: HTMLElement) {
  el.style.scrollSnapType = "none";
}
/** The rail's own snapping (HomeRail's classes) again. */
function snapOn(el: HTMLElement | null) {
  if (el) el.style.scrollSnapType = "";
}

/**
 * Hands a drifting rail back to its own snapping without a jump. Turning
 * mandatory snapping back on between two cards makes the engine jump to one
 * at once (Chromium does), so snapping stays off while the visitor's scroll
 * (a swipe, a wheel, an arrow's page, the keys) plays out; once the rail is
 * at rest (`scrollend`, or `REST_MS` with no scroll event, never while a
 * finger or a scrollbar press is still down) it glides smoothly onto the
 * nearest card, then snapping comes back on there, where it has nothing left
 * to move. `firstWait` is how long to wait for a scroll that may be about to
 * start (Pause: none); `held`, that a finger or press is already down.
 * Returns a cancel (leaving snapping as it is).
 */
export function settleOnCard(rail: HTMLElement, firstWait = REST_MS, held = false): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let holding = held; // a finger, or a mouse press on the rail itself, is down
  let gliding = false;
  // Where the rail was when this phase (the visitor's scroll, then the glide) began, and whether
  // it has moved since. The drift's last write can still report a scroll and a scrollend just
  // after the hand-over; those leave the rail where it was, so they're not taken for the end of
  // the scroll that's about to start (an arrow's page).
  let from = rail.scrollLeft;
  let moved = false;

  const wait = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(atRest, ms);
  };
  function atRest() {
    if (holding) return;
    const target = nearestCardLeft(rail);
    if (gliding || Math.abs(target - rail.scrollLeft) < 1) {
      cancel();
      snapOn(rail);
      return;
    }
    gliding = true;
    from = rail.scrollLeft;
    moved = false;
    rail.scrollTo({ left: target, behavior: "smooth" });
    wait(SETTLE_MS);
  }
  const onScroll = () => {
    if (!moved && Math.abs(rail.scrollLeft - from) <= OWN_SCROLL_SLACK) return;
    moved = true;
    wait(REST_MS);
  };
  const onScrollEnd = () => {
    if (!moved) return;
    clearTimeout(timer);
    atRest();
  };
  const onDown = (event: Event) => {
    if (event.type === "touchstart" || event.target === rail) {
      holding = true;
      clearTimeout(timer);
    }
  };
  const onUp = () => {
    if (!holding) return;
    holding = false;
    wait(REST_MS);
  };
  function cancel() {
    clearTimeout(timer);
    rail.removeEventListener("scroll", onScroll);
    rail.removeEventListener("scrollend", onScrollEnd);
    rail.removeEventListener("touchstart", onDown);
    rail.removeEventListener("pointerdown", onDown);
    window.removeEventListener("touchend", onUp);
    window.removeEventListener("touchcancel", onUp);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  }

  rail.addEventListener("scroll", onScroll, { passive: true });
  rail.addEventListener("scrollend", onScrollEnd);
  rail.addEventListener("touchstart", onDown, { passive: true });
  rail.addEventListener("pointerdown", onDown);
  window.addEventListener("touchend", onUp, { passive: true });
  window.addEventListener("touchcancel", onUp, { passive: true });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  if (holding) return cancel;
  if (firstWait > 0) wait(firstWait);
  else atRest();
  return cancel;
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
 * A home rail that drifts by itself (owner, 23 Oct 2026, docs/design/mobile-redesign.md),
 * the way the original DICE-style carousel did: a slow, continuous slide of
 * `DRIFT_PX_PER_SEC`, driven by requestAnimationFrame and timed by the
 * frames' clock, so it's the same speed at 60Hz or 144Hz. Its position is
 * kept as a fraction and written each frame, so an engine that rounds
 * `scrollLeft` never stalls it. Scroll snapping is off while it drifts (it
 * would pull the rail back to a card) and comes back when the visitor takes
 * over or presses Pause, once the rail has come to rest on a card
 * (`settleOnCard`), so it never jumps. At the far end it holds for `END_HOLD_MS`, glides
 * back to the start in one eased movement (`easeInOutSine`, `returnDuration`)
 * and drifts on. The cards are the real ones: nothing is cloned to make an
 * endless loop. Only while `enabled` (the caller's rail overflows and is a
 * carousel, never a desktop pair grid) and only for people who haven't asked
 * for reduced motion.
 *
 * It holds still (exactly where it is, carrying on from there with no jump)
 * while the pointer is over the rail, while keyboard focus (`:focus-visible`)
 * is anywhere in the section except the Pause/Play button itself, during a
 * touch on the rail, while the rail is off screen and while the tab is
 * hidden. When the visitor scrolls the rail themselves (a swipe, a sideways
 * wheel or trackpad, the keyboard, dragging a scrollbar, or an arrow via
 * `stop`) it stops for the rest of the page view; Play starts it again. Its
 * own writes are never mistaken for the visitor's: a scroll only counts when
 * it moves the rail away from where the drift put it, during a touch, a press
 * on the rail or just after a key press. Moving content needs a way to stop
 * it (WCAG 2.2.2): `showControl` says when to render the Pause/Play button;
 * Pause glides the rail onto the nearest card and stops there.
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
  const active = enabled && motionOk && playing;
  /** Cancels a hand-over's settle onto a card while it's under way (`settleOnCard`; leaves snapping as it is). */
  const settleRef = useRef<(() => void) | null>(null);

  const cancelSettle = useCallback(() => {
    settleRef.current?.();
    settleRef.current = null;
  }, []);

  // Off until Play. While it was drifting, hand the rail back to its snapping without a jump.
  const handOver = useCallback(
    (firstWait: number, held = false) => {
      cancelSettle();
      setPlaying(false);
      const rail = railRef.current;
      if (rail && active) settleRef.current = settleOnCard(rail, firstWait, held);
    },
    [active, cancelSettle, railRef],
  );
  // The visitor scrolled the rail (an arrow press, before its page scroll starts).
  const stop = useCallback(() => handOver(REST_MS), [handOver]);
  // Pause settles on the nearest card straight away; Play starts the drift from wherever the rail is.
  const toggle = useCallback(() => {
    if (playing) handOver(0);
    else setPlaying(true);
  }, [playing, handOver]);

  // Nothing left waiting when the section goes.
  useEffect(() => cancelSettle, [cancelSettle]);

  useEffect(() => {
    const root = rootRef.current;
    const rail = railRef.current;
    if (!active || !root || !rail) return;
    // Play during a hand-over's settle: the drift takes over from wherever the rail is.
    cancelSettle();
    snapOff(rail);

    const isToggle = (el: Element) => el.closest(`[${AUTO_SCROLL_TOGGLE_ATTR}]`) !== null;
    const keyboardFocused = (el: Element | null) =>
      el instanceof Element && root.contains(el) && !isToggle(el) && matchesSafe(el, ":focus-visible", true);
    let hovering = matchesSafe(rail, ":hover", false);
    let focused = keyboardFocused(document.activeElement);
    let touching = false;
    let pressing = false; // a mouse button down on the rail itself (its scrollbar, where one shows)
    let cooling = false; // the moment after a hold ends, before it carries on
    let visible = typeof IntersectionObserver === "undefined";
    let hidden = document.visibilityState === "hidden";
    let lastKey = -Infinity;
    let coolTimer: ReturnType<typeof setTimeout> | undefined;

    let raf = 0;
    let running = false;
    let last: number | undefined; // the previous frame's time; unset until the first frame after a start
    let pos = rail.scrollLeft; // the drift's position, fractional
    let lastSet = pos; // what the drift last wrote to scrollLeft
    let phase: "drift" | "hold" | "return" = "drift";
    let heldFor = 0;
    let returnFrom = 0;
    let returnFor = 0;
    let returnMs = RETURN_MIN_MS;

    const maxScroll = () => rail.scrollWidth - rail.clientWidth;
    const beginReturn = () => {
      phase = "return";
      returnFrom = pos;
      returnFor = 0;
      returnMs = returnDuration(pos);
    };
    // Play at the far end: straight into the glide back, not another hold.
    if (maxScroll() > EDGE && pos >= maxScroll() - EDGE) beginReturn();

    const shouldRun = () => !hovering && !focused && !touching && !cooling && visible && !hidden;

    const frame = (now: number) => {
      const max = maxScroll();
      if (max <= EDGE) {
        running = false;
        return;
      }
      // Moved by something other than the drift while it waited (a script, a resize): carry on from there.
      if (Math.abs(rail.scrollLeft - lastSet) > OWN_SCROLL_SLACK) pos = rail.scrollLeft;
      // The first frame after a start only reads the clock, so a resume never jumps.
      const dt = last === undefined ? 0 : Math.min(Math.max(now - last, 0), MAX_FRAME_MS);
      last = now;
      pos = Math.min(pos, max);
      if (phase === "drift") {
        pos += (DRIFT_PX_PER_SEC * dt) / 1000;
        if (pos >= max) {
          pos = max;
          phase = "hold";
          heldFor = 0;
        }
      } else if (phase === "hold") {
        heldFor += dt;
        if (heldFor >= END_HOLD_MS) beginReturn();
      } else {
        returnFor += dt;
        const t = returnFor / returnMs;
        pos = returnFrom * (1 - easeInOutSine(t));
        if (t >= 1) {
          pos = 0;
          phase = "drift";
        }
      }
      lastSet = pos;
      rail.scrollLeft = pos;
      raf = requestAnimationFrame(frame);
    };

    // The loop runs while nothing holds it, and stops (no frames at all) while something does.
    const update = () => {
      if (shouldRun()) {
        if (running) return;
        running = true;
        last = undefined;
        raf = requestAnimationFrame(frame);
      } else if (running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    };
    const coolDown = (ms: number) => {
      clearTimeout(coolTimer);
      cooling = true;
      update();
      coolTimer = setTimeout(() => {
        cooling = false;
        update();
      }, ms);
    };
    const userScrolled = () => {
      running = false;
      cancelAnimationFrame(raf);
      clearTimeout(coolTimer);
      handOver(REST_MS, touching || pressing);
    };

    // A mouse or pen over the rail. Touch has its own handling (a tap fires pointerenter too).
    const onPointerEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovering = true;
      update();
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovering = false;
      coolDown(POINTER_RESUME_MS);
    };
    // A press on the rail itself, not on a card: its scrollbar, where an engine shows one.
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.target === rail) pressing = true;
    };
    const onPointerUp = () => {
      pressing = false;
    };
    // Keyboard focus only: a click focuses a button too, and Play must not stop itself.
    const onFocusIn = (event: FocusEvent) => {
      focused = keyboardFocused(event.target instanceof Element ? event.target : null);
      update();
    };
    const onFocusOut = (event: FocusEvent) => {
      // The next focusin (if focus stays in the section) sets it again.
      focused = false;
      if (!(event.relatedTarget instanceof Element && root.contains(event.relatedTarget))) coolDown(POINTER_RESUME_MS);
    };
    const onKeyDown = () => {
      lastKey = Date.now();
    };
    const onTouchStart = () => {
      touching = true;
      update();
    };
    const onTouchEnd = () => {
      touching = false;
      coolDown(TOUCH_RESUME_MS);
    };
    // The rail moving away from where the drift put it during a touch (a swipe), a press on its
    // scrollbar or straight after a key press is the visitor's doing. The drift's own writes land
    // where it put them, so they never count.
    const onScroll = () => {
      if (Math.abs(rail.scrollLeft - lastSet) <= OWN_SCROLL_SLACK) return;
      if (touching || pressing || Date.now() - lastKey < KEY_SCROLL_WINDOW) userScrolled();
    };
    // A sideways wheel or trackpad swipe (shift + wheel too); a vertical one just scrolls the page past.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || (event.shiftKey && event.deltaY !== 0)) userScrolled();
    };
    const onVisibility = () => {
      hidden = document.visibilityState === "hidden";
      update();
    };

    rail.addEventListener("pointerenter", onPointerEnter);
    rail.addEventListener("pointerleave", onPointerLeave);
    rail.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
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
            update();
          });
    observer?.observe(rail);
    update();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearTimeout(coolTimer);
      observer?.disconnect();
      rail.removeEventListener("pointerenter", onPointerEnter);
      rail.removeEventListener("pointerleave", onPointerLeave);
      rail.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      rail.removeEventListener("touchstart", onTouchStart);
      rail.removeEventListener("touchend", onTouchEnd);
      rail.removeEventListener("touchcancel", onTouchEnd);
      rail.removeEventListener("scroll", onScroll);
      rail.removeEventListener("wheel", onWheel);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
      // Handing over turns snapping back on when the rail is at rest on a card. Otherwise
      // (reduced motion switched on, the rail no longer overflowing, unmounting) it's back on now.
      if (!settleRef.current) snapOn(rail);
    };
  }, [active, rootRef, railRef, cancelSettle, handOver]);

  return { showControl: enabled && (!hydrated || motionOk), playing, toggle, stop };
}
