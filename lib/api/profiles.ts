import { apiFetch, type GetToken } from "./client";
import type { ProfileInput, ProfileRecord } from "./types";

/** The caller's social profile. Throws ApiError(404) if they haven't created one. */
export async function getMyProfile(getToken: GetToken) {
  const token = await getToken();
  return apiFetch<ProfileRecord>("/profiles/me", { token });
}

/**
 * Creates the caller's profile (adultConfirmed must be true) or renames it.
 * Needs a verified email (ApiError 403 otherwise).
 */
export async function saveMyProfile(input: ProfileInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<ProfileRecord>("/profiles/me", { method: "PUT", body: input, token });
}

/** Deletes the caller's profile and every Who's Going opt-in. Idempotent. */
export async function deleteMyProfile(getToken: GetToken) {
  const token = await getToken();
  await apiFetch<void>("/profiles/me", { method: "DELETE", token });
}
