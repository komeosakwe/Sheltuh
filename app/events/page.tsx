import type { Metadata } from "next";
import EventFeed from "@/components/EventFeed";
import { Page, PageHeader } from "@/components/ui/Section";
import { parseEventFilterParams } from "@/lib/event-filter-params";

export const metadata: Metadata = { title: "All events — Sheltüh" };

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const { category, pricing } = parseEventFilterParams(await searchParams);

  return (
    <Page>
      <PageHeader
        eyebrow="Events"
        title="All events"
        intro="Every live music night, exhibition, workshop and pop-up on Sheltüh. Filter by category, price or date."
      />
      {/* key: a new ?category=/?pricing= starts a fresh feed with those filters. */}
      <EventFeed key={`${category}|${pricing}`} initialCategory={category} initialPricing={pricing} />
    </Page>
  );
}
