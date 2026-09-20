import type { EventCategory } from "@/lib/types";
import { apiFetch, type GetToken } from "./client";
import type { OrganiserRecord } from "./types";

export interface OrganiserApplicationInput {
  displayName: string;
  contactEmail: string;
  description: string;
  categories: EventCategory[];
  websiteUrl?: string;
}

export async function applyAsOrganiser(input: OrganiserApplicationInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>("/organisers/apply", { method: "POST", body: input, token });
}

export async function getMyOrganiser(getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>("/organisers/me", { token });
}

export async function resubmitOrganiser(input: OrganiserApplicationInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<OrganiserRecord>("/organisers/me", { method: "PATCH", body: input, token });
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
