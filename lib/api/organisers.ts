import type { EventCategory } from "@/lib/types";
import { apiFetch, type GetToken } from "./client";
import type { OrganiserRecord, PublicOrganiserProfile } from "./types";

/**
 * Social handles, as the organiser types them: a leading '@' and surrounding
 * spaces are removed by the server. Not a URL. null or "" clears one.
 */
export interface OrganiserSocialHandlesInput {
  /** Up to 30 letters, numbers, full stops or underscores. */
  instagramHandle?: string | null;
  /** Up to 30 letters, numbers, full stops or underscores. */
  tiktokHandle?: string | null;
  /** The page's username (facebook.com/<page>): 5 to 50 letters, numbers or full stops. */
  facebookPage?: string | null;
  /** Up to 15 letters, numbers or underscores. */
  xHandle?: string | null;
}

export interface OrganiserApplicationInput extends OrganiserSocialHandlesInput {
  displayName: string;
  contactEmail: string;
  description: string;
  categories: EventCategory[];
  websiteUrl?: string;
}

/**
 * An approved organiser's profile edit (no new review). Fields left out are
 * unchanged; websiteUrl or a handle set to null or "" is cleared.
 */
export interface OrganiserProfileInput extends OrganiserSocialHandlesInput {
  description?: string;
  websiteUrl?: string | null;
}

export async function applyAsOrganiser(input: OrganiserApplicationInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>("/organisers/apply", { method: "POST", body: input, token });
}

export async function getMyOrganiser(getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>("/organisers/me", { token });
}

/** Edits and resubmits a rejected application (back to pending). */
export async function resubmitOrganiser(input: OrganiserApplicationInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>("/organisers/me", { method: "PATCH", body: input, token });
}

/**
 * Edits an approved organiser's public profile; stays approved. 400 with
 * fieldErrors for an invalid field (or a changed displayName, contactEmail or
 * categories); 409 if the application isn't approved.
 */
export async function updateOrganiserProfile(input: OrganiserProfileInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>("/organisers/me", { method: "PATCH", body: input, token });
}

/** Public: an approved organiser's profile and their published events. 404 for anything else. */
export function getOrganiserProfile(organiserId: string) {
  return apiFetch<PublicOrganiserProfile>(`/organisers/${encodeURIComponent(organiserId)}/profile`);
}

/** Starts (or resumes) Stripe Connect onboarding — returns the URL to send the organiser to. */
export async function connectStripeOnboarding(getToken: GetToken) {
  const token = await getToken();
  return apiFetch<{ url: string }>("/organisers/me/connect/onboard", { method: "POST", token });
}

/** Re-syncs payoutsEnabled from Stripe's own account status. */
export async function refreshStripeConnectStatus(getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>("/organisers/me/connect/refresh", { method: "POST", token });
}
