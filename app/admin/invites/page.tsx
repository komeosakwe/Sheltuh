import type { Metadata } from "next";
import AdminPage from "@/components/admin/AdminPage";
import InvitesAdmin from "@/components/admin/InvitesAdmin";

export const metadata: Metadata = { title: "Invites — Sheltüh admin" };

export default function AdminInvitesPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Invites"
      intro="Invite someone who asked to join, as an organiser (approved when they accept) or as a member. We email them a link that works for 14 days; there are no reminders."
    >
      <InvitesAdmin />
    </AdminPage>
  );
}
