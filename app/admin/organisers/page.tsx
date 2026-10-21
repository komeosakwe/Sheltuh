import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/Section";
import AdminGate from "@/components/admin/AdminGate";
import OrganiserQueue from "@/components/admin/OrganiserQueue";

export const metadata: Metadata = { title: "Organisers — Sheltüh admin" };

export default function AdminOrganisersPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-3xl flex-col gap-8">
        <BackLink href="/admin">Admin</BackLink>
        <PageHeader flush size="md" eyebrow="Admin" title="Organisers" />
        <AdminGate>
          <OrganiserQueue />
        </AdminGate>
      </div>
    </div>
  );
}
