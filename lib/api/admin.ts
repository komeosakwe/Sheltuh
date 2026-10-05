import { apiFetch, type GetToken } from "./client";
import type {
  AdminReport,
  EventRecord,
  EventStatus,
  OrganiserRecord,
  OrganiserStatus,
  Paginated,
  ReportStatus,
  ResolveReportInput,
} from "./types";

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

/** Member reports, oldest first for `open`, most recently resolved first otherwise. */
export async function adminListReports(status: ReportStatus, getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const qs = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
  return apiFetch<Paginated<AdminReport>>(`/admin/reports?${qs}`, { token });
}

/** Dismisses a report, or suspends the reported member. ApiError 409 if it's already been resolved. */
export async function adminResolveReport(reportId: string, input: ResolveReportInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminReport>(`/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: "POST",
    body: input,
    token,
  });
}
