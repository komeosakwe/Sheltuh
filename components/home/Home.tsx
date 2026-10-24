import CategoryRow from "./CategoryRow";
import CommunitySection from "./CommunitySection";
import CreatorsCard from "./CreatorsCard";
import HomeEventSections from "./HomeEventSections";
import { HomeEventsProvider } from "./HomeEventsProvider";
import { HOME_CONTAINER } from "./HomeRail";
import HomeHero from "./HomeHero";
import WhatElse from "./WhatElse";

/** The spacing between home sections (mobile-redesign.md §3.3, tightened in the Refinement of 22 Oct 2026). */
const SECTION_GAP = "mt-8 sm:mt-10 lg:mt-12";

/**
 * The home page at every width (docs/design/mobile-redesign.md §6.1, §6.3
 * and the Refinement of 22 Oct 2026): the hero and search, the category
 * chips right under it, This weekend (then From organisers you follow, for
 * members who follow someone), Popular right now (or Coming up), What
 * else? (the three promises, restored by the owner, 23 Oct 2026), Find your
 * people (the compact full-bleed orange band, outside the page container),
 * For organisers, then the footer. Kept short so the first event's image and
 * title are on a phone's first screen. One tree, one outline, and every
 * section is visible from the start: nothing waits for a scroll. The event
 * sections sit outside the page column so their rails can run edge to edge
 * (they put their own heads back in it).
 */
export default function Home() {
  return (
    <HomeEventsProvider>
      <div className={`${HOME_CONTAINER} pt-4 sm:pt-8 lg:pt-10`}>
        <HomeHero />
        {/* Close under the search: it's the other way in. */}
        <CategoryRow className="mt-3 sm:mt-4" />
      </div>
      {/* Full width: each section's head is in the page column, its rail runs edge to edge. */}
      <HomeEventSections />
      {/* Not on phones (owner, 23 Oct 2026): it's a long scroll for little there. */}
      <div className={`${HOME_CONTAINER} hidden sm:block`}>
        <WhatElse className={SECTION_GAP} />
      </div>
      <CommunitySection className={SECTION_GAP} />
      <div className={`${HOME_CONTAINER} pb-12 sm:pb-16`}>
        <CreatorsCard className={SECTION_GAP} />
      </div>
    </HomeEventsProvider>
  );
}
