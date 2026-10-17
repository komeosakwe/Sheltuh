import type { OrganiserEditField } from "@/lib/api/types";
import { SOCIAL_HANDLE_FIELDS, type SocialHandleField } from "@/lib/organiser-profile";

/** What the admin views call each field an organiser-log entry can record. */
export const ORGANISER_FIELD_LABELS: Record<OrganiserEditField, string> = {
  description: "Bio",
  websiteUrl: "Website",
  instagramHandle: "Instagram",
  tiktokHandle: "TikTok",
  facebookPage: "Facebook",
  xHandle: "X",
  status: "Status",
};

/** The order fields are listed in (the profile form's order, then status). */
export const ORGANISER_FIELD_ORDER: readonly OrganiserEditField[] = [
  "description",
  "websiteUrl",
  ...SOCIAL_HANDLE_FIELDS.map((f) => f.field),
  "status",
];

function isSocialHandleField(field: OrganiserEditField): field is SocialHandleField {
  return SOCIAL_HANDLE_FIELDS.some((f) => f.field === field);
}

/**
 * A stored value as it reads on the profile: handles with their prefix
 * ("@name", "facebook.com/page"), anything else as stored.
 */
export function formatOrganiserFieldValue(field: OrganiserEditField, value: string): string {
  if (!isSocialHandleField(field)) return value;
  const prefix = SOCIAL_HANDLE_FIELDS.find((f) => f.field === field)?.prefix ?? "";
  return `${prefix}${value}`;
}
