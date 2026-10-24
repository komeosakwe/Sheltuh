import type { Metadata } from "next";
import { Suspense } from "react";
import AdminPage from "@/components/admin/AdminPage";
import EventQueue from "@/components/admin/EventQueue";
import { LoadingState } from "@/components/ui/ProgressLoader";

export const metadata: Metadata = { title: "Event submissions — Sheltüh admin" };

export default function AdminEventsPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Event submissions"
      intro="Events organisers have sent in, soonest first. Approve publishes an event and emails its organiser’s followers; Reject sends your reason to the organiser."
      width="wide"
    >
      {/* The filters live in the URL (useSearchParams), so the queue renders on the client. */}
      <Suspense fallback={<LoadingState text="Loading…" />}>
        <EventQueue />
      </Suspense>
    </AdminPage>
  );
}
