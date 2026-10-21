import type { Metadata } from "next";
import { Suspense } from "react";
import EventAnalytics from "@/components/analytics/EventAnalytics";
import { Page } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Event analytics — Sheltüh" };

export default async function EventAnalyticsPage({ params }: PageProps<"/dashboard/events/[id]/analytics">) {
  const { id } = await params;
  return (
    <Page>
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <EventAnalytics eventId={id} />
      </Suspense>
    </Page>
  );
}
