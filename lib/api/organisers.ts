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
