"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const SPEED_PX_PER_SEC = 60;
const RESUME_AFTER_MS = 2500;
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
 * Horizontal rail of fixed-width tiles. It runs full-bleed to the edges of the
 * viewport, with padding that keeps the first card aligned to the page's content column.
 *
 * Arrow buttons on both sides scroll it by about a screen of cards (hidden on
 * phones, where swiping works; still keyboard- and screen-reader-accessible
 * from sm up).
 *
 * With `autoScroll` it drifts on its own — cards slide left to right, then
 * turn around at the end (no duplicated cards, so every event exists once).
 * It pauses while the pointer or keyboard focus is on it or the person scrolls
 * by hand (resuming a moment later), stops entirely for people who prefer
 * reduced motion, and stops for good the first time it's clicked — including
 * clicking an arrow. It's always a normal scrollable region.
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
    let direction = -1; // -1: cards move left → right (view travels toward the start)
    let paused = false;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;

    const maxScroll = () => el.scrollWidth - el.clientWidth;

    function setSnap(on: boolean) {
      if (el) el.style.scrollSnapType = on ? "" : "none";
    }

    function pause() {
      paused = true;
      clearTimeout(resumeTimer);
      setSnap(true);
    }

    function resumeSoon() {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (!el || stoppedRef.current) return;
        pos = el.scrollLeft;
        paused = false;
        setSnap(false);
      }, RESUME_AFTER_MS);
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      const max = maxScroll();
      if (max <= 0 || !el) {
        last = now;
        return;
      }
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      if (paused || stoppedRef.current) return;
      pos += direction * SPEED_PX_PER_SEC * dt;
      if (pos <= 0) {
        pos = 0;
        direction = 1;
      } else if (pos >= max) {
        pos = max;
        direction = -1;
      }
      el.scrollLeft = pos;
    }

    const interrupt = () => {
      pause();
      resumeSoon();
    };
    const hold = () => pause();
    const release = () => resumeSoon();

    el.addEventListener("pointerenter", hold);
    el.addEventListener("pointerleave", release);
    el.addEventListener("focusin", hold);
    el.addEventListener("focusout", release);
    el.addEventListener("touchstart", interrupt, { passive: true });
    el.addEventListener("wheel", interrupt, { passive: true });
    el.addEventListener("keydown", interrupt);

    setSnap(false);
    raf = requestAnimationFrame((t) => {
      last = t;
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resumeTimer);
      el.removeEventListener("pointerenter", hold);
      el.removeEventListener("pointerleave", release);
      el.removeEventListener("focusin", hold);
      el.removeEventListener("focusout", release);
      el.removeEventListener("touchstart", interrupt);
      el.removeEventListener("wheel", interrupt);
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
        className="no-scrollbar flex w-full snap-x snap-mandatory gap-5 overflow-x-auto scroll-pl-[var(--rail-gutter)] pb-2 pl-[var(--rail-gutter)] pr-[var(--rail-gutter)] [--rail-gutter:max(1.25rem,calc((100vw-72rem)/2+1.25rem))] sm:gap-6 sm:[--rail-gutter:max(2rem,calc((100vw-72rem)/2+2rem))]"
      >
        {children}
      </div>
    </div>
  );
}

export function CarouselItem({ children }: { children: ReactNode }) {
  return <div className="w-[68vw] max-w-[320px] shrink-0 snap-start sm:w-[280px]">{children}</div>;
}
