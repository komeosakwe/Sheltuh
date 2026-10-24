"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useMotionOk } from "@/components/ui/useMotionOk";
import { nearestCardLeft } from "./RailArrows";
import { RAIL_CLONE_ATTR } from "./RailItem";

/**
 * The drift's speed: the original DICE-style carousel's (components/ui/Carousel.tsx,
 * 29 Sep to 22 Oct 2026; owner, 23 Oct 2026: "as smooth as the very initial one").
 */
export const DRIFT_PX_PER_SEC = 60;
/** A long frame (a busy main thread) never moves it further than this much time would. */
const MAX_FRAME_MS = 100;
/** After the pointer leaves the rail or keyboard focus leaves the section, it carries on this soon (the original's). */
export const POINTER_RESUME_MS = 600;
/** After a touch that didn't scroll the rail (a tap, the page scrolling past), it carries on this soon (the original's). */
export const TOUCH_RESUME_MS = 2500;
/** A rail that can scroll less than this doesn't overflow (sub-pixel layout). */
const EDGE = 4;
/** A rail position this close to the drift's last write is the drift's own (engines round `scrollLeft`). */
const OWN_SCROLL_SLACK = 1.5;
/** A rail scroll this soon after a key press in the section is the visitor's (Tab bringing a card into view, arrow keys). */
const KEY_SCROLL_WINDOW = 800;
/** Handing over: the rail counts as at rest at `scrollend`, or this long after its last scroll event (engines without `scrollend`). */
export const REST_MS = 150;
/** Handing over: the glide onto a card counts as done after this long if the rail never reports scrolling. */
export const SETTLE_MS = 1000;
/** Sub-pixel layout: a position this close to a seam counts as on it. */
const SEAM_SLACK = 0.5;
/** Marks the Pause/Play button: focus on it never pauses (so Play from the keyboard plays). */
export const AUTO_SCROLL_TOGGLE_ATTR = "data-rail-autoscroll-toggle";

/** Scroll snapping off: the drift moves a fraction of a pixel at a time, and mandatory snap would pull it back to a card. */
function snapOff(el: HTMLElement) {
  el.style.scrollSnapType = "none";
}
/** The rail's own snapping (HomeRail's classes) again. */
function snapOn(el: HTMLElement | null) {
  if (el) el.style.scrollSnapType = "";
}

function railCards(rail: HTMLElement): HTMLLIElement[] {
  return Array.from(rail.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement);
}
const isCopy = (li: Element) => li.hasAttribute(RAIL_CLONE_ATTR);

/**
 * How many copies of a rail's cards its endless loop needs: enough that the
 * cards always fill the rail's width past the loop's seam (one set wider
 * than the rail: one copy). 0 when nothing has a size yet (no layout).
 */
export function loopCopiesNeeded(rail: HTMLElement): number {
  const cards = railCards(rail).filter((li) => !isCopy(li));
  const first = cards[0];
  const last = cards[cards.length - 1];
  if (!first || !last || !(rail.clientWidth > 0)) return 0;
  const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
  const set = last.getBoundingClientRect().right - first.getBoundingClientRect().left + gap;
  return set > 0 ? Math.max(1, Math.ceil(rail.clientWidth / set)) : 0;
}

/**
 * Where a looping rail's seam is, in `scrollLeft` terms: `start`, the first
 * real card's offset (the rail's start inset); `period`, one set of cards
 * with its gaps (the real cards' first to the first copy's); `end`, where
 * the last copy's set ends. A rail at `left` and at `left - period` shows
 * exactly the same thing while `left - period >= start` and its view ends
 * by `end`. Null without copies or layout.
 */
export interface RailLoop {
  start: number;
  period: number;
  end: number;
}
export function railLoop(rail: HTMLElement): RailLoop | null {
  const cards = railCards(rail);
  const first = cards.find((li) => !isCopy(li));
  const firstCopy = cards.find(isCopy);
  if (!first || !firstCopy) return null;
  const firstLeft = first.getBoundingClientRect().left;
  const period = firstCopy.getBoundingClientRect().left - firstLeft;
  if (!(period > 0)) return null;
  const sets = cards.length / cards.filter((li) => !isCopy(li)).length;
  const start = rail.scrollLeft + firstLeft - (rail.getBoundingClientRect().left + rail.clientLeft);
  return { start, period, end: start + sets * period };
}

/**
 * A rail whose view is wholly in the copies moves back one set, onto the
 * real cards: the same picture, so nothing visibly moves.
 */
