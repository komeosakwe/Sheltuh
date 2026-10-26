import type { Metadata } from "next";
import DashboardContent from "@/components/dashboard/DashboardContent";

export const metadata: Metadata = { title: "Your events — Sheltüh" };

/** The organiser's events. DashboardContent has the heading, so New event sits beside it once they can create events. */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <DashboardContent />
    </div>
  );
}
