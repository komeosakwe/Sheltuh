import type { Metadata } from "next";
import DottedLine from "@/components/brand/DottedLine";
import EventFeed from "@/components/EventFeed";
import GuideCard from "@/components/home/GuideCard";
import { Page, PageHeader } from "@/components/ui/Section";
import { parseEventFilterParams } from "@/lib/event-filter-params";

export const metadata: Metadata = { title: "What’s on — Sheltüh" };

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const { category, pricing } = parseEventFilterParams(await searchParams);

  return (
    <Page>
      {/* The brand line: one dotted letter, the rest plain (owner, 30 Oct 2026). */}
      <PageHeader
        brand
        eyebrow="Events · Australia"
        title={<DottedLine line="What’s ^on." />}
      />
      {/* key: a new ?category=/?pricing= starts a fresh feed with those filters. */}
      <EventFeed key={`${category}|${pricing}`} initialCategory={category} initialPricing={pricing} />
      {/* "After dark", the editorial card, after the listings (moved off the home,
          docs/design/mobile-redesign.md §6.3.5). */}
      <GuideCard className="mt-12 sm:mt-16" />
    </Page>
  );
}
