import type { ReactNode } from "react";
import { RESULTS_GRID } from "@/components/EventResults";
import SectionHead from "@/components/ui/SectionHead";
import { HOME_CONTAINER } from "./HomeRail";

/**
 * One home event section on a phone (below 640px): the same head as the
 * rails' (`SectionHead`: title, optional note, link), then its cards as the
 * results grid's two columns (`RESULTS_GRID`, 16px between columns), inside
 * the page column's gutters. Each card is an `li` of a list named by the
 * h2. `data-home-section` marks it, as for `HomeRailSection`.
 */
export default function HomeGridSection({
  id,
  title,
  note,
  link,
  className,
  children,
}: {
  /** The h2's id; the list is `${id}-grid`. */
  id: string;
  title: string;
  note?: string;
  link?: { href: string; label?: string; srLabel?: string };
  className?: string;
  /** The cards, each in an `li` (`HomeGridItem`). */
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} data-home-section="" data-home-grid="" className={className}>
      <div className={HOME_CONTAINER}>
        <SectionHead id={id} title={title} note={note} link={link} />
        <ul id={`${id}-grid`} aria-labelledby={id} className={RESULTS_GRID}>
          {children}
        </ul>
      </div>
    </section>
  );
}

/** One card's cell: the grid stretches it to the row's height. */
export function HomeGridItem({ children }: { children: ReactNode }) {
  return <li className="flex min-w-0">{children}</li>;
}
