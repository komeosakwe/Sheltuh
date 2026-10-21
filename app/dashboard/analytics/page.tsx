import type { Metadata } from "next";
import { LoadingIndicator } from "@/components/ui/ProgressLoader";
import { Suspense } from "react";
import AnalyticsOverview from "@/components/analytics/AnalyticsOverview";
import { Page } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Analytics — Sheltüh" };

export default function AnalyticsPage() {
  return (
    <Page>
      {/* The range lives in the URL (useSearchParams), so the report renders on the client. */}
      <Suspense fallback={<LoadingIndicator label="Loading analytics" />}>
        <AnalyticsOverview />
      </Suspense>
    </Page>
  );
}
