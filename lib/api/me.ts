import { apiFetch, type GetToken } from "./client";
import type { AccountSummary, MyTicketsPage, UsernameCheck } from "./types";

/**
 * The signed-in member's own account summary (GET /api/me; docs/architecture.md,
 * "API"): `upcomingCount`, the published events not started yet they hold a
 * ticket for, and their username, if any, with when it can next change.
 * ApiError 401 (signed out), 403 (email not verified); or the abort error if
 * `signal` aborted.
 */
export async function getMe(getToken: GetToken, signal?: AbortSignal): Promise<AccountSummary> {
  const token = await getToken();
  return apiFetch<AccountSummary>("/me", { token, signal });
}

/**
 * One page of the signed-in member's My tickets (GET /api/me/tickets;
 * docs/architecture.md, "API"): their orders (by their verified email) and
 * the tickets sent to them, upcoming first, with `counts` for both lists.
 * Pass the previous page's `nextCursor` for the next. ApiError 400 (a bad
 * cursor), 401 (signed out), 403 (email not verified); or the abort error if
 * `signal` aborted.
 */
export async function listMyTickets(
  getToken: GetToken,
  options: { cursor?: string; signal?: AbortSignal } = {},
): Promise<MyTicketsPage> {
  const token = await getToken();
  const suffix = options.cursor ? `?${new URLSearchParams({ cursor: options.cursor })}` : "";
  return apiFetch<MyTicketsPage>(`/me/tickets${suffix}`, { token, signal: options.signal });
}

/**
 * Sets or changes the caller's username (PUT /api/me/username;
 * docs/architecture.md, "Usernames"); a leading "@" is dropped and it's
 * stored in lower case. Answers the new AccountSummary. ApiError 400
 * (fieldErrors.username), 401, 403 (email not verified, or suspended), 409
 * (`body.code` "username_taken": someone's, or released in the last 30 days),
 * 429 (`body.code` "username_change_too_soon" with `body.changeableAt`; or
 * too many checks).
 */
export async function setMyUsername(username: string, getToken: GetToken): Promise<AccountSummary> {
  const token = await getToken();
  return apiFetch<AccountSummary>("/me/username", { method: "PUT", body: { username }, token });
}

/** Clears the caller's username (DELETE /api/me/username): it's held for 30 days, and the change clock isn't reset. Idempotent. */
export async function clearMyUsername(getToken: GetToken): Promise<void> {
  const token = await getToken();
  await apiFetch<void>("/me/username", { method: "DELETE", token });
}

/**
 * Whether the caller could have `username` (POST /api/me/username/check: a
 * POST, so the name stays out of URLs). Shares an allowance with
 * setMyUsername. ApiError 400 (fieldErrors.username), 401, 403, 429; or the
 * abort error if `signal` aborted.
 */
export async function checkUsername(username: string, getToken: GetToken, signal?: AbortSignal): Promise<UsernameCheck> {
  const token = await getToken();
  return apiFetch<UsernameCheck>("/me/username/check", { method: "POST", body: { username }, token, signal });
}
