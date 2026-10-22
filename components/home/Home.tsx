import CategoryRow from "./CategoryRow";
import CommunitySection from "./CommunitySection";
import CreatorsCard from "./CreatorsCard";
import HomeEventSections from "./HomeEventSections";
import { HomeEventsProvider } from "./HomeEventsProvider";
import HomeHero from "./HomeHero";

/** Every home section's spacing, the hero to the first section included (mobile-redesign.md §3.3). */
const SECTION_GAP = "mt-8 sm:mt-12 lg:mt-16";

/**
 * The home page at every width (docs/design/mobile-redesign.md §6.1, §6.3),
 * in the brief's order: the hero and search, This weekend (then From
 * organisers you follow, for members who follow someone), Popular right now
 * (or Coming up), Explore by category, Find your people (the full-bleed
 * orange band, outside the page container), For organisers, then the
 * footer. One tree, one outline, and every section is visible from the
 * start: nothing waits for a scroll. "Only in the city" lives at the end of
 * /events.
 */
export default function Home() {
  return (
    <HomeEventsProvider>
      <div className="mx-auto max-w-6xl px-5 pt-5 sm:px-8 sm:pt-8 lg:pt-10">
        <HomeHero />
        <HomeEventSections />
        <CategoryRow className={SECTION_GAP} />
      </div>
      <CommunitySection className={SECTION_GAP} />
      <div className="mx-auto max-w-6xl px-5 pb-12 sm:px-8 sm:pb-16">
        <CreatorsCard className={SECTION_GAP} />
      </div>
    </HomeEventsProvider>
  );
}
