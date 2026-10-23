import type { ReactNode } from "react";
import RailItem from "./RailItem";

/**
 * A section's list of cards: below 640px a horizontal rail (native
 * scroll-snap only: no arrows, no drift, nothing moves unless the thumb does)
 * that bleeds to the screen edges so the next card peeks; from 640px the same
 * list is a grid, 2 columns, 3 from 768px and 4 from 1024px (cards stay
 * card-sized on a wide screen; a short row stays short and left-aligned). The
 * vertical padding keeps focus rings unclipped in the rail. The end gutter
 * comes from an 8px spacer after the last card (plus the 12px gap), with no
 * end padding: engines disagree on whether a flex scroller's end padding
 * counts (Safari has dropped it, Chromium adds it), so relying on the spacer
 * alone makes it 20px in every engine.
 *
 * Snapping is start-aligned (each item `snap-start`) at the page gutter
 * (`scroll-px-5`, the same 20px as the first card's start), so a swipe
 * always settles with a card's left edge on the gutter and the next card
 * peeking. `overflow-y-hidden`: a sideways scroller is otherwise a vertical
 * one too (overflow-x: auto makes overflow-y auto), and a pixel of overhang
 * let a diagonal swipe nudge the rail up and down. The cells stretch to the
 * tallest card, so every card in a row is the same height.
 */
export default function HomeRail({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <ul
      aria-labelledby={labelledBy}
      className="no-scrollbar -mx-5 -my-4 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain ps-5 pe-0 py-4 after:block after:w-2 after:shrink-0 after:content-[''] sm:mx-0 sm:my-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-x-6 sm:gap-y-8 sm:overflow-visible sm:ps-0 sm:py-0 sm:after:hidden md:grid-cols-3 lg:grid-cols-4"
    >
      {children}
    </ul>
  );
}

/** One card's cell. Keyboard focus anywhere in the card brings the whole card into view (RailItem). */
export function HomeRailItem({ children }: { children: ReactNode }) {
  return <RailItem className="flex shrink-0 snap-start">{children}</RailItem>;
}
