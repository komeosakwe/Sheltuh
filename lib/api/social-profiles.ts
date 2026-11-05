/**
 * The "path" style social profiles: Spotify, SoundCloud, YouTube and
 * LinkedIn. Unlike Instagram's plain username, each of these needs a bit more
 * than a name to point at the right page (an artist or a podcast, a channel
 * id, a person or a company), so what's stored is a small validated value
 * and the server builds the https URL from it. Shared by the API (which
 * validates every request) and the profile forms (which tidy a pasted link
 * before it's sent). The patterns match the check constraints in
 * supabase/migrations/20261121000000_organiser_more_socials.sql.
 *
 * Stored forms:
 * - spotifyPath      `artist/<22 letters/digits>`, `show/<22 letters/digits>`
 *                    or `user/<1-64 of letters, digits . _ ->, starting with a letter or digit`
 *                    -> https://open.spotify.com/<path>
 * - soundcloudHandle the profile name, 1-40 of letters, digits, `_` and `-`
 *                    -> https://soundcloud.com/<name>
 * - youtubeChannel   `@<3-30 of letters, digits . _ ->, starting with a letter or digit` or
 *                    `channel/UC<22 of letters, digits, _ and ->`
 *                    -> https://www.youtube.com/<value>
 * - linkedinPath     `in/<slug>` or `company/<slug>`, the slug 3-100 of
 *                    letters, digits and `-`, starting with a letter or digit
 *                    -> https://www.linkedin.com/<path>
 */

export type PathSocialField = "spotifyPath" | "soundcloudHandle" | "youtubeChannel" | "linkedinPath";

// A name or id part starts with a letter or digit, so it can never be just "."
// or ".." (which a URL would resolve away) or only punctuation.
export const SPOTIFY_PATH = /^((artist|show)\/[A-Za-z0-9]{22}|user\/[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;
export const SOUNDCLOUD_HANDLE = /^[A-Za-z0-9_-]{1,40}$/;
export const YOUTUBE_CHANNEL = /^(@[A-Za-z0-9][A-Za-z0-9._-]{2,29}|channel\/UC[A-Za-z0-9_-]{22})$/;
export const LINKEDIN_PATH = /^(in|company)\/[A-Za-z0-9][A-Za-z0-9-]{2,99}$/;

/** The stored pattern for each field (the check constraints'; SoundCloud's also needs a letter or digit, see isPathSocialValue). */
export const PATH_SOCIAL_PATTERNS: Record<PathSocialField, RegExp> = {
  spotifyPath: SPOTIFY_PATH,
  soundcloudHandle: SOUNDCLOUD_HANDLE,
  youtubeChannel: YOUTUBE_CHANNEL,
  linkedinPath: LINKEDIN_PATH,
};

/** SoundCloud's own pages, which look like a one-segment profile. */
const SOUNDCLOUD_RESERVED = new Set([
  "charts",
  "discover",
  "feed",
  "jobs",
  "legal",
  "messages",
  "notifications",
  "pages",
  "people",
  "search",
  "settings",
  "stream",
  "terms-of-use",
  "upload",
  "you",
]);

const SPOTIFY_LOCALE_SEGMENT = /^intl-[a-z]{2}(-[A-Za-z]{2})?$/;
const SPOTIFY_URI = /^spotify:(artist|show|user):([A-Za-z0-9._-]+)$/i;

// Whitespace anywhere, control and invisible-format characters, backslashes.
const DISALLOWED = /[\p{Cc}\p{Cf}\p{Z}\s\\]/u;

interface ParsedUrl {
  host: string;
  /** Percent-decoded path segments, no empty ones. */
  segments: string[];
}

/**
 * A pasted http(s) link (the scheme optional), or null: anything with another
 * scheme, a username or password, or a port is not read at all. Query string
 * and fragment are dropped.
 */
function parseLink(text: string): ParsedUrl | null {
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const segments: string[] = [];
  for (const raw of url.pathname.split("/")) {
    if (!raw) continue;
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return { host: url.hostname.toLowerCase(), segments };
}

const withoutAt = (text: string) => (text.startsWith("@") ? text.slice(1) : text);

function spotifyFrom(text: string): string | null {
  const uri = SPOTIFY_URI.exec(text);
  if (uri) return `${uri[1].toLowerCase()}/${uri[2]}`;
  const stored = /^(artist|show|user)\/(.+)$/i.exec(text);
  if (stored && !text.includes("?") && !text.includes("#")) return `${stored[1].toLowerCase()}/${stored[2]}`;
  const link = parseLink(text);
  if (!link || link.host !== "open.spotify.com") return null;
  let segments = link.segments;
  if (segments[0] && SPOTIFY_LOCALE_SEGMENT.test(segments[0])) segments = segments.slice(1);
  const [kind, id] = segments;
  if (!kind || !id) return null;
  return `${kind.toLowerCase()}/${id}`;
}

function soundcloudFrom(text: string): string | null {
  if (!text.includes("/")) return withoutAt(text);
  const link = parseLink(text);
  if (!link || !["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].includes(link.host)) return null;
  return link.segments[0] ?? null;
}

function youtubeFrom(text: string): string | null {
  if (/^channel\/UC/i.test(text) && !text.includes("?") && !text.includes("#")) return `channel/${text.slice("channel/".length)}`;
  if (!text.includes("/")) return `@${withoutAt(text)}`;
  const link = parseLink(text);
  if (!link || !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(link.host)) return null;
  const [first, second] = link.segments;
  if (first?.startsWith("@")) return first;
  if (first === "channel" && second) return `channel/${second}`;
  return null;
}

function linkedinFrom(text: string): string | null {
  const stored = /^(in|company)\/([^/?#]+)$/i.exec(text);
  if (stored) return `${stored[1].toLowerCase()}/${stored[2]}`;
  const link = parseLink(text);
  if (!link || !/^([a-z]{2,3}\.|www\.)?linkedin\.com$/.test(link.host)) return null;
  const [kind, slug] = link.segments;
  if (!kind || !slug) return null;
  return `${kind.toLowerCase()}/${slug}`;
}

const READERS: Record<PathSocialField, (text: string) => string | null> = {
  spotifyPath: spotifyFrom,
  soundcloudHandle: soundcloudFrom,
  youtubeChannel: youtubeFrom,
  linkedinPath: linkedinFrom,
};

const HAS_ALPHANUMERIC = /[A-Za-z0-9]/;

/** Whether `value` is a stored form for `field` (its pattern; a SoundCloud name also has a letter or digit and isn't one of SoundCloud's own pages). */
export function isPathSocialValue(field: PathSocialField, value: string): boolean {
  if (!PATH_SOCIAL_PATTERNS[field].test(value)) return false;
  return field !== "soundcloudHandle" || (HAS_ALPHANUMERIC.test(value) && !SOUNDCLOUD_RESERVED.has(value.toLowerCase()));
}

/**
 * The stored value for what someone typed or pasted into `field`, or null if
 * it isn't one: the stored form itself, a spotify: URI, a bare name (SoundCloud
 * and YouTube, with or without a leading '@'), or an http(s) link on that
 * network's own site (www./m. and "http" accepted, query string, fragment
 * and anything after the profile part ignored). Never any other site, a link
 * with a username, password or port, or a page that isn't a profile.
 */
export function pathSocialValueFromInput(field: PathSocialField, input: string): string | null {
  const text = input.trim();
  if (!text || DISALLOWED.test(text)) return null;
  const value = READERS[field](text);
  return value !== null && isPathSocialValue(field, value) ? value : null;
}
