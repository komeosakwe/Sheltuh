import type { TicketingMode } from "@/lib/ticketing";
import type { EventCategory } from "@/lib/types";
import { ApiError, apiFetch, type GetToken } from "./client";
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
  /** At least one for a Sheltüh-ticketed event; must be empty for an external one. */
  ticketTypes: TicketTypeInput[];
  /**
   * Where tickets are sold. Absent: `sheltuh` when creating; when editing,
   * the stored ticketing is kept (and its link and free flag, unless sent).
   * Once the event has been
   * approved (`EventRecord.ticketingLocked`), changing it or the link is
   * ApiError 409 with fieldErrors on the changed field; only an admin can.
   */
  ticketingMode?: TicketingMode;
  /**
   * `external`: required, the ticket page's https address (no IP address,
   * port, username/password, localhost or link shortener; checked with
   * lib/ticketing.ts checkExternalTicketUrl, whose messages the API returns
   * as fieldErrors.externalTicketUrl). `sheltuh`: absent, null or "".
   */
  externalTicketUrl?: string | null;
  /** `external` only: entry is free. Absent or false for `sheltuh`. */
  externalFree?: boolean;
}

export async function createEventDraft(input: EventInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>("/events", { method: "POST", body: input, token });
}

export async function updateEventDraft(eventId: string, input: EventInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/events/${eventId}`, { method: "PATCH", body: input, token });
}

/**
 * The error body's `code` (ApiError.body.code) when an event with a paid
 * Sheltüh ticket type can't be submitted, approved or published, or get a new
 * paid ticket type while submitted or published, because the organiser's
 * payouts aren't set up (`OrganiserRecord.payoutsEnabled` false: Stripe
 * Connect at /dashboard/payouts). Always a 409. Free and external events never
 * need payouts, and drafts can always be saved.
 */
export const PAYOUTS_REQUIRED_CODE = "payouts_required";

/** Whether `err` is the 409 with `code: "payouts_required"` (PAYOUTS_REQUIRED_CODE). */
export function isPayoutsRequiredError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.body?.code === PAYOUTS_REQUIRED_CODE;
}

/**
 * Draft or rejected → pending review. ApiError 409 when it isn't a draft or
 * rejected, or (`code: "payouts_required"`, isPayoutsRequiredError) when it
 * has a paid Sheltüh ticket type and the organiser's payouts aren't set up;
 * 404 unknown event.
 */
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
