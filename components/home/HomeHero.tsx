import DotsMark from "@/components/brand/DotsMark";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import SearchBar from "@/components/SearchBar";
import { ButtonLink } from "@/components/ui/Button";
import { isApiConfigured } from "@/lib/api/client";
import { HOME_HERO } from "./home-content";
import { ArrowRightIcon } from "./icons";

/**
 * The home's hero (docs/design/mobile-redesign.md §6.1): one message and one
 * orange action. The eyebrow, the h1 "Find your next thing." (two lines at
 * every width, each free to wrap at large text sizes: never `nowrap`), one
 * sentence, then "Explore events" and the search. Nothing animates in: the
 * hero reads instantly. "WHERE IS ÜR SHELTÜH?" is the footer's campaign
 * line now.
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
        <h1 id="home-title" className="display-lg mt-3 font-display sm:mt-4">
          {/* The literal space keeps the accessible name "Find your next thing.". */}
          <span className="block">Find your</span> <span className="block">next thing.</span>
        </h1>
        <p className="mt-3 max-w-[40ch] text-base leading-6 sm:mt-4 sm:text-lg sm:leading-7 lg:max-w-[44ch]">
          Discover Melbourne’s music, art, workshops and pop-ups. See who’s going before you book.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:items-center">
          <ButtonLink href="/events" variant="signal" size="lg" className="w-full sm:w-auto sm:px-6">
            Explore events
            <ArrowRightIcon />
          </ButtonLink>
          <div className="sm:max-w-[26rem] sm:min-w-0 sm:flex-1">
            <SearchBar size="lg" submit label="Search events" placeholder="Search events" />
          </div>
        </div>
        {!isApiConfigured && (
          <div className="mt-3 sm:mt-4">
            <DemoNotice>Not real bookings.</DemoNotice>
          </div>
        )}
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
