import type { Metadata, Viewport } from "next";
import CheckInPage from "@/components/check-in/CheckInPage";
import { DOOR_THEME_COLOR } from "@/lib/pwa/theme";

export const metadata: Metadata = { title: "Door check-in — Sheltüh" };

/** Ink status bar over the ink door surface (docs/design/check-in.md §3.1). */
export const viewport: Viewport = { themeColor: DOOR_THEME_COLOR };

export default async function DoorCheckInPage({ params }: PageProps<"/dashboard/[eventId]/check-in">) {
  const { eventId } = await params;
  return <CheckInPage eventId={eventId} />;
}
