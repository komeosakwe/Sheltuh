import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/Section";
import AdminEditEvent from "@/components/admin/AdminEditEvent";
import AdminGate from "@/components/admin/AdminGate";

export const metadata: Metadata = { title: "Edit event — Sheltüh admin" };

export default function AdminEditEventPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-8">
        <BackLink href="/admin/events">Event submissions</BackLink>
        <PageHeader flush size="md" eyebrow="Admin" title="Edit event" />
        <AdminGate>
          <AdminEditEvent />
        </AdminGate>
      </div>
    </div>
  );
}
