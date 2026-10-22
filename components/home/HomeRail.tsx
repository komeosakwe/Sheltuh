import type { ReactNode } from "react";
import RailItem from "./RailItem";

/**
 * A section's list of cards: below 640px a horizontal rail (native
 * scroll-snap only: no arrows, no drift, nothing moves unless the thumb does)
 * that bleeds to the screen edges so the next card peeks; from 640px the same
 * list is a grid, 2 columns and 3 from 768px. The vertical padding keeps
 * focus rings unclipped in the rail. Some engines drop a flex scroller's end
 * padding, so an 8px spacer after the last card (plus the 12px gap) keeps it
 * 20px clear of the screen's edge when scrolled to the end.
 */
export default function HomeRail({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <ul
      aria-labelledby={labelledBy}
      className="no-scrollbar -mx-5 -my-4 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto overscroll-x-contain px-5 py-4 after:block after:w-2 after:shrink-0 after:content-[''] sm:mx-0 sm:my-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-x-6 sm:gap-y-8 sm:overflow-visible sm:px-0 sm:py-0 sm:after:hidden md:grid-cols-3"
    >
      {children}
    </ul>
  );
}

/** One card's cell. Keyboard focus anywhere in the card brings the whole card into view (RailItem). */
export function HomeRailItem({ children }: { children: ReactNode }) {
  return <RailItem className="flex shrink-0 snap-start">{children}</RailItem>;
}
