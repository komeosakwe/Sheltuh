import { apiFetch, type GetToken } from "./client";
import type { FavouriteEvent, FavouriteIds, FavouriteState, Paginated } from "./types";

/**
 * Favourited events (docs/architecture.md, "Favourites"). Signed-in members
 * only (ApiError 401 otherwise); a verified email isn't needed. Only the
 * caller ever sees their own favourites: there's no public count.
 */

const favourite = (eventId: string) => `/events/${encodeURIComponent(eventId)}/favourite`;

/** The caller's favourited published events, newest favourite first. Up to `limit` (default 20, max 50) a page. */
export async function listFavourites(getToken: GetToken, page: { cursor?: string; limit?: number } = {}) {
  const token = await getToken();
  const qs = new URLSearchParams();
  if (page.cursor) qs.set("cursor", page.cursor);
  if (page.limit) qs.set("limit", String(page.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<Paginated<FavouriteEvent>>(`/favourites${suffix}`, { token });
}

/** Ids of every favourited published event (at most 500), to fill in the hearts with one request. */
export async function listFavouriteIds(getToken: GetToken) {
  const token = await getToken();
  return apiFetch<FavouriteIds>("/favourites/ids", { token });
}

/**
 * Favourites an event. Idempotent. ApiError 404 if the event isn't published,
 * 409 if the caller already has 500 favourites (409 means only that here).
 */
export async function addFavourite(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<FavouriteState>(favourite(eventId), { method: "PUT", token });
}

/**
 * Removes a favourite. Idempotent. Works for a favourite whose event has since
 * been unpublished; otherwise ApiError 404 if the event isn't published.
 */
export async function removeFavourite(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<FavouriteState>(favourite(eventId), { method: "DELETE", token });
}
