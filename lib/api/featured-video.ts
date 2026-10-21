/**
 * An organiser's featured video (docs/architecture.md, "Organiser profiles"):
 * a YouTube or Vimeo video, stored as provider + id only, never the URL the
 * organiser pasted. Shared by the API (validation) and the browser (building
 * the privacy-enhanced player URL only once the visitor presses play).
 */

export type FeaturedVideoProvider = "youtube" | "vimeo";

export interface FeaturedVideo {
  provider: FeaturedVideoProvider;
  /** YouTube: 11 characters of [A-Za-z0-9_-]. Vimeo: 1 to 12 digits. */
  id: string;
}

/** Mirrors the organisers_featured_video_check constraint. */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const VIMEO_ID = /^[0-9]{1,12}$/;

/** Longest pasted link considered at all. */
export const MAX_VIDEO_URL_LENGTH = 2048;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com"]);

// Whitespace, control, invisible and format characters, and backslashes (which
// some parsers read as "/"): nothing a real copied link contains.
const DISALLOWED = /[\p{Cc}\p{Cf}\p{Z}\s\\]/u;

export function isFeaturedVideo(value: unknown): value is FeaturedVideo {
  if (!value || typeof value !== "object") return false;
  const { provider, id } = value as Record<string, unknown>;
  if (typeof id !== "string") return false;
  return (provider === "youtube" && YOUTUBE_ID.test(id)) || (provider === "vimeo" && VIMEO_ID.test(id));
}

/**
 * The video behind a pasted link, or null if it isn't one of exactly these
 * forms (http or https, or no scheme; no username, password or port):
 * - youtube.com/watch?v={id} (also www. and m.; other query parameters ignored)
 * - youtu.be/{id}
 * - youtube.com/shorts/{id}
 * - vimeo.com/{digits} (also www.; a query string is ignored)
 * Anything else (embed or player URLs, playlists, channels, private Vimeo
 * links with a hash, other hosts, look-alike hosts) is refused.
 */
export function parseFeaturedVideoUrl(input: string): FeaturedVideo | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_VIDEO_URL_LENGTH || DISALLOWED.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  // Paths are matched exactly (one optional trailing slash): no extra segments.
  const path = url.pathname.replace(/\/$/, "");

  if (YOUTUBE_HOSTS.has(host)) {
    if (path === "/watch") {
      const ids = url.searchParams.getAll("v");
      return ids.length === 1 && YOUTUBE_ID.test(ids[0]) ? { provider: "youtube", id: ids[0] } : null;
    }
    const shorts = /^\/shorts\/([^/]+)$/.exec(path);
    return shorts && YOUTUBE_ID.test(shorts[1]) ? { provider: "youtube", id: shorts[1] } : null;
  }
  if (host === "youtu.be") {
    const id = path.slice(1);
    return YOUTUBE_ID.test(id) ? { provider: "youtube", id } : null;
  }
  if (VIMEO_HOSTS.has(host)) {
    const id = path.slice(1);
    return VIMEO_ID.test(id) ? { provider: "vimeo", id } : null;
  }
  return null;
}

/**
 * The privacy-enhanced player, to load only after the visitor presses play
 * (no third-party request before that). YouTube's no-cookie domain; Vimeo's
 * `dnt=1` (no tracking cookies). Neither autoplays on its own: the visitor's
 * press is the play action, so the URL asks it to start then.
 */
export function featuredVideoEmbedUrl(video: FeaturedVideo): string {
  if (video.provider === "youtube") {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=1&rel=0`;
  }
  return `https://player.vimeo.com/video/${encodeURIComponent(video.id)}?dnt=1&autoplay=1`;
}

/** The video's page on its own site (a plain link, e.g. "Watch on YouTube"). */
export function featuredVideoPageUrl(video: FeaturedVideo): string {
  return video.provider === "youtube"
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`
    : `https://vimeo.com/${encodeURIComponent(video.id)}`;
}

/** How the edit log stores a video: "youtube:{id}" / "vimeo:{id}". */
export function featuredVideoKey(video: FeaturedVideo): string {
  return `${video.provider}:${video.id}`;
}
