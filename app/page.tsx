import EventFeed from "@/components/EventFeed";
import IntentHero from "@/components/IntentHero";

export default function DiscoverPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8 sm:px-6">
      <IntentHero />

      <div id="feed" className="scroll-mt-20">
        <EventFeed />
      </div>
    </div>
  );
}
