import type { Metadata } from "next";
import SeatMapEditorPage from "@/components/seating/editor/SeatMapEditorPage";

export const metadata: Metadata = { title: "Seat map — Sheltüh" };

/** The organiser's seat-map editor for one of their events (docs/design/seating.md §5.13). */
export default async function SeatMapPage({ params }: PageProps<"/dashboard/[eventId]/seat-map">) {
  const { eventId } = await params;
  return <SeatMapEditorPage eventId={eventId} />;
}
