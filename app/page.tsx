import EventFeed from "@/components/EventFeed";
import { PartnerBand, WhatElse } from "@/components/HomeSections";
import IntentHero from "@/components/IntentHero";
import { SectionHeader } from "@/components/ui/Section";

export default function DiscoverPage() {
  return (
    <>
      <IntentHero />

      <div id="feed" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:px-8 sm:py-24">
        <SectionHeader
          title="Coming up in Melbourne"
          intro="The most interesting live music, art, workshops and pop-ups in your city — curated, not scraped."
        />
        <EventFeed />
      </div>

      <WhatElse />
      <PartnerBand />
    </>
  );
}
