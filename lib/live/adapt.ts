import type { PublicEvent } from "@/lib/api/public-events";
import type { SheltuhEvent } from "@/lib/types";
import { assignPoster } from "./assign-poster";

/** Maps a live API event onto the same shape the existing demo screens render. */
export function adaptPublicEvent(event: PublicEvent): SheltuhEvent {
  return {
    id: event.eventId,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    suburb: event.suburb,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    organiserName: event.organiserName,
    poster: assignPoster(event.slug),
    ticketTypes: event.ticketTypes,
  };
}
