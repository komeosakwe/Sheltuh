import type { Metadata } from "next";
import HolderMessages from "@/components/admin/HolderMessages";
import AdminPage from "@/components/admin/AdminPage";

export const metadata: Metadata = { title: "Event messages — Sheltüh admin" };

export default function AdminEventMessagesPage() {
  return (
    <AdminPage
      crumbs={[
        { href: "/admin", label: "Admin" },
        { href: "/admin/emails", label: "Emails" },
      ]}
      title="Event messages"
      intro="What organisers have sent to their ticket holders. Stop one to keep the rest from going out."
    >
      <HolderMessages />
    </AdminPage>
  );
}
