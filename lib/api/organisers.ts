import type { EventCategory } from "@/lib/types";
import { apiFetch } from "./client";
import type { OrganiserRecord } from "./types";

export interface OrganiserApplicationInput {
  displayName: string;
  contactEmail: string;
  description: string;
  categories: EventCategory[];
  websiteUrl?: string;
}

export function applyAsOrganiser(input: OrganiserApplicationInput, token: string) {
  return apiFetch<OrganiserRecord>("/organisers/apply", { method: "POST", body: input, token });
}

export function getMyOrganiser(token: string) {
  return apiFetch<OrganiserRecord>("/organisers/me", { token });
}

export function resubmitOrganiser(input: OrganiserApplicationInput, token: string) {
  return apiFetch<OrganiserRecord>("/organisers/me", { method: "PATCH", body: input, token });
}
