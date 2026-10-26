import type { Metadata, ResolvingMetadata } from "next";
import { formatEventDateKey, formatEventDateShort, formatEventTime, zoneSuffix } from "./format";
import type { StateCode } from "./time-zones";
import { ORGANISER_PAGE_TITLE, ORGANISER_UNAVAILABLE_TITLE, organiserPageTitle } from "./organiser-profile";

/**
 * Link-preview metadata (Open Graph, Twitter/X cards, canonical) for public
 * pages: what a crawler such as facebookexternalhit, iMessage or Slack reads
 * when someone shares a link. Pure functions over data the public page
 * already shows; the live reads are in lib/server/share-metadata.ts.
 *
 * Absolute URLs are built from the configured site origin
 * (NEXT_PUBLIC_SITE_URL), never the request's Host header. Without one (a
 * demo deployment), paths stay relative and Next resolves them against
 * metadataBase (app/layout.tsx), or its own fallback.
 */

export const SITE_NAME = "Sheltüh";
export const OG_LOCALE = "en_AU";

/** Longest description an excerpt is cut to: most previews show 2 lines, Google about 155 characters. */
export const SHARE_DESCRIPTION_MAX = 200;

/** The configured public origin ("https://sheltuh.com.au"), or undefined when unset or not a URL. */
export function siteOrigin(value: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** `path` on `origin` when there is one; otherwise the path, for metadataBase to resolve. */
export function absoluteUrl(path: string, origin: string | undefined): string {
  if (/^https?:\/\//i.test(path)) return path;
  return origin ? `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}` : path;
}

/**
 * Plain text for a meta description: whitespace (newlines included) collapsed,
 * control characters dropped, and cut at a word boundary with an ellipsis
 * when longer than `max` characters.
 */
export function plainExcerpt(text: string, max: number): string {
  const plain = text
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  if (max < 2) return "";
  const cut = plain.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Don't throw away more than a third of the room to end on a whole word.
  const trimmed = lastSpace > max * 0.66 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[\s.,;:!?–—-]+$/u, "")}…`;
}

/** The fields of a public event that its link preview uses: nothing about tickets, buyers or the organiser's account. */
export interface EventShareFields {
  slug: string;
  title: string;
  description: string;
  venueName: string;
  suburb: string;
  startsAt: string;
  /** The zone the start is shown in (the event's own; absent: Melbourne). */
  timeZone?: string;
  /** The event's state, for the zone's name (the ACT's "Canberra time"; absent: VIC). */
  state?: StateCode;
  /** The approved cover image: a path on this site or an absolute URL. Absent: the site's share image. */
  imageUrl?: string;
  /** The image's MIME type, when known (og:image:type). */
  imageType?: string;
}

/**
 * "Sat 6 Mar 2027, 8:00 pm", in the event's zone (Melbourne by default),
 * always with the year (a preview may be read long after). Outside
 * Melbourne's zone it names the zone: "Sat 6 Mar 2027, 8:00 pm Perth time"
 * (zoneSuffix; pass the state for the ACT's "Canberra time").
 */
export function shareDate(isoLike: string, timeZone?: string, state?: StateCode): string {
  return `${formatEventDateShort(isoLike, timeZone)} ${formatEventDateKey(isoLike, timeZone).slice(0, 4)}, ${formatEventTime(isoLike, timeZone)}${zoneSuffix(timeZone, state)}`;
}

/** "Sat 6 Mar 2027, 8:00 pm · The Tote, Collingwood. Four bands, one warehouse." */
export function eventShareDescription(event: EventShareFields): string {
  const place = [event.venueName.trim(), event.suburb.trim()].filter(Boolean).join(", ");
  const lead = [shareDate(event.startsAt, event.timeZone, event.state), place].filter(Boolean).join(" · ");
  const room = SHARE_DESCRIPTION_MAX - lead.length - 2;
  const excerpt = room > 20 ? plainExcerpt(event.description, room) : "";
  return excerpt ? `${lead}. ${excerpt}` : lead;
}

/** The share images a page inherits (app/opengraph-image.tsx, app/twitter-image.tsx), for pages without their own. */
export interface InheritedShareImages {
  openGraph: NonNullable<NonNullable<Metadata["openGraph"]>["images"]>;
  twitter: NonNullable<NonNullable<Metadata["twitter"]>["images"]>;
}

/**
 * The parent segments' resolved share images. A page that sets `openGraph` or
 * `twitter` replaces the parent's whole object (Next merges metadata
 * shallowly), images included, so a page without its own image passes these on.
 */
export async function inheritedShareImages(parent: ResolvingMetadata | undefined): Promise<InheritedShareImages> {
  if (!parent) return { openGraph: [], twitter: [] };
  try {
    const resolved = await parent;
    return { openGraph: resolved.openGraph?.images ?? [], twitter: resolved.twitter?.images ?? [] };
  } catch {
    return { openGraph: [], twitter: [] };
  }
}

/** A page's title, description, canonical URL and link preview, with the inherited share image. */
export function pageShareMetadata(
  page: { title: string; description: string; path: string },
  origin: string | undefined,
  images: InheritedShareImages,
): Metadata {
  const url = absoluteUrl(page.path, origin);
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title: page.title,
      description: page.description,
      siteName: SITE_NAME,
      locale: OG_LOCALE,
      images: images.openGraph,
    },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: images.twitter },
  };
}

/**
 * A published event's metadata: "{title} — Sheltüh", a plain-text
 * description (date, venue, an excerpt), canonical and og:url at its public
 * address (lib/event-url.ts's shape: no query string, so a tracking `?ref=` is
 * never canonical), and its cover image or the site's.
 */
export function eventMetadata(event: EventShareFields, origin: string | undefined, fallback: InheritedShareImages): Metadata {
  const title = `${event.title} — ${SITE_NAME}`;
  const description = eventShareDescription(event);
  const base = pageShareMetadata({ title, description, path: `/events/${encodeURIComponent(event.slug)}` }, origin, fallback);
  if (!event.imageUrl) return base;
  const image = {
    url: absoluteUrl(event.imageUrl, origin),
    alt: event.title,
    ...(event.imageType ? { type: event.imageType } : {}),
  };
  return {
    ...base,
    openGraph: { ...base.openGraph, images: [image] },
    twitter: { ...base.twitter, images: [image] },
  };
}

/** No robots indexing or following, for a page that isn't (or is no longer) public. */
export const NOINDEX: Metadata["robots"] = { index: false, follow: false };

/**
 * An unknown slug, or an event that isn't published (draft, in review,
 * rejected or unpublished): the same metadata for all of them, so nothing
 * tells them apart, and nothing about the event.
 */
export const EVENT_NOT_FOUND_METADATA: Metadata = { title: `Event not found — ${SITE_NAME}`, robots: NOINDEX };

/**
 * The event couldn't be read (a database error): a generic title only. Not
 * noindex, so a passing outage doesn't drop a real event from search.
 */
export const EVENT_METADATA_UNAVAILABLE: Metadata = { title: SITE_NAME };

/** The fields of an approved organiser's public profile that its link preview uses. */
export interface OrganiserShareFields {
  organiserId: string;
  displayName: string;
  description: string;
}

/** An approved organiser's profile: "{name} — Sheltüh", an excerpt of their bio, canonical, and the site's share image. */
export function organiserMetadata(
  organiser: OrganiserShareFields,
  origin: string | undefined,
  fallback: InheritedShareImages,
): Metadata {
  const bio = plainExcerpt(organiser.description, SHARE_DESCRIPTION_MAX);
  return pageShareMetadata(
    {
      title: organiserPageTitle(organiser.displayName),
      description: bio || `Events by ${organiser.displayName} on ${SITE_NAME}.`,
      path: `/organisers/${encodeURIComponent(organiser.organiserId)}`,
    },
    origin,
    fallback,
  );
}

/** Unknown, pending, rejected or suspended: one title for all, never indexed (as the page's own "not available"). */
export const ORGANISER_NOT_FOUND_METADATA: Metadata = { title: ORGANISER_UNAVAILABLE_TITLE, robots: NOINDEX };

/** The organiser couldn't be read (a database error): the generic title only, not noindex. */
export const ORGANISER_METADATA_UNAVAILABLE: Metadata = { title: ORGANISER_PAGE_TITLE };
