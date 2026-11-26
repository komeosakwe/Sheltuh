import { apiFetch, ApiError, isApiConfigured, type GetToken } from "./client";
import type {
  AnalyticsOverview,
  AnalyticsQuery,
  CreateTrackingLinkInput,
  EventAnalytics,
  RecordViewInput,
  TrackingLink,
} from "./types";

/**
 * Organiser analytics (docs/architecture.md, "Organiser analytics"). Every
 * organiser route needs an approved organiser (ApiError 403 otherwise) and
 * only ever covers the caller's own events: anyone else's is a 404, admins
 * included. Money is integer cents. Dates are Australia/Melbourne YYYY-MM-DD,
 * inclusive; a bad or over-long (2 years) range is ApiError 400 with
 * fieldErrors `from` / `to`.
 */

const myEvent = (eventId: string) => `/organisers/me/events/${encodeURIComponent(eventId)}`;

const adminEvent = (eventId: string) => `/admin/events/${encodeURIComponent(eventId)}`;

function query(q: AnalyticsQuery = {}): string {
  const qs = new URLSearchParams();
  if (q.from) qs.set("from", q.from);
  if (q.to) qs.set("to", q.to);
  if (q.compare) qs.set("compare", q.compare);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * Counts one page view (public, no account, no cookie). Fire-and-forget: it
 * never throws, and does nothing in demo mode. `keepalive` lets it finish if
 * the page is closed straight away.
 */
export function recordEventView(eventId: string, input: RecordViewInput = {}): void {
  if (!isApiConfigured) return;
  try {
    void fetch(`/api/events/${encodeURIComponent(eventId)}/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    // Counting a view must never break the page.
  }
}

/**
 * Counts one click on an external event's "Buy tickets" link (public,
 * no account, no cookie, nothing about the visitor). Fire-and-forget: call it
 * from the link's click handler and let the navigation go ahead; it never
 * throws, never delays the link, and does nothing in demo mode. `keepalive`
 * lets it finish as the page unloads. (`navigator.sendBeacon` sends
 * text/plain, which isn't counted.)
 */
export function recordOutboundClick(eventId: string): void {
  if (!isApiConfigured) return;
  try {
    void fetch(`/api/events/${encodeURIComponent(eventId)}/outbound`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    // Counting a click must never break the link.
  }
}

/** One event's analytics. By default its whole life so far (at most 2 years). */
export async function getEventAnalytics(eventId: string, getToken: GetToken, q: AnalyticsQuery = {}) {
  const token = await getToken();
  return apiFetch<EventAnalytics>(`${myEvent(eventId)}/analytics${query(q)}`, { token });
}

/** Every one of the caller's events, with totals. By default the last 30 days. */
export async function getAnalyticsOverview(getToken: GetToken, q: AnalyticsQuery = {}) {
  const token = await getToken();
  return apiFetch<AnalyticsOverview>(`/organisers/me/analytics/overview${query(q)}`, { token });
}

/** The event's tracking links, newest first, with all-time numbers (at most 20). */
export async function listTrackingLinks(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<{ items: TrackingLink[] }>(`${myEvent(eventId)}/tracking-links`, { token });
}

/**
 * Creates a tracking link (the code is made by the server). ApiError 400 for
 * a bad label (fieldErrors.label), 409 for a label already used on this event
 * (fieldErrors.label) or when the event already has 20 links.
 */
export async function createTrackingLink(eventId: string, input: CreateTrackingLinkInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<TrackingLink>(`${myEvent(eventId)}/tracking-links`, { method: "POST", body: input, token });
}

/** The label of the tracking link an event's QR code carries (docs/architecture.md, "Event QR codes"). */
export const QR_TRACKING_LABEL = "QR code";

const isQrLink = (link: TrackingLink) => link.label.trim().toLowerCase() === QR_TRACKING_LABEL.toLowerCase();

/**
 * The event's "QR code" tracking link, made the first time it's needed: the
 * existing one (its label in any case, as the API compares labels) or a new
 * one. Null when the event already has the most links it can
 * (MAX_TRACKING_LINKS_PER_EVENT, a 409 without a label error): the code then
 * opens the plain event page, untracked. A 409 on the label means another tab
 * made it first, so it's read again. Anything else throws. Only for a
 * published event (call it for nothing else: a draft's link would be made for
 * a page nobody can open yet).
 */
export async function ensureQrTrackingLink(eventId: string, getToken: GetToken): Promise<TrackingLink | null> {
  const existing = (await listTrackingLinks(eventId, getToken)).items.find(isQrLink);
  if (existing) return existing;
  try {
    return await createTrackingLink(eventId, { label: QR_TRACKING_LABEL }, getToken);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 409) throw err;
    if (!err.fieldErrors?.label) return null;
    const raced = (await listTrackingLinks(eventId, getToken)).items.find(isQrLink);
    if (raced) return raced;
    throw err;
  }
}

/** Deletes a tracking link. Idempotent. Its numbers stay in the event's analytics, under its code. */
export async function deleteTrackingLink(eventId: string, linkId: string, getToken: GetToken) {
  const token = await getToken();
  await apiFetch<void>(`${myEvent(eventId)}/tracking-links/${encodeURIComponent(linkId)}`, {
    method: "DELETE",
    token,
  });
}

export async function fetchCsv(path: string, getToken: GetToken): Promise<Blob> {
  if (!isApiConfigured) {
    throw new Error("The live API is not configured in this environment (Supabase is unset).");
  }
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => undefined);
    const message = (data && typeof data.error === "string" && data.error) || `Request failed (${res.status}).`;
    throw new ApiError(res.status, message, data?.fieldErrors);
  }
  return res.blob();
}

/** Admin only: any event's analytics (same shape and query as getEventAnalytics). 403 for non-admins, 404 for no such event. */
export async function getAdminEventAnalytics(eventId: string, getToken: GetToken, q: AnalyticsQuery = {}) {
  const token = await getToken();
  return apiFetch<EventAnalytics>(`${adminEvent(eventId)}/analytics${query(q)}`, { token });
}

/** Admin only: any event's analytics as a CSV file. */
export function downloadAdminEventAnalyticsCsv(eventId: string, getToken: GetToken, q: AnalyticsQuery = {}) {
  return fetchCsv(`${adminEvent(eventId)}/analytics.csv${query(q)}`, getToken);
}

/** The event's analytics as a CSV file (no buyer details). Same query and errors as getEventAnalytics. */
export function downloadEventAnalyticsCsv(eventId: string, getToken: GetToken, q: AnalyticsQuery = {}) {
  return fetchCsv(`${myEvent(eventId)}/analytics.csv${query(q)}`, getToken);
}

/** The overview as a CSV file. Same query and errors as getAnalyticsOverview. */
export function downloadAnalyticsOverviewCsv(getToken: GetToken, q: AnalyticsQuery = {}) {
  return fetchCsv(`/organisers/me/analytics/overview.csv${query(q)}`, getToken);
}
