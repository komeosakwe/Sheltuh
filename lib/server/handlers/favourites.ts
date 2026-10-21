import { MAX_FAVOURITES, type FavouriteEvent, type FavouriteIds, type FavouriteState } from "@/lib/api/types";
import { requireCaller } from "../auth";
import { HttpError, okPrivate } from "../http";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { EVENT_SELECT, toEvent, toPublicEvent } from "../records";
import type { Handler } from "../route";

/**
 * Favourites (docs/architecture.md, "Favourites"): a signed-in member's
 * private list of events. No verified email needed (nothing here touches
 * anyone else). Only published events are listed or can be added; a
 * favourite of an event that's since been unpublished is kept but hidden.
 * Every response is `private, no-store`.
 */

const NOT_FOUND = "Event not found.";

/** GET /api/favourites?cursor&limit — the caller's favourited published events, newest favourite first. */
export const listFavourites: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const page = await db.query<{ event_id: string; created_at: string | Date }>(
    `select f.event_id, f.created_at
       from public.event_favourites f
       join public.events e on e.id = f.event_id and e.status = 'published'
      where f.user_id = $1
      order by f.created_at desc, f.event_id desc
      limit $2 offset $3`,
    [caller.userId, limit + 1, offset],
  );
  // One query for the whole page's events, not one per favourite.
  const events = page.length
    ? await db.query(`${EVENT_SELECT} where e.id = any($1::uuid[]) and e.status = 'published'`, [
        page.map((f) => f.event_id),
      ])
    : [];
  const byId = new Map(events.map((row) => [row.id as string, toPublicEvent(toEvent(row))]));

  const items: FavouriteEvent[] = [];
  for (const f of page) {
    const event = byId.get(f.event_id);
    // Unpublished between the two queries: leave it out, as it would be a moment later.
    if (event) items.push({ ...event, favouritedAt: new Date(f.created_at).toISOString() });
  }
  // Paging decisions use the first query's rows, so a dropped row can't end the list early.
  const { nextCursor } = toPage(page, offset, limit);
  return okPrivate({ items: items.slice(0, limit), nextCursor });
};

/** GET /api/favourites/ids — ids only, for the hearts. At most MAX_FAVOURITES (the cap). */
export const listFavouriteIds: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const rows = await db.query<{ event_id: string }>(
    `select f.event_id
       from public.event_favourites f
       join public.events e on e.id = f.event_id and e.status = 'published'
      where f.user_id = $1
      order by f.created_at desc, f.event_id desc
      limit $2`,
    [caller.userId, MAX_FAVOURITES],
  );
  const body: FavouriteIds = { eventIds: rows.map((r) => r.event_id) };
  return okPrivate(body);
};

/**
 * PUT /api/events/[eventId]/favourite — idempotent. 404 unless the event is
 * published; 409 when the caller already has MAX_FAVOURITES (409 means only
 * that here). Decided in one atomic step by private.add_favourite.
 */
export const putFavourite: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);

  const [{ result }] = await db.query<{ result: string }>(`select private.add_favourite($1, $2, $3) as result`, [
    caller.userId,
    eventId,
    MAX_FAVOURITES,
  ]);
  switch (result) {
    case "added":
    case "exists":
      break;
    case "not_found":
      throw new HttpError(404, NOT_FOUND);
    case "limit":
      throw new HttpError(409, `You've saved ${MAX_FAVOURITES} events, the most you can. Remove some to save more.`);
    default:
      throw new Error(`Unexpected add_favourite result: ${result}`);
  }
  const body: FavouriteState = { eventId, favourited: true };
  return okPrivate(body);
};

/**
 * DELETE /api/events/[eventId]/favourite — idempotent. Removing a favourite
 * always works, even once its event is unpublished. Without one, it's a 404
 * unless the event is published, so it can't be used to probe for
 * unpublished events.
 */
export const deleteFavourite: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);

  const [row] = await db.query<{ deleted: boolean; published: boolean }>(
    `with d as (delete from public.event_favourites where user_id = $1 and event_id = $2 returning 1)
     select exists (select 1 from d) as deleted,
            exists (select 1 from public.events e where e.id = $2 and e.status = 'published') as published`,
    [caller.userId, eventId],
  );
  if (!row.deleted && !row.published) throw new HttpError(404, NOT_FOUND);
  const body: FavouriteState = { eventId, favourited: false };
  return okPrivate(body);
};
