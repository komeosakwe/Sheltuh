"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "@/components/home/icons";

/** Within this many pixels of an end counts as at it (sub-pixel layout). */
const EDGE = 4;

/**
 * The cue that a sideways row scrolls: a soft fade on each side that has more beyond it, and (on
 * phones, where there are no Previous/Next buttons) a small arrow at the right edge. Only while
 * the row overflows. Decorative: `aria-hidden`, never takes a tap, nothing animates, so reduced
 * motion needs no special case. The scroller itself keeps its native keyboard and screen reader
 * behaviour. The fade is the page background, so put it where the row sits on the page.
 *
 * `className` positions both fades' box (e.g. `sm:hidden` where the row wraps instead of
 * scrolling); `arrowClassName` places the arrow (default: vertically centred).
 */
export function ScrollEdges({
  canPrev,
  canNext,
  className = "",
  arrowClassName = "top-1/2 -translate-y-1/2",
}: {
  canPrev: boolean;
  canNext: boolean;
  className?: string;
  arrowClassName?: string;
}) {
  return (
    <>
      {canPrev && (
        <span
          aria-hidden="true"
          data-scroll-fade="start"
          className={`pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-linear-to-r from-background to-transparent ${className}`.trim()}
        />
      )}
      {canNext && (
        <>
          <span
            aria-hidden="true"
            data-scroll-fade="end"
            className={`pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-linear-to-l from-background to-transparent ${className}`.trim()}
          />
          <span
            aria-hidden="true"
            data-scroll-arrow=""
            className={`pointer-events-none absolute right-1 z-10 flex size-6 items-center justify-center rounded-control bg-foreground text-background sm:hidden ${arrowClassName}`.trim()}
          >
            <ChevronRightIcon className="size-4" />
          </span>
        </>
      )}
    </>
  );
}

/**
 * Wraps one sideways scroller (its only child) with `ScrollEdges`, measuring it as it scrolls and
 * resizes. `className` goes on the frame (for a row that bleeds to the screen edges: `-mx-5
 * sm:mx-0`); `fadeClassName` on the fades.
 */
export default function ScrollHint({
  children,
  className = "",
  fadeClassName = "",
}: {
  children: ReactNode;
  className?: string;
  fadeClassName?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ canPrev: false, canNext: false });

  useEffect(() => {
    const scroller = frameRef.current?.firstElementChild;
    if (!(scroller instanceof HTMLElement)) return;
    const update = () => {
      const canPrev = scroller.scrollLeft > EDGE;
      const canNext = scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - EDGE;
      setEdges((prev) => (prev.canPrev === canPrev && prev.canNext === canNext ? prev : { canPrev, canNext }));
    };
    const raf = requestAnimationFrame(update);
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(scroller);
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, []);

  return (
    <div ref={frameRef} className={`relative ${className}`.trim()}>
      {children}
      <ScrollEdges {...edges} className={fadeClassName} />
    </div>
  );
}
