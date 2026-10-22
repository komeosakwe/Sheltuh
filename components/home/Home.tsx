import CategoryRow from "./CategoryRow";
import CommunitySection from "./CommunitySection";
import CreatorsCard from "./CreatorsCard";
import HomeEventSections from "./HomeEventSections";
import { HomeEventsProvider } from "./HomeEventsProvider";
import HomeHero from "./HomeHero";

/** The spacing between home sections (mobile-redesign.md §3.3, tightened in the Refinement of 22 Oct 2026). */
const SECTION_GAP = "mt-8 sm:mt-10 lg:mt-12";

/**
 * The home page at every width (docs/design/mobile-redesign.md §6.1, §6.3
 * and the Refinement of 22 Oct 2026): the hero and search, the category
 * chips right under it, This weekend (then From organisers you follow, for
 * members who follow someone), Popular right now (or Coming up), Find your
 * people (the compact full-bleed orange band, outside the page container),
 * For organisers, then the footer. Kept short so the first event's image and
 * title are on a phone's first screen. One tree, one outline, and every
 * section is visible from the start: nothing waits for a scroll.
 */
export default function Home() {
  return (
    <HomeEventsProvider>
      <div className="mx-auto max-w-6xl px-5 pt-4 sm:px-8 sm:pt-8 lg:pt-10">
        <HomeHero />
        {/* Close under the search: it's the other way in. */}
        <CategoryRow className="mt-3 sm:mt-4" />
        <HomeEventSections />
      </div>
      <CommunitySection className={SECTION_GAP} />
      <div className="mx-auto max-w-6xl px-5 pb-12 sm:px-8 sm:pb-16">
        <CreatorsCard className={SECTION_GAP} />
      </div>
    </HomeEventsProvider>
  );
}
