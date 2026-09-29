import EventFeed from "@/components/EventFeed";
import { PartnerBand, WhatElse } from "@/components/HomeSections";
import IntentHero from "@/components/IntentHero";
import { SectionHeader } from "@/components/ui/Section";

export default function DiscoverPage() {
  return (
    <>
      <IntentHero />

      {/* scroll-mt adds to html's header-based scroll-padding-top; lg keeps its existing offset. */}
      <div id="feed" className="mx-auto max-w-6xl scroll-mt-4 px-5 pb-12 pt-8 sm:px-8 sm:py-24 lg:scroll-mt-20">
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
