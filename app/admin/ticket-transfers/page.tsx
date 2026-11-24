import type { Metadata } from "next";
import { Suspense } from "react";
import AdminPage from "@/components/admin/AdminPage";
import TicketTransfersAdmin from "@/components/admin/TicketTransfersAdmin";
import { LoadingState } from "@/components/ui/ProgressLoader";

export const metadata: Metadata = { title: "Ticket transfers — Sheltüh admin" };

export default function AdminTicketTransfersPage() {
  return (
    <AdminPage
      crumbs={[
        { href: "/admin", label: "Admin" },
        { href: "/admin/emails", label: "Emails" },
      ]}
      title="Ticket transfers"
      intro="Tickets buyers sent to someone else. Check here before refunding an order: a refund voids the tickets it sent too. You can cancel an offer that’s still waiting; an accepted one can’t be undone."
    >
      {/* The reference lives in the URL (useSearchParams), so the list renders on the client. */}
      <Suspense fallback={<LoadingState text="Loading…" />}>
        <TicketTransfersAdmin />
      </Suspense>
    </AdminPage>
  );
}
