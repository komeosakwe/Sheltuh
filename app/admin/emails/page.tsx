import type { Metadata } from "next";
import { Suspense } from "react";
import AdminPage from "@/components/admin/AdminPage";
import EmailOutbox from "@/components/admin/EmailOutbox";
import { LoadingState } from "@/components/ui/ProgressLoader";

export const metadata: Metadata = { title: "Emails — Sheltüh admin" };

export default function AdminEmailsPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Emails"
      intro="Failed sends retry for about 9 hours (6 attempts), then wait here for a manual resend."
    >
      {/* The filter lives in the URL (useSearchParams), so the list renders on the client. */}
      <Suspense fallback={<LoadingState text="Loading…" />}>
        <EmailOutbox />
      </Suspense>
    </AdminPage>
  );
}
