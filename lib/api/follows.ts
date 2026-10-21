import { apiFetch, type GetToken } from "./client";
import type { PublicEvent } from "./public-events";
import type { FollowedOrganiser, FollowInput, FollowStatus, Paginated, UnsubscribeFollowResult } from "./types";

/**
 * Following organisers (docs/architecture.md, "Following organisers").
 * Following needs a verified email (ApiError 403); reading your own follows
 * and unfollowing need only a sign-in.
 */

const followPath = (organiserId: string) => `/organisers/${encodeURIComponent(organiserId)}/follow`;

/** Whether the caller follows the organiser. ApiError 404 unless it's an approved organiser. */
export async function getFollowStatus(organiserId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<FollowStatus>(followPath(organiserId), { token });
}

/**
 * Follows (idempotent), with the email choice (off unless `true` is sent;
 * sending it again changes it; anything but a boolean is a 400). ApiError 400 (own organiser), 403 (unverified), 404,
 * 409 (500 follows), 429.
 */
export async function followOrganiser(organiserId: string, input: FollowInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<FollowStatus>(followPath(organiserId), { method: "POST", body: input, token });
}

/** Unfollows. Idempotent. */
export async function unfollowOrganiser(organiserId: string, getToken: GetToken) {
  const token = await getToken();
  await apiFetch<void>(followPath(organiserId), { method: "DELETE", token });
}

/** The organisers the caller follows, most recent first, up to 50 a page. */
export async function listFollowing(getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Paginated<FollowedOrganiser>>(`/me/following${suffix}`, { token });
}

/** Upcoming events from organisers the caller follows, soonest first (the home's rail). */
export async function listFollowingEvents(getToken: GetToken, options: { cursor?: string; limit?: number } = {}) {
  const token = await getToken();
  const qs = new URLSearchParams();
  if (options.cursor) qs.set("cursor", options.cursor);
  if (options.limit) qs.set("limit", String(options.limit));
  const query = qs.toString();
  const suffix = query ? `?${query}` : "";
  return apiFetch<Paginated<PublicEvent>>(`/me/following/events${suffix}`, { token });
}

/**
 * The emailed unsubscribe link's page (/following/unsubscribe#token=…): POST
 * the fragment's token when the button is pressed. Turns that organiser's
 * new-event emails off; the follow stays. ApiError 400 (incomplete link), 404.
 */
export function unsubscribeFromFollowEmails(token: string) {
  return apiFetch<UnsubscribeFollowResult>("/follows/unsubscribe", { method: "POST", body: { token } });
}
