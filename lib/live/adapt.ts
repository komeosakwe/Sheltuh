import type { PublicEvent } from "@/lib/api/public-events";
import type { SheltuhEvent } from "@/lib/types";
import { assignPoster } from "./assign-poster";

/** Maps a live API event onto the same shape the existing demo screens render. */
export function adaptPublicEvent(event: PublicEvent): SheltuhEvent {
  return {
    id: event.eventId,
    organiserId: event.organiserId,
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
    imageUrl: event.imageUrl,
    // Only the fields the UI knows: what's left comes from the server's own
    // `soldOut` / `remaining` (shown only at 10 or fewer), never worked out here.
    ticketTypes: event.ticketTypes.map((ticket) => ({
      id: ticket.id,
      name: ticket.name,
      ...(ticket.description !== undefined ? { description: ticket.description } : {}),
      priceCents: ticket.priceCents,
      feePolicy: ticket.feePolicy,
      quantityAvailable: ticket.quantityAvailable,
      ...(ticket.soldOut === true ? { soldOut: true } : {}),
      ...(typeof ticket.remaining === "number" ? { remaining: ticket.remaining } : {}),
    })),
    // An external event's stock isn't known, so it's never sold out here.
    ...(event.soldOut === true && event.ticketingMode !== "external" ? { soldOut: true } : {}),
    ticketingMode: event.ticketingMode ?? "sheltuh",
    ...(event.ticketingMode === "external"
      ? {
          externalTicketUrl: event.externalTicketUrl,
          externalFree: event.externalFree === true,
          externalProvider: event.externalProvider ?? null,
        }
      : {}),
  };
}
