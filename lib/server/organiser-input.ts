/**
 * Organiser social profiles: validation of the handles organisers enter, and
 * the public URLs built from them. Only handles are stored (never free-form
 * URLs), so a link can only ever point at the network it names. The patterns
 * match the check constraints in
 * supabase/migrations/20261016000000_organiser_public_profile.sql (and, for
 * Spotify, SoundCloud, YouTube and LinkedIn, 20261121000000_organiser_more_socials.sql).
 */
import {
  isPathSocialValue,
  PATH_SOCIAL_PATTERNS as PATH_PATTERNS,
  pathSocialValueFromInput,
  type PathSocialField,
} from "@/lib/api/social-profiles";
import type { OrganiserSocialLinks } from "./types";

export type SocialField = "instagramHandle" | "tiktokHandle" | "facebookPage" | "xHandle" | PathSocialField;

interface SocialRule {
  field: SocialField;
  /** The organisers column it's stored in. */
  column:
    | "instagram_handle"
    | "tiktok_handle"
    | "facebook_page"
    | "x_handle"
    | "spotify_path"
    | "soundcloud_handle"
    | "youtube_channel"
    | "linkedin_path";
  pattern: RegExp;
  error: string;
  url: (handle: string) => string;
  link: keyof OrganiserSocialLinks;
  /**
   * Set for the networks whose stored value is more than a username (see
   * lib/api/social-profiles.ts): what was typed or pasted (a stored form, or
   * a link on the network's own site) is read into the stored value. The
   * handle networks take just a handle (a leading '@' stripped), as ever.
   */
  path?: PathSocialField;
}

export const SOCIAL_RULES: readonly SocialRule[] = [
  {
    field: "instagramHandle",
    column: "instagram_handle",
    pattern: /^[A-Za-z0-9._]{1,30}$/,
    error: "Enter just your Instagram username: up to 30 letters, numbers, full stops or underscores.",
    url: (h) => `https://www.instagram.com/${h}/`,
    link: "instagram",
  },
  {
    field: "tiktokHandle",
    column: "tiktok_handle",
    pattern: /^[A-Za-z0-9._]{1,30}$/,
    error: "Enter just your TikTok username: up to 30 letters, numbers, full stops or underscores.",
    url: (h) => `https://www.tiktok.com/@${h}`,
    link: "tiktok",
  },
  {
    field: "spotifyPath",
    column: "spotify_path",
    pattern: PATH_PATTERNS.spotifyPath,
    error: "Paste your Spotify artist, podcast or profile link, like open.spotify.com/artist/… (or artist/…, show/…, user/…).",
    url: (p) => `https://open.spotify.com/${p}`,
    link: "spotify",
    path: "spotifyPath",
  },
  {
    field: "soundcloudHandle",
    column: "soundcloud_handle",
    pattern: PATH_PATTERNS.soundcloudHandle,
    error: "Enter just your SoundCloud name (soundcloud.com/<name>): up to 40 letters, numbers, hyphens or underscores.",
    url: (h) => `https://soundcloud.com/${h}`,
    link: "soundcloud",
    path: "soundcloudHandle",
  },
  {
    field: "youtubeChannel",
    column: "youtube_channel",
    pattern: PATH_PATTERNS.youtubeChannel,
    error: "Enter your YouTube @handle (3 to 30 letters, numbers, full stops, hyphens or underscores), or a youtube.com/channel/UC… link.",
    url: (c) => `https://www.youtube.com/${c}`,
    link: "youtube",
    path: "youtubeChannel",
  },
  {
    field: "facebookPage",
    column: "facebook_page",
    pattern: /^[A-Za-z0-9.]{5,50}$/,
    error: "Enter just your Facebook page's username: 5 to 50 letters, numbers or full stops.",
    url: (h) => `https://www.facebook.com/${h}`,
    link: "facebook",
  },
  {
    field: "xHandle",
    column: "x_handle",
    pattern: /^[A-Za-z0-9_]{1,15}$/,
    error: "Enter just your X username: up to 15 letters, numbers or underscores.",
    url: (h) => `https://x.com/${h}`,
    link: "x",
  },
  {
    field: "linkedinPath",
    column: "linkedin_path",
    pattern: PATH_PATTERNS.linkedinPath,
    error: "Paste your LinkedIn profile or company page link, like linkedin.com/company/… or linkedin.com/in/… (or company/…, in/…).",
    url: (p) => `https://www.linkedin.com/${p}`,
    link: "linkedin",
    path: "linkedinPath",
  },
];

const HAS_ALPHANUMERIC = /[A-Za-z0-9]/;

/**
 * One handle from a request body: `undefined` when the field wasn't sent,
 * `null` to clear it (null or blank), otherwise the trimmed handle without a
 * leading '@'. An invalid handle records an error (and returns undefined).
 */
export function parseHandle(value: unknown, rule: SocialRule, errors: Record<string, string>): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    errors[rule.field] = rule.error;
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (rule.path) {
    const stored = pathSocialValueFromInput(rule.path, trimmed);
    if (stored === null) {
      errors[rule.field] = rule.error;
      return undefined;
    }
    return stored;
  }
  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!rule.pattern.test(handle) || !HAS_ALPHANUMERIC.test(handle)) {
    errors[rule.field] = rule.error;
    return undefined;
  }
  return handle;
}

/** Every social handle the body sends (absent fields are left out: "unchanged"). */
export function parseSocialHandles(
  body: Record<string, unknown>,
  errors: Record<string, string>,
): Partial<Record<SocialField, string | null>> {
  const handles: Partial<Record<SocialField, string | null>> = {};
  for (const rule of SOCIAL_RULES) {
    const handle = parseHandle(body[rule.field], rule, errors);
    if (handle !== undefined) handles[rule.field] = handle;
  }
  return handles;
}

/** The public https URLs for an organiser's stored handles (unset ones left out). */
export function socialLinks(handles: Partial<Record<SocialField, string | undefined>>): OrganiserSocialLinks {
  const links: OrganiserSocialLinks = {};
  for (const rule of SOCIAL_RULES) {
    const handle = handles[rule.field];
    // Re-checked on the way out too: the database enforces the same pattern,
    // but a link is only ever built from a handle that matches it.
    if (!handle) continue;
    const valid = rule.path
      ? isPathSocialValue(rule.path, handle)
      : rule.pattern.test(handle) && HAS_ALPHANUMERIC.test(handle);
    if (valid) links[rule.link] = rule.url(handle);
  }
  return links;
}

/**
 * The social columns of an insert: their names, one placeholder each
 * (numbered from `firstParam`) and the values to bind, in SOCIAL_RULES order
 * (unset: null). Column names only ever come from SOCIAL_RULES.
 */
export function socialInsertParts(
  handles: Partial<Record<SocialField, string | null>>,
  firstParam: number,
): { columns: string; placeholders: string; params: (string | null)[] } {
  return {
    columns: SOCIAL_RULES.map((rule) => rule.column).join(", "),
    placeholders: SOCIAL_RULES.map((_, i) => `$${firstParam + i}`).join(", "),
    params: SOCIAL_RULES.map((rule) => handles[rule.field] ?? null),
  };
}
