import { apiFetch, type GetToken } from "./client";
import type { EventInput } from "./events";
import type {
  AdminCreateOrganiserInput,
  AdminEmailJob,
  AdminEventRecord,
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
  TicketingMode,
} from "./types";

/** POST /api/admin/events: an organiser's event body plus the organiser and an optional publish. */
export interface AdminCreateEventInput extends EventInput {
  /** Any approved organiser, platform-managed or not. */
  organiserId: string;
  /** Publish straight away (logged `created`, then `approved`). Default false: a draft. */
  publish?: boolean;
}

/**
 * PATCH /api/admin/events/{eventId}: the whole event, as POST (it stays with
 * its organiser), whatever its status. `ticketingMode` is required, so an
 * external event is never quietly turned back.
 */
export interface AdminUpdateEventInput extends EventInput {
  ticketingMode: TicketingMode;
  /** The `updatedAt` of the version being edited: ApiError 409 with fieldErrors.expectedUpdatedAt if it has changed since. */
  expectedUpdatedAt: string;
  /** Publish it if it isn't published yet. Unpublishing is adminUnpublishEvent. */
  publish?: boolean;
  /**
   * Up to 500 characters, shown in the moderation log (the organiser sees
   * it). Required to change the mode or link of an event that has been
   * approved before (ApiError 400, fieldErrors.reason).
   */
  reason?: string | null;
}

/** GET /api/admin/organisers query. */
export interface AdminListOrganisersQuery {
  status: OrganiserStatus;
  /**
   * Search: name, contact email or social handles containing it, ignoring
   * case and accents ("sheltuh" finds "Sheltüh Presents"; "@" before a handle
   * is optional). Blank: everyone in `status`. At most 100 characters are used.
   */
  q?: string;
  /** Page size: 20 by default, at most 50. */
  limit?: number;
  cursor?: string;
}

/**
 * Organisers in one status, most recently updated first. Each item carries
 * its social handles and `recentEdits`: the newest 20 entries of its
 * append-only log (profile edits made without review, and takedowns).
 * Called with a query object (`{status, q, limit, cursor}`), or as
 * `(status, getToken, cursor)`.
 */
export async function adminListOrganisers(
  query: OrganiserStatus | AdminListOrganisersQuery,
  getToken: GetToken,
  cursor?: string,
) {
  const token = await getToken();
  const options: AdminListOrganisersQuery = typeof query === "string" ? { status: query, cursor } : query;
  const { status, q, limit, cursor: pageCursor } = options;
  const qs = new URLSearchParams({ status });
  if (q?.trim()) qs.set("q", q.trim());
  if (limit !== undefined) qs.set("limit", String(limit));
  if (pageCursor) qs.set("cursor", pageCursor);
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

/**
 * Creates a platform-managed organiser (no owner account), approved straight
 * away. Same fields and rules as an organiser application (ApiError 400 with
 * fieldErrors). Its events can only have free Sheltüh tickets or external
 * ticketing, and only admins check them in at the door.
 */
export async function adminCreateOrganiser(input: AdminCreateOrganiserInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminOrganiserRecord>("/admin/organisers", { method: "POST", body: input, token });
}

/** Any event, any status, for the admin editor. ApiError 404 unknown. */
export async function adminGetEvent(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminEventRecord>(`/admin/events/${encodeURIComponent(eventId)}`, { token });
}

/**
 * Creates an event for any approved organiser (logged `created`), and
 * publishes it straight away with `publish: true`. ApiError 400 (fieldErrors,
 * including organiserId, and ticketTypes for a paid ticket of a
 * platform-managed organiser), 409 organiser not approved.
 */
export async function adminCreateEvent(input: AdminCreateEventInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminEventRecord>("/admin/events", { method: "POST", body: input, token });
}

/**
 * Saves the whole event, whatever its status (logged `edited`, and
 * `ticketing_changed` for its ticketing). ApiError 409 with
 * fieldErrors.expectedUpdatedAt when someone else changed it since
 * `expectedUpdatedAt` (reload, then edit again); 409 also for a sold ticket
 * type removed or cut below what's sold, switching to external an event with
 * orders, or publishing for an organiser who isn't approved. 400 fieldErrors.
 */
export async function adminUpdateEvent(eventId: string, input: AdminUpdateEventInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminEventRecord>(`/admin/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: input,
    token,
  });
}

/** Uploads (or replaces) any event's photo (logged `edited`). Returns the event, whose `imageUrl` is the new version. */
export async function adminUploadEventImage(eventId: string, image: Blob, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminEventRecord>(`/admin/events/${encodeURIComponent(eventId)}/image`, {
    method: "PUT",
    body: image,
    token,
  });
}

/** Removes any event's photo (logged `edited` if it had one). */
export async function adminDeleteEventImage(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminEventRecord>(`/admin/events/${encodeURIComponent(eventId)}/image`, { method: "DELETE", token });
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
