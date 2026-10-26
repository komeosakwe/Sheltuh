import type { Metadata } from "next";
import EventFeed from "@/components/EventFeed";
import GuideCard from "@/components/home/GuideCard";
import { Page, PageHeader } from "@/components/ui/Section";
import { parseEventFilterParams } from "@/lib/event-filter-params";

export const metadata: Metadata = { title: "What’s on — Sheltüh" };

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const { category, pricing } = parseEventFilterParams(await searchParams);

  return (
    <Page>
      {/* The brand line (owner decision 1), in the display face: it reads as written. */}
      <PageHeader
        brand
        eyebrow="Events · Australia"
        title="What’s on."
        intro="Every live music night, exhibition, workshop and pop-up on Sheltüh. Filter by category, price or date."
      />
      {/* key: a new ?category=/?pricing= starts a fresh feed with those filters. */}
      <EventFeed key={`${category}|${pricing}`} initialCategory={category} initialPricing={pricing} />
      {/* "Only in the city", the editorial card, after the listings (moved off the home,
          docs/design/mobile-redesign.md §6.3.5). */}
      <GuideCard className="mt-12 sm:mt-16" />
    </Page>
  );
}
