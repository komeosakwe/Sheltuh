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

/** Uploads (or replaces) the event's photo. Returns the updated event, whose `imageUrl` is the new version. */
export async function uploadEventImage(eventId: string, image: Blob, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/events/${eventId}/image`, { method: "PUT", body: image, token });
}

export async function deleteEventImage(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/events/${eventId}/image`, { method: "DELETE", token });
}

/**
 * Fetches a not-yet-published event's photo, which needs the owner's token
 * (an <img> tag can't send one), and returns an object URL to preview it.
 */
export async function fetchPrivateEventImage(imageUrl: string, getToken: GetToken): Promise<string> {
  const token = await getToken();
  const res = await fetch(imageUrl, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Couldn't load the image.");
  return URL.createObjectURL(await res.blob());
}
