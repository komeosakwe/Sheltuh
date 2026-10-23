import type { TicketingMode } from "@/lib/ticketing";
import type { EventCategory } from "@/lib/types";
import { apiFetch } from "./client";
import type { Paginated, TicketTypeInput } from "./types";

/**
 * `remaining` is only sent when this many tickets or fewer are left, so the
 * API never reveals an exact large stock (or, through it, sales).
 */
export const REMAINING_SHOWN_AT_MOST = 10;

/**
 * A ticket type as the public sees it: the organiser's fields plus what's
 * left. `quantityAvailable` is the capacity, not what's left.
 */
export interface PublicTicketType extends TicketTypeInput {
  /** None left (every ticket sold). Always sent by the API; optional so older fixtures stay valid. */
  soldOut?: boolean;
  /**
   * Tickets left, only when REMAINING_SHOWN_AT_MOST or fewer (0 when sold
   * out); absent when more are left. First come, first served: no ticket is
   * held while someone checks out.
   */
  remaining?: number;
}

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
  /**
   * The organiser's logo thumbnail: `/api/organisers/{organiserId}/logo?size=thumb&v={version}`
   * (96 px square WebP, public, cached for a day). Only when the organiser has
   * a logo; absent otherwise (show initials).
   */
  organiserLogoThumbUrl?: string;
  /** Always empty for an external event. */
  ticketTypes: PublicTicketType[];
  /**
   * Every ticket type is sold out (false with no ticket types, and always
   * false for an external event, whose stock isn't known). While it's true
   * and the event hasn't ended, people can join the waitlist
   * (lib/api/waitlist.ts). Always sent by the API; optional so older
   * fixtures stay valid.
   */
  soldOut?: boolean;
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
  /**
   * Only for an event with a seat map (reserved seating): its version, for
   * GET /events/{id}/seat-map?v={version}. Its seated tiers carry
   * `seated: true`; general admission tiers (a mixed event) don't. Absent for
   * a general admission event, whose payload is otherwise unchanged.
   */
  seating?: { version: number };
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
