import { apiFetch, type GetToken } from "./client";
import { fetchCsv } from "./analytics";
import type { EventOrders } from "./types";

/**
 * Organiser orders (docs/architecture.md, "Organiser orders"): who bought, for
 * one of the caller's own events. Needs an approved organiser (ApiError 403);
 * anyone else's event is a 404. Names and emails come with the notice shown
 * at checkout and only for 12 months after the event (lib/buyer-details.ts).
 */

export interface EventOrdersQuery {
  /** Matches name, email or reference (up to 100 characters). Sent in a POST body, never in a URL. */
  q?: string;
  cursor?: string;
  limit?: number;
}

const base = (eventId: string) => `/organisers/me/events/${encodeURIComponent(eventId)}/orders`;

/**
 * One page, newest first. Without `q`: GET with `?cursor&limit`. With `q`:
 * POST .../orders/search with {q, cursor, limit} in the body, so the text
 * searched for (a buyer's name or email) never reaches a URL, a request log or
 * the browser's history. ApiError 429: `rate_limited` (asked too often, try
 * again in a few minutes) or `daily_limit` (today's allowance of buyer details
 * for the event is used up; see ApiError.body.code).
 */
export async function getEventOrders(eventId: string, getToken: GetToken, query: EventOrdersQuery = {}) {
  const token = await getToken();
  if (query.q) {
    const body: EventOrdersQuery = { q: query.q };
    if (query.cursor) body.cursor = query.cursor;
    if (query.limit) body.limit = query.limit;
    return apiFetch<EventOrders>(`${base(eventId)}/search`, { token, method: "POST", body });
  }
  const qs = new URLSearchParams();
  if (query.cursor) qs.set("cursor", query.cursor);
  if (query.limit) qs.set("limit", String(query.limit));
  const s = qs.toString();
  return apiFetch<EventOrders>(`${base(eventId)}${s ? `?${s}` : ""}`, { token });
}

/**
 * Every visible order as a CSV file. ApiError 409 over 20,000 orders, 429
 * `rate_limited` after 10 exports an hour, `daily_limit` when today's allowance of buyer details for the event is used up. Each export is logged.
 */
export function downloadEventOrdersCsv(eventId: string, getToken: GetToken) {
  return fetchCsv(`${base(eventId)}.csv`, getToken);
}
