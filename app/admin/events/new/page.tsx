import type { Metadata } from "next";
import AdminNewEvent from "@/components/admin/AdminNewEvent";
import AdminPage from "@/components/admin/AdminPage";

export const metadata: Metadata = { title: "New event — Sheltüh admin" };

export default function AdminNewEventPage() {
  return (
    <AdminPage
      crumbs={[
        { href: "/admin", label: "Admin" },
        { href: "/admin/events", label: "Event submissions" },
      ]}
      title="New event"
      intro="For any approved organiser, or a Sheltüh-run (platform-managed) organiser with no account of its own. Save it as a draft, or publish it straight away."
      width="narrow"
    >
      <AdminNewEvent />
    </AdminPage>
  );
}
