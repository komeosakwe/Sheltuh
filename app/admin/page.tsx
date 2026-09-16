import type { Metadata } from "next";
import Link from "next/link";
import AdminGate from "@/components/admin/AdminGate";

export const metadata: Metadata = { title: "Admin — Sheltüh" };

export default function AdminHomePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Admin</h1>
      <AdminGate>
        <div className="flex gap-4">
          <Link
            href="/admin/organisers"
            className="flex-1 rounded-lg border border-surface-border bg-surface p-4 hover:border-accent"
          >
            <p className="font-heading text-2xl text-foreground">Organiser applications</p>
            <p className="mt-1 text-sm text-muted">Review, approve or reject applications.</p>
          </Link>
          <Link
            href="/admin/events"
            className="flex-1 rounded-lg border border-surface-border bg-surface p-4 hover:border-accent"
          >
            <p className="font-heading text-2xl text-foreground">Event submissions</p>
            <p className="mt-1 text-sm text-muted">Review, publish, reject or unpublish events.</p>
          </Link>
        </div>
      </AdminGate>
    </div>
  );
}
