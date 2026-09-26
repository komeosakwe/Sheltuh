import { apiFetch, type GetToken } from "./client";
import type { EventRecord, EventStatus, OrganiserRecord, OrganiserStatus, Paginated } from "./types";

export async function adminListOrganisers(status: OrganiserStatus, getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const qs = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
  return apiFetch<Paginated<OrganiserRecord>>(`/admin/organisers?${qs}`, { token });
}

export async function adminApproveOrganiser(organiserId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>(`/admin/organisers/${organiserId}/approve`, { method: "POST", token });
}

export async function adminRejectOrganiser(organiserId: string, reason: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>(`/admin/organisers/${organiserId}/reject`, {
    method: "POST",
    body: { reason },
    token,
  });
}

export async function adminListEvents(status: EventStatus, getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const qs = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
  return apiFetch<Paginated<EventRecord>>(`/admin/events?${qs}`, { token });
}

export async function adminApproveEvent(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/admin/events/${eventId}/approve`, { method: "POST", token });
}

export async function adminRejectEvent(eventId: string, reason: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/admin/events/${eventId}/reject`, {
    method: "POST",
    body: { reason },
    token,
  });
}

export async function adminUnpublishEvent(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/admin/events/${eventId}/unpublish`, { method: "POST", token });
}
