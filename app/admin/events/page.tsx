import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/Section";
import AdminGate from "@/components/admin/AdminGate";
import EventQueue from "@/components/admin/EventQueue";

export const metadata: Metadata = { title: "Event submissions — Sheltüh admin" };

export default function AdminEventsPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <BackLink href="/admin">Admin</BackLink>
      <PageHeader flush size="md" eyebrow="Admin" title="Event submissions" />
      <AdminGate>
        <EventQueue />
      </AdminGate>
    </div>
  );
}
