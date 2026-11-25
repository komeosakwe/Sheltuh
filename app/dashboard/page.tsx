import type { Metadata } from "next";
import OverviewContent from "@/components/dashboard/overview/OverviewContent";
import { Page } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Overview — Sheltüh" };

/**
 * The organiser dashboard's home, the Overview (Latte's frame 430:7340). The events list is the
 * Events tab, /dashboard/events. The page fills the frame's column (flex-1), so the Performance
 * column reaches the panel's foot.
 */
export default function DashboardPage() {
  return (
    <Page padding="subNav" className="flex flex-1 flex-col">
      <OverviewContent />
    </Page>
  );
}
