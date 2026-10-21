import CommunitySection from "./CommunitySection";
import CreatorsCard from "./CreatorsCard";
import GuideCard from "./GuideCard";
import HomeEventSections from "./HomeEventSections";
import { HomeEventsProvider } from "./HomeEventsProvider";
import HomeHero from "./HomeHero";
import UpNext from "./UpNext";

/**
 * The home page at every width (docs/design/home.md): one tree, one outline.
 * Rails below 640px, grids from there, Up next beside the hero from 1024px.
 * The orange community band is full-bleed, so it sits outside the container.
 */
export default function Home() {
  return (
    <HomeEventsProvider>
      <div className="mx-auto max-w-6xl px-5 pt-4 sm:px-8 sm:pt-8 lg:pt-10">
        <HomeHero upNext={<UpNext />} />
        <HomeEventSections guide={<GuideCard className="reveal mt-8 sm:mt-12 lg:mt-16" />} />
      </div>
      <CommunitySection className="mt-12 sm:mt-16" />
      <div className="mx-auto max-w-6xl px-5 pb-12 sm:px-8 sm:pb-16">
        <CreatorsCard className="reveal mt-8 sm:mt-12 lg:mt-16" />
      </div>
    </HomeEventsProvider>
  );
}
