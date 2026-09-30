import EventPreview from "@/components/EventPreview";
import { PartnerBand, WhatElse } from "@/components/HomeSections";
import IntentHero from "@/components/IntentHero";
import PhoneHome from "@/components/home/phone/PhoneHome";
import { SectionHeader } from "@/components/ui/Section";

export default function DiscoverPage() {
  return (
    <>
      {/* Below 640px the phone home replaces the desktop tree (hidden, so there's one h1 and one set of landmarks). */}
      <PhoneHome className="sm:hidden" />

      <div className="hidden sm:block">
        <IntentHero />

        {/* scroll-mt adds to html's header-based scroll-padding-top; lg keeps its existing offset. */}
        <div id="feed" className="mx-auto max-w-6xl scroll-mt-4 px-5 pb-12 pt-8 sm:px-8 sm:py-24 lg:scroll-mt-20">
          <div className="reveal"><SectionHeader
            title="Coming up in Melbourne"
            intro="The most interesting live music, art, workshops and pop-ups in your city — curated, not scraped."
          /></div>
          <EventPreview />
        </div>

        <WhatElse />
        <PartnerBand />
      </div>
    </>
  );
}
