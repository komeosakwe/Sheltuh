import type { Metadata } from "next";
import { Suspense } from "react";
import AdminPage from "@/components/admin/AdminPage";
import TransferQueue from "@/components/admin/TransferQueue";
import { LoadingState } from "@/components/ui/ProgressLoader";

export const metadata: Metadata = { title: "Payouts — Sheltüh admin" };

export default function AdminPayoutsPage() {
  return (
    <AdminPage crumbs={[{ href: "/admin", label: "Admin" }]} title="Payouts">
      {/* The filter lives in the URL (useSearchParams), so the list renders on the client. */}
      <Suspense fallback={<LoadingState text="Loading…" />}>
        <TransferQueue />
      </Suspense>
    </AdminPage>
  );
}
