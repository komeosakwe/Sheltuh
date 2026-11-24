import type { StoryCardEventFields } from "@/lib/story-card";
import type { AustralianTimeZone, StateCode } from "@/lib/time-zones";
import type { Db } from "./db";
import type { PhotoFocus } from "./share-card-data";

/**
 * What the story card (GET /events/{slug}/story-card, lib/server/handlers/story-card.ts) reads
 * about an event in live mode: the public fields the card draws and its photo's version and
 * focus, under the event page's own visibility rule (`slug = $1 and status = 'published'`, as
 * GET /api/events/slug/{slug}, the .ics route and the link previews: lib/server/share-metadata.ts).
 * No bytes: the photo is read only for a card that's actually drawn (findPublicEventCover),
 * after the 304 check and the rate limit. No organiser, ticket, order, buyer or contact data.
 * Served by the unique index on events.slug and event_images' primary key (event_id).
 */

/** events_slug_check: anything else can't be an event, so it's not found without a query (share-metadata.ts's rule). */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 200;

export interface StoryCardEvent extends StoryCardEventFields {
  slug: string;
  /** The photo's version (whole seconds of event_images.updated_at, as its public `?v=`), or null: no photo. */
  imageVersion: string | null;
  focus: PhotoFocus;
}

/** A published event's card fields, or null for anything else (unknown, malformed, draft, in review, rejected, unpublished). */
export async function findStoryCardEvent(db: Db, slug: string): Promise<StoryCardEvent | null> {
  if (slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) return null;
  const [row] = await db.query<{
    slug: string;
    title: string;
    venue_name: string;
    suburb: string;
    state: StateCode;
    time_zone: AustralianTimeZone;
    starts_at: string | Date;
    ends_at: string | Date | null;
    image_version: string | null;
    focus_x: number | null;
    focus_y: number | null;
  }>(
    `select e.slug, e.title, e.venue_name, e.suburb, e.state, e.time_zone, e.starts_at, e.ends_at,
            floor(extract(epoch from i.updated_at))::bigint::text as image_version, i.focus_x, i.focus_y
       from public.events e
       left join public.event_images i on i.event_id = e.id
      where e.slug = $1 and e.status = 'published'`,
    [slug],
  );
  if (!row) return null;
  return {
    slug: row.slug,
    title: row.title,
    venueName: row.venue_name,
    suburb: row.suburb,
    state: row.state,
    timeZone: row.time_zone,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: row.ends_at === null ? undefined : new Date(row.ends_at).toISOString(),
    imageVersion: row.image_version,
    focus: row.focus_x !== null && row.focus_y !== null ? { x: Number(row.focus_x), y: Number(row.focus_y) } : null,
  };
}
