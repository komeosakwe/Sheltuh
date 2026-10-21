"use client";

import type { ReactNode } from "react";
import { formatWeekendRange } from "@/lib/home-sections";
import HomeEventCard, { HomeEventCardPlaceholder } from "./HomeEventCard";
import { useHomeEvents } from "./HomeEventsProvider";
import HomeRail, { HomeRailItem } from "./HomeRail";
import SectionHead from "./SectionHead";

const SECTION = "reveal mt-8 sm:mt-12 lg:mt-16";
/**
 * The first section after the hero (owner decision 7, compact hero): a step
 * closer on phones, and no scroll-in rise, which would leave it faded at the
 * fold where it must read without scrolling.
 */
const FIRST_SECTION = "mt-6 sm:mt-12 lg:mt-16";

/**
 * The home's event sections below the hero (docs/design/home.md §5.6), in
 * order: This weekend, Trending, Coming up near you, the static `guide` slot,
 * then Free & low-cost. Each event appears once on the page (the provider's
 * sections are already de-duplicated, Up next included). A section with too
 * few events renders nothing; on a load error they're all hidden and Up next
 * carries the alert.
 */
export default function HomeEventSections({ guide }: { guide?: ReactNode }) {
  const { mode, state } = useHomeEvents();
  const loading = state.status === "loading";
  const sections = state.status === "ready" ? state.sections : null;
  const weekend = sections?.weekend;
  const showWeekend = !!weekend && weekend.status !== "hidden";
  const showTrending = !!sections && sections.trending.length > 0;
  const showComing = !!sections && sections.comingUp.length > 0;
  const first = loading ? "loading" : showWeekend ? "weekend" : showTrending ? "trending" : showComing ? "coming" : null;
  const spacing = (key: string) => (key === first ? FIRST_SECTION : SECTION);

  return (
    <>
      {/* Always mounted so "Loading events…" is announced. */}
      <p role="status" className="sr-only">
        {loading ? "Loading events…" : ""}
      </p>

      {loading && (
        <div aria-hidden="true" className={spacing("loading")}>
          <div className="border-t border-foreground pt-2">
            <div className="h-4" />
          </div>
          <div className="mt-3 mb-3 h-7 w-48 bg-surface sm:mb-6 sm:h-8" />
          <div className="-mx-5 -my-4 flex gap-3 overflow-hidden px-5 py-4 sm:mx-0 sm:my-0 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:px-0 sm:py-0 md:grid-cols-3">
            <HomeEventCardPlaceholder />
            <HomeEventCardPlaceholder />
            <HomeEventCardPlaceholder className="hidden md:flex" />
          </div>
        </div>
      )}

      {weekend && showWeekend && (
        <section aria-labelledby="home-weekend" data-home-section className={spacing("weekend")}>
          <SectionHead
            id="home-weekend"
            title="This weekend"
            note={{ text: formatWeekendRange(weekend.window) }}
            seeAll={{ href: "/events", srLabel: "events" }}
          />
          {weekend.status === "cards" ? (
            <HomeRail labelledBy="home-weekend" grid="cards">
              {weekend.items.map((event) => (
                <HomeRailItem key={event.id}>
                  <HomeEventCard event={event} variant="wide" mode={mode} />
                </HomeRailItem>
              ))}
            </HomeRail>
          ) : (
            <p className="text-sm leading-5 text-muted">
              Nothing listed for this weekend yet. New events are added through the week.
            </p>
          )}
        </section>
      )}

      {sections && showTrending && (
        <section aria-labelledby="home-trending" data-home-section className={spacing("trending")}>
          <SectionHead id="home-trending" title="Trending" />
          <HomeRail labelledBy="home-trending" grid="cards">
            {sections.trending.map(({ event, signal }) => (
              <HomeRailItem key={event.id}>
                <HomeEventCard event={event} variant="standard" mode={mode} signal={signal} />
              </HomeRailItem>
            ))}
          </HomeRail>
        </section>
      )}

      {sections && showComing && (
        <section aria-labelledby="home-coming" data-home-section className={spacing("coming")}>
          <SectionHead
            id="home-coming"
            title="Coming up near you"
            strap="Coming up"
            seeAll={{ href: "/events", srLabel: "events" }}
          />
          <p className="hidden max-w-xl text-sm leading-5 text-muted sm:-mt-3 sm:mb-6 sm:block">
            The most interesting live music, art, workshops and pop-ups in your city — curated, not scraped.
          </p>
          <HomeRail labelledBy="home-coming" grid="cards">
            {sections.comingUp.map((event) => (
              <HomeRailItem key={event.id}>
                <HomeEventCard event={event} variant="standard" mode={mode} />
              </HomeRailItem>
            ))}
          </HomeRail>
        </section>
      )}

      {guide}

      {sections && sections.lowCost.length > 0 && (
        <section aria-labelledby="home-free" data-home-section className={SECTION}>
          <SectionHead
            id="home-free"
            title="Free & low-cost"
            seeAll={{ href: "/events?pricing=free", srLabel: "free events" }}
          />
          <HomeRail labelledBy="home-free" grid="compact">
            {sections.lowCost.map(({ event, badge }) => (
              <HomeRailItem key={event.id}>
                <HomeEventCard event={event} variant="compact" mode={mode} badge={badge} />
              </HomeRailItem>
            ))}
          </HomeRail>
        </section>
      )}
    </>
  );
}
