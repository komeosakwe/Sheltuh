import type { Metadata } from "next";
import AdminPage from "@/components/admin/AdminPage";
import InvitesAdmin from "@/components/admin/InvitesAdmin";
import { INVITE_LINK_DAYS } from "@/lib/invites";

export const metadata: Metadata = { title: "Invites — Sheltüh admin" };

export default function AdminInvitesPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Invites"
      intro={`Send an organiser a link that makes them an approved organiser (no email or details needed), or invite someone who asked to join by email, as an organiser or a member: we email them a link that works for ${INVITE_LINK_DAYS} days, with no reminders.`}
    >
      <InvitesAdmin />
    </AdminPage>
  );
}
