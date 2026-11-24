import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { EVENTS_HREF } from "@/lib/organiser-nav";
import { Page } from "@/components/ui/Section";
import EditEventPageContent from "@/components/dashboard/EditEventPageContent";

export const metadata: Metadata = { title: "Edit event — Sheltüh" };

/** An organiser's event: EditEventPageContent has the h1, which says whether it can be edited. */
export default function EditEventPage() {
  return (
    <Page width="full" padding="subNav" className="max-w-7xl">
      <div className="flex flex-col gap-8">
        <BackLink href={EVENTS_HREF}>Back to your events</BackLink>
        <EditEventPageContent />
      </div>
    </Page>
  );
}
