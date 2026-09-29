"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const SPEED_PX_PER_SEC = 60;
const RESUME_AFTER_MS = 2500; // after touch, keyboard or sideways scrolling
const POINTER_RESUME_MS = 600; // after the pointer leaves or focus moves away
const PAGE_FRACTION = 0.8; // an arrow click scrolls by about a screen of cards
/** Tailwind's `sm`: below it the events are a plain vertical list, from it a rail. */
const RAIL_QUERY = "(min-width: 40rem)";
/** Drift only where a mouse drives the page and motion is welcome — never on touch screens. */
const DRIFT_QUERY = "(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)";

/**
 * Whether a media query matches, kept current as it changes (a phone rotating,
 * a window resized across a breakpoint). `false` on the server and during
 * hydration, so the server markup and the first client render agree.
 */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

function Arrow({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d={direction === "prev" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} />
    </svg>
  );
}

// aria-disabled (not `disabled`) so a keyboard user who pages to the end keeps
// focus on the button instead of dropping to <body>.
const arrowClass =
  "absolute top-[140px] z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-accent-foreground transition-opacity hover:bg-accent-strong aria-disabled:cursor-default aria-disabled:opacity-25 aria-disabled:hover:bg-accent sm:flex";

/**
 * Below sm (phones) it's simply a vertical list: full-width tiles, 32px apart,
 * inside the page's own gutters, scrolled with the page. Nothing below applies
 * there — no arrows, no drift, no Pause button, no scroll tracking. The same DOM
 * serves both layouts, so every event is in the page (and the accessibility
 * tree) exactly once.
 *
 * From sm up it's a horizontal rail of fixed-width tiles. It runs full-bleed,
 * wall to wall. A 24px buffer on the left keeps card text off the screen edge
 * when the row rests on a card (scroll snapping); the right end is flush to the
 * edge so there's no empty gap after the last card.
 *
 * Arrow buttons on both sides scroll it by about a screen of cards (keyboard-
 * and screen-reader-accessible).
 *
 * With `autoScroll` it drifts on its own as soon as it is on screen — cards slide
 * left to right until the row reaches its far end, then it stays there (no
 * bouncing back, no duplicated cards). A visible Pause/Play button controls it
 * (WCAG 2.2.2). It also pauses while the pointer is moving over it, it has
 * keyboard focus, or the person scrolls it sideways or touches it (resuming a
 * moment later); vertical page scrolling never pauses it. It stops for good the
 * first time it's clicked — including clicking an arrow — until Play is pressed.
 * The animation loop only runs while it's actually drifting on screen. It's
 * always a normal scrollable region.
 *
 * The drift only exists on mouse-driven devices (`DRIFT_QUERY`). On phones and
 * other touch screens a swipe is the control, so the rail stays put at the first
 * (soonest) card and there's no Pause button to show. It never runs for people
 * who prefer reduced motion.
 */
