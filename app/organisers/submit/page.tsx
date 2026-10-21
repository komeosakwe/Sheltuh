import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/Section";
import SubmitEventForm from "@/components/SubmitEventForm";

export const metadata: Metadata = {
  title: "Submit an event — Sheltüh",
};

export default function SubmitEventPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex flex-col gap-3">
        <PageHeader
          flush
          size="md"
          eyebrow="For organisers"
          title="Submit an event"
          intro="Tell us about your event. Sheltüh is Melbourne-first and focused on independent live music, art, workshops and pop-ups."
        />
        <div role="note" className="flex flex-wrap items-baseline gap-3 text-sm">
          <span className="eyebrow rounded-badge bg-signal px-2 py-1 text-signal-foreground">Demo</span>
          <span className="text-muted">
            This is a demo. Submissions are validated locally in your browser only — nothing is
            sent or saved, and no organiser approval process exists yet.
          </span>
        </div>
      </div>

      <SubmitEventForm />
    </div>
  );
}