function backIntoRealCards(rail: HTMLElement, loop: RailLoop) {
  const left = rail.scrollLeft;
  if (left >= loop.start + loop.period - SEAM_SLACK && left + rail.clientWidth <= loop.end + SEAM_SLACK) {
    rail.scrollLeft = left - loop.period;
  }
}
/** No copy is in view: taking them away changes nothing on screen (and the rail's position stays in range). */
function copiesOutOfView(rail: HTMLElement, loop: RailLoop): boolean {
  return rail.scrollLeft + rail.clientWidth <= loop.start + loop.period + SEAM_SLACK;
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
 * start; `held`, that a finger or press is already down. `atRest` runs when
 * the rail first comes to rest, before the glide (the loop moves it back
 * onto the real cards there); `settled` once it's on a card, just before
 * snapping comes back on. Returns a cancel (leaving snapping as it is).
 */
export function settleOnCard(
  rail: HTMLElement,
  firstWait = REST_MS,
  held = false,
  { atRest: onRest, settled }: { atRest?: () => void; settled?: () => void } = {},
): () => void {
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
    if (!gliding) onRest?.();
    const target = nearestCardLeft(rail);
    if (gliding || Math.abs(target - rail.scrollLeft) < 1) {
      cancel();
      settled?.();
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
  /** How many copies of the cards the rail renders after the real ones (`HomeRail` `clones`). */
  clones: number;
}

/** Drifting; paused (frozen, still a marquee); or stopped, the visitor having scrolled it (an ordinary rail). */
type Mode = "drift" | "paused" | "stopped";

/**
 * A home rail as an endless marquee (owner, 24 Oct 2026, docs/design/mobile-redesign.md:
 * "make it go from one end of screen to next"), DICE-style: the cards slide
 * right to left across the full width of the screen, entering at the right
 * edge and leaving at the left, at `DRIFT_PX_PER_SEC`, for as long as it
 * runs, with no end and no way back. `clones` copies of the cards follow the
 * real ones (enough to fill the rail past the seam, usually one), rendered
 * after mount only, `aria-hidden` and `inert` (`RailItem`): no tab stops and
 * no second set of links for a screen reader. When the drift has moved one
 * set's width past the first card (`railLoop`) it subtracts that width from
 * its position: the copies look exactly like the cards they copy, so the
 * wrap is invisible and the motion never goes backwards.
 *
 * The drift is driven by requestAnimationFrame and timed by the frames'
 * clock, so it's the same speed at 60Hz or 144Hz; its position is kept as a
 * fraction and written each frame, so an engine that rounds `scrollLeft`
 * never stalls it. Scroll snapping is off while it's a marquee (it would pull
 * the rail back to a card). Only while `enabled` (the caller's rail overflows
 * and is a carousel, never a pair) and only for people who haven't asked for
 * reduced motion: otherwise the rail is static, on its first card, with no
 * copies and no button.
 *
 * It holds still (exactly where it is, carrying on from there with no jump)
 * while the pointer is over the rail, while keyboard focus (`:focus-visible`)
 * is anywhere in the section except the Pause/Play button itself, during a
 * touch on the rail, while the rail is off screen and while the tab is
 * hidden. Moving content needs a way to stop it (WCAG 2.2.2): `showControl`
 * says when to render the Pause/Play button. Pause freezes the marquee where
 * it is (copies, and snapping off, kept, so nothing moves); Play carries on
 * from that spot.
 *
 * When the visitor scrolls the rail themselves (a swipe, a sideways wheel or
 * trackpad, the keyboard, dragging a scrollbar, or an arrow via `stop`),
 * drifting or paused, it stops for the rest of the page view and becomes an
 * ordinary rail, without a jump (`settleOnCard`): once their scroll is at
 * rest, a view wholly in the copies moves back one set onto the real cards
 * (the same picture), it glides onto the nearest card and snapping comes
 * back on. The copies then go as soon as none is in view (straight away, or
 * at a later rest), since taking away cards on screen would be a jump; until
 * then they stay inert. Play starts the marquee again from where the rail
 * is. Its own writes are never mistaken for the visitor's: a scroll only
 * counts when it moves the rail away from where the drift put it, during a
 * touch, a press on the rail or just after a key press.
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
  const [mode, setMode] = useState<Mode>("drift");
  /** Copies the loop needs at this width (`loopCopiesNeeded`), once measured. */
  const [needed, setNeeded] = useState(0);
  /** Stopped, with the copies out of view: they've gone, and it's an ordinary rail. */
  const [released, setReleased] = useState(false);
  const marquee = enabled && motionOk && hydrated;
  const clones = marquee && (mode !== "stopped" || !released) ? needed : 0;
  const snapHeldOff = marquee && mode !== "stopped";
  /** Cancels a hand-over's settle onto a card while it's under way (`settleOnCard`; leaves snapping as it is). */
  const settleRef = useRef<(() => void) | null>(null);
  /** The drift's last (fractional) write, so a Play or a re-measure carries on from the exact spot. */
  const lastWriteRef = useRef<number | null>(null);

  const cancelSettle = useCallback(() => {
    settleRef.current?.();
    settleRef.current = null;
  }, []);

  // The copies go once none is in view; a view wholly in them moves back onto the real cards first.
  const tidyCopies = useCallback(() => {
    const rail = railRef.current;
    const loop = rail ? railLoop(rail) : null;
    if (!rail || !loop) return;
    backIntoRealCards(rail, loop);
    if (copiesOutOfView(rail, loop)) setReleased(true);
  }, [railRef]);

  // Off until Play. While snapping was held off (a marquee, or a settle under way), hand the
  // rail back to its snapping without a jump.
  const handOver = useCallback(
    (firstWait: number, held = false) => {
      const wasSettling = settleRef.current !== null;
      cancelSettle();
      setMode("stopped");
      const rail = railRef.current;
      if (!rail || !(snapHeldOff || wasSettling)) return;
      let done = false;
      const cancel = settleOnCard(rail, firstWait, held, {
        atRest: () => {
          const loop = railLoop(rail);
          if (loop) backIntoRealCards(rail, loop);
        },
        settled: () => {
          done = true;
          settleRef.current = null;
          tidyCopies();
        },
      });
      if (!done) settleRef.current = cancel;
    },
    [snapHeldOff, cancelSettle, railRef, tidyCopies],
  );
  // The visitor scrolled the rail (an arrow press, before its page scroll starts).
  const stop = useCallback(() => handOver(REST_MS), [handOver]);
  // Pause freezes the marquee where it is; Play carries on from wherever the rail is.
  const toggle = useCallback(() => {
    if (mode === "drift") {
      setMode("paused");
      return;
    }
    cancelSettle();
    setReleased(false);
    setMode("drift");
  }, [mode, cancelSettle]);

  // Nothing left waiting when the section goes.
  useEffect(() => cancelSettle, [cancelSettle]);

  // How many copies the loop needs, measured on the real cards, again whenever the rail resizes.
  useEffect(() => {
    const rail = railRef.current;
    if (!marquee || !rail) return;
    const measure = () => {
      const next = loopCopiesNeeded(rail);
      setNeeded((prev) => (prev === next ? prev : next));
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(rail);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [marquee, railRef]);

  // Snapping is off for as long as it's a marquee (drifting or paused). Handing over turns it back
  // on once the rail is at rest on a card; otherwise (reduced motion switched on, the rail no
  // longer overflowing, unmounting) it's back on now.
  useEffect(() => {
    const rail = railRef.current;
    if (!snapHeldOff || !rail) return;
    snapOff(rail);
    return () => {
      if (!settleRef.current) snapOn(rail);
    };
  }, [snapHeldOff, railRef]);

  // Stopped with the copies still in view: they go at the first rest where none is.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !marquee || mode !== "stopped" || released) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let touching = false;
    const check = () => {
      if (!touching && !settleRef.current) tidyCopies();
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(check, REST_MS);
    };
    const onScrollEnd = () => {
      clearTimeout(timer);
      check();
    };
    const onTouchStart = () => {
      touching = true;
      clearTimeout(timer);
    };
    const onTouchEnd = () => {
      touching = false;
      onScroll();
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    rail.addEventListener("scrollend", onScrollEnd);
    rail.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      clearTimeout(timer);
      rail.removeEventListener("scroll", onScroll);
      rail.removeEventListener("scrollend", onScrollEnd);
      rail.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [marquee, mode, released, railRef, tidyCopies]);

  // The marquee: frames while drifting, and while drifting or paused, watching for the visitor.
  useEffect(() => {
    const root = rootRef.current;
    const rail = railRef.current;
    if (!marquee || mode === "stopped" || !root || !rail) return;
    const drifting = mode === "drift";

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
    // The drift's position, fractional: from its own last write when the rail is still there.
    const resumed = lastWriteRef.current;
    let pos = resumed !== null && Math.abs(rail.scrollLeft - resumed) <= OWN_SCROLL_SLACK ? resumed : rail.scrollLeft;
    let lastSet = pos; // what the drift last wrote to scrollLeft
    // The seam, measured now and again when the rail resizes (no layout reads in the frames).
    let loop = railLoop(rail);
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => (loop = railLoop(rail)));
    resizeObserver?.observe(rail);

    const shouldRun = () => drifting && !hovering && !focused && !touching && !cooling && visible && !hidden;

    const frame = (now: number) => {
      const max = rail.scrollWidth - rail.clientWidth;
      if (max <= EDGE) {
        running = false;
        return;
      }
      // Moved by something other than the drift while it waited (a script, a resize): carry on from there.
      if (Math.abs(rail.scrollLeft - lastSet) > OWN_SCROLL_SLACK) pos = rail.scrollLeft;
      // The first frame after a start only reads the clock, so a resume never jumps.
      const dt = last === undefined ? 0 : Math.min(Math.max(now - last, 0), MAX_FRAME_MS);
      last = now;
      pos += (DRIFT_PX_PER_SEC * dt) / 1000;
      // One set's width past the first card: the same picture one set back. Never a step backwards on screen.
      if (loop && pos >= loop.start + loop.period) pos -= loop.period;
      pos = Math.min(pos, max);
      lastSet = pos;
      lastWriteRef.current = pos;
      rail.scrollLeft = pos;
      // No copies (no layout to measure): it stops at the end rather than spinning there.
      if (!loop && pos >= max) {
        running = false;
        return;
      }
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
      lastWriteRef.current = null;
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
      resizeObserver?.disconnect();
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
    };
  }, [marquee, mode, clones, rootRef, railRef, handOver]);

  return { showControl: enabled && (!hydrated || motionOk), playing: mode === "drift", toggle, stop, clones };
}
