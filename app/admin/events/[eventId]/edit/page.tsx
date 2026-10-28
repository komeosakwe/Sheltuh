import type { Metadata } from "next";
import AdminEditEvent from "@/components/admin/AdminEditEvent";
import AdminPage from "@/components/admin/AdminPage";

export const metadata: Metadata = { title: "Edit event — Sheltüh admin" };

export default function AdminEditEventPage() {
  return (
    <AdminPage
      crumbs={[
        { href: "/admin", label: "Admin" },
        { href: "/admin/events", label: "Events" },
      ]}
      title="Edit event"
      intro="Changes are logged where the organiser can see them."
      width="editor"
    >
      <AdminEditEvent />
    </AdminPage>
  );
}
