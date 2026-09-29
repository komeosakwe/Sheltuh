"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const SPEED_PX_PER_SEC = 60;
const RESUME_AFTER_MS = 2500; // after touch, keyboard or sideways scrolling
const POINTER_RESUME_MS = 600; // after the pointer leaves or focus moves away
const PAGE_FRACTION = 0.8; // an arrow click scrolls by about a screen of cards

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
 * Horizontal rail of fixed-width tiles. It runs full-bleed, wall to wall. A small
 * buffer on the left (20px on phones, 24px from sm up) keeps card text off the
 * screen edge when the row rests on a card (scroll snapping); from sm up the
 * right end is flush to the edge so there's no empty gap after the last card.
 *
 * Arrow buttons on both sides scroll it by about a screen of cards (hidden on
 * phones, where swiping works; still keyboard- and screen-reader-accessible
 * from sm up).
 *
 * With `autoScroll` it drifts on its own as soon as it is on screen — cards slide
 * left to right until the row reaches its far end, then it stays there (no
 * bouncing back, no duplicated cards). A visible Pause/Play button controls it
 * (WCAG 2.2.2). It also pauses while the pointer is moving over it, it has
 * keyboard focus, or the person scrolls it sideways or touches it (resuming a
 * moment later); vertical page scrolling never pauses it. It doesn't run at all
 * for people who prefer reduced motion, and it stops for good the first time
 * it's clicked — including clicking an arrow — until Play is pressed. The
 * animation loop only runs while it's actually drifting on screen. It's always
 * a normal scrollable region.
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
  const [driftAvailable, setDriftAvailable] = useState(false);
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
    if (!el) return;
    const raf = requestAnimationFrame(updateArrows);
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows]);

  // Reduced-motion people never get a drift (and so no Pause button either).
  useEffect(() => {
    if (!autoScroll || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a browser-only media query after mount
    setDriftAvailable(true);
  }, [autoScroll]);

  // When it drifts, open part-way along the rail — not at either end — so the
  // very first screen is completely filled with events, starting on a whole card.
  // (Before paint, so there's no visible jump.) Without drift it stays at the
  // start, aligned to the page's content column.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!autoScroll || !el || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const middle = cards[Math.floor(cards.length / 2)];
    if (!middle) return;
    // Land on a whole card (its left edge at the rail's padding), never mid-card.
    const paddingLeft = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    el.scrollLeft = Math.max(0, middle.offsetLeft - paddingLeft);
  }, [autoScroll]);

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
    const onPointerMove = () => {
      if (hovering) return;
      hovering = true;
      pauseNow();
    };
    const onPointerLeave = () => {
      hovering = false;
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
    if (on) ensureLoopRef.current(true);
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
    <div ref={wrapperRef} className="relative ml-[calc(50%-50vw)] w-screen" onClick={stopDriftingOnClick}>
      {driftAvailable && (
        <button
          type="button"
          data-carousel-toggle
          onClick={() => setDrift(!playing)}
          // The name starts with the visible word ("Pause"/"Play") — WCAG 2.5.3.
          aria-label={`${playing ? "Pause" : "Play"} automatic scrolling of ${label}`}
          className="btn btn-solid btn-sm absolute right-4 top-3 z-10"
        >
          {playing ? "Pause" : "Play"}
        </button>
      )}
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
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="no-scrollbar flex w-full snap-x snap-mandatory gap-5 overflow-x-auto scroll-pl-5 pb-2 pl-5 pr-5 sm:scroll-pl-6 sm:gap-6 sm:pl-6 sm:pr-0"
      >
        {children}
      </div>
    </div>
  );
}

export function CarouselItem({ children }: { children: ReactNode }) {
  return <div className="w-[68vw] max-w-[320px] shrink-0 snap-start sm:w-[280px]">{children}</div>;
}
