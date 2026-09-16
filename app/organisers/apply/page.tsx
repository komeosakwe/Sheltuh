import type { Metadata } from "next";
import ApplyPageContent from "@/components/organisers/ApplyPageContent";

export const metadata: Metadata = { title: "Become an organiser — Sheltüh" };

export default function OrganiserApplyPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Become an organiser</h1>
        <p className="text-muted">
          Apply to list your events on Sheltüh. Every application and every event is reviewed by
          an admin.
        </p>
      </div>
      <ApplyPageContent />
    </div>
  );
}
