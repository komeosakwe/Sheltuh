import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EventDetailsView from "@/components/EventDetailsView";
import LiveEventDetails from "@/components/LiveEventDetails";
import { isApiConfigured } from "@/lib/api/client";
import { getEventBySlug } from "@/lib/data";

interface EventDetailsPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: EventDetailsPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (isApiConfigured) {
    return { title: "Sheltüh" };
  }
  const event = await getEventBySlug(slug);
  return { title: event ? `${event.title} — Sheltüh` : "Event not found — Sheltüh" };
}

export default async function EventDetailsPage({ params }: EventDetailsPageProps) {
  const { slug } = await params;

  if (isApiConfigured) {
    // Live mode fetches (and shows loading/error states) client-side —
    // see components/LiveEventDetails.tsx.
    return <LiveEventDetails slug={slug} />;
  }

  const event = await getEventBySlug(slug);
  if (!event) {
    notFound();
  }
  return <EventDetailsView event={event} demo />;
}
