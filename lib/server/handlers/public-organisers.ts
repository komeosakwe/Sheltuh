import { HttpError, ok } from "../http";
import { isUuid } from "../pagination";
import { EVENT_SELECT, findPublicOrganiserRow, toPublicEventFromRow, toPublicOrganiserProfile } from "../records";
import type { Handler } from "../route";

/** Most events a profile lists: upcoming ones first, then the most recent past ones. */
export const PROFILE_EVENT_LIMIT = 24;

const NOT_FOUND = "Organiser not found.";

/**
 * GET /api/organisers/[organiserId]/profile — public, unauthenticated. Only an
 * approved organiser has a profile; anything else (pending, rejected, unknown,
 * or not a uuid) is the same 404. Only public columns are read
 * (findPublicOrganiserRow), events are published ones in the public event
 * shape, and nothing depends on who's asking, so it's cacheable like the
 * public event routes.
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
  const recent =
    upcoming.length < PROFILE_EVENT_LIMIT
      ? await db.query(
          `${EVENT_SELECT} where e.organiser_id = $1 and e.status = 'published' and e.ends_at <= $2::timestamptz
           order by e.starts_at desc, e.id limit $3`,
          [organiserId, now, PROFILE_EVENT_LIMIT - upcoming.length],
        )
      : [];

  return ok(
    toPublicOrganiserProfile(
      row,
      upcoming.map(toPublicEventFromRow),
      recent.map(toPublicEventFromRow),
    ),
  );
};
