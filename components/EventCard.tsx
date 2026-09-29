import EventTile from "@/components/ui/EventTile";
import type { SheltuhEvent } from "@/lib/types";

/** Kept as the app's single event-card entry point; the visual lives in ui/EventTile. */
export default function EventCard({ event }: { event: SheltuhEvent }) {
  return <EventTile event={event} />;
}
