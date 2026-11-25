import type { Metadata } from "next";
import { Suspense } from "react";
import EventsContent from "@/components/dashboard/events/EventsContent";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Page } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Your events — Sheltüh" };

/**
 * The organiser's events, the dashboard's Events tab (Latte's frame 433:7341). `?filter=live`,
 * `drafts` or `past` shows that filter (the Overview's drafts bar links to the drafts); anything else
 * is All. EventsContent reads the address itself (useSearchParams), so it follows every change to it;
 * the Suspense boundary is where the page waits for the address while it's prerendered.
 */
export default function DashboardEventsPage() {
  return (
    <Page padding="subNav">
      <Suspense fallback={<LoadingState text="Loading your events…" />}>
        <EventsContent />
      </Suspense>
    </Page>
  );
}
