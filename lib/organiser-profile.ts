import { pathSocialValueFromInput, type PathSocialField } from "@/lib/api/social-profiles";
import type { OrganiserSocialLinks, PublicOrganiserProfile } from "@/lib/api/types";

/**
 * An organiser profile's own fields, without its event lists: what the
 * profile page shows above the events, which it's given separately, already
 * in the screens' shape (a live profile's adapted, or the demo's samples).
 */
export type OrganiserProfileDetails = Omit<PublicOrganiserProfile, "upcomingEvents" | "recentEvents">;

/** Longest bio the API accepts (organisers.description). */
/** The dashboard Profile page's logo field (its id is `logo`), for every "Add logo" link. */
export const ADD_LOGO_HREF = "/dashboard/profile#logo";

export const MAX_BIO_LENGTH = 2000;

export type SocialNetwork = keyof OrganiserSocialLinks;

/** The order and names the social links are shown in. */
export const SOCIAL_NETWORKS: readonly { network: SocialNetwork; label: string }[] = [
  { network: "instagram", label: "Instagram" },
  { network: "tiktok", label: "TikTok" },
  { network: "spotify", label: "Spotify" },
  { network: "soundcloud", label: "SoundCloud" },
  { network: "youtube", label: "YouTube" },
  { network: "facebook", label: "Facebook" },
  { network: "x", label: "X" },
  { network: "linkedin", label: "LinkedIn" },
];

/** The organiser profile page's title before (or without) the organiser's name. */
export const ORGANISER_PAGE_TITLE = "Organiser — Sheltüh";
/** The title while the profile can't be shown (unknown or not public). */
export const ORGANISER_UNAVAILABLE_TITLE = "Organiser not available — Sheltüh";

/** "Northside Noise — Sheltüh". */
export function organiserPageTitle(displayName: string): string {
  return `${displayName} — Sheltüh`;
}

/**
 * The social-handle fields an organiser types into, in display order. The
 * server validates them (lib/server/organiser-input.ts) and strips a leading
 * '@'; the client only shapes the request. The hints spell out the server's
 * limits so they're known before a save is refused.
 */
export const SOCIAL_HANDLE_FIELDS = [
  {
    field: "instagramHandle",
    label: "Instagram username",
    prefix: "@",
    hint: "Without the @. Letters, numbers, . and _, up to 30.",
  },
  {
    field: "tiktokHandle",
    label: "TikTok username",
    prefix: "@",
    hint: "Without the @. Letters, numbers, . and _, up to 30.",
  },
  {
    field: "spotifyPath",
    label: "Spotify",
    prefix: "open.spotify.com/",
    hint: "Paste your Spotify artist, podcast or profile link.",
  },
  {
    field: "soundcloudHandle",
    label: "SoundCloud",
    prefix: "soundcloud.com/",
    hint: "Your name after soundcloud.com/, or paste your link.",
  },
  {
    field: "youtubeChannel",
    label: "YouTube",
    prefix: "youtube.com/",
    hint: "Your @handle, or paste your channel link.",
  },
  {
    field: "facebookPage",
    label: "Facebook page",
    prefix: "facebook.com/",
    hint: "Letters, numbers and ., 5 to 50.",
  },
  {
    field: "xHandle",
    label: "X username",
    prefix: "@",
    hint: "Without the @. Letters, numbers and _, up to 15.",
  },
  {
    field: "linkedinPath",
    label: "LinkedIn",
    prefix: "linkedin.com/",
    hint: "Paste your LinkedIn profile or company page link.",
  },
] as const;

export type SocialHandleField = (typeof SOCIAL_HANDLE_FIELDS)[number]["field"];
export type SocialHandleValues = Record<SocialHandleField, string>;

/** The sites each handle's profile URL can be on ("www.", "m." and the like are dropped first). */
const PROFILE_HOSTS: Record<Exclude<SocialHandleField, PathSocialField>, readonly string[]> = {
  instagramHandle: ["instagram.com"],
  tiktokHandle: ["tiktok.com"],
  facebookPage: ["facebook.com", "fb.com"],
  xHandle: ["x.com", "twitter.com"],
};

const PATH_FIELDS: readonly SocialHandleField[] = ["spotifyPath", "soundcloudHandle", "youtubeChannel", "linkedinPath"];

function isPathField(field: SocialHandleField): field is PathSocialField {
  return PATH_FIELDS.includes(field);
}

/** One-segment paths on those sites that are pages of the site itself, not someone's profile. */
const NOT_PROFILES = new Set([
  "accounts",
  "events",
  "explore",
  "groups",
  "hashtag",
  "home",
  "i",
  "login",
  "messages",
  "notifications",
  "p",
  "pages",
  "profile.php",
  "reel",
  "reels",
  "search",
  "settings",
  "share",
  "stories",
  "watch",
]);

/**
 * The handle in a pasted profile URL for that field's network, when it's
 * unambiguous: instagram.com/name, tiktok.com/@name, facebook.com/name,
 * x.com/name (or twitter.com/name), with or without https:// and "www.",
 * and exactly one path segment. Anything else (a plain handle, another site,
 * a post or other deeper link) is null, and left for the server to judge.
 */
export function handleFromProfileUrl(field: SocialHandleField, value: string): string | null {
  const trimmed = value.trim();
  // Spotify, SoundCloud, YouTube and LinkedIn store a small path, not a username
  // (lib/api/social-profiles.ts, the same reader the API uses): only a pasted
  // link or spotify: URI is rewritten here, a typed name is left alone.
  if (isPathField(field)) {
    return trimmed.includes("/") || trimmed.toLowerCase().startsWith("spotify:")
      ? pathSocialValueFromInput(field, trimmed)
      : null;
  }
  if (!trimmed.includes("/")) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|mobile|web)\./, "");
  if (!PROFILE_HOSTS[field].includes(host)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(segments[0]);
  } catch {
    return null;
  }
  if (field === "tiktokHandle") {
    if (!segment.startsWith("@")) return null;
    segment = segment.slice(1);
  }
  if (!segment || /[\s@/]/.test(segment) || NOT_PROFILES.has(segment.toLowerCase())) return null;
  return segment;
}

