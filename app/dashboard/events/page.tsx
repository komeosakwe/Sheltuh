import type { Metadata } from "next";
import EventsContent from "@/components/dashboard/events/EventsContent";
import { Page } from "@/components/ui/Section";
import { ORGANISER_EVENT_FILTERS, type OrganiserEventFilter } from "@/lib/api/types";

export const metadata: Metadata = { title: "Your events — Sheltüh" };

function isFilter(value: string | undefined): value is OrganiserEventFilter {
  return (ORGANISER_EVENT_FILTERS as readonly string[]).includes(value ?? "");
}

/**
 * The organiser's events, the dashboard's Events tab (Latte's frame 433:7341). `?filter=live`,
 * `drafts` or `past` opens on that filter (the Overview's drafts bar links to the drafts); anything
 * else is All.
 */
export default async function DashboardEventsPage({ searchParams }: PageProps<"/dashboard/events">) {
  const { filter: raw } = await searchParams;
  const filter = Array.isArray(raw) ? raw[0] : raw;
  return (
    <Page padding="subNav">
      <EventsContent initialFilter={isFilter(filter) ? filter : "all"} />
    </Page>
  );
}
