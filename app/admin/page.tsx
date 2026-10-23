import type { Metadata } from "next";
import Link from "next/link";
import AdminGate from "@/components/admin/AdminGate";
import { PageHeader } from "@/components/ui/Section";

export const metadata: Metadata = { title: "Admin — Sheltüh" };

/** White info cards with a black border (brand-direction-one.md §2.4): elevation without shadow. */
const cardClass = "group flex-1 rounded-card border border-foreground bg-card p-4 hover:bg-surface";

export default function AdminHomePage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-8">
        <PageHeader flush size="md" eyebrow="Sheltüh" title="Admin" />
        <AdminGate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              href="/admin/organisers"
              className={cardClass}
            >
              <p className="font-heading text-xl leading-6 text-foreground underline-offset-4 group-hover:underline">Organisers</p>
              <p className="mt-1 text-sm text-muted">Review applications, and suspend approved organisers.</p>
            </Link>
            <Link
              href="/admin/events"
              className={cardClass}
            >
              <p className="font-heading text-xl leading-6 text-foreground underline-offset-4 group-hover:underline">Event submissions</p>
              <p className="mt-1 text-sm text-muted">Review, edit, publish, reject or unpublish events.</p>
            </Link>
            <Link
              href="/admin/events/new"
              className={cardClass}
            >
              <p className="font-heading text-xl leading-6 text-foreground underline-offset-4 group-hover:underline">New event</p>
              <p className="mt-1 text-sm text-muted">
                Create an event for any organiser, or a platform-managed one, and publish it.
              </p>
            </Link>
            <Link
              href="/admin/reports"
              className={cardClass}
            >
              <p className="font-heading text-xl leading-6 text-foreground underline-offset-4 group-hover:underline">Member reports</p>
              <p className="mt-1 text-sm text-muted">Review reports, then dismiss or suspend.</p>
            </Link>
            <Link
              href="/admin/emails"
              className={cardClass}
            >
              <p className="font-heading text-xl leading-6 text-foreground underline-offset-4 group-hover:underline">Ticket emails</p>
              <p className="mt-1 text-sm text-muted">See failed ticket emails and resend them.</p>
            </Link>
          </div>
        </AdminGate>
      </div>
    </div>
  );
}
