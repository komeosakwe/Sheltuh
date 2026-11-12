import BrandU from "@/components/brand/BrandU";
import SearchBar from "@/components/SearchBar";
import HeroCollage from "./HeroCollage";
import HeroThumb from "./HeroThumb";
import { HOME_TITLE, HOME_TITLE_LINES } from "./home-content";

/**
 * The home's hero (docs/design/mobile-redesign.md §6.1 and its Refinement,
 * 22 Oct 2026): one message, kept short so the first event's image and title
 * come up on a phone's first screen. The h1 "Find your next thing." (the site's one heavy
 * uppercase display line; two lines at every width, each free to wrap at
 * large text sizes: never `nowrap`), one short muted sentence (at every
 * width, one line on a phone), then the search,
 * the page's only search on the home (the header leaves its own out here).
 * The category row under it is the way to browse. Nothing animates in.
 *
 * The h1 is a display headline in Bootzy, FIND YOÜR NEXT THING., shown
 * through BrandU (`HOME_TITLE_LINES`) and read as "Find your next thing."
 * (`HOME_TITLE`).
 *
 * From 1024px the hero is compact (owner, 4 Nov 2026: "hero and search bar
 * take too much of the screen"): a smaller h1, the search right under it, and
 * one short photo with the badge (`HeroCollage`, its badge slowly turning)
 * beside them, so the first events come up on a laptop's first screen. The
 * photo shows from 1024px only; its lead photo is lazy (a hidden image is
 * never fetched) with a high fetch priority where it shows. Below 1024px the
 * same photo is a small tile beside the eyebrow and h1 (`HeroThumb`, owner,
 * 24 Oct 2026), no taller than them, so the first event still reaches a
 * phone's first screen.
 */
export default function HomeHero() {
  const [first, second] = HOME_TITLE_LINES;
  return (
    <section aria-labelledby="home-title" className="lg:flex lg:items-center lg:justify-between lg:gap-x-12">
      <div className="lg:min-w-0 lg:flex-1">
        {/* The tile takes a fixed column at the right, so the h1's two lines keep their own width. */}
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            {/* The owner's compact hero (4 Nov 2026): 48px from 1024px until the hero is redone. */}
            <h1 id="home-title" className="display-m lg:text-5xl">
              <BrandU spoken={HOME_TITLE}>
                <span className="block">{first}</span> <span className="block">{second}</span>
              </BrandU>
            </h1>
          </div>
          <HeroThumb className="lg:hidden" />
        </div>
        {/* Search is the hero's main action: full width on phones, a comfortable field from 640px.
            The site's one search bar: the words, Where and an orange Search (components/SearchBar.tsx). */}
        <div className="mt-4 sm:mt-5 sm:max-w-xl lg:mt-4 lg:max-w-2xl">
          <SearchBar />
        </div>
      </div>
      <HeroCollage className="hidden shrink-0 lg:block" />
    </section>
  );
}
