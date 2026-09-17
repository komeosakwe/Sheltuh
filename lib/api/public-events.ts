import type { EventCategory } from "@/lib/types";
import { apiFetch } from "./client";
import type { Paginated, TicketTypeInput } from "./types";

export interface PublicEvent {
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
  ticketTypes: TicketTypeInput[];
}

export interface ListPublicEventsParams {
  category?: EventCategory;
  onOrAfter?: string;
  pricing?: "free" | "paid";
  cursor?: string;
}

export function listPublicEvents(params: ListPublicEventsParams = {}) {
  const qs = new URLSearchParams();
  if (params.category) qs.set("category", params.category);
  if (params.onOrAfter) qs.set("onOrAfter", params.onOrAfter);
  if (params.pricing) qs.set("pricing", params.pricing);
  if (params.cursor) qs.set("cursor", params.cursor);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<Paginated<PublicEvent>>(`/events${suffix}`);
}

export function getPublicEventBySlug(slug: string) {
  return apiFetch<PublicEvent>(`/events/${encodeURIComponent(slug)}`);
}
