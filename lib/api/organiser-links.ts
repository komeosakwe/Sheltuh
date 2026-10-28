import { apiFetch, type GetToken } from "./client";
import type { OrganiserLinkJoinInput, OrganiserLinkJoinResult, OrganiserLinkView } from "./types";

/**
 * The joining side of organiser links (docs/architecture.md, "Organiser
 * links"). The link is `/organisers/join#token=…`; the token (from the
 * fragment) is the credential. Joining needs the person signed in with a
 * verified email (any address).
 */

/**
 * Whether the link can be used, without changing anything (safe on page
 * load). ApiError 404 (`body.code === "unavailable"`): unknown, used,
 * expired or cancelled, one answer for all; 429 too many checks.
 */
export async function viewOrganiserLink(token: string) {
  return apiFetch<OrganiserLinkView>("/organiser-links/view", { method: "POST", body: { token } });
}

/**
 * Joins as an approved organiser with the link (idempotent for the account
 * that used it). `displayName` and `categories` are needed when the account
 * has no organiser; a pending application is approved as it is. ApiError 400
 * fieldErrors (`displayName`, `categories`), 401, 403 email not verified, 404
 * unavailable (as viewOrganiserLink), 409 `body.code` `already_organiser`,
 * `rejected` (the link wasn't used) or `conflict` (try again), 429.
 */
export async function joinWithOrganiserLink(input: OrganiserLinkJoinInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserLinkJoinResult>("/organiser-links/join", { method: "POST", body: input, token });
}
