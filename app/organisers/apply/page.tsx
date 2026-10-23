import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/Section";
import ApplyPageContent from "@/components/organisers/ApplyPageContent";

export const metadata: Metadata = { title: "Become an organiser — Sheltüh" };

export default function OrganiserApplyPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-8">
        <PageHeader
          flush
          size="md"
          eyebrow="For organisers"
          title="Become an organiser"
          intro="Apply to list your events on Sheltüh. Every application and every event is reviewed by an admin."
        />
        <ApplyPageContent />
      </div>
    </div>
  );
}
