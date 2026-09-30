import type { ReactNode } from "react";

/**
 * The phone home's horizontal rail: native scroll-snap only. No arrows, no
 * drift, no listeners, nothing moves unless the thumb moves it. It bleeds to
 * the screen edges, so the first card lines up with the gutter and the next
 * one peeks. The vertical padding keeps card shadows and focus rings unclipped.
 * (`ui/Carousel` stays the desktop rail.)
 */
export default function PhoneRail({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <ul
      aria-labelledby={labelledBy}
      className="no-scrollbar -mx-5 -my-4 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto overscroll-x-contain px-5 py-4"
    >
      {children}
    </ul>
  );
}

export function PhoneRailItem({ children }: { children: ReactNode }) {
  return <li className="flex shrink-0 snap-start">{children}</li>;
}
