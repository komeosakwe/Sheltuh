import type { ReactNode, Ref } from "react";
import RailItem from "./RailItem";

/**
 * The home's page column: the hero's, the section heads' and the For
 * organisers card's. The rails' start inset (`INSET`) is derived from these
 * numbers (72rem wide, 1.25rem gutters, 2rem from 640px), so change them
 * together.
 */
export const HOME_CONTAINER = "mx-auto max-w-6xl px-5 sm:px-8";

/**
 * Where a rail's first card starts, so it lines up with the section head
 * above it: the page gutter (20px) on phones; from 640px the page column's
 * content edge, `max(2rem, (100% - 72rem) / 2 + 2rem)` of the full-width
 * rail (32px up to 1152, 96px at 1280, 176px at 1440).
 */
const INSET = "ps-5 sm:ps-[max(2rem,(100%_-_72rem)/2_+_2rem)]";
/** Snapping uses the same inset, so a card always settles on that line. */
const SNAP_INSET = "scroll-px-5 sm:scroll-ps-[max(2rem,(100%_-_72rem)/2_+_2rem)]";

/**
 * The end gutter: a spacer after the last card (plus the gap) rather than
 * end padding, which engines disagree on for a flex scroller (Safari drops
 * it, Chromium adds it). 8px + the 12px gap = 20px on phones. From 640px the
 * last card ends on the page column's right edge, as the first starts on
 * its left: the spacer's percentage is of the rail's content box (the full
 * width less `INSET`), which makes it `max(0.5rem, 100% - 69.5rem)`, plus
 * the 24px gap.
 */
const END_GUTTER = "after:block after:w-2 after:shrink-0 after:content-[''] sm:after:w-[max(0.5rem,100%_-_69.5rem)]";

/**
 * A section's cards as a horizontal rail at every width (owner, 23 Oct 2026:
 * "keep using the horizontal scrolling", reinstating the original
 * carousel's scrolling; docs/design/mobile-redesign.md §4). The caller
 * places it full width, outside the page column: it runs to both screen
 * edges, its first card starts on the column's edge (`INSET`) and the cards
 * run off the right edge, so a partly visible card says there's more.
 * Fixed-width cards (EventCard `rail`: 62vw up to 240px on phones, 256px
 * from 640px), never stretched to fill a row; the cells stretch to the
 * tallest card, so every card's price and button sit at the same height.
 *
 * Native scrolling only: start-aligned mandatory snap (a swipe, wheel or
 * arrow press settles with a card's left edge on the inset line), and
 * nothing moves by itself (no drift). From 640px the section head's
 * Previous/Next buttons page it (`RailArrows`); keyboard focus anywhere in
 * a card brings the whole card into view (`RailItem`).
 * `overflow-y-hidden`: a sideways scroller is otherwise a vertical one too,
 * and a pixel of overhang let a diagonal swipe nudge the rail up and down.
 * The vertical padding (cancelled by the negative margin) keeps focus rings
 * unclipped.
 */
export default function HomeRail({
  children,
  labelledBy,
  id,
  ref,
}: {
  children: ReactNode;
  labelledBy: string;
  id?: string;
  ref?: Ref<HTMLUListElement>;
}) {
  return (
    <ul
      ref={ref}
      id={id}
      aria-labelledby={labelledBy}
      className={`no-scrollbar -my-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain py-4 pe-0 sm:gap-6 ${INSET} ${SNAP_INSET} ${END_GUTTER}`}
    >
      {children}
    </ul>
  );
}

/** The loading skeleton's row: the rail's inset and gaps, clipped (it never scrolls). */
export const RAIL_SKELETON = `-my-4 flex gap-3 overflow-hidden py-4 sm:gap-6 ${INSET}`;

/** One card's cell. Keyboard focus anywhere in the card brings the whole card into view (RailItem). */
export function HomeRailItem({ children }: { children: ReactNode }) {
  return <RailItem className="flex shrink-0 snap-start">{children}</RailItem>;
}
