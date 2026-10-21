import { apiFetch, type GetToken } from "./client";
import type { ConfirmWaitlistResult, JoinWaitlistResult, LeaveWaitlistResult, WaitlistStatus } from "./types";

/**
 * The waitlist for sold-out events (docs/architecture.md, "Waitlist"). Only
 * an event whose `soldOut` is true (every ticket type sold out), ticketed on
 * Sheltüh and not ended, takes joins. Joining never reserves a ticket: when
 * tickets free up, people on the list are emailed in join order and it's
 * first come, first served.
 */

const waitlist = (eventId: string) => `/events/${encodeURIComponent(eventId)}/waitlist`;

async function optionalToken(getToken?: GetToken): Promise<string | undefined> {
  if (!getToken) return undefined;
  try {
    return await getToken();
  } catch {
    return undefined;
  }
}

/**
 * Joins `eventId`'s waitlist. Pass `getToken` when signed in: with the
 * account's own verified email (sent, or `email` left out) the member is on
 * the list at once (`{status: "joined", alreadyJoined}`). Any other email
 * gets a confirmation link (`{status: "confirmation_sent", expiresInHours}`:
 * show "check your inbox"); that answer is the same whether or not the
 * address was already on the list. A token that can't be had is left off.
 *
 * ApiError: 400 (fieldErrors `email`), 404 event not found, 409 not sold out,
 * ticketed elsewhere, or ended (the waitlist is closed), 503 busy or the
 * confirmation email couldn't be sent.
 */
export async function joinWaitlist(eventId: string, email?: string, getToken?: GetToken) {
  const token = await optionalToken(getToken);
  return apiFetch<JoinWaitlistResult>(waitlist(eventId), {
    method: "POST",
    body: email ? { email } : {},
    token,
  });
}

/** Signed in: whether the caller is on `eventId`'s waitlist (by account or verified email). ApiError 401, 404. */
export async function getWaitlistStatus(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<WaitlistStatus>(`${waitlist(eventId)}/status`, { token });
}

/**
 * Leaves a waitlist.
 * - `{token}`: the token from a notification email's leave link (its
 *   `#token=` fragment); public. ApiError 400 malformed, 404 unknown.
 * - `{eventId, getToken}`: signed in, the caller's own entry for that event.
 *   Resolves with nothing (204). Idempotent either way.
 */
export async function leaveWaitlist(input: { token: string }): Promise<LeaveWaitlistResult>;
export async function leaveWaitlist(input: { eventId: string; getToken: GetToken }): Promise<void>;
export async function leaveWaitlist(
  input: { token: string } | { eventId: string; getToken: GetToken },
): Promise<LeaveWaitlistResult | void> {
  if ("token" in input) {
    return apiFetch<LeaveWaitlistResult>("/waitlist/leave", { method: "POST", body: { token: input.token } });
  }
  const token = await input.getToken();
  await apiFetch<void>(waitlist(input.eventId), { method: "DELETE", token });
}

/**
 * Public: confirms a guest's join with the token from the emailed link (its
 * `#token=` fragment). Resolves also when already on the list. ApiError 400
 * malformed, 404 unknown, 410 expired or already used, 409 the waitlist is
 * closed.
 */
export async function confirmWaitlist(token: string) {
  return apiFetch<ConfirmWaitlistResult>("/waitlist/confirm", { method: "POST", body: { token } });
}
