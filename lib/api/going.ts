import { apiFetch, type GetToken } from "./client";
import type { GoingAttendee, GoingSummary, MyGoingStatus, Paginated } from "./types";

const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}/going`;

/** Public count of members going. */
export function getGoingSummary(eventId: string) {
  return apiFetch<GoingSummary>(base(eventId));
}

/** Display names of members going (verified members only; ApiError 403 otherwise). Up to 50 per page. */
export async function listGoingAttendees(eventId: string, getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Paginated<GoingAttendee>>(`${base(eventId)}/attendees${suffix}`, { token });
}

export async function getMyGoingStatus(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<MyGoingStatus>(`${base(eventId)}/me`, { token });
}

/**
 * Opts the caller in to being shown as going. ApiError 403 if they aren't
 * eligible (no matching ticket, unverified email, suspended), 409 if they
 * need to create a profile first, 404 if Who's Going isn't open for the event.
 */
export async function setGoing(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<MyGoingStatus>(`${base(eventId)}/me`, { method: "PUT", token });
}

/** Opts the caller back out. Idempotent. */
export async function unsetGoing(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<MyGoingStatus>(`${base(eventId)}/me`, { method: "DELETE", token });
}
