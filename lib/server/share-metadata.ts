import type { Metadata } from "next";
import { cache } from "react";
import {
  EVENT_METADATA_UNAVAILABLE,
  EVENT_NOT_FOUND_METADATA,
  eventMetadata,
  type EventShareFields,
  ORGANISER_METADATA_UNAVAILABLE,
  ORGANISER_NOT_FOUND_METADATA,
  organiserMetadata,
  type OrganiserShareFields,
} from "@/lib/share-metadata";
import type { StateCode } from "@/lib/time-zones";
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
    time_zone: string;
    state: StateCode;
    image_version: string | null;
  }>(
    `select e.id, e.slug, e.title, e.description, e.venue_name, e.suburb, e.starts_at, e.time_zone, e.state,
            floor(extract(epoch from i.updated_at))::bigint::text as image_version
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
    timeZone: row.time_zone,
    state: row.state,
    // The same versioned URL the public event shape gives it (records.ts,
    // EVENT_COLUMNS). The preview card draws the photo from the database
    // itself (findPublicEventCover); this is what tells a card its photo changed.
    // Only reviewed images get here: an event's image can only change while
    // it's a draft or rejected.
    ...(row.image_version !== null ? { imageUrl: `/api/events/${row.id}/image?v=${row.image_version}` } : {}),
  };
}

/** A published event's cover photo as stored (JPEG, PNG or WebP) and where its focus point is, for the preview card. */
export interface PublicEventCover {
  bytes: Uint8Array;
  focus: { x: number; y: number } | null;
}

/**
 * The cover photo of a published event, under the same rule as
 * findPublicEventShare (`status = 'published'`) and GET /api/events/{id}/image
 * (which serves a published event's image to anyone). Null for anything else,
 * or an event without a photo.
 */
export async function findPublicEventCover(db: Db, slug: string): Promise<PublicEventCover | null> {
  if (slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) return null;
  const [row] = await db.query<{ data: Uint8Array; focus_x: number | null; focus_y: number | null }>(
    `select i.data, i.focus_x, i.focus_y
       from public.events e
       join public.event_images i on i.event_id = e.id
      where e.slug = $1 and e.status = 'published'`,
    [slug],
  );
  if (!row) return null;
  return {
    bytes: new Uint8Array(row.data),
    focus: row.focus_x !== null && row.focus_y !== null ? { x: Number(row.focus_x), y: Number(row.focus_y) } : null,
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
  const [row] = await db.query<{ id: string; display_name: string; description: string; logo_version: string | null }>(
    `select o.id, o.display_name, o.description,
            floor(extract(epoch from l.updated_at) * 1000)::bigint::text as logo_version
       from public.organisers o
       left join private.organiser_logos l on l.organiser_id = o.id
      where o.id = $1 and o.status = 'approved'`,
    [organiserId],
  );
  if (!row) return null;
  return {
    organiserId: row.id,
    displayName: row.display_name,
    description: row.description,
    ...(row.logo_version !== null ? { logoVersion: row.logo_version } : {}),
  };
}

/**
 * An approved organiser's logo (the 512 px WebP GET /api/organisers/{id}/logo
 * serves), for the preview card; null for anyone else or no logo.
 */
export async function findPublicOrganiserLogo(db: Db, organiserId: string): Promise<Uint8Array | null> {
  if (!isUuid(organiserId)) return null;
  const [row] = await db.query<{ image: Uint8Array }>(
    `select l.image
       from public.organisers o
       join private.organiser_logos l on l.organiser_id = o.id
      where o.id = $1 and o.status = 'approved'`,
    [organiserId],
  );
  return row ? new Uint8Array(row.image) : null;
}

/** What generateMetadata needs from the outside world: the database and the configured site origin. */
export type MetadataDeps = Pick<Deps, "db" | "siteUrl">;

function logUnavailable(what: string, err: unknown) {
  console.error(`${what} metadata unavailable:`, redactForLog(err instanceof Error ? err.message : "unknown error"));
}

/** A live event page's metadata: full for a published event, the not-found metadata otherwise, generic on an error. */
export async function liveEventMetadata(
  slug: string,
  deps: () => MetadataDeps = getDeps,
): Promise<Metadata> {
  try {
    const { db, siteUrl } = deps();
    const event = await readPublicEventShare(db, slug);
    if (!event) return EVENT_NOT_FOUND_METADATA;
    return eventMetadata(event, siteUrl());
  } catch (err) {
    logUnavailable("Event", err);
    return EVENT_METADATA_UNAVAILABLE;
  }
}

/** A live organiser profile's metadata: full for an approved organiser, "not available" otherwise, generic on an error. */
export async function liveOrganiserMetadata(
  organiserId: string,
  deps: () => MetadataDeps = getDeps,
): Promise<Metadata> {
  try {
    const { db, siteUrl } = deps();
    const organiser = await findPublicOrganiserShare(db, organiserId);
    if (!organiser) return ORGANISER_NOT_FOUND_METADATA;
    return organiserMetadata(organiser, siteUrl());
  } catch (err) {
    logUnavailable("Organiser", err);
    return ORGANISER_METADATA_UNAVAILABLE;
  }
}
