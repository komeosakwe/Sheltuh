import { ApiError, apiFetch, isApiConfigured, type GetToken } from "./client";
import type { MemberProfile, ProfileInput, ProfilePatchInput, ProfileRecord } from "./types";

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

/**
 * Member profile settings: visibility (opt-in), bio, Instagram handle, and the
 * display name. Fields left out are unchanged. ApiError 400 (fieldErrors),
 * 403 (unverified email, suspended), 404 (no profile yet).
 */
export async function updateMyProfile(input: ProfilePatchInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<ProfileRecord>("/profiles/me", { method: "PATCH", body: input, token });
}

/**
 * Uploads a profile photo (JPEG, PNG or WebP, under 5 MB). The server
 * re-encodes it to a square image and strips all metadata (camera, GPS).
 * ApiError 400 (not a supported image), 403, 404 (no profile), 413 (too
 * large), 429 (20 a day).
 */
export async function uploadMyAvatar(image: Blob, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<ProfileRecord>("/profiles/me/avatar", { method: "PUT", body: image, token });
}

/** Removes the caller's photo. Idempotent. */
export async function deleteMyAvatar(getToken: GetToken) {
  const token = await getToken();
  await apiFetch<void>("/profiles/me/avatar", { method: "DELETE", token });
}

/**
 * Another member's profile (verified members with a profile). ApiError 404
 * for anything the caller can't see (hidden, blocked either way, suspended,
 * or the caller isn't eligible); 429 when rate-limited.
 */
export async function getMemberProfile(profileId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<MemberProfile>(`/profiles/${encodeURIComponent(profileId)}`, { token });
}

/**
 * A member photo (`avatarUrl` / `avatarThumbUrl` from the API). Photos are
 * never public, so they can't go straight into an <img src>: this fetches one
 * with the bearer token, and the caller shows it with URL.createObjectURL
 * (and revokes it when done). ApiError 404 when it can't be seen (fall back to
 * initials).
 */
export async function fetchAvatar(url: string, getToken: GetToken, signal?: AbortSignal): Promise<Blob> {
  if (!isApiConfigured) throw new Error("The live API is not configured in this environment (Supabase is unset).");
  if (!url.startsWith("/api/profiles/") && !url.startsWith("/api/admin/reports/")) throw new Error("Not a photo URL.");
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, ...(signal ? { signal } : {}) });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status}).`);
  return res.blob();
}
