import CommunitySection from "./CommunitySection";
import CreatorsCard from "./CreatorsCard";
import HomeEventSections from "./HomeEventSections";
import { HomeEventsProvider } from "./HomeEventsProvider";
import HomeHero from "./HomeHero";

/** The space above the home's last two sections (the proposal's rhythm). */
const SECTION_GAP = "mt-16 md:mt-24";

/**
 * The home page (the proposal, redesign PR 3), top to bottom: the hero (the h1, the lede and
 * the search, on one row from 1280px), the featured carousel, the category chips, This weekend,
 * From organisers you follow (members who follow someone), All events with its filters, Find
 * your people (the compact "See who's going." band), and Bring your event to life, then the
 * footer. Everything sits in the page column (1312px of content: four 304px cards at 1440).
 * One tree, one outline; every section is visible from the start, nothing waits for a scroll.
 * The rails, the marquee, What else? and Recently on are gone (the audit), and so are the
 * proposal's Fashion / Art / Music community cards (no data behind them).
 */
export default function Home() {
  return (
    <HomeEventsProvider>
      <div className="page-container pt-6 md:pt-8">
        <HomeHero />
      </div>
      <HomeEventSections />
      <div className="page-container pb-16 md:pb-24">
        <CommunitySection className={SECTION_GAP} />
        <CreatorsCard className={SECTION_GAP} />
      </div>
    </HomeEventsProvider>
  );
}
