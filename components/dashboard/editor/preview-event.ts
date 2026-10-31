import { assignPoster } from "@/lib/live/assign-poster";
import type { RefundPolicy } from "@/lib/refund-policy";
import { localToUtcIso, type AustralianTimeZone, type StateCode } from "@/lib/time-zones";
import type { TicketingMode } from "@/lib/ticketing";
import type { TicketTypeInput } from "@/lib/api/types";
import type { Coordinates, EventCategory, EventClip, SheltuhEvent } from "@/lib/types";

/** What the draft doesn't have yet: the event page shows its own muted stand-in for each (EventDetailsView's `preview`). */
export interface PreviewMissing {
  title: boolean;
  description: boolean;
  /** No valid start: the date and time line says it is still to be added. */
  when: boolean;
  /** No venue name or address. */
  where: boolean;
}

/** The draft, as the editor holds it. */
export interface PreviewDraft {
  /** The saved event's id and slug (they key the generated artwork); none for a new event. */
  eventId?: string;
  slug?: string;
  title: string;
  description: string;
  category: EventCategory;
  suburb: string;
  state?: StateCode;
  timeZone: AustralianTimeZone | string;
  venueName: string;
  venueAddress: string;
  /** The venue's confirmed pin, and its Google place, when it has them. */
  pin: Coordinates | null;
  placeId?: string;
  start: { date: string; time: string };
  end: { date: string; time: string };
  organiserId?: string;
  organiserName: string;
  organiserLogoThumbUrl?: string;
  /** The photo as it'd show: the new pick's, or the saved one's, as an object URL. */
  imageUrl?: string;
  clip?: EventClip;
  ticketTypes: readonly TicketTypeInput[];
  ticketingMode: TicketingMode;
  externalTicketUrl?: string;
  externalFree: boolean;
  /** The "price from" in whole cents, when the field holds a valid one. */
  externalPriceFromCents?: number | null;
  externalProvider?: string | null;
  refundPolicy: RefundPolicy;
  /** The days as typed, as a number (NaN when blank or not a number). */
  refundDays: number;
}

/** A moment far ahead, so an event with no date yet isn't treated as ended (its date line is a stand-in anyway). */
const PLACEHOLDER_INSTANT = "2099-01-01T00:00:00.000Z";

/** The instant for a date and time typed in the event's zone, or undefined while it's half-typed or not a real time. */
function instant(parts: { date: string; time: string }, timeZone: string): string | undefined {
  if (!parts.date || !parts.time) return undefined;
  try {
    return localToUtcIso(parts.date, parts.time, timeZone);
  } catch {
    return undefined;
  }
}

/**
 * The draft as the event page takes it, in the order of lib/live/adapt.ts
 * `adaptPublicEvent`, with what's missing flagged so the page can show a
 * stand-in instead of an empty line. No `seating` (the preview has no seat
 * map: a reserved-seating draft previews as general admission), and no
 * `soldOut` on any ticket. Pure.
 */
export function draftToPreviewEvent(draft: PreviewDraft): { event: SheltuhEvent; missing: PreviewMissing } {
  const startsAt = instant(draft.start, draft.timeZone);
  const endsAt = instant(draft.end, draft.timeZone);
  const external = draft.ticketingMode === "external";
  const slug = draft.slug ?? draft.eventId ?? "new";
  const days = Number.isInteger(draft.refundDays) ? draft.refundDays : undefined;

  const event: SheltuhEvent = {
    id: draft.eventId ?? "preview",
    ...(draft.organiserId ? { organiserId: draft.organiserId } : {}),
    slug,
    title: draft.title.trim(),
    description: draft.description.trim(),
    category: draft.category,
    suburb: draft.suburb,
    venueName: draft.venueName.trim(),
    venueAddress: draft.venueAddress.trim(),
    ...(draft.placeId ? { venuePlaceId: draft.placeId } : {}),
    ...(draft.pin ? { venuePinned: true, coordinates: { lat: draft.pin.lat, lng: draft.pin.lng } } : {}),
    ...(draft.state ? { state: draft.state } : {}),
    timeZone: draft.timeZone as AustralianTimeZone,
    startsAt: startsAt ?? PLACEHOLDER_INSTANT,
    ...(endsAt ? { endsAt } : {}),
    organiserName: draft.organiserName,
    ...(draft.organiserLogoThumbUrl ? { organiserLogoThumbUrl: draft.organiserLogoThumbUrl } : {}),
    poster: assignPoster(slug),
    ...(draft.imageUrl ? { imageUrl: draft.imageUrl } : {}),
    ...(draft.clip ? { clip: draft.clip } : {}),
    ticketTypes: external
      ? []
      : draft.ticketTypes.map((ticket) => ({
          id: ticket.id,
          name: ticket.name.trim() || "Ticket",
          ...(ticket.description?.trim() ? { description: ticket.description.trim() } : {}),
          priceCents: Number.isInteger(ticket.priceCents) && ticket.priceCents > 0 ? ticket.priceCents : 0,
          feePolicy: ticket.feePolicy,
          quantityAvailable: Number.isInteger(ticket.quantityAvailable) ? Math.max(ticket.quantityAvailable, 0) : 0,
        })),
    ticketingMode: draft.ticketingMode,
    ...(external
      ? {
          externalTicketUrl: draft.externalTicketUrl,
          externalFree: draft.externalFree,
          ...(!draft.externalFree && typeof draft.externalPriceFromCents === "number"
            ? { externalPriceFromCents: draft.externalPriceFromCents }
            : {}),
          ...(draft.externalProvider !== undefined ? { externalProvider: draft.externalProvider } : {}),
        }
      : {
          refundPolicy: draft.refundPolicy,
          ...(draft.refundPolicy === "days_before" && days !== undefined ? { refundDays: days } : {}),
        }),
  };

  return {
    event,
    missing: {
      title: !event.title,
      description: !event.description,
      when: startsAt === undefined,
      where: !event.venueName && !event.venueAddress,
    },
  };
}
