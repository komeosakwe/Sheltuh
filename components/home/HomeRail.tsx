import type { ReactNode } from "react";

/**
 * A section's list of cards: below 640px a horizontal rail (native
 * scroll-snap only: no arrows, no drift, nothing moves unless the thumb does)
 * that bleeds to the screen edges so the next card peeks; from 640px the same
 * list is a grid. The vertical padding keeps focus rings unclipped in the rail.
 * `cards`: 2 columns, 3 from 768px. `compact`: 2 columns, 3 from 1024px.
 */
export default function HomeRail({
  children,
  labelledBy,
  grid,
}: {
  children: ReactNode;
  labelledBy: string;
  grid: "cards" | "compact";
}) {
  const columns = grid === "cards" ? "sm:grid-cols-2 md:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <ul
      aria-labelledby={labelledBy}
      className={`no-scrollbar -mx-5 -my-4 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto overscroll-x-contain px-5 py-4 sm:mx-0 sm:my-0 sm:grid sm:snap-none sm:gap-x-6 sm:gap-y-8 sm:overflow-visible sm:px-0 sm:py-0 ${columns}`}
    >
      {children}
    </ul>
  );
}

export function HomeRailItem({ children }: { children: ReactNode }) {
  return <li className="flex shrink-0 snap-start">{children}</li>;
}
