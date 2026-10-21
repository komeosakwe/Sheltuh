import type { Metadata } from "next";
import Link from "next/link";
import AdminGate from "@/components/admin/AdminGate";
import AdminNewEvent from "@/components/admin/AdminNewEvent";

export const metadata: Metadata = { title: "New event — Sheltüh admin" };

export default function AdminNewEventPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <Link href="/admin/events" className="text-sm text-accent underline underline-offset-2">
        <span aria-hidden="true">&larr;</span> Event submissions
      </Link>
      <h1 className="display-lg">New event</h1>
      <AdminGate>
        <AdminNewEvent />
      </AdminGate>
    </div>
  );
}
