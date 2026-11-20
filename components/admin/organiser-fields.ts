import { featuredVideoPageUrl, isFeaturedVideo } from "@/lib/api/featured-video";
import { isOrganiserTag, organiserTagLabel } from "@/lib/api/organiser-tags";
import type { OrganiserEditEntry, OrganiserLogField } from "@/lib/api/types";
import { formatDayTime } from "@/lib/format";
import { SOCIAL_HANDLE_FIELDS, type SocialHandleField } from "@/lib/organiser-profile";

/** What the admin views call each field an organiser-log entry can record. */
export const ORGANISER_FIELD_LABELS: Record<OrganiserLogField, string> = {
  description: "Bio",
  websiteUrl: "Website",
  instagramHandle: "Instagram",
  tiktokHandle: "TikTok",
  spotifyPath: "Spotify",
  soundcloudHandle: "SoundCloud",
  youtubeChannel: "YouTube",
  facebookPage: "Facebook",
  xHandle: "X",
  linkedinPath: "LinkedIn",
  featuredVideo: "Featured video",
  logo: "Logo",
  cover: "Cover photo",
  profileTags: "Profile categories",
  customTags: "Own words",
  status: "Status",
};

/** The order fields are listed in (the profile form's order, then status). */
export const ORGANISER_FIELD_ORDER: readonly OrganiserLogField[] = [
  "description",
  "websiteUrl",
  ...SOCIAL_HANDLE_FIELDS.map((f) => f.field),
  "featuredVideo",
  "logo",
  "cover",
  "profileTags",
  "customTags",
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

/**
 * A logged logo version (milliseconds since the epoch of the upload) as
 * "Uploaded Fri 25 Sep, 8:05 pm" (Melbourne); anything unexpected as stored.
 */
export function formatLoggedLogo(value: string): string {
  if (!/^\d{1,15}$/.test(value)) return value;
  const at = new Date(Number(value));
  return Number.isNaN(at.getTime()) ? value : `Uploaded ${formatDayTime(at.toISOString())}`;
}

/** Logged profile chips ("live-music, art") as their labels ("Live music, Art"); a slug the list doesn't know as stored. */
export function formatLoggedProfileTags(value: string): string {
  return value
    .split(", ")
    .map((slug) => (isOrganiserTag(slug) ? organiserTagLabel(slug) : slug))
    .join(", ");
}

/**
 * Logged own words ("Late night, Queer joy": an own word can't hold a comma)
 * each in curly quotes, as the row above the log shows them ("“Late night”,
 * “Queer joy”"), so a stray space is visible.
 */
export function formatLoggedCustomTags(value: string): string {
  return value
    .split(", ")
    .map((word) => `“${word}”`)
    .join(", ");
}

/**
 * The words for a logged value that has no text of its own, or null when it
 * has some: profile chips not chosen yet (null: their profile shows their
 * event categories) or chosen as none (""); nothing at all for any field (null).
 */
export function emptyOrganiserFieldValue(field: OrganiserLogField, value: string | null): string | null {
  if (field === "profileTags") {
    if (value === null) return "Not chosen yet (their profile showed their event categories)";
    if (value === "") return "None chosen";
    return null;
  }
  if (value === null || (value === "" && field === "customTags")) return "(none)";
  return null;
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
 * a logo or cover as when it was uploaded ("Uploaded Fri 25 Sep, 8:05 pm"),
 * profile chips from the list as their labels ("Live music, Art"), own words
 * in quotes ("“Late night”, “Queer joy”"), anything else as stored.
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
  if (field === "logo" || field === "cover") return formatLoggedLogo(value);
  if (field === "profileTags") return formatLoggedProfileTags(value);
  if (field === "customTags") return formatLoggedCustomTags(value);
  if (!isSocialHandleField(field)) return value;
  const prefix = SOCIAL_HANDLE_FIELDS.find((f) => f.field === field)?.prefix ?? "";
  return `${prefix}${value}`;
}
