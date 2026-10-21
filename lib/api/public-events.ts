import type { TicketingMode } from "@/lib/ticketing";
import type { EventCategory } from "@/lib/types";
import { apiFetch } from "./client";
import type { Paginated, TicketTypeInput } from "./types";

export interface PublicEvent {
  organiserId: string;
  eventId: string;
  slug: string;
  title: string;
  description: string;
  category: EventCategory;
  venueName: string;
  venueAddress: string;
  suburb: string;
  startsAt: string;
  endsAt: string;
  organiserName: string;
  imageUrl?: string;
  /** Always empty for an external event. */
  ticketTypes: TicketTypeInput[];
  /**
   * `sheltuh`: tickets sold here. `external`: sold on another site, at
   * `externalTicketUrl` (no Sheltüh checkout, booking fee, Who's Going or
   * check-in; no ticket types, and no price shown). Always sent by the API;
   * optional so older fixtures stay valid (absent means `sheltuh`).
   */
  ticketingMode?: TicketingMode;
  /** External events only: the ticket page. Link to it only through the outbound beacon (recordOutboundClick). */
  externalTicketUrl?: string;
  /** The organiser says entry is free (external events only; false otherwise). Always sent. */
  externalFree?: boolean;
  /**
   * External events only: a known ticketing site's name ("Humanitix",
   * "Eventbrite", ...) for "Get tickets on {provider}", or null: then say
   * "the organiser's site", never the bare host. Always sent; null for
   * Sheltüh-ticketed events.
   */
  externalProvider?: string | null;
}

export interface ListPublicEventsParams {
  category?: EventCategory;
  onOrAfter?: string;
  /**
   * `free`: Sheltüh-ticketed with ticket types, all free, or external with
   * `externalFree`. `paid`: has a paid Sheltüh ticket type (external events
   * never match: their price isn't known).
   */
  pricing?: "free" | "paid";
  /** Free-text search over title, venue, suburb, organiser and description. */
  q?: string;
  /** Only events that haven't ended yet (in progress included), still soonest first. */
  upcoming?: boolean;
  /** Page size (the server's default is 20, its maximum 50). */
  limit?: number;
  cursor?: string;
}

export function listPublicEvents(params: ListPublicEventsParams = {}) {
  const qs = new URLSearchParams();
  if (params.category) qs.set("category", params.category);
  if (params.onOrAfter) qs.set("onOrAfter", params.onOrAfter);
  if (params.pricing) qs.set("pricing", params.pricing);
  if (params.q) qs.set("q", params.q);
  if (params.upcoming) qs.set("upcoming", "1");
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<Paginated<PublicEvent>>(`/events${suffix}`);
}

export function getPublicEventBySlug(slug: string) {
  return apiFetch<PublicEvent>(`/events/slug/${encodeURIComponent(slug)}`);
}