export default function Carousel({
  children,
  label,
  autoScroll = false,
}: {
  children: ReactNode;
  label: string;
  autoScroll?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Whether the drift is switched on (Pause/Play, or stopped by a click).
  const playingRef = useRef(true);
  const ensureLoopRef = useRef<(force?: boolean) => void>(() => {});
  const isRail = useMediaQuery(RAIL_QUERY);
  const canDrift = useMediaQuery(DRIFT_QUERY);
  // Touch screens, reduced-motion people and the phone list never get a drift
  // (and so no Pause button either).
  const driftAvailable = autoScroll && isRail && canDrift;
  const [playing, setPlaying] = useState(true);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateArrows = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !isRail) return; // the phone list has no arrows to update
    const raf = requestAnimationFrame(updateArrows);
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [isRail, updateArrows]);

  // When it drifts, open part-way along the rail — not at either end — so the
  // very first screen is completely filled with events, starting on a whole card.
  // (Before paint, so there's no visible jump.) Without drift it stays at the
  // start on the soonest event, aligned to the page's content column. Only from
  // the start: becoming a rail again (a resize) never yanks it away from where
  // the person left it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!driftAvailable || !el || el.scrollLeft > 4) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const middle = cards[Math.floor(cards.length / 2)];
    if (!middle) return;
    // Land on a whole card (its left edge at the rail's padding), never mid-card.
    const paddingLeft = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    el.scrollLeft = Math.max(0, middle.offsetLeft - paddingLeft);
  }, [driftAvailable]);

  useEffect(() => {
    const el = ref.current;
    const wrapper = wrapperRef.current;
    if (!driftAvailable || !el || !wrapper) return;

    let raf = 0;
    let running = false;
    let last = 0;
    let pos = el.scrollLeft; // where the layout effect opened it
    let paused = false; // touch, keyboard or sideways wheel (temporary)
    let hovering = false; // the pointer is genuinely moving over the carousel
    let focused = false; // keyboard focus is somewhere inside it
    let ignoreHover = false; // set by an explicit Play, until the pointer leaves
    // The drift only runs while the rail is on screen, and starts the moment it is.
    let visible = typeof IntersectionObserver === "undefined";
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;

    const shouldRun = () => visible && playingRef.current && !paused && !hovering && !focused;

    function setSnap(on: boolean) {
      if (el) el.style.scrollSnapType = on ? "" : "none";
    }

    function tick(now: number) {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      const max = el!.scrollWidth - el!.clientWidth;
      if (!shouldRun() || max <= 0) {
        // Nothing to animate right now: stop the loop instead of spinning at 60fps.
        running = false;
        setSnap(true);
        return;
      }
      pos = Math.min(pos, max) - SPEED_PX_PER_SEC * dt; // cards slide left → right
      if (pos <= 0) {
        // Reached the far end: stay there for good — no bouncing back.
        el!.scrollLeft = 0;
        playingRef.current = false;
        setPlaying(false);
        running = false;
        setSnap(true);
        return;
      }
      el!.scrollLeft = pos;
      raf = requestAnimationFrame(tick);
    }

    // `force` is an explicit Play press: it overrides the temporary pauses.
    function ensureLoop(force = false) {
      if (force) {
        clearTimeout(resumeTimer);
        paused = false;
        hovering = false;
        focused = false;
        ignoreHover = true;
      }
      if (running || !shouldRun()) return;
      running = true;
      pos = el!.scrollLeft;
      setSnap(false);
      raf = requestAnimationFrame((t) => {
        last = t;
        raf = requestAnimationFrame(tick);
      });
    }
    ensureLoopRef.current = ensureLoop;

    function pauseNow() {
      clearTimeout(resumeTimer);
      setSnap(true);
    }

    function resumeSoon(delay: number) {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        paused = false;
        ensureLoop();
      }, delay);
    }

    // Hover is judged by real pointer movement, not by "the pointer is inside the
    // box": scrolling the page can slide the rail under a resting cursor, and that
    // shouldn't count as hovering.
    // Only a mouse "hovers". Touch is handled by touchstart/touchend below: a touch
    // pan makes the browser fire pointercancel/pointerleave while the finger is still
    // down, which would otherwise cut the touch pause short and fight the swipe.
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      if (hovering || ignoreHover) return;
      hovering = true;
      pauseNow();
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      hovering = false;
      ignoreHover = false;
      resumeSoon(POINTER_RESUME_MS);
    };
    // Only real keyboard focus pauses it: clicking a button also focuses it, and
    // that must not leave the drift stuck.
    const onFocusIn = (event: FocusEvent) => {
      let keyboardFocus = true;
      try {
        keyboardFocus = (event.target as HTMLElement).matches(":focus-visible");
      } catch {
        // Very old engines without :focus-visible: treat any focus as keyboard focus.
      }
      if (!keyboardFocus) return;
      focused = true;
      pauseNow();
    };
    const onFocusOut = () => {
      focused = false;
      resumeSoon(POINTER_RESUME_MS);
    };
    const interrupt = () => {
      paused = true;
      pauseNow();
      resumeSoon(RESUME_AFTER_MS);
    };
    // Vertical wheel motion is just the page scrolling past — only a sideways one is
    // the person scrolling the rail.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) interrupt();
    };

    wrapper.addEventListener("pointermove", onPointerMove);
    wrapper.addEventListener("pointerleave", onPointerLeave);
    wrapper.addEventListener("focusin", onFocusIn);
    wrapper.addEventListener("focusout", onFocusOut);
    wrapper.addEventListener("touchstart", interrupt, { passive: true });
    wrapper.addEventListener("touchend", interrupt, { passive: true });
    wrapper.addEventListener("wheel", onWheel, { passive: true });
    wrapper.addEventListener("keydown", interrupt);

    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(
            ([entry]) => {
              visible = entry.isIntersecting;
              if (visible) ensureLoop();
            },
            { threshold: 0.2 },
          );
    observer?.observe(el);

    ensureLoop();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resumeTimer);
      observer?.disconnect();
      running = false;
      ensureLoopRef.current = () => {};
      wrapper.removeEventListener("pointermove", onPointerMove);
      wrapper.removeEventListener("pointerleave", onPointerLeave);
      wrapper.removeEventListener("focusin", onFocusIn);
      wrapper.removeEventListener("focusout", onFocusOut);
      wrapper.removeEventListener("touchstart", interrupt);
      wrapper.removeEventListener("touchend", interrupt);
      wrapper.removeEventListener("wheel", onWheel);
      wrapper.removeEventListener("keydown", interrupt);
      el.style.scrollSnapType = "";
    };
  }, [driftAvailable]);

  function setDrift(on: boolean) {
    playingRef.current = on;
    setPlaying(on);
    // Snapping back on lets arrow scrolling land on a card; off while drifting.
    if (ref.current) ref.current.style.scrollSnapType = on ? "none" : "";
    if (on) {
      // Play at the far end would stop again on the first frame; replay from the other end.
      const el = ref.current;
      if (el && el.scrollLeft <= 4) el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      ensureLoopRef.current(true);
    }
  }

  /** Any click on the carousel (rail or arrows) ends the auto-drift until Play is pressed. */
  function stopDriftingOnClick(event: React.MouseEvent) {
    if ((event.target as HTMLElement).closest("[data-carousel-toggle]")) return;
    if (playingRef.current) setDrift(false);
  }

  function scrollByPage(sign: 1 | -1, enabled: boolean) {
    const el = ref.current;
    if (!el || !enabled) return;
    const reduced =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: sign * el.clientWidth * PAGE_FRACTION, behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <div ref={wrapperRef} className="relative sm:ml-[calc(50%-50vw)] sm:w-screen" onClick={stopDriftingOnClick}>
      {driftAvailable && (
        <button
          type="button"
          data-carousel-toggle
          onClick={() => setDrift(!playing)}
          // The name starts with the visible word ("Pause"/"Play") — WCAG 2.5.3.
          aria-label={`${playing ? "Pause" : "Play"} automatic scrolling of ${label}`}
          className="btn btn-solid btn-sm absolute -top-10 right-4 z-10"
        >
          {playing ? "Pause" : "Play"}
        </button>
      )}
      {/* The phone list has no arrows at all (not merely hidden). */}
      {isRail && (
        <>
          <button
            type="button"
            aria-label="Previous events"
            aria-disabled={!canPrev}
            onClick={() => scrollByPage(-1, canPrev)}
            className={`${arrowClass} left-4`}
          >
            <Arrow direction="prev" />
          </button>
          <button
            type="button"
            aria-label="Next events"
            aria-disabled={!canNext}
            onClick={() => scrollByPage(1, canNext)}
            className={`${arrowClass} right-4`}
          >
            <Arrow direction="next" />
          </button>
        </>
      )}
      <div
        ref={ref}
        role="region"
        aria-label={label}
        // Focusable only when it scrolls sideways (the rail), so keyboard users can scroll it.
        tabIndex={isRail ? 0 : undefined}
        className="no-scrollbar flex w-full flex-col gap-8 sm:snap-x sm:snap-mandatory sm:flex-row sm:gap-6 sm:overflow-x-auto sm:scroll-pl-6 sm:pb-2 sm:pl-6"
      >
        {children}
      </div>
    </div>
  );
}

export function CarouselItem({ children }: { children: ReactNode }) {
  return <div className="w-full shrink-0 sm:w-[280px] sm:snap-start">{children}</div>;
}
