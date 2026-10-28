import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/Section";
import SubmitEventForm from "@/components/SubmitEventForm";

export const metadata: Metadata = {
  title: "Submit an event — Sheltüh",
};

export default function SubmitEventPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-8">
        <div className="flex flex-col gap-3">
          <PageHeader
            flush
            size="md"
            eyebrow="For organisers"
            title="Submit an event"
          />
          <div role="note" className="flex flex-wrap items-baseline gap-3 text-sm">
            <span className="eyebrow rounded-badge bg-signal px-2 py-1 text-signal-foreground">Demo</span>
            <span className="text-muted">
              Nothing is sent or saved.
            </span>
          </div>
        </div>
  
        <SubmitEventForm />
      </div>
    </div>
  );
}
