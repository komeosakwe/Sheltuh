import type { Metadata } from "next";
import ApplyPageContent from "@/components/organisers/ApplyPageContent";

export const metadata: Metadata = { title: "Become an organiser — Sheltüh" };

export default function OrganiserApplyPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex flex-col gap-2">
        <h1 className="display-lg">Become an organiser</h1>
        <p className="text-muted">
          Apply to list your events on Sheltüh. Every application and every event is reviewed by
          an admin.
        </p>
      </div>
      <ApplyPageContent />
    </div>
  );
}
