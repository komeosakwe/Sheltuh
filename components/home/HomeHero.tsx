import DotsMark from "@/components/brand/DotsMark";
import EventArt from "@/components/EventArt";
import SearchBar from "@/components/SearchBar";
import { HOME_HERO, HOME_INTRO } from "./home-content";

/**
 * The home's hero (docs/design/mobile-redesign.md §6.1 and its Refinement,
 * 22 Oct 2026): one message, kept short so the first event's image and title
 * come up on a phone's first screen. The eyebrow (the page's one use of the
 * brand dots), the h1 "Find your new thing." (the site's one heavy
 * uppercase display line; two lines at every width, each free to wrap at
 * large text sizes: never `nowrap`), one short sentence, then the search,
 * the page's only search on the home (the header leaves its own out here).
 * The category row under it is the way to browse. Nothing animates in.
 *
 * The photo shows from 1024px only, beside the text; it's lazy (a hidden
 * image is never fetched) with a high fetch priority where it shows.
 */
export default function HomeHero() {
  return (
    <section aria-labelledby="home-title" className="lg:grid lg:grid-cols-12 lg:items-center lg:gap-x-8">
      <div className="lg:col-span-7">
        <p className="eyebrow flex items-center gap-2 text-muted">
          <DotsMark size="xs" className="text-signal" />
          Melbourne • What’s on
        </p>
        <h1 id="home-title" className="display-lg mt-2 font-display sm:mt-3">
          {/* The literal space keeps the accessible name "Find your new thing.". */}
          <span className="block">Find your</span> <span className="block">new thing.</span>
        </h1>
        <p className="mt-2 max-w-[40ch] text-base leading-6 text-muted sm:mt-3 sm:text-lg sm:leading-7">{HOME_INTRO}</p>
        {/* Search is the hero's main action: full width on phones, a comfortable field from 640px. */}
        <div className="mt-4 sm:mt-5 sm:max-w-xl">
          <SearchBar size="lg" submit label="Search events" placeholder="Search events" />
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
