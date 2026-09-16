import type { EventCategory } from "@/lib/types";
import { apiFetch } from "./client";
import type { EventRecord, Paginated, TicketTypeInput } from "./types";

export interface EventInput {
  title: string;
  description: string;
  category: EventCategory;
  venueName: string;
  venueAddress: string;
  suburb: string;
  start: { date: string; time: string };
  end: { date: string; time: string };
  ticketTypes: TicketTypeInput[];
}

export function createEventDraft(input: EventInput, token: string) {
  return apiFetch<EventRecord>("/events", { method: "POST", body: input, token });
}

export function updateEventDraft(organiserId: string, eventId: string, input: EventInput, token: string) {
  return apiFetch<EventRecord>(`/events/${organiserId}/${eventId}`, { method: "PATCH", body: input, token });
}

export function submitEventForReview(organiserId: string, eventId: string, token: string) {
  return apiFetch<EventRecord>(`/events/${organiserId}/${eventId}/submit`, { method: "POST", token });
}

export function listMyEvents(token: string, cursor?: string) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Paginated<EventRecord>>(`/organisers/me/events${qs}`, { token });
}

export function getMyEvent(eventId: string, token: string) {
  return apiFetch<EventRecord>(`/organisers/me/events/${eventId}`, { token });
}
