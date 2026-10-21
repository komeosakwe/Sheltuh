import type { Metadata } from "next";
import BackLink from "@/components/ui/BackLink";
import { PageHeader } from "@/components/ui/Section";
import AdminGate from "@/components/admin/AdminGate";
import EmailOutbox from "@/components/admin/EmailOutbox";

export const metadata: Metadata = { title: "Ticket emails — Sheltüh admin" };

export default function AdminEmailsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <BackLink href="/admin">Admin</BackLink>
      <PageHeader
        flush
        size="md"
        eyebrow="Admin"
        title="Ticket emails"
        intro="Failed sends are retried automatically for about 9 hours (6 attempts). After that they wait here for a manual resend."
      />
      <AdminGate>
        <EmailOutbox />
      </AdminGate>
    </div>
  );
}
