import type { Metadata } from "next";
import { Suspense } from "react";
import AdminPage from "@/components/admin/AdminPage";
import OrganiserQueue from "@/components/admin/OrganiserQueue";
import { LoadingState } from "@/components/ui/ProgressLoader";

export const metadata: Metadata = { title: "Organisers — Sheltüh admin" };

export default function AdminOrganisersPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Organisers"
      intro="Check their links before approving. A suspended organiser can only return by applying again."
    >
      {/* The filter lives in the URL (useSearchParams), so the list renders on the client. */}
      <Suspense fallback={<LoadingState text="Loading…" />}>
        <OrganiserQueue />
      </Suspense>
    </AdminPage>
  );
}
