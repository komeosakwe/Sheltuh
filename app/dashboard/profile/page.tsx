import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import PublicProfilePanel from "@/components/dashboard/PublicProfilePanel";
import { Page, PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Public profile — Sheltüh" };

/** The same rhythm as the newer dashboard pages (analytics): back link, then the eyebrowed page header. */
export default function DashboardProfilePage() {
  return (
    <Page width="narrow">
      <div className="mb-6">
        <BackLink href="/dashboard">Your events</BackLink>
      </div>
      <PageHeader size="md" eyebrow="Organiser" title="Public profile" />
      <PublicProfilePanel />
    </Page>
  );
}
