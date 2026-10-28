import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { Page, PageHeader } from "@/components/ui/Section";
import NewEventPageContent from "@/components/dashboard/NewEventPageContent";

export const metadata: Metadata = { title: "New event — Sheltüh" };

export default function NewEventPage() {
  return (
    <Page width="full" padding="subNav" className="max-w-7xl">
      <div className="flex flex-col gap-8">
        <BackLink href="/dashboard">Back to your events</BackLink>
        <PageHeader flush size="md" eyebrow="Organiser" title="New event" />
        <NewEventPageContent />
      </div>
    </Page>
  );
}
