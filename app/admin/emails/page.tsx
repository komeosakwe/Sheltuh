import type { Metadata } from "next";
import AdminPage from "@/components/admin/AdminPage";
import EmailOutbox from "@/components/admin/EmailOutbox";

export const metadata: Metadata = { title: "Ticket emails — Sheltüh admin" };

export default function AdminEmailsPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Ticket emails"
      intro="Failed sends are retried automatically for about 9 hours (6 attempts). After that they wait here for a manual resend."
    >
      <EmailOutbox />
    </AdminPage>
  );
}
