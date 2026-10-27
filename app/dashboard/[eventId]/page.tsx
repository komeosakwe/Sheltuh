import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { Page } from "@/components/ui/Section";
import EditEventPageContent from "@/components/dashboard/EditEventPageContent";

export const metadata: Metadata = { title: "Edit event — Sheltüh" };

/** An organiser's event: EditEventPageContent has the h1, which says whether it can be edited. */
export default function EditEventPage() {
  return (
    <Page padding="subNav">
      <div className="flex max-w-2xl flex-col gap-8">
        <BackLink href="/dashboard">Back to your events</BackLink>
        <EditEventPageContent />
      </div>
    </Page>
  );
}
