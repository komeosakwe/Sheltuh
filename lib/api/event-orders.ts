import { apiFetch, type GetToken } from "./client";
import { fetchCsv } from "./analytics";
import type { EventOrdersPage } from "./types";

/**
 * Organiser orders (docs/architecture.md, "Organiser orders"): who bought, for
 * one of the caller's own events. Needs an approved organiser (ApiError 403);
 * anyone else's event is a 404. Names and emails come with the notice shown
 * at checkout and only for 12 months after the event (lib/buyer-details.ts).
 */

export interface EventOrdersQuery {
  /** Matches name, email or reference (up to 100 characters). */
  q?: string;
  cursor?: string;
  limit?: number;
}

const base = (eventId: string) => `/organisers/me/events/${encodeURIComponent(eventId)}/orders`;

function query(q: EventOrdersQuery): string {
  const qs = new URLSearchParams();
  if (q.q) qs.set("q", q.q);
  if (q.cursor) qs.set("cursor", q.cursor);
  if (q.limit) qs.set("limit", String(q.limit));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** One page, newest first. ApiError 429 `rate_limited`: asked too often (try again in a few minutes). */
export async function getEventOrders(eventId: string, getToken: GetToken, q: EventOrdersQuery = {}) {
  const token = await getToken();
  return apiFetch<EventOrdersPage>(`${base(eventId)}${query(q)}`, { token });
}

/**
 * Every visible order as a CSV file. ApiError 409 over 20,000 orders, 429
 * `rate_limited` after 10 exports an hour. Each export is logged.
 */
export function downloadEventOrdersCsv(eventId: string, getToken: GetToken) {
  return fetchCsv(`${base(eventId)}.csv`, getToken);
}
