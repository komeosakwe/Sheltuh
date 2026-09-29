import type { Metadata } from "next";
import EventFeed from "@/components/EventFeed";
import { Page, PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = { title: "All events — Sheltüh" };

export default function EventsPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Events"
        title="All events"
        intro="Every live music night, exhibition, workshop and pop-up on Sheltüh. Filter by category, price or date."
      />
      <EventFeed />
    </Page>
  );
}
