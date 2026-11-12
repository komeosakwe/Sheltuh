import BrandU from "@/components/brand/BrandU";
import SearchBar from "@/components/SearchBar";
import HeroBadge from "./HeroBadge";
import { HOME_LEDE, HOME_TITLE, HOME_TITLE_LINES } from "./home-content";

/**
 * The home's hero (the proposal, redesign PR 3): one row from 1280px, as drawn. The round
 * "Melbourne · Naarm · Curated" badge (from 1024px; it turns slowly, and can be paused), the h1
 * FIND YOÜR / NEXT THING. in Display (Bootzy; the Ü through BrandU, read "Find your next
 * thing."), the one-line lede "Curated creative events. See who's going." under it, and the
 * site's search bar beside them (components/SearchBar.tsx: the words, Where and an orange
 * Search). From 1024 to 1279px the search drops under the headline, which keeps its two lines;
 * below 1024px the headline wraps where it must (never `nowrap`), then the lede, then the search,
 * full width. Nothing animates in.
 */
export default function HomeHero() {
  const [first, second] = HOME_TITLE_LINES;
  return (
    <section aria-labelledby="home-title" className="xl:flex xl:items-center xl:justify-between xl:gap-8">
      <div className="flex items-center gap-8">
        <HeroBadge className="hidden size-28 shrink-0 lg:flex" />
        <div className="min-w-0">
          <h1 id="home-title" className="display-m lg:display-l">
            <BrandU spoken={HOME_TITLE}>
              <span className="lg:block">{first}</span> <span className="lg:block">{second}</span>
            </BrandU>
          </h1>
          <p data-home-lede="" className="mt-2 body-l text-muted md:mt-4">
            {HOME_LEDE}
          </p>
        </div>
      </div>
      <div className="mt-6 md:mt-8 lg:max-w-2xl xl:mt-0 xl:w-full xl:max-w-xl">
        <SearchBar />
      </div>
    </section>
  );
}
