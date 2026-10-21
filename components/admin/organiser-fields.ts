import { featuredVideoPageUrl, isFeaturedVideo } from "@/lib/api/featured-video";
import type { OrganiserEditEntry, OrganiserLogField } from "@/lib/api/types";
import { SOCIAL_HANDLE_FIELDS, type SocialHandleField } from "@/lib/organiser-profile";

/** What the admin views call each field an organiser-log entry can record. */
export const ORGANISER_FIELD_LABELS: Record<OrganiserLogField, string> = {
  description: "Bio",
  websiteUrl: "Website",
  instagramHandle: "Instagram",
  tiktokHandle: "TikTok",
  facebookPage: "Facebook",
  xHandle: "X",
  featuredVideo: "Featured video",
  status: "Status",
};

/** The order fields are listed in (the profile form's order, then status). */
export const ORGANISER_FIELD_ORDER: readonly OrganiserLogField[] = [
  "description",
  "websiteUrl",
  ...SOCIAL_HANDLE_FIELDS.map((f) => f.field),
  "featuredVideo",
  "status",
];

const PROVIDER_NAMES = { youtube: "YouTube", vimeo: "Vimeo" } as const;

/** A logged video ("youtube:{id}") as its page's link, "YouTube: https://…"; anything unexpected as stored. */
export function formatLoggedVideo(value: string): string {
  const at = value.indexOf(":");
  const video = { provider: value.slice(0, at), id: value.slice(at + 1) };
  if (at === -1 || !isFeaturedVideo(video)) return value;
  return `${PROVIDER_NAMES[video.provider]}: ${featuredVideoPageUrl(video)}`;
}

function isSocialHandleField(field: OrganiserLogField): field is SocialHandleField {
  return SOCIAL_HANDLE_FIELDS.some((f) => f.field === field);
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

/**
 * A stored value as it reads on the profile: handles with their prefix
 * ("@name", "facebook.com/page"), statuses in words ("Approved"; a takedown's
 * "rejected" reads "Suspended"), a video as its link ("YouTube: https://…"),
 * anything else as stored.
 */
export function formatOrganiserFieldValue(
  field: OrganiserLogField,
  value: string,
  kind?: OrganiserEditEntry["kind"],
): string {
  if (field === "status") {
    if (kind === "suspended" && value === "rejected") return "Suspended";
    return STATUS_LABELS[value] ?? value;
  }
  if (field === "featuredVideo") return formatLoggedVideo(value);
  if (!isSocialHandleField(field)) return value;
  const prefix = SOCIAL_HANDLE_FIELDS.find((f) => f.field === field)?.prefix ?? "";
  return `${prefix}${value}`;
}
