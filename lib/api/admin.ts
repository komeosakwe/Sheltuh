import { apiFetch } from "./client";
import type { EventRecord, EventStatus, OrganiserRecord, OrganiserStatus, Paginated } from "./types";

export function adminListOrganisers(status: OrganiserStatus, token: string, cursor?: string) {
  const qs = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
  return apiFetch<Paginated<OrganiserRecord>>(`/admin/organisers?${qs}`, { token });
}

export function adminApproveOrganiser(ownerUserId: string, token: string) {
  return apiFetch<OrganiserRecord>(`/admin/organisers/${ownerUserId}/approve`, { method: "POST", token });
}

export function adminRejectOrganiser(ownerUserId: string, reason: string, token: string) {
  return apiFetch<OrganiserRecord>(`/admin/organisers/${ownerUserId}/reject`, {
    method: "POST",
    body: { reason },
    token,
  });
}

export function adminListEvents(status: EventStatus, token: string, cursor?: string) {
  const qs = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
  return apiFetch<Paginated<EventRecord>>(`/admin/events?${qs}`, { token });
}

export function adminApproveEvent(organiserId: string, eventId: string, token: string) {
  return apiFetch<EventRecord>(`/admin/events/${organiserId}/${eventId}/approve`, { method: "POST", token });
}

export function adminRejectEvent(organiserId: string, eventId: string, reason: string, token: string) {
  return apiFetch<EventRecord>(`/admin/events/${organiserId}/${eventId}/reject`, {
    method: "POST",
    body: { reason },
    token,
  });
}

export function adminUnpublishEvent(organiserId: string, eventId: string, token: string) {
  return apiFetch<EventRecord>(`/admin/events/${organiserId}/${eventId}/unpublish`, { method: "POST", token });
}
