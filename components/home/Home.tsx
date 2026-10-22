import CategoryRow from "./CategoryRow";
import CommunitySection from "./CommunitySection";
import CreatorsCard from "./CreatorsCard";
import GuideCard from "./GuideCard";
import HomeEventSections from "./HomeEventSections";
import { HomeEventsProvider } from "./HomeEventsProvider";
import HomeHero from "./HomeHero";

/**
 * The home page at every width (docs/design/mobile-redesign.md §6.1, §6.3):
 * one tree, one outline. The hero, the event sections (rails below 640px,
 * grids from there), Explore by category, then the full-bleed orange
 * community band (outside the page container) and the organiser pitch.
 * Every section is visible from the start: nothing waits for a scroll.
 */
export default function Home() {
  return (
    <HomeEventsProvider>
      <div className="mx-auto max-w-6xl px-5 pt-5 sm:px-8 sm:pt-8 lg:pt-10">
        <HomeHero />
        <HomeEventSections guide={<GuideCard className="mt-8 sm:mt-12 lg:mt-16" />} />
        <CategoryRow className="mt-8 sm:mt-12 lg:mt-16" />
      </div>
      <CommunitySection className="mt-12 sm:mt-16" />
      <div className="mx-auto max-w-6xl px-5 pb-12 sm:px-8 sm:pb-16">
        <CreatorsCard className="mt-8 sm:mt-12 lg:mt-16" />
      </div>
    </HomeEventsProvider>
  );
}
