import type { Metadata } from "next";
import Link from "next/link";
import PublicProfilePanel from "@/components/dashboard/PublicProfilePanel";
import { Page, PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Public profile — Sheltüh" };

/** The same rhythm as the newer dashboard pages (analytics): back link, then the eyebrowed page header. */
export default function DashboardProfilePage() {
  return (
    <Page width="narrow">
      <Link
        href="/dashboard"
        className="eyebrow mb-6 inline-flex min-h-11 w-fit items-center underline underline-offset-4"
      >
        <span aria-hidden="true">&larr;</span> Your events
      </Link>
      <PageHeader eyebrow="Organiser" title="Public profile" />
      <PublicProfilePanel />
    </Page>
  );
}
