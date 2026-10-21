import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/Section";
import AdminGate from "@/components/admin/AdminGate";
import ReportQueue from "@/components/admin/ReportQueue";

export const metadata: Metadata = { title: "Member reports — Sheltüh admin" };

export default function AdminReportsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <BackLink href="/admin">Admin</BackLink>
      <PageHeader flush size="md" eyebrow="Admin" title="Member reports" />
      <AdminGate>
        <ReportQueue />
      </AdminGate>
    </div>
  );
}
