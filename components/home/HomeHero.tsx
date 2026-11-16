import BrandU from "@/components/brand/BrandU";
import HeroBadge from "./HeroBadge";
import { HOME_LEDE, HOME_TITLE, HOME_TITLE_LINES } from "./home-content";
import HomeSearchBar from "./HomeSearchBar";

/**
 * The home's hero (the proposal, redesign PR 3; Round 2 §1.2–1.3): one row from 1024px. The round
 * "Melbourne · Naarm · Curated" badge (from 1024px, 72px and 80px from 1280px; it turns slowly, and
 * can be paused), the h1 FIND YOÜR / NEXT THING. in display-hero (Bootzy capitals, 40/48, 48/56 from
 * 768px, 56/64 from 1280px; the Ü through BrandU, read "Find your next thing."), the one-line lede
 * "Curated creative events. See who's going." under it in body-m, and the site's search bar beside
 * them (components/SearchBar.tsx: the words, Where and an orange Search; HomeSearchBar, which
 * suggests the home's loaded events under its empty field), 448px wide from 1024px and 576px from
 * 1280px. Below 1024px the headline wraps where it must (never `nowrap`), then the lede, then the
 * search, full width. Nothing animates in.
 */
export default function HomeHero() {
  const [first, second] = HOME_TITLE_LINES;
  return (
    <section aria-labelledby="home-title" className="lg:flex lg:items-center lg:justify-between lg:gap-8">
      <div className="flex items-center gap-8">
        <HeroBadge className="hidden size-18 shrink-0 lg:flex xl:size-20" />
        <div className="min-w-0">
          <h1 id="home-title" className="display-hero">
            <BrandU spoken={HOME_TITLE}>
              <span className="max-md:block lg:block">{first}</span> <span className="max-md:block lg:block">{second}</span>
            </BrandU>
          </h1>
          <p data-home-lede="" className="mt-3 body-m text-muted md:mt-4">
            {HOME_LEDE}
          </p>
        </div>
      </div>
      <div className="mt-4 md:mt-6 lg:mt-0 lg:w-full lg:max-w-md xl:max-w-xl">
        <HomeSearchBar />
      </div>
    </section>
  );
}
