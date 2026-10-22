import Link from "next/link";
import DotsMark from "@/components/brand/DotsMark";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import SearchBar from "@/components/SearchBar";
import { isApiConfigured } from "@/lib/api/client";
import { HOME_HERO } from "./home-content";
import { ArrowRightIcon } from "./icons";

/**
 * The home's hero (docs/design/mobile-redesign.md §6.1): one message, and
 * search as its main action. The eyebrow, the h1 "Find your next thing."
 * (two lines at every width, each free to wrap at large text sizes: never
 * `nowrap`), one sentence, the search field, then "Explore all events" as a
 * quiet text link and, in the demo, the one-line demo label. Kept short so
 * the category buttons and the first events come up on a phone's first
 * screen. Nothing animates in: the hero reads instantly. "WHERE IS ÜR
 * SHELTÜH?" is the footer's campaign line.
 *
 * The photo shows from 1024px only, beside the text; it's lazy (a hidden
 * image is never fetched) with a high fetch priority where it shows.
 */
export default function HomeHero() {
  return (
    <section aria-labelledby="home-title" className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-8">
      <div className="lg:col-span-7">
        <p className="eyebrow flex items-center gap-2 text-muted">
          <DotsMark size="xs" className="text-signal" />
          Melbourne • What’s on
        </p>
        <h1 id="home-title" className="display-lg mt-2 font-display sm:mt-4">
          {/* The literal space keeps the accessible name "Find your next thing.". */}
          <span className="block">Find your</span> <span className="block">next thing.</span>
        </h1>
        <p className="mt-2 max-w-[40ch] text-base leading-6 sm:mt-4 sm:text-lg sm:leading-7 lg:max-w-[44ch]">
          Discover Melbourne’s music, art, workshops and pop-ups. See who’s going before you book.
        </p>
        {/* Search is the hero's main action: full width on phones, a comfortable field from 640px. */}
        <div className="mt-4 sm:mt-6 sm:max-w-xl">
          <SearchBar size="lg" submit label="Search events" placeholder="Search events" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-6">
          <Link
            href="/events"
            className="group/link inline-flex min-h-11 items-center gap-1 text-sm leading-5 font-semibold underline underline-offset-4 hover:decoration-2"
          >
            Explore all events
            <ArrowRightIcon className="h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover/link:translate-x-0.5" />
          </Link>
          {!isApiConfigured && <DemoNotice compact>Not real bookings.</DemoNotice>}
        </div>
      </div>
      <div className="hidden lg:col-span-5 lg:col-start-8 lg:block">
        <EventArt
          poster={HOME_HERO.poster}
          imageUrl={HOME_HERO.imageUrl}
          title="Sheltüh"
          priority="when-shown"
          motion
          className="aspect-[4/3] w-full rounded-card"
        />
      </div>
    </section>
  );
}
