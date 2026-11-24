import { apiFetch, type GetToken } from "./client";
import type { OrganiserEventFilter, OrganiserEventSummaryPage, OrganiserOverview } from "./types";

/**
 * The organiser dashboard's Overview and Events tab (docs/architecture.md,
 * "Organiser dashboard summaries"). The caller's own events only; ApiError
 * 403 without an approved organiser, 401 signed out. Money is integer cents;
 * counts of tickets are people. No buyer data, and followers are a count only.
 * Throws in demo mode (no Supabase), like every lib/api call: the dashboard
 * shows its demo state instead of calling these.
 */

/** The Overview: this week's numbers, the banner's event, the next two events, drafts count and Performance. */
export async function getOrganiserOverview(getToken: GetToken, options: { signal?: AbortSignal } = {}) {
  const token = await getToken();
  return apiFetch<OrganiserOverview>("/organisers/me/overview", { token, signal: options.signal });
}

/**
 * One page of the Events tab for a filter (default `all`), with the counts of
 * every filter. Pass the previous page's `nextCursor` for the next one.
 * ApiError 400 (fieldErrors.filter) for an unknown filter.
 */
export async function getOrganiserEventsSummary(
  getToken: GetToken,
  options: { filter?: OrganiserEventFilter; cursor?: string; limit?: number; signal?: AbortSignal } = {},
) {
  const qs = new URLSearchParams();
  if (options.filter && options.filter !== "all") qs.set("filter", options.filter);
  if (options.cursor) qs.set("cursor", options.cursor);
  if (options.limit !== undefined) qs.set("limit", String(options.limit));
  const query = qs.toString();
  const token = await getToken();
  return apiFetch<OrganiserEventSummaryPage>(`/organisers/me/events/summary${query ? `?${query}` : ""}`, {
    token,
    signal: options.signal,
  });
}
