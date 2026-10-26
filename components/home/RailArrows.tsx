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

/**
 * The rail position that puts the nearest card's start on the rail's start
 * inset (where mandatory snapping settles it), within the scroll range; the
 * current position when no card has a size (no layout yet). A rail at rest
 * is already there; one the auto-scroll is drifting usually isn't.
 */
export function nearestCardLeft(el: HTMLElement): number {
  const max = Math.max(0, el.scrollWidth - el.clientWidth);
  const inset = parseFloat(getComputedStyle(el).paddingInlineStart) || 0;
  const railLeft = el.getBoundingClientRect().left + el.clientLeft;
  let best = el.scrollLeft;
  let bestDistance = Infinity;
  for (const card of Array.from(el.children)) {
    if (!(card instanceof HTMLLIElement)) continue;
    const box = card.getBoundingClientRect();
    if (!(box.width > 0)) continue;
    const left = Math.min(max, Math.max(0, el.scrollLeft + box.left - railLeft - inset));
    const distance = Math.abs(left - el.scrollLeft);
    if (distance < bestDistance) {
      best = left;
      bestDistance = distance;
    }
  }
  return best;
}

/** A rail control in the section head: a 44px outlined square (the arrows and the auto-scroll Pause/Play). */
export const RAIL_BUTTON =
  "size-11 shrink-0 items-center justify-center rounded-control border border-foreground bg-card text-foreground transition-colors hover:bg-surface";

const ARROW = `hidden ${RAIL_BUTTON} aria-disabled:cursor-default aria-disabled:border-surface-border aria-disabled:text-muted aria-disabled:hover:bg-card sm:flex`;

/**
 * A rail's Previous and Next buttons (the original carousel's arrows, now in
 * the section head beside its link, so they never cover a card). From 640px
 * only: on phones a swipe is the control. Shown only while the rail
 * overflows. At an end the button is `aria-disabled` rather than `disabled`,
 * so a keyboard user who pages to the end keeps focus on it. A press pages
 * by the cards wholly in view, from the nearest card's start (so it lands on
 * a card even mid-drift), instantly under reduced motion, and calls `onPage`
 * first (the visitor scrolled the rail: its auto-scroll stops).
 */
export default function RailArrows({
  railRef,
  controls,
  title,
  scroll,
  onPage,
}: {
  railRef: RefObject<HTMLElement | null>;
  /** The rail's id (aria-controls). */
  controls: string;
  /** The section's title, so each section's buttons have their own names. */
  title: string;
  scroll: RailScroll;
  /** Called when a press scrolls the rail. */
  onPage?: () => void;
}) {
  if (!scroll.canPrev && !scroll.canNext) return null;

  function page(sign: 1 | -1, enabled: boolean) {
    const el = railRef.current;
    if (!el || !enabled) return;
    onPage?.();
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // From a card's start (where a rail at rest already is): a press during the auto-scroll's
    // drift, between cards, still lands on one, in one movement.
    const fromCard = nearestCardLeft(el) - el.scrollLeft;
    el.scrollBy({ left: sign * railPageStep(el) + fromCard, behavior: reduce ? "auto" : "smooth" });
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
