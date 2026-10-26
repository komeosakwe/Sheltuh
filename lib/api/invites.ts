import { apiFetch, type GetToken } from "./client";
import type { AcceptInviteResult, InviteAccountLink, InviteView, MyInvite } from "./types";

/**
 * The invitee's side of account invites (docs/architecture.md, "Account
 * invites"). The emailed link is `/invite#token=…`; the token (from the
 * fragment, lib/link-token.ts) is the credential for the first two calls.
 * Acceptance needs the invitee signed in with a verified email equal to the
 * invite's.
 */

/**
 * What the invite is, without changing anything (safe on page load).
 * ApiError 400 malformed token, 404 unknown, 410 expired, revoked or already used.
 */
export async function viewInvite(token: string) {
  return apiFetch<InviteView>("/invites/view", { method: "POST", body: { token } });
}

/**
 * "Create account": a sign-up token's hash for the invite's address, to pass
 * to `verifyOtp({token_hash, type: "invite"})`, then set a password. ApiError
 * 400, 404, 410 (as viewInvite); 409 with `body.code === "has_account"`: the
 * address already has an account (sign in instead); 429 too many attempts;
 * 503 not available here (fall back to `/signup?next=/invite`).
 */
export async function getInviteAccountLink(token: string) {
  return apiFetch<InviteAccountLink>("/invites/account-link", { method: "POST", body: { token } });
}

/** Signed in with a verified email: the pending invite for it. ApiError 401, 403 not verified, 404 none. */
export async function getMyInvite(getToken: GetToken) {
  const token = await getToken();
  return apiFetch<MyInvite>("/invites/me", { token });
}

/**
 * Accepts the caller's invite (idempotent). ApiError 401, 403 not verified,
 * 404 not theirs or unknown, 409 the account already has an organiser, 410
 * expired, revoked or used by another account.
 */
export async function acceptInvite(inviteId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AcceptInviteResult>("/invites/accept", { method: "POST", body: { inviteId }, token });
}
