import type { Metadata } from "next";
import Link from "next/link";
import AdminGate from "@/components/admin/AdminGate";
import EventQueue from "@/components/admin/EventQueue";

export const metadata: Metadata = { title: "Event submissions — Sheltüh admin" };

export default function AdminEventsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href="/admin" className="text-sm text-accent underline underline-offset-2">
        &larr; Admin
      </Link>
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Event submissions</h1>
      <AdminGate>
        <EventQueue />
      </AdminGate>
    </div>
  );
}
