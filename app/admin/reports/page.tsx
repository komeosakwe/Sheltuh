import type { Metadata } from "next";
import { Suspense } from "react";
import AdminPage from "@/components/admin/AdminPage";
import ReportQueue from "@/components/admin/ReportQueue";
import { LoadingState } from "@/components/ui/ProgressLoader";

export const metadata: Metadata = { title: "Reports — Sheltüh admin" };

export default function AdminReportsPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Reports"
      intro="Oldest first. Suspending hides the member from Who’s Going and blocks messaging."
    >
      {/* The filter lives in the URL (useSearchParams), so the list renders on the client. */}
      <Suspense fallback={<LoadingState text="Loading…" />}>
        <ReportQueue />
      </Suspense>
    </AdminPage>
  );
}
