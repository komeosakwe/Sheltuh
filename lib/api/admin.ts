import { apiFetch, type GetToken } from "./client";
import type {
  AdminEmailJob,
  AdminOrganiserRecord,
  AdminReport,
  AdminSetEventTicketingInput,
  EmailJobStatus,
  EventRecord,
  EventStatus,
  OrganiserStatus,
  Paginated,
  ReportStatus,
  ResolveReportInput,
  SuspendOrganiserResult,
} from "./types";

/**
 * Organisers in one status, most recently updated first. Each item carries
 * its social handles and `recentEdits`: the newest 20 entries of its
 * append-only log (profile edits made without review, and takedowns).
 */
export async function adminListOrganisers(status: OrganiserStatus, getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const qs = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
  return apiFetch<Paginated<AdminOrganiserRecord>>(`/admin/organisers?${qs}`, { token });
}

export async function adminApproveOrganiser(organiserId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminOrganiserRecord>(`/admin/organisers/${organiserId}/approve`, { method: "POST", token });
}

export async function adminRejectOrganiser(organiserId: string, reason: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminOrganiserRecord>(`/admin/organisers/${organiserId}/reject`, {
    method: "POST",
    body: { reason },
    token,
  });
}

/**
 * Takes an approved organiser down: their status becomes `rejected` with
 * `reason` (1–500 characters, shown to them), their profile disappears, their
 * published events are unpublished and events waiting for review rejected.
 * Nothing is deleted. ApiError 400 (fieldErrors.reason), 404 unknown
 * organiser, 409 not approved (e.g. another admin already suspended them).
 */
export async function adminSuspendOrganiser(organiserId: string, reason: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<SuspendOrganiserResult>(`/admin/organisers/${encodeURIComponent(organiserId)}/suspend`, {
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

/**
 * Sets an event's ticketing (mode, ticket link, free flag), whatever its
 * status: the only way to change an approved event's mode or link. Logged in
 * the event's moderation log as `ticketing_changed`, with `reason` and the
 * old and new values (`ModerationLogEntry.changes`). Returns the event
 * (unchanged, with nothing logged, if nothing would change). ApiError 400
 * (fieldErrors ticketingMode / externalTicketUrl / externalFree / reason),
 * 404 unknown event, 409 switching to external an event that has orders.
 */
export async function adminSetEventTicketing(eventId: string, input: AdminSetEventTicketingInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/admin/events/${encodeURIComponent(eventId)}/ticketing`, {
    method: "PATCH",
    body: input,
    token,
  });
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

/** Ticket emails in one status, newest first (default view: `failed`). */
export async function adminListEmailJobs(status: EmailJobStatus, getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const qs = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
  return apiFetch<Paginated<AdminEmailJob>>(`/admin/emails?${qs}`, { token });
}

/**
 * Sends a ticket email again now. ApiError 409 while it's being sent; 429 if
 * it was resent in the last 5 minutes or the admin has resent 20 this hour.
 */
export async function adminResendEmailJob(jobId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminEmailJob>(`/admin/emails/${encodeURIComponent(jobId)}/resend`, { method: "POST", token });
}
