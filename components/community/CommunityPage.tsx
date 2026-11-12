import CommunityHero from "./CommunityHero";
import { CommunityEventsProvider } from "./CommunityEventsProvider";
import JoinBanner from "./JoinBanner";
import LocalDiscovery from "./LocalDiscovery";
import ScenesByCity from "./ScenesByCity";
import WhoSeesYou from "./WhoSeesYou";

/**
 * /community (redesign PR 3), built only from what is real: the hero (FIND YOÜR PEOPLE.), Local
 * discovery (upcoming events) beside You choose who sees you (how Who's Going's opt-in works),
 * Scenes by city (links to Nearby set to each city, with real counts) and the join banner (only
 * the steps that exist). The proposal's Word of mouth, Follow scenes, member counts and "2 you
 * know" wait for Batch 3. Works in demo and live; the events load in the browser.
 */
export default function CommunityPage() {
  return (
    <>
      <CommunityHero />
      <CommunityEventsProvider>
        <div className="page-container pb-16 md:pb-24">
          {/* The two panels are as tall as each other (grid rows stretch). */}
          <div className="mt-12 grid gap-6 md:mt-16 lg:mt-24 lg:grid-cols-12 lg:gap-8">
            <LocalDiscovery className="min-w-0 lg:col-span-7" />
            <WhoSeesYou className="lg:col-span-5" />
          </div>
          <ScenesByCity className="mt-16 lg:mt-24" />
          <JoinBanner className="mt-16 lg:mt-24" />
        </div>
      </CommunityEventsProvider>
    </>
  );
}
