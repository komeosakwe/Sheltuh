import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EventDetailsView from "@/components/EventDetailsView";
import LiveEventDetails from "@/components/LiveEventDetails";
import { isApiConfigured } from "@/lib/api/client";
import { getEventBySlug } from "@/lib/data";
import { liveEventMetadata } from "@/lib/server/share-metadata";
import { EVENT_NOT_FOUND_METADATA, eventMetadata, siteOrigin } from "@/lib/share-metadata";

interface EventDetailsPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Server-side, so link previews (Open Graph, Twitter/X) and the canonical URL
 * are in the HTML crawlers read, though live mode renders the page itself
 * client-side. Live: a published event's details, read with the page's own
 * visibility rule (lib/server/share-metadata.ts); anything else is the same
 * noindex "not found", and a database error generic metadata, never a 500.
 * Demo: the sample event's, the same way. The preview image is the segment's
 * own opengraph-image / twitter-image (the event's card), which Next only
 * uses when this metadata sets no `images`, so it sets none.
 */
export async function generateMetadata({ params }: EventDetailsPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (isApiConfigured) return liveEventMetadata(slug);
  const event = await getEventBySlug(slug);
  return event ? eventMetadata(event, siteOrigin()) : EVENT_NOT_FOUND_METADATA;
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
