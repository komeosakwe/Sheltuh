import type { Metadata } from "next";
import DashboardContent from "@/components/dashboard/DashboardContent";

export const metadata: Metadata = { title: "Your events — Sheltüh" };

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Your events</h1>
      <DashboardContent />
    </div>
  );
}
