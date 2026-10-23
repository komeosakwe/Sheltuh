"use client";

import { useRef, type ReactNode } from "react";
import SectionHead from "@/components/ui/SectionHead";
import HomeRail, { HOME_CONTAINER } from "./HomeRail";
import RailArrows, { useRailScroll } from "./RailArrows";

/**
 * A rail with five or more cards overflows at every width up to about
 * 1500px (256px cards, 24px gaps), so its arrows are in the server markup;
 * shorter rails get theirs once measured (if they overflow at all).
 */
const SURELY_OVERFLOWS = 5;

/**
 * One home event section (docs/design/mobile-redesign.md §6.3): its head in
 * the page column (title, optional note and link, and from 640px the rail's
 * Previous/Next buttons while it overflows), then its cards as a
 * full-width rail (`HomeRail`). `empty` replaces the rail with a line of
 * text (This weekend with nothing on). `data-home-section` marks it for
 * Try again's focus move and the e2e suite.
 */
export default function HomeRailSection({
  id,
  title,
  note,
  link,
  count,
  empty,
  className,
  children,
}: {
  /** The h2's id; the rail is `${id}-rail`. */
  id: string;
  title: string;
  note?: string;
  link?: { href: string; label?: string; srLabel?: string };
  /** How many cards the rail holds (for the server render's arrows). */
  count: number;
  empty?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const railRef = useRef<HTMLUListElement>(null);
  const railId = `${id}-rail`;
  const scroll = useRailScroll(railRef, !empty && count >= SURELY_OVERFLOWS, empty ? -1 : count);
  const overflows = !empty && (scroll.canPrev || scroll.canNext);

  return (
    <section aria-labelledby={id} data-home-section className={className}>
      <div className={HOME_CONTAINER}>
        <SectionHead
          id={id}
          title={title}
          note={note}
          link={link}
          actions={overflows ? <RailArrows railRef={railRef} controls={railId} title={title} scroll={scroll} /> : undefined}
        />
        {empty}
      </div>
      {!empty && (
        <HomeRail ref={railRef} id={railId} labelledBy={id}>
          {children}
        </HomeRail>
      )}
    </section>
  );
}
