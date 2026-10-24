"use client";

import { useRef, type ReactNode } from "react";
import SectionHead from "@/components/ui/SectionHead";
import HomeRail, { HOME_CONTAINER, isPairRail } from "./HomeRail";
import RailArrows, { useRailScroll } from "./RailArrows";
import RailAutoScrollButton from "./RailAutoScrollButton";
import { useRailAutoScroll } from "./useRailAutoScroll";

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
 * text (This weekend with nothing on). One or two cards are a pair: a
 * two-column grid from 1024px (`isPairRail`; the caller gives those cards
 * EventCard's `wide`). `data-home-section` marks it for Try again's focus
 * move and the e2e suite.
 *
 * A rail that overflows (not a pair) is an endless marquee: its cards drift
 * slowly and continuously from the right edge of the screen to the left,
 * looping seamlessly on copies of the cards that only it renders
 * (`useRailAutoScroll`, `HomeRail` `clones`), with a Pause/Play button in the
 * head before the arrows, at every width; never under reduced motion. A pair
 * never does, at any width: from 1024px it's a grid, and below it there's
 * barely anything to scroll.
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
  const rootRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLUListElement>(null);
  const railId = `${id}-rail`;
  const scroll = useRailScroll(railRef, !empty && count >= SURELY_OVERFLOWS, empty ? -1 : count);
  const overflows = !empty && (scroll.canPrev || scroll.canNext);
  const pair = isPairRail(count);
  const auto = useRailAutoScroll({ rootRef, railRef, enabled: overflows && !pair });

  return (
    <section ref={rootRef} aria-labelledby={id} data-home-section className={className}>
      <div className={HOME_CONTAINER}>
        <SectionHead
          id={id}
          title={title}
          note={note}
          link={link}
          actions={
            overflows ? (
              <>
                {auto.showControl && (
                  <RailAutoScrollButton playing={auto.playing} onToggle={auto.toggle} controls={railId} title={title} />
                )}
                <RailArrows railRef={railRef} controls={railId} title={title} scroll={scroll} onPage={auto.stop} />
              </>
            ) : undefined
          }
        />
        {empty}
      </div>
      {!empty && (
        <HomeRail ref={railRef} id={railId} labelledBy={id} pair={pair} clones={auto.clones}>
          {children}
        </HomeRail>
      )}
    </section>
  );
}
