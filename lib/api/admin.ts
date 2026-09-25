import { apiFetch, type GetToken } from "./client";
import type { EventRecord, EventStatus, OrganiserRecord, OrganiserStatus, Paginated } from "./types";

export async function adminListOrganisers(status: OrganiserStatus, getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const qs = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
  return apiFetch<Paginated<OrganiserRecord>>(`/admin/organisers?${qs}`, { token });
}

export async function adminApproveOrganiser(ownerUserId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>(`/admin/organisers/${ownerUserId}/approve`, { method: "POST", token });
}

export async function adminRejectOrganiser(ownerUserId: string, reason: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>(`/admin/organisers/${ownerUserId}/reject`, {
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

export async function adminApproveEvent(organiserId: string, eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/admin/events/${organiserId}/${eventId}/approve`, { method: "POST", token });
}

export async function adminRejectEvent(organiserId: string, eventId: string, reason: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/admin/events/${organiserId}/${eventId}/reject`, {
    method: "POST",
    body: { reason },
    token,
  });
}

export async function adminUnpublishEvent(organiserId: string, eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/admin/events/${organiserId}/${eventId}/unpublish`, { method: "POST", token });
}
