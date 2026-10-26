import type { Metadata } from "next";
import DashboardContent from "@/components/dashboard/DashboardContent";
import { Page } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Your events — Sheltüh" };

/** The organiser's events. DashboardContent has the heading, so New event sits beside it once they can create events. */
export default function DashboardPage() {
  return (
    <Page padding="subNav">
      <DashboardContent />
    </Page>
  );
}
