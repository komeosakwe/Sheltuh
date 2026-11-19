import { HttpError, okPublic } from "../http";
import { isUuid } from "../pagination";
import { EVENT_SELECT, findPublicOrganiserRow, toPublicEventFromRow, toPublicOrganiserProfile } from "../records";
import type { Handler } from "../route";
import { PUBLIC_EVENTS_CACHE_CONTROL } from "./public-events";

/** Most upcoming events a profile lists (lib/similar-events.ts ORGANISER_PROFILE_EVENT_LIMIT says "24+ upcoming"). */
export const PROFILE_EVENT_LIMIT = 24;
/** Most past events a profile lists (the most recent), however many are upcoming. */
export const PROFILE_PAST_EVENT_LIMIT = 12;

const NOT_FOUND = "Organiser not found.";

/**
 * GET /api/organisers/[organiserId]/profile — public, unauthenticated. Only an
 * approved organiser has a profile; anything else (pending, rejected, unknown,
 * or not a uuid) is the same 404. Only public columns are read
 * (findPublicOrganiserRow), events are published ones in the public event
 * shape (up to PROFILE_EVENT_LIMIT upcoming and, separately, the
 * PROFILE_PAST_EVENT_LIMIT most recent past ones; three indexed queries in
 * all), and nothing depends on who's asking, so a 200 is shared at the CDN
 * like the feed (PUBLIC_EVENTS_CACHE_CONTROL: up to about 3 minutes stale,
 * an organiser's own edits included). Errors are `private, no-store`.
 */
export const getPublicOrganiserProfile: Handler<{ organiserId: string }> = async (_req, { organiserId }, { db }) => {
  if (!isUuid(organiserId)) throw new HttpError(404, NOT_FOUND);

  const row = await findPublicOrganiserRow(db, organiserId);
  if (!row) throw new HttpError(404, NOT_FOUND);

  // One instant for both queries, so an event ending between them can't be
  // listed twice or not at all.
  const now = new Date().toISOString();
  const upcoming = await db.query(
    `${EVENT_SELECT} where e.organiser_id = $1 and e.status = 'published' and e.ends_at > $2::timestamptz
     order by e.starts_at, e.id limit $3`,
    [organiserId, now, PROFILE_EVENT_LIMIT],
  );
  const recent = await db.query(
    `${EVENT_SELECT} where e.organiser_id = $1 and e.status = 'published' and e.ends_at <= $2::timestamptz
     order by e.starts_at desc, e.id limit $3`,
    [organiserId, now, PROFILE_PAST_EVENT_LIMIT],
  );

  return okPublic(
    toPublicOrganiserProfile(
      row,
      upcoming.map(toPublicEventFromRow),
      recent.map(toPublicEventFromRow),
    ),
    PUBLIC_EVENTS_CACHE_CONTROL,
  );
};
