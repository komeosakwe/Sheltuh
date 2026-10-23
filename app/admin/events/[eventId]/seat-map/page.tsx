import type { Metadata } from "next";
import AdminGate from "@/components/admin/AdminGate";
import AdminSeatMap from "@/components/admin/AdminSeatMap";

export const metadata: Metadata = { title: "Seat map — Sheltüh admin" };

/** An admin's view of an event's seat map: preview as buyer, read-only editor, replace or remove (§5.14). */
export default async function AdminSeatMapPage({ params }: PageProps<"/admin/events/[eventId]/seat-map">) {
  const { eventId } = await params;
  return (
    <AdminGate>
      <AdminSeatMap eventId={eventId} />
    </AdminGate>
  );
}
