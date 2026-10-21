import type { Metadata } from "next";
import Link from "next/link";
import AdminEditEvent from "@/components/admin/AdminEditEvent";
import AdminGate from "@/components/admin/AdminGate";

export const metadata: Metadata = { title: "Edit event — Sheltüh admin" };

export default function AdminEditEventPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <Link href="/admin/events" className="text-sm text-accent underline underline-offset-2">
        <span aria-hidden="true">&larr;</span> Event submissions
      </Link>
      <h1 className="display-lg">Edit event</h1>
      <AdminGate>
        <AdminEditEvent />
      </AdminGate>
    </div>
  );
}
