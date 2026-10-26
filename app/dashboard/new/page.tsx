import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { Page, PageHeader } from "@/components/ui/Section";
import NewEventPageContent from "@/components/dashboard/NewEventPageContent";

export const metadata: Metadata = { title: "New event — Sheltüh" };

export default function NewEventPage() {
  return (
    <Page padding="subNav">
      <div className="flex max-w-2xl flex-col gap-8">
        <BackLink href="/dashboard">Back to your events</BackLink>
        <PageHeader flush size="md" eyebrow="Organiser" title="New event" />
        <NewEventPageContent />
      </div>
    </Page>
  );
}
