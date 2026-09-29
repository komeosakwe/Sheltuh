import type { ReactNode } from "react";

/**
 * Horizontal scroll-snap rail. Children should be fixed-width tiles; the rail
 * bleeds to the viewport edge so the next tile peeks in (as in the reference).
 */
export default function Carousel({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="no-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2 sm:gap-6"
    >
      {children}
    </div>
  );
}

export function CarouselItem({ children }: { children: ReactNode }) {
  return <div className="w-[68vw] max-w-[320px] shrink-0 snap-start sm:w-[280px]">{children}</div>;
}
