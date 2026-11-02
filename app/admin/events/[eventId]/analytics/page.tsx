import type { Metadata } from "next";
import { Suspense } from "react";
import EventAnalytics from "@/components/analytics/EventAnalytics";

export const metadata: Metadata = { title: "Event analytics — Sheltüh admin" };

/** Any event's analytics, read-only, for an admin. Gated by app/admin/layout.tsx. */
export default async function AdminEventAnalyticsPage({ params }: PageProps<"/admin/events/[eventId]/analytics">) {
  const { eventId } = await params;
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <EventAnalytics eventId={eventId} scope="admin" />
      </Suspense>
    </div>
  );
}
