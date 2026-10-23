"use client";

import { useEffect, useState, type RefObject } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

/** Within this many pixels of an end counts as at it (sub-pixel layout and snapping). */
const EDGE = 4;
/** Without a measurable card (no layout yet), page by most of the rail's width. */
const PAGE_FRACTION = 0.8;

export interface RailScroll {
  /** There's more to the left (the rail has been scrolled). */
  canPrev: boolean;
  /** There's more to the right. */
  canNext: boolean;
}

/**
 * Whether a sideways rail can scroll back and on, kept current as it
 * scrolls and resizes. `initialOverflow` is the first render's guess (the
 * server can't measure), so a rail that surely overflows has its arrows in
 * the server markup and doesn't shift its head on hydration; the first
 * measurement corrects it either way. A change of `measureKey` (the cards
 * changed, or the rail appeared) measures again.
 */
export function useRailScroll(
  ref: RefObject<HTMLElement | null>,
  initialOverflow: boolean,
  measureKey: string | number,
): RailScroll {
  const [state, setState] = useState<RailScroll>({ canPrev: false, canNext: initialOverflow });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const canPrev = el.scrollLeft > EDGE;
      const canNext = el.scrollLeft < el.scrollWidth - el.clientWidth - EDGE;
      setState((prev) => (prev.canPrev === canPrev && prev.canNext === canNext ? prev : { canPrev, canNext }));
    };
    const raf = requestAnimationFrame(update);
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [ref, measureKey]);

  return state;
}

/**
 * One press's distance: every card that's wholly in view, so the card that
 * was peeking at the edge becomes the first (and snapping lands exactly on
 * it). Falls back to most of the rail's width when nothing has a size.
 */
export function railPageStep(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const inset = parseFloat(style.paddingInlineStart) || 0;
  const gap = parseFloat(style.columnGap) || 0;
  const card = el.querySelector("li")?.getBoundingClientRect().width ?? 0;
  if (card <= 0) return el.clientWidth * PAGE_FRACTION;
  const whole = Math.max(1, Math.floor((el.clientWidth - inset + gap) / (card + gap)));
  return whole * (card + gap);
}

const ARROW =
  "hidden size-11 shrink-0 items-center justify-center rounded-control border border-foreground bg-card text-foreground transition-colors hover:bg-surface aria-disabled:cursor-default aria-disabled:border-surface-border aria-disabled:text-muted aria-disabled:hover:bg-card sm:flex";

/**
 * A rail's Previous and Next buttons (the original carousel's arrows, now in
 * the section head beside its link, so they never cover a card). From 640px
 * only: on phones a swipe is the control. Shown only while the rail
 * overflows. At an end the button is `aria-disabled` rather than `disabled`,
 * so a keyboard user who pages to the end keeps focus on it. A press pages
 * by the cards wholly in view, instantly under reduced motion.
 */
export default function RailArrows({
  railRef,
  controls,
  title,
  scroll,
}: {
  railRef: RefObject<HTMLElement | null>;
  /** The rail's id (aria-controls). */
  controls: string;
  /** The section's title, so each section's buttons have their own names. */
  title: string;
  scroll: RailScroll;
}) {
  if (!scroll.canPrev && !scroll.canNext) return null;

  function page(sign: 1 | -1, enabled: boolean) {
    const el = railRef.current;
    if (!el || !enabled) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: sign * railPageStep(el), behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Previous events: ${title}`}
        aria-controls={controls}
        aria-disabled={!scroll.canPrev}
        onClick={() => page(-1, scroll.canPrev)}
        className={ARROW}
      >
        <ChevronLeftIcon />
      </button>
      <button
        type="button"
        aria-label={`Next events: ${title}`}
        aria-controls={controls}
        aria-disabled={!scroll.canNext}
        onClick={() => page(1, scroll.canNext)}
        className={ARROW}
      >
        <ChevronRightIcon />
      </button>
    </>
  );
}
