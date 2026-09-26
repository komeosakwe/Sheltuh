import type { EventCategory } from "@/lib/types";
import { apiFetch, type GetToken } from "./client";
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

export async function createEventDraft(input: EventInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>("/events", { method: "POST", body: input, token });
}

export async function updateEventDraft(eventId: string, input: EventInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/events/${eventId}`, { method: "PATCH", body: input, token });
}

export async function submitEventForReview(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/events/${eventId}/submit`, { method: "POST", token });
}

export async function listMyEvents(getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Paginated<EventRecord>>(`/organisers/me/events${qs}`, { token });
}

export async function getMyEvent(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/organisers/me/events/${eventId}`, { token });
}
