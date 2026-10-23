import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LiveSeatPage from "@/components/seating/LiveSeatPage";
import SeatPicker from "@/components/seating/SeatPicker";
import { isApiConfigured } from "@/lib/api/client";
import { getEventBySlug } from "@/lib/data";
import { sampleSeatMap } from "@/lib/sample-seat-maps";

export async function generateMetadata({ params }: PageProps<"/events/[slug]/seats">): Promise<Metadata> {
  const { slug } = await params;
  if (isApiConfigured) return { title: "Choose seats — Sheltüh" };
  const event = await getEventBySlug(slug);
  return { title: event ? `Choose seats — ${event.title} — Sheltüh` : "Event not found — Sheltüh" };
}

/**
 * /events/[slug]/seats: choosing seats for a reserved-seating event
 * (docs/design/seating.md). Live mode loads the event, map and availability
 * client-side (LiveSeatPage); demo mode uses the sample event's local map
 * (lib/sample-seat-maps.ts), with checkout off.
 */
export default async function SeatsPage({ params }: PageProps<"/events/[slug]/seats">) {
  const { slug } = await params;
  if (isApiConfigured) return <LiveSeatPage slug={slug} />;

  const event = await getEventBySlug(slug);
  const sample = event ? sampleSeatMap(event.id) : undefined;
  if (!event || !event.seating || !sample) notFound();
  return (
    <SeatPicker
      event={event}
      map={{ version: sample.version, seatCount: sample.seatCount, template: sample.template }}
      mode="demo"
      initialUnavailable={sample.unavailable}
    />
  );
}
