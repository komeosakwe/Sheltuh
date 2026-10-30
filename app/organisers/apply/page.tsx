import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui/Section";
import ApplyPageContent from "@/components/organisers/ApplyPageContent";

export const metadata: Metadata = { title: "Become an organiser — Sheltüh" };

export default function OrganiserApplyPage() {
  return (
    <Page width="narrow">
      <div className="flex flex-col gap-8">
        <PageHeader
          flush
          size="md"
          eyebrow="For organisers"
          title="Become an organiser"
        />
        <ApplyPageContent />
      </div>
    </Page>
  );
}
