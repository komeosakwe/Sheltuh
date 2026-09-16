import type { Metadata } from "next";
import SubmitEventForm from "@/components/SubmitEventForm";

export const metadata: Metadata = {
  title: "Submit an event — Sheltüh",
};

export default function SubmitEventPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Submit an event</h1>
        <p className="text-muted">
          Tell us about your event. Sheltüh is Melbourne-first and focused on independent live
          music, art, workshops and pop-ups.
        </p>
        <div
          role="note"
          className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground"
        >
          <span className="font-heading mr-2 align-middle text-accent">Demo</span>
          <span className="align-middle text-muted">
            This is a demo. Submissions are validated locally in your browser only — nothing is
            sent or saved, and no organiser approval process exists yet.
          </span>
        </div>
      </div>

      <SubmitEventForm />
    </div>
  );
}
