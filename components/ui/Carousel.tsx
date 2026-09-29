"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const SPEED_PX_PER_SEC = 60;
const RESUME_AFTER_MS = 2500; // after touch, keyboard or sideways scrolling
const POINTER_RESUME_MS = 600; // after the pointer leaves or focus moves away
const PAGE_FRACTION = 0.8; // an arrow click scrolls by about a screen of cards

function Arrow({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d={direction === "prev" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} />
    </svg>
  );
}

const arrowClass =
  "absolute top-[140px] z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-accent-foreground transition-opacity hover:bg-accent-strong disabled:pointer-events-none disabled:opacity-0 sm:flex";

/**
 * Horizontal rail of fixed-width tiles. It runs full-bleed, wall to wall, with
 * no padding at either end — so at the start and the end of the row the cards
 * sit right against the edge of the screen, with no empty gap.
 *
 * Arrow buttons on both sides scroll it by about a screen of cards (hidden on
 * phones, where swiping works; still keyboard- and screen-reader-accessible
 * from sm up).
 *
 * With `autoScroll` it drifts on its own as soon as it is on screen — cards slide
 * left to right until the row reaches its far end, then it stays there (no
 * bouncing back, no duplicated cards). It pauses while the pointer is moving over
 * it, it has focus, or the person scrolls it sideways or touches it (resuming a
 * moment later); vertical page scrolling never pauses it. It stops entirely for
 * people who prefer reduced motion, and for good the first time it's clicked —
 * including clicking an arrow. It's always a normal scrollable region.
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
  const ref = useRef<HTMLDivElement>(null);
  // Set by the first click; the drift never restarts after that.
  const stoppedRef = useRef(false);
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

  // When it drifts, open part-way along the rail — not at either end — so the
  // very first screen is completely filled with events. (Before paint, so
  // there's no visible jump.) Without drift it stays at the start, aligned to
  // the page's content column.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!autoScroll || !el || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  }, [autoScroll]);

  useEffect(() => {
    const el = ref.current;
    if (!autoScroll || !el || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let last = 0;
    let pos = el.scrollLeft; // where the layout effect opened it
    let paused = false; // touch, keyboard, focus or horizontal wheel
    let hovering = false; // the pointer is genuinely moving over the rail
    // The drift only runs while the rail is on screen, and starts the moment it is.
    let visible = typeof IntersectionObserver === "undefined";
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;

    function setSnap(on: boolean) {
      if (el) el.style.scrollSnapType = on ? "" : "none";
    }

    function pause() {
      paused = true;
      clearTimeout(resumeTimer);
      setSnap(true);
    }

    function resumeSoon(delay: number) {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (!el || stoppedRef.current || hovering) return;
        pos = el.scrollLeft;
        paused = false;
        setSnap(false);
      }, delay);
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      if (!visible || paused || stoppedRef.current || !el) return;
      if (el.scrollWidth - el.clientWidth <= 0) return;
      pos -= SPEED_PX_PER_SEC * dt; // cards slide left → right
      if (pos <= 0) {
        // Reached the far end: stay there for good — no bouncing back.
        el.scrollLeft = 0;
        stoppedRef.current = true;
        setSnap(true);
        return;
      }
      el.scrollLeft = pos;
    }

    // Hover is judged by real pointer movement, not by "the pointer is inside the
    // box": scrolling the page can slide the rail under a resting cursor, and that
    // shouldn't count as hovering.
    const onPointerMove = () => {
      if (hovering) return;
      hovering = true;
      pause();
    };
    const onPointerLeave = () => {
      hovering = false;
      resumeSoon(POINTER_RESUME_MS);
    };
    const interrupt = () => {
      pause();
      resumeSoon(RESUME_AFTER_MS);
    };
    // Vertical wheel motion is just the page scrolling past — only a sideways one is
    // the person scrolling the rail.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) interrupt();
    };
    const onFocusOut = () => resumeSoon(POINTER_RESUME_MS);

    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("touchstart", interrupt, { passive: true });
    el.addEventListener("touchend", interrupt, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("keydown", interrupt);

    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(
            ([entry]) => {
              visible = entry.isIntersecting;
              if (visible) pos = el.scrollLeft;
            },
            { threshold: 0.2 },
          );
    observer?.observe(el);

    setSnap(false);
    raf = requestAnimationFrame((t) => {
      last = t;
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resumeTimer);
      observer?.disconnect();
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("focusin", pause);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("touchstart", interrupt);
      el.removeEventListener("touchend", interrupt);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", interrupt);
      el.style.scrollSnapType = "";
    };
  }, [autoScroll]);

  /** Any click on the carousel (rail or arrows) ends the auto-drift for good. */
  function stopDrifting() {
    stoppedRef.current = true;
    // Give the rail its snap points back, so arrow scrolling lands on a card.
    if (ref.current) ref.current.style.scrollSnapType = "";
  }

  function scrollByPage(sign: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    const reduced =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: sign * el.clientWidth * PAGE_FRACTION, behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <div className="relative ml-[calc(50%-50vw)] w-screen" onClick={stopDrifting}>
      <button
        type="button"
        aria-label="Previous events"
        disabled={!canPrev}
        onClick={() => scrollByPage(-1)}
        className={`${arrowClass} left-4`}
      >
        <Arrow direction="prev" />
      </button>
      <button
        type="button"
        aria-label="Next events"
        disabled={!canNext}
        onClick={() => scrollByPage(1)}
        className={`${arrowClass} right-4`}
      >
        <Arrow direction="next" />
      </button>
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="no-scrollbar flex w-full snap-x snap-mandatory gap-5 overflow-x-auto pb-2 sm:gap-6"
      >
        {children}
      </div>
    </div>
  );
}

export function CarouselItem({ children }: { children: ReactNode }) {
  return <div className="w-[68vw] max-w-[320px] shrink-0 snap-start sm:w-[280px]">{children}</div>;
}
