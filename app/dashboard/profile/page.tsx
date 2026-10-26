import type { Metadata } from "next";
import PublicProfilePanel from "@/components/dashboard/PublicProfilePanel";
import { Page, PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Public profile — Sheltüh" };

/** A section of the organiser area: the sub-nav (app/dashboard/layout.tsx) is the way around, then the eyebrowed page header. */
export default function DashboardProfilePage() {
  return (
    <Page width="narrow">
      <PageHeader size="md" eyebrow="Organiser" title="Public profile" />
      <PublicProfilePanel />
    </Page>
  );
}
