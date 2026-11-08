import type { Metadata } from "next";
import { Suspense } from "react";
import EventOrders from "@/components/dashboard/EventOrders";

export const metadata: Metadata = { title: "Event orders — Sheltüh admin" };

/** A platform-managed organiser's event orders, for an admin. Gated by app/admin/layout.tsx. */
export default async function AdminEventOrdersPage({ params }: PageProps<"/admin/events/[eventId]/orders">) {
  const { eventId } = await params;
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <EventOrders eventId={eventId} scope="admin" />
      </Suspense>
    </div>
  );
}
