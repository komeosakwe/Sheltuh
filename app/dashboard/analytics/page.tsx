import type { Metadata } from "next";
import { Suspense } from "react";
import AnalyticsOverview from "@/components/analytics/AnalyticsOverview";
import { Page } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Analytics — Sheltüh" };

export default function AnalyticsPage() {
  return (
    <Page>
      {/* The range lives in the URL (useSearchParams), so the report renders on the client. */}
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <AnalyticsOverview />
      </Suspense>
    </Page>
  );
}
