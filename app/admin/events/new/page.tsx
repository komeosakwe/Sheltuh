import type { Metadata } from "next";
import AdminNewEvent from "@/components/admin/AdminNewEvent";
import AdminPage from "@/components/admin/AdminPage";

export const metadata: Metadata = { title: "New event — Sheltüh admin" };

export default function AdminNewEventPage() {
  return (
    <AdminPage
      crumbs={[
        { href: "/admin", label: "Admin" },
        { href: "/admin/events", label: "Events" },
      ]}
      title="New event"
      intro="For an approved organiser, or a Sheltüh-run one with no account."
      width="editor"
    >
      <AdminNewEvent />
    </AdminPage>
  );
}
