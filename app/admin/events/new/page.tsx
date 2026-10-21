import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/Section";
import AdminGate from "@/components/admin/AdminGate";
import AdminNewEvent from "@/components/admin/AdminNewEvent";

export const metadata: Metadata = { title: "New event — Sheltüh admin" };

export default function AdminNewEventPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <BackLink href="/admin/events">Event submissions</BackLink>
      <PageHeader flush size="md" eyebrow="Admin" title="New event" />
      <AdminGate>
        <AdminNewEvent />
      </AdminGate>
    </div>
  );
}
