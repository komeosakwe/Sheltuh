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
      intro={`Email invites work for ${INVITE_LINK_DAYS} days, with no reminders. Organiser links approve the organiser straight away.`}
    >
      <InvitesAdmin />
    </AdminPage>
  );
}
