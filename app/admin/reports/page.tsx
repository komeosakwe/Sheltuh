import type { Metadata } from "next";
import AdminPage from "@/components/admin/AdminPage";
import ReportQueue from "@/components/admin/ReportQueue";

export const metadata: Metadata = { title: "Member reports — Sheltüh admin" };

export default function AdminReportsPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Member reports"
      intro="Members’ reports about messages, Who’s Going names and profiles, oldest first. Dismiss a report, or suspend the member: they’re hidden from Who’s Going and can’t send messages."
    >
      <ReportQueue />
    </AdminPage>
  );
}
