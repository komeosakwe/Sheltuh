import type { Metadata } from "next";
import Link from "next/link";
import AdminGate from "@/components/admin/AdminGate";
import EmailOutbox from "@/components/admin/EmailOutbox";

export const metadata: Metadata = { title: "Ticket emails — Sheltüh admin" };

export default function AdminEmailsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <Link href="/admin" className="text-sm text-accent underline underline-offset-2">
        &larr; Admin
      </Link>
      <h1 className="display-lg">Ticket emails</h1>
      <p className="max-w-xl text-sm text-muted">
        Failed sends are retried automatically for about 9 hours (6 attempts). After that they wait here for a
        manual resend.
      </p>
      <AdminGate>
        <EmailOutbox />
      </AdminGate>
    </div>
  );
}