/** The form's values for an organiser record (or an application being edited): every field, "" when unset. */
export function socialHandleValuesOf(record: Partial<Record<SocialHandleField, string | undefined>> | undefined): SocialHandleValues {
  return Object.fromEntries(SOCIAL_HANDLE_FIELDS.map(({ field }) => [field, record?.[field] ?? ""])) as SocialHandleValues;
}

/** Handles as typed: trimmed, with "" meaning "clear it" (sent as null). */
export function socialHandlesForRequest(values: SocialHandleValues): Record<SocialHandleField, string | null> {
  return {
    instagramHandle: values.instagramHandle.trim() || null,
    tiktokHandle: values.tiktokHandle.trim() || null,
    spotifyPath: values.spotifyPath.trim() || null,
    soundcloudHandle: values.soundcloudHandle.trim() || null,
    youtubeChannel: values.youtubeChannel.trim() || null,
    facebookPage: values.facebookPage.trim() || null,
    xHandle: values.xHandle.trim() || null,
    linkedinPath: values.linkedinPath.trim() || null,
  };
}

const monthYearFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

/** "2026-03" -> "March 2026". Anything that isn't YYYY-MM is returned as-is rather than invented. */
export function formatMemberSince(yearMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) return yearMonth;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return yearMonth;
  return monthYearFormatter.format(new Date(Date.UTC(Number(match[1]), month - 1, 1)));
}

/** The hostname to show for a website link ("www." dropped), or null if it isn't an http(s) URL. */
export function websiteHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

/** A trimmed value that's a valid http(s) URL as typed (the API requires the scheme too). */
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Longest website URL the API accepts (organisers.website_url). */
export const MAX_WEBSITE_URL_LENGTH = 2048;

/** The error for a new website that isn't an https:// address (as the API words it). */
export const WEBSITE_NOT_HTTPS_ERROR = "Use your site's secure address, starting with https://";

// As the API refuses (lib/server/validation.ts): control, invisible-format,
// separator and whitespace characters, and backslashes (which URL parsers
// read as "/").
const URL_DISALLOWED = /[\p{Cc}\p{Cf}\p{Z}\s\\]/u;

/**
 * The client-side copy of the API's website rule (optionalUrl in
 * lib/server/validation.ts), with the same messages, checked before a round
 * trip. The API is the source of truth and its field error is always shown.
 *
 * Blank is fine (no website). `current` is the value already stored: left
 * exactly as it is, it's accepted even if it predates these rules (an
 * `http://` site). A new value must start with `https://` as typed, and
 * can't carry a username or password ("https://bank.example@evil.example"
 * reads as one site and goes to another).
 */
export function websiteUrlError(value: string, current?: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (current !== undefined && trimmed === current) return null;
  if (trimmed.length > MAX_WEBSITE_URL_LENGTH) return `Must be ${MAX_WEBSITE_URL_LENGTH} characters or fewer.`;
  if (/^http:\/\//i.test(trimmed)) return WEBSITE_NOT_HTTPS_ERROR;
  let url: URL;
  try {
    if (!/^https:\/\//i.test(trimmed) || URL_DISALLOWED.test(trimmed)) throw new Error("not a plain https URL");
    url = new URL(trimmed);
    if (url.protocol !== "https:") throw new Error("not https");
  } catch {
    return "Enter a valid URL, including https://";
  }
  // The authority as typed (up to the first / ? or #), as well as the parser's view.
  const authority = trimmed.slice("https://".length).split(/[/?#]/, 1)[0];
  if (authority.includes("@") || url.username || url.password) {
    return "Enter the address without a username or password.";
  }
  return null;
}

/**
 * The handle in a server-built profile URL, without any '@', or null if the URL
 * can't be read or has nothing readable to show: instagram.com/name/,
 * tiktok.com/@name, facebook.com/name, x.com/name, soundcloud.com/name,
 * youtube.com/@name -> "name", linkedin.com/in/slug -> "in/slug" (the kind is
 * part of how it reads). Spotify's links carry only an opaque id, and a
 * youtube.com/channel/UC… link no name, so those are null.
 */
export function socialHandleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "open.spotify.com") return null;
    if (host === "youtube.com") {
      return segments[0]?.startsWith("@") ? decodeURIComponent(segments[0]).slice(1) || null : null;
    }
    if (host === "linkedin.com") {
      return segments.length >= 2 ? `${decodeURIComponent(segments[0])}/${decodeURIComponent(segments[1])}` : null;
    }
    const segment = segments[0];
    if (!segment) return null;
    const handle = decodeURIComponent(segment).replace(/^@/, "");
    return handle || null;
  } catch {
    return null;
  }
}

/**
 * How a handle (from socialHandleFromUrl) reads in a link: "@name", except
 * Facebook pages, SoundCloud and LinkedIn, which aren't @-names:
 * "facebook.com/page", "soundcloud.com/name", "linkedin.com/in/slug".
 */
export function displayHandle(network: SocialNetwork, handle: string): string {
  switch (network) {
    case "facebook":
      return `facebook.com/${handle}`;
    case "soundcloud":
      return `soundcloud.com/${handle}`;
    case "linkedin":
      return `linkedin.com/${handle}`;
    default:
      return `@${handle}`;
  }
}
