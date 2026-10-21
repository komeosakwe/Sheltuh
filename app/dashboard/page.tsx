import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/Section";
import DashboardContent from "@/components/dashboard/DashboardContent";

export const metadata: Metadata = { title: "Your events — Sheltüh" };

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <PageHeader flush size="md" eyebrow="Organiser" title="Your events" />
      <DashboardContent />
    </div>
  );
}
