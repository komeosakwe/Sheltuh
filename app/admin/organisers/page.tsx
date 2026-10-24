import type { Metadata } from "next";
import AdminPage from "@/components/admin/AdminPage";
import OrganiserQueue from "@/components/admin/OrganiserQueue";

export const metadata: Metadata = { title: "Organisers — Sheltüh admin" };

export default function AdminOrganisersPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Organisers"
      intro="People who want to list events on Sheltüh. Check their links before approving. A suspended organiser can only come back by applying again."
    >
      <OrganiserQueue />
    </AdminPage>
  );
}
