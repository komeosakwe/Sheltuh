import type { PublicEvent } from "@/lib/api/public-events";
import { DEFAULT_REFUND_POLICY } from "@/lib/refund-policy";
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
    // Only with a venue location: the linked Google place (for directions, never resolved to coordinates) and
    // the organiser's own pin as `coordinates` (exact on our maps and in the Apple Maps link). Without a pin,
    // `coordinates` stays absent and the maps place the event at its suburb's centre, as before.
    ...(event.location
      ? {
          ...(event.location.placeId ? { venuePlaceId: event.location.placeId } : {}),
          venuePinned: !!event.location.pin,
          ...(event.location.pin ? { coordinates: { lat: event.location.pin.lat, lng: event.location.pin.lng } } : {}),
        }
      : {}),
    // Only when sent: absent means VIC / Australia/Melbourne, so an older payload adapts as before.
    ...(event.state ? { state: event.state } : {}),
    ...(event.timeZone ? { timeZone: event.timeZone } : {}),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    organiserName: event.organiserName,
    // Only while the organiser has a logo (and is approved): absent means initials.
    ...(event.organiserLogoThumbUrl ? { organiserLogoThumbUrl: event.organiserLogoThumbUrl } : {}),
    poster: assignPoster(event.slug),
    imageUrl: event.imageUrl,
    // Only with a focus point: an event without one adapts exactly as before.
    ...(event.imageFocus ? { imageFocus: { x: event.imageFocus.x, y: event.imageFocus.y } } : {}),
    // Only with a clip: an event without one adapts exactly as before.
    ...(event.clip
      ? {
          clip: {
            url: event.clip.url,
            durationMs: event.clip.durationMs,
            width: event.clip.width,
            height: event.clip.height,
            description: event.clip.description,
          },
        }
      : {}),
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
      ...(ticket.seated === true ? { seated: true as const } : {}),
    })),
    // An external event's stock isn't known, so it's never sold out here.
    ...(event.soldOut === true && event.ticketingMode !== "external" ? { soldOut: true } : {}),
    ticketingMode: event.ticketingMode ?? "sheltuh",
    // Reserved seating: only the map's version (the seat page loads the map itself).
    ...(event.seating && event.ticketingMode !== "external" ? { seating: { version: event.seating.version } } : {}),
    // Sheltüh-ticketed only (an external event's ticketing site has its own terms); days only for days_before.
    ...(event.ticketingMode !== "external"
      ? {
          refundPolicy: event.refundPolicy ?? DEFAULT_REFUND_POLICY,
          ...(event.refundPolicy === "days_before" && typeof event.refundDays === "number"
            ? { refundDays: event.refundDays }
            : {}),
        }
      : {}),
    ...(event.ticketingMode === "external"
      ? {
          externalTicketUrl: event.externalTicketUrl,
          externalFree: event.externalFree === true,
          externalProvider: event.externalProvider ?? null,
        }
      : {}),
  };
}
