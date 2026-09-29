import type { Metadata } from "next";
import Link from "next/link";
import AdminGate from "@/components/admin/AdminGate";

export const metadata: Metadata = { title: "Admin — Sheltüh" };

export default function AdminHomePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <h1 className="display-lg">Admin</h1>
      <AdminGate>
        <div className="flex gap-4">
          <Link
            href="/admin/organisers"
            className="flex-1 bg-surface p-4 hover:border-accent"
          >
            <p className="font-heading text-2xl text-foreground">Organiser applications</p>
            <p className="mt-1 text-sm text-muted">Review, approve or reject applications.</p>
          </Link>
          <Link
            href="/admin/events"
            className="flex-1 bg-surface p-4 hover:border-accent"
          >
            <p className="font-heading text-2xl text-foreground">Event submissions</p>
            <p className="mt-1 text-sm text-muted">Review, publish, reject or unpublish events.</p>
          </Link>
        </div>
      </AdminGate>
    </div>
  );
}
