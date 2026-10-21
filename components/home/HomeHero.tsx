import type { ReactNode } from "react";
import BrandU from "@/components/brand/BrandU";
import DotsMark from "@/components/brand/DotsMark";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import SearchBar from "@/components/SearchBar";
import { ButtonLink } from "@/components/ui/Button";
import { isApiConfigured } from "@/lib/api/client";
import CategoryRow from "./CategoryRow";
import { HOME_HERO } from "./home-content";
import { ArrowRightIcon } from "./icons";

/** Hero buttons share a row at every width: content-sized, a size smaller below 640px. */
const CTA = "flex-auto px-3 text-[0.8125rem] sm:flex-none sm:px-6 sm:text-sm";

/**
 * The home's compact hero (docs/design/home.md §5.2 and owner decision 7):
 * the brand question, one plain sentence on what Sheltüh does, the CTAs,
 * search and categories, then `upNext`. Small enough that events show
 * without scrolling: from 1024px Up next is the right-hand column; below
 * that it follows in the single column.
 *
 * The h1 is the LCP element, so it never animates in (`.rise` is on the
 * rest). Screen readers hear "Where is your Sheltüh?".
 */
export default function HomeHero({ upNext }: { upNext: ReactNode }) {
  return (
    <section aria-labelledby="home-title" className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-8">
      <div className="lg:col-span-8">
        <p className="eyebrow rise flex items-center gap-2 text-muted">
          <DotsMark size="xs" className="text-signal" />
          Melbourne · What’s on
        </p>
        <div className="mt-2 grid grid-cols-[auto_minmax(5.5rem,1fr)] items-stretch gap-x-3 sm:mt-3 sm:grid-cols-[auto_minmax(10rem,1fr)] sm:gap-x-6 lg:grid-cols-1">
          {/* The spaces between the spans keep the accessible text a sentence. */}
          <h1
            id="home-title"
            className="font-display text-[clamp(2rem,9.25vw,2.25rem)] leading-[0.9] uppercase sm:text-[2.75rem] lg:text-[3.5rem]"
          >
            <span className="block whitespace-nowrap">
              Where is <BrandU />
            </span>{" "}
            <span className="block whitespace-nowrap">Sheltüh?</span>
          </h1>
          <div className="rise min-h-16 [--d:120ms] lg:hidden">
            <EventArt
              poster={HOME_HERO.poster}
              imageUrl={HOME_HERO.imageUrl}
              title="Sheltüh"
              priority
              motion
              className="h-full w-full rounded-card"
            />
          </div>
        </div>
        <p className="rise mt-3 max-w-[40ch] text-base leading-6 [--d:200ms] sm:mt-4 sm:text-lg sm:leading-7 lg:max-w-[48ch]">
          Live music, art, workshops and pop-ups in Melbourne, curated, with the people going.
        </p>
        {/* One row at every width: below 640px the labels are a size smaller and the arrow drops, so both fit from 375px. */}
        <div className="rise mt-4 flex gap-2 [--d:300ms] sm:mt-5 sm:gap-3">
          <ButtonLink href="/events" variant="signal" size="lg" className={CTA}>
            Explore events
            <ArrowRightIcon className="hidden h-4 w-4 sm:block" />
          </ButtonLink>
          <ButtonLink href="#find-your-people" variant="outline" size="lg" className={CTA}>
            Join the community
          </ButtonLink>
        </div>
        <div className="rise mt-3 [--d:400ms] sm:mt-6 lg:flex lg:items-center lg:gap-6">
          <div className="sm:max-w-xl lg:min-w-0 lg:flex-1">
            <SearchBar size="lg" submit label="Search events" />
          </div>
          <CategoryRow className="mt-3 sm:mt-6 lg:mt-0 lg:shrink-0" />
        </div>
        {!isApiConfigured && (
          <div className="mt-3 sm:mt-6">
            <DemoNotice>Not real bookings.</DemoNotice>
          </div>
        )}
      </div>
      <div className="mt-3 sm:mt-8 lg:col-span-4 lg:col-start-9 lg:mt-0 lg:pt-7">{upNext}</div>
    </section>
  );
}
