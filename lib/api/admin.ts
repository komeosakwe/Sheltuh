import { apiFetch, type GetToken } from "./client";
import type { EventInput } from "./events";
import type {
  AdminCreateInviteInput,
  AdminCreateOrganiserInput,
  AdminEmailJob,
  AdminInviteRecord,
  AdminInviteSendResult,
  AdminMemberProfile,
  AdminEventRecord,
  AdminOrganiserRecord,
  AdminReport,
  AdminSetEventTicketingInput,
  AdminSummary,
  EmailJobStatus,
  EventRecord,
  EventStatus,
  InviteStatus,
  OrganiserStatus,
  Paginated,
  RemoveProfileContentInput,
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

/** GET /api/admin/events query. */
export interface AdminListEventsQuery {
  status: EventStatus;
  /**
   * Search: the title or the organiser's name containing it, ignoring case
   * and accents. Blank: every event in `status`. At most 100 characters are used.
   */
  q?: string;
  /**
   * true: only events that haven't ended (in progress included); false:
   * every event. Omitted: the server's default, true for `published` and
   * false for every other status.
   */
  upcoming?: boolean;
  /** true: only platform-managed organisers' events; false: only organisers with an account. Omitted: both. */
  platformManaged?: boolean;
  /**
   * `published` only (ApiError 400 otherwise): events that went live in the
   * last 14 days, newest first (by an admin's approval or the organiser's own
   * publish: AdminEventRecord.publishedAt / publishedBy), ended ones included
   * unless `upcoming: true`.
   */
  recent?: boolean;
  /** Page size: 20 by default, at most 50. */
  limit?: number;
  cursor?: string;
}

/**
 * Events in one status, soonest first. `published` lists only events that
 * haven't ended unless `upcoming: false` is sent. Called with a query
 * object (its `cursor` included), or as `(status, getToken, cursor)`: the
 * overloads keep a third argument off the object form, where it would be
 * ignored. ApiError 400 for a bad status.
 */
export function adminListEvents(query: AdminListEventsQuery, getToken: GetToken): Promise<Paginated<AdminEventRecord>>;
export function adminListEvents(
  status: EventStatus,
  getToken: GetToken,
  cursor?: string,
): Promise<Paginated<AdminEventRecord>>;
export async function adminListEvents(query: EventStatus | AdminListEventsQuery, getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const options: AdminListEventsQuery = typeof query === "string" ? { status: query, cursor } : query;
  const { status, q, upcoming, platformManaged, recent, limit, cursor: pageCursor } = options;
  const qs = new URLSearchParams({ status });
  if (q?.trim()) qs.set("q", q.trim());
  if (upcoming !== undefined) qs.set("upcoming", upcoming ? "1" : "0");
  if (platformManaged !== undefined) qs.set("platformManaged", platformManaged ? "1" : "0");
  if (recent) qs.set("recent", "1");
  if (limit !== undefined) qs.set("limit", String(limit));
  if (pageCursor) qs.set("cursor", pageCursor);
  return apiFetch<Paginated<AdminEventRecord>>(`/admin/events?${qs}`, { token });
}

/**
 * What's waiting for an admin, as counts (open reports, events and organiser
 * applications to review, failed and retrying ticket emails, door check-ins
 * in the next 24 hours). ApiError 401/403 for anyone but an admin.
 */
export async function adminGetSummary(getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminSummary>("/admin/summary", { token });
}

/**
 * Pending review → published. ApiError 409 when it's no longer pending, its
 * organiser isn't approved, or (`code: "payouts_required"`, lib/api/events.ts
 * isPayoutsRequiredError) it has a paid Sheltüh ticket type and the
 * organiser's payouts aren't set up (or were turned off since they submitted).
 */
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

/**
 * Published → draft. `reason` (optional, 1–500 characters) is shown to the
 * organiser (`EventRecord.rejectionReason`) and logged. If they publish it
 * again, it goes to the review queue. ApiError 400 (fieldErrors.reason), 404,
 * 409 no longer published.
 */
export async function adminUnpublishEvent(eventId: string, getToken: GetToken, reason?: string) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/admin/events/${eventId}/unpublish`, {
    method: "POST",
    ...(reason?.trim() ? { body: { reason: reason.trim() } } : {}),
    token,
  });
}

/**
 * Turns review of an organiser's events on (`required: true`: their
 * publishes go to the review queue instead of going live) or off, with a
 * reason (1–500 characters) logged on the organiser's log. Returns the
 * organiser (`eventReviewRequired`). ApiError 400 (fieldErrors.required /
 * .reason), 404 unknown organiser.
 */
export async function adminSetEventReviewRequired(
  organiserId: string,
  required: boolean,
  reason: string,
  getToken: GetToken,
) {
  const token = await getToken();
  return apiFetch<AdminOrganiserRecord>(`/admin/organisers/${encodeURIComponent(organiserId)}/event-review`, {
    method: "POST",
    body: { required, reason },
    token,
  });
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
 * platform-managed organiser), 409 organiser not approved, or (`code:
 * "payouts_required"`, fieldErrors.ticketTypes) publishing paid tickets for an
 * organiser whose payouts aren't set up.
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
 * orders, or publishing for an organiser who isn't approved; 409 `code:
 * "refund_policy_tightened"` (fieldErrors.refundPolicy,
 * isRefundPolicyTightenedError) when the event has pending or paid orders and
 * the edit would make its refund policy less generous; 409 `code:
 * "payouts_required"` (fieldErrors.ticketTypes) when the organiser's payouts
 * aren't set up and the edit would publish paid tickets, or add a paid ticket
 * type (or make a free one paid) on a submitted or published event. 400
 * fieldErrors.
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

/**
 * Removes an organiser's featured video, with a reason (logged on their
 * organiser log as an edit by the Sheltüh team). ApiError 400 (reason), 404.
 */
export async function adminRemoveFeaturedVideo(organiserId: string, reason: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminOrganiserRecord>(`/admin/organisers/${encodeURIComponent(organiserId)}/remove-video`, {
    method: "POST",
    body: { reason },
    token,
  });
}

/**
 * Removes an organiser's logo, with a reason (logged on their organiser log
 * as an edit by the Sheltüh team). Unchanged, and nothing logged, without a
 * logo. ApiError 400 (reason), 404.
 */
export async function adminRemoveOrganiserLogo(organiserId: string, reason: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminOrganiserRecord>(`/admin/organisers/${encodeURIComponent(organiserId)}/remove-logo`, {
    method: "POST",
    body: { reason },
    token,
  });
}

/** A member profile whatever its visibility, with its moderation log (AdminReport.reportedProfileId). */
export async function adminGetMemberProfile(profileId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminMemberProfile>(`/admin/profiles/${encodeURIComponent(profileId)}`, { token });
}

/**
 * Removes a member's photo, bio and/or Instagram handle, with a reason
 * (logged; the content isn't kept). `removed` says what was there to remove.
 * ApiError 400, 404.
 */
export async function adminRemoveProfileContent(profileId: string, input: RemoveProfileContentInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminMemberProfile>(`/admin/profiles/${encodeURIComponent(profileId)}/remove-content`, {
    method: "POST",
    body: input,
    token,
  });
}

// ---------------------------------------------------------------------------
// Account invites (docs/architecture.md, "Account invites")
// ---------------------------------------------------------------------------

/** Invites in one status (default `pending`), newest first. `expired` includes pending invites whose link has run out. */
export async function adminListInvites(status: InviteStatus, getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const qs = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
  return apiFetch<Paginated<AdminInviteRecord>>(`/admin/invites?${qs}`, { token });
}

/**
 * Invites someone who asked to join, and emails them the link (14 days).
 * 201 `{invite, emailSent}` (`emailSent: false`: saved, but the email failed:
 * resend it). ApiError 400 (fieldErrors `kind`, `email`, `consent`,
 * `organiser.<field>`), 409 the address already has a pending invite, or (an
 * organiser invite) its account already has an organiser, 429 over 20 an hour
 * (this admin) or 100 a day (everyone), 503 invites aren't configured.
 */
export async function adminCreateInvite(input: AdminCreateInviteInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminInviteSendResult>("/admin/invites", { method: "POST", body: input, token });
}

/**
 * Emails a new link (the old one stops working; 14 days from now). A pending
 * or expired invite. ApiError 404, 409 accepted or revoked (or the address
 * has another pending invite), 429 sent in the last minute or over the
 * allowances, 503 invites aren't configured.
 */
export async function adminResendInvite(inviteId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminInviteSendResult>(`/admin/invites/${encodeURIComponent(inviteId)}/resend`, {
    method: "POST",
    token,
  });
}

/** Revokes a pending invite: its link stops working at once. ApiError 404, 409 not pending (accepted, revoked or expired). */
export async function adminRevokeInvite(inviteId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminInviteRecord>(`/admin/invites/${encodeURIComponent(inviteId)}/revoke`, {
    method: "POST",
    token,
  });
}
