import type { Metadata } from "next";
import { cache } from "react";
import {
  EVENT_METADATA_UNAVAILABLE,
  EVENT_NOT_FOUND_METADATA,
  eventMetadata,
  type EventShareFields,
  type InheritedShareImages,
  ORGANISER_METADATA_UNAVAILABLE,
  ORGANISER_NOT_FOUND_METADATA,
  organiserMetadata,
  type OrganiserShareFields,
} from "@/lib/share-metadata";
import type { Db } from "./db";
import { getDeps, type Deps } from "./deps";
import { redactForLog } from "./email-address";
import { isUuid } from "./pagination";

/**
 * Live mode's server-side reads for link previews (generateMetadata on
 * /events/[slug] and /organisers/[organiserId]). Each is a few public columns
 * under exactly the visibility rule of the page's own API route, so a preview
 * never shows more than the page would:
 *
 *   - an event: `slug = $1 and status = 'published'`, as
 *     GET /api/events/slug/{slug} (public-events.ts) and the .ics route
 *     (event-calendar.ts). Served by the unique index on events.slug.
 *   - an organiser: `id = $1 and status = 'approved'`, as
 *     GET /api/organisers/{id}/profile (findPublicOrganiserRow). Primary key.
 *
 * No ticket, order, buyer or contact data is read. A database error gives
 * generic metadata (logged without details), never a 500.
 */

/** events_slug_check: anything else can't be an event, so it's not found without a query. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 200;

/** The share fields of a published event, or null for anything else (unknown, draft, in review, rejected, unpublished). */
export async function findPublicEventShare(db: Db, slug: string): Promise<EventShareFields | null> {
  if (slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) return null;
  const [row] = await db.query<{
    id: string;
    slug: string;
    title: string;
    description: string;
    venue_name: string;
    suburb: string;
    starts_at: string | Date;
    image_version: string | null;
    image_type: string | null;
  }>(
    `select e.id, e.slug, e.title, e.description, e.venue_name, e.suburb, e.starts_at,
            floor(extract(epoch from i.updated_at))::bigint::text as image_version,
            i.content_type as image_type
       from public.events e
       left join public.event_images i on i.event_id = e.id
      where e.slug = $1 and e.status = 'published'`,
    [slug],
  );
  if (!row) return null;
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    venueName: row.venue_name,
    suburb: row.suburb,
    startsAt: new Date(row.starts_at).toISOString(),
    // The same versioned URL the public event shape gives it (records.ts,
    // EVENT_COLUMNS): GET /api/events/{id}/image serves a published event's
    // image to anyone, crawlers included. Only reviewed images get there: an
    // event's image can only change while it's a draft or rejected.
    ...(row.image_version !== null
      ? { imageUrl: `/api/events/${row.id}/image?v=${row.image_version}`, imageType: row.image_type ?? undefined }
      : {}),
  };
}

/**
 * findPublicEventShare, memoised for one server render (React `cache`), so a
 * page that also reads the event server-side doesn't query twice.
 */
export const readPublicEventShare = cache(findPublicEventShare);

/** The share fields of an approved organiser, or null for anything else (unknown, pending, rejected or suspended, not a uuid). */
export async function findPublicOrganiserShare(db: Db, organiserId: string): Promise<OrganiserShareFields | null> {
  if (!isUuid(organiserId)) return null;
  const [row] = await db.query<{ id: string; display_name: string; description: string }>(
    `select o.id, o.display_name, o.description from public.organisers o where o.id = $1 and o.status = 'approved'`,
    [organiserId],
  );
  return row ? { organiserId: row.id, displayName: row.display_name, description: row.description } : null;
}

/** What generateMetadata needs from the outside world: the database and the configured site origin. */
export type MetadataDeps = Pick<Deps, "db" | "siteUrl">;

function logUnavailable(what: string, err: unknown) {
  console.error(`${what} metadata unavailable:`, redactForLog(err instanceof Error ? err.message : "unknown error"));
}

/** A live event page's metadata: full for a published event, the not-found metadata otherwise, generic on an error. */
export async function liveEventMetadata(
  slug: string,
  fallback: InheritedShareImages,
  deps: () => MetadataDeps = getDeps,
): Promise<Metadata> {
  try {
    const { db, siteUrl } = deps();
    const event = await readPublicEventShare(db, slug);
    if (!event) return EVENT_NOT_FOUND_METADATA;
    return eventMetadata(event, siteUrl(), fallback);
  } catch (err) {
    logUnavailable("Event", err);
    return EVENT_METADATA_UNAVAILABLE;
  }
}

/** A live organiser profile's metadata: full for an approved organiser, "not available" otherwise, generic on an error. */
export async function liveOrganiserMetadata(
  organiserId: string,
  fallback: InheritedShareImages,
  deps: () => MetadataDeps = getDeps,
): Promise<Metadata> {
  try {
    const { db, siteUrl } = deps();
    const organiser = await findPublicOrganiserShare(db, organiserId);
    if (!organiser) return ORGANISER_NOT_FOUND_METADATA;
    return organiserMetadata(organiser, siteUrl(), fallback);
  } catch (err) {
    logUnavailable("Organiser", err);
    return ORGANISER_METADATA_UNAVAILABLE;
  }
}
