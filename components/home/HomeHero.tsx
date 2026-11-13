import BrandU from "@/components/brand/BrandU";
import HeroBadge from "./HeroBadge";
import { HOME_LEDE, HOME_TITLE, HOME_TITLE_LINES } from "./home-content";
import HomeSearchBar from "./HomeSearchBar";

/**
 * The home's hero (the proposal, redesign PR 3): one row from 1280px, as drawn (the h1 at 56px: the owner asked for a home that shows more on first open, Nov 2026). The round
 * "Melbourne · Naarm · Curated" badge (from 1024px; it turns slowly, and can be paused), the h1
 * FIND YOÜR / NEXT THING. in Display (Bootzy; the Ü through BrandU, read "Find your next
 * thing."), the one-line lede "Curated creative events. See who's going." under it, and the
 * site's search bar beside them (components/SearchBar.tsx: the words, Where and an orange
 * Search; HomeSearchBar, which suggests the home's loaded events under its empty field). From 1024 to 1279px the search drops under the headline, which keeps its two lines;
 * below 1024px the headline wraps where it must (never `nowrap`), then the lede, then the search,
 * full width. Nothing animates in.
 */
export default function HomeHero() {
  const [first, second] = HOME_TITLE_LINES;
  return (
    <section aria-labelledby="home-title" className="xl:flex xl:items-center xl:justify-between xl:gap-8">
      <div className="flex items-center gap-8">
        <HeroBadge className="hidden size-20 shrink-0 lg:flex" />
        <div className="min-w-0">
          <h1 id="home-title" className="text-[2.625rem] leading-[2.75rem] font-display uppercase md:display-m">
            <BrandU spoken={HOME_TITLE}>
              <span className="max-md:block lg:block">{first}</span> <span className="max-md:block lg:block">{second}</span>
            </BrandU>
          </h1>
          <p data-home-lede="" className="mt-3 text-[1.0625rem] leading-7 font-medium text-muted md:mt-4 md:body-l">
            {HOME_LEDE}
          </p>
        </div>
      </div>
      <div className="mt-4 md:mt-6 lg:max-w-2xl xl:mt-0 xl:w-full xl:max-w-xl">
        <HomeSearchBar />
      </div>
    </section>
  );
}
