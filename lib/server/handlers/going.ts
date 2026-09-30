import { requireCaller, requireVerifiedCaller, type Caller } from "../auth";
import type { Db } from "../db";
import { HttpError, ok, okPrivate } from "../http";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { toGoingAttendee } from "../records";
import type { Handler } from "../route";
import type { GoingSummary, MyGoingStatus } from "../types";

/**
 * "Who's Going" (docs/architecture.md). Only published events have a Who's
 * Going; anything else is a 404. It's "open" while the event hasn't ended and
 * the per-event switch (events.whos_going_enabled) is on; once closed, nothing
 * is shown. Suspended members (private.social_suspensions) are left out of
 * every list and count.
 */

const NOT_FOUND = "Event not found.";

/** SQL for "Who's Going is open" on an events row aliased `e`. */
const OPEN = `(e.whos_going_enabled and e.ends_at > now())`;

/** SQL: the event_attendees row aliased `a` belongs to a suspended member. */
const SUSPENDED_ATTENDEE = `exists (select 1 from private.social_suspensions s where s.user_id = a.user_id)`;

/** Below this many members going, the public count is withheld: small numbers can identify people. */
export const GOING_COUNT_THRESHOLD = 3;

/**
 * Attendee-list requests allowed per member per window. Loading an event page
 * is one request, "Show more" one more per 50 names; this is well above any
 * browsing pace and well below a scrape.
 */
export const ATTENDEE_LIST_RATE_LIMIT = { hits: 30, window: "10 minutes" } as const;

/** GET /api/events/[eventId]/going — public; only a count, never who, and not even that below the threshold. */
export const getGoingSummary: Handler<{ eventId: string }> = async (_req, { eventId }, { db }) => {
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);
  const [row] = await db.query<{ open: boolean; count: number }>(
    `select ${OPEN} as open,
            (select count(*)::int from public.event_attendees a
              where a.event_id = e.id and not ${SUSPENDED_ATTENDEE}) as count
       from public.events e
      where e.id = $1 and e.status = 'published'`,
    [eventId],
  );
  if (!row) throw new HttpError(404, NOT_FOUND);
  const countHidden = row.open && row.count < GOING_COUNT_THRESHOLD;
  const summary: GoingSummary = {
    count: row.open && !countHidden ? row.count : 0,
    closed: !row.open,
    countHidden,
  };
  return ok(summary);
};

/**
 * GET /api/events/[eventId]/going/attendees?cursor — verified members with a
 * profile that isn't suspended (403 otherwise), rate-limited per member (429).
 * Display names and opaque per-event ids, oldest opt-in first, up to 50 a
 * page. An empty page once the event is closed.
 */
