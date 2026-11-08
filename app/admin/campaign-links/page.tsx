import type { Metadata } from "next";
import AdminPage from "@/components/admin/AdminPage";
import CampaignLinks from "@/components/admin/CampaignLinks";

export const metadata: Metadata = { title: "Campaign links — Sheltüh admin" };

export default function AdminCampaignLinksPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Campaign links"
      intro="Make a link for a post, bio, newsletter or poster. Usage analytics then shows the signups and sales it brought in."
      width="narrow"
    >
      <CampaignLinks />
    </AdminPage>
  );
}