export const listGoingAttendees: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);
  const qs = new URL(req.url).searchParams;
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const [viewer] = await db.query<{ open: boolean | null; has_profile: boolean; suspended: boolean }>(
    `select (select ${OPEN} from public.events e where e.id = $1 and e.status = 'published') as open,
            exists (select 1 from public.profiles p where p.user_id = $2) as has_profile,
            exists (select 1 from private.social_suspensions s where s.user_id = $2) as suspended`,
    [eventId, caller.userId],
  );
  if (viewer.open === null) throw new HttpError(404, NOT_FOUND);
  if (viewer.suspended) throw new HttpError(403, "Your profile can't be shown on events right now.");
  if (!viewer.has_profile) throw new HttpError(403, "Create a profile to see who's going.");

  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'going_attendees', $2, $3::interval) as allowed`,
    [caller.userId, ATTENDEE_LIST_RATE_LIMIT.hits, ATTENDEE_LIST_RATE_LIMIT.window],
  );
  if (!allowed) throw new HttpError(429, "Too many requests. Try again in a few minutes.");

  if (!viewer.open) return okPrivate({ items: [] });

  const rows = await db.query(
    `select a.id, p.display_name, a.user_id = $2 as is_you
       from public.event_attendees a
       join public.profiles p on p.user_id = a.user_id
      where a.event_id = $1 and not ${SUSPENDED_ATTENDEE}
      order by a.created_at, a.id
      limit $3 offset $4`,
    [eventId, caller.userId, limit + 1, offset],
  );
  return okPrivate(toPage(rows.map(toGoingAttendee), offset, limit));
};

/**
 * The caller's status on an event, or undefined if the event isn't published.
 * `eligible` means a PUT would succeed given a profile; it's only ever true
 * for a verified email.
 */
async function myGoingStatus(db: Db, caller: Caller, eventId: string): Promise<MyGoingStatus | undefined> {
  const verifiedEmail = caller.emailVerified && caller.email ? caller.email : null;
  const [row] = await db.query<{
    published: boolean;
    open: boolean;
    going: boolean;
    has_profile: boolean;
    suspended: boolean;
    has_ticket: boolean;
  }>(
    `select e.id is not null as published,
            coalesce(${OPEN}, false) as open,
            exists (select 1 from public.event_attendees a where a.event_id = $1 and a.user_id = $2) as going,
            exists (select 1 from public.profiles p where p.user_id = $2) as has_profile,
            exists (select 1 from private.social_suspensions s where s.user_id = $2) as suspended,
            ($3::text is not null and exists (
              select 1 from public.orders o
               where o.event_id = $1 and o.status = 'paid' and lower(o.buyer_email) = lower($3::text)
            )) as has_ticket
       from (select 1) as one
       left join public.events e on e.id = $1 and e.status = 'published'`,
    [eventId, caller.userId, verifiedEmail],
  );
  if (!row.published) return undefined;
  return {
    going: row.going,
    eligible: row.open && row.has_ticket && !row.suspended,
    hasProfile: row.has_profile,
  };
}

/** GET /api/events/[eventId]/going/me */
export const getMyGoing: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);
  const status = await myGoingStatus(db, caller, eventId);
  if (!status) throw new HttpError(404, NOT_FOUND);
  return okPrivate(status);
};

/**
 * PUT /api/events/[eventId]/going/me — opt in. Eligibility is decided in
 * one atomic step by private.set_going, against the caller's verified email.
 * Idempotent.
 */
export const putMyGoing: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);

  const [{ result }] = await db.query<{ result: string }>(`select private.set_going($1, $2, $3) as result`, [
    eventId,
    caller.userId,
    caller.email,
  ]);
  switch (result) {
    case "going":
      break;
    case "event_unavailable":
      throw new HttpError(404, "Who's Going isn't open for this event.");
    case "no_profile":
      throw new HttpError(409, "Create a profile before you show that you're going.");
    case "suspended":
      throw new HttpError(403, "Your profile can't be shown on events right now.");
    case "not_eligible":
      throw new HttpError(
        403,
        "Only ticket holders can show they're going. Use the email address your ticket was sent to.",
      );
    default:
      throw new Error(`Unexpected set_going result: ${result}`);
  }

  const status = await myGoingStatus(db, caller, eventId);
  if (!status) throw new HttpError(404, NOT_FOUND);
  return okPrivate(status);
};

/**
 * DELETE /api/events/[eventId]/going/me — opt out. Idempotent, and works
 * whatever state the event is in: withdrawing is never blocked.
 */
export const deleteMyGoing: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, NOT_FOUND);
  await db.query(`delete from public.event_attendees where event_id = $1 and user_id = $2`, [eventId, caller.userId]);
  const status = await myGoingStatus(db, caller, eventId);
  return okPrivate(status ?? { going: false, eligible: false, hasProfile: await hasProfile(db, caller.userId) });
};

async function hasProfile(db: Db, userId: string): Promise<boolean> {
  const rows = await db.query(`select 1 from public.profiles where user_id = $1`, [userId]);
  return rows.length > 0;
}
