import { createHash } from "node:crypto";
import { requireCaller, requireVerifiedCaller } from "../auth";
import type { Db } from "../db";
import { createdPrivate, HttpError, noContentPrivate, okPrivate, readJson } from "../http";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { EVENT_SELECT, toPublicEventFromRow } from "../records";
import type { Handler } from "../route";
import type { FollowedOrganiser, FollowStatus, UnsubscribeFollowResult } from "../types";
import { fail } from "../validation";

/**
 * Following organisers (docs/architecture.md, "Following organisers";
 * supabase/migrations/20261024000200_organiser_follows.sql). A verified
 * member follows an approved organiser, choosing then whether to be emailed
 * about new events. Keyed on the account: nobody else ever sees who follows
 * whom; the organiser's public profile shows only a count from 10, and their
 * analytics the exact count. Every response is private and never cached.
 */
export const FOLLOW_LIMITS = {
  /** Organisers one account can follow. */
  maxFollows: 500,
  /** New follows per account per window (re-following counts; unfollowing doesn't). */
  newFollows: { hits: 60, window: "1 hour" },
} as const;

/**
 * private.notify_followers' rules, which live in SQL (a database trigger):
 * at most one email per follower per organiser per `perFollowerHours`, and
 * at most `platformDaily` queued a day across the platform. Mirrored here for
 * documentation and tests only; change both together.
 */
export const FOLLOWER_NOTIFY = { perFollowerHours: 24, platformDaily: 500 } as const;

const NOT_FOUND = "Organiser not found.";
/** 32 random bytes, base64url: 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LINK_NOT_FOUND = "This link isn't valid. Check it's the whole link from your email.";

/** The caller's follow of `organiserId`, or not following. */
async function followStatus(db: Db, userId: string, organiserId: string): Promise<FollowStatus> {
  const [row] = await db.query<{ notify: boolean }>(
    `select notify_new_events as notify from public.organiser_follows where user_id = $1 and organiser_id = $2`,
    [userId, organiserId],
  );
  return { following: Boolean(row), notifyNewEvents: row?.notify === true };
}

/** 404 unless `organiserId` is an approved organiser (anything else has no public profile to follow from). */
async function requireApprovedOrganiserId(db: Db, organiserId: string) {
  if (!isUuid(organiserId)) throw new HttpError(404, NOT_FOUND);
  const rows = await db.query(`select 1 from public.organisers where id = $1 and status = 'approved'`, [organiserId]);
  if (rows.length === 0) throw new HttpError(404, NOT_FOUND);
}

/** GET /api/organisers/[organiserId]/follow — signed in: the caller's own follow. 404 unless the organiser is approved. */
export const getFollow: Handler<{ organiserId: string }> = async (req, { organiserId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  await requireApprovedOrganiserId(db, organiserId);
  return okPrivate(await followStatus(db, caller.userId, organiserId));
};

/**
 * POST /api/organisers/[organiserId]/follow {notifyNewEvents?} — verified
 * members. 201 a new follow (emails only if notifyNewEvents is true: left
 * out, they're off); 200 already following (idempotent; notifyNewEvents, if
 * sent, updates the choice); 400 not a boolean (null included), or the
 * organiser's own account; 404 not an approved
 * organiser; 409 at 500 follows; 429 over 60 new follows an hour. Atomic in
 * private.follow_organiser.
 */
export const followOrganiser: Handler<{ organiserId: string }> = async (req, { organiserId }, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const body = await readJson(req);
  // Emails only by explicit choice: left out, a new follow's are off (an existing follow's choice is kept);
  // anything but true or false (null included) is a 400.
  const notify = body.notifyNewEvents;
  if (notify !== undefined && typeof notify !== "boolean") {
    fail({ notifyNewEvents: "Must be true or false." });
  }
  if (!isUuid(organiserId)) throw new HttpError(404, NOT_FOUND);

  const [row] = await db.query<{ result: string; notify: boolean | null }>(
    `select * from private.follow_organiser($1, $2, $3::boolean, $4, $5, $6::interval)`,
    [
      caller.userId,
      organiserId,
      typeof notify === "boolean" ? notify : null,
      FOLLOW_LIMITS.maxFollows,
      FOLLOW_LIMITS.newFollows.hits,
      FOLLOW_LIMITS.newFollows.window,
    ],
  );
  const status: FollowStatus = { following: true, notifyNewEvents: row.notify === true };
  switch (row.result) {
    case "followed":
      return createdPrivate(status);
    case "exists":
      return okPrivate(status);
    case "not_found":
      throw new HttpError(404, NOT_FOUND);
    case "self":
      throw new HttpError(400, "You can't follow your own organiser profile.");
    case "limit":
      throw new HttpError(409, `You're following ${FOLLOW_LIMITS.maxFollows} organisers, the most there can be. Unfollow some first.`);
    case "rate_limited":
      throw new HttpError(429, "You've followed a lot of organisers in the last hour. Try again later.");
    default:
      throw new Error(`Unexpected follow_organiser result: ${row.result}`);
  }
};

/**
 * DELETE /api/organisers/[organiserId]/follow — signed in: unfollows
 * (whatever the organiser's state, so a member can always leave), and with
 * the follow go its pending email and unsubscribe links. 204, idempotent.
 */
export const unfollowOrganiser: Handler<{ organiserId: string }> = async (req, { organiserId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (isUuid(organiserId)) {
    await db.query(`delete from public.organiser_follows where user_id = $1 and organiser_id = $2`, [
      caller.userId,
      organiserId,
    ]);
  }
  return noContentPrivate();
};

/**
 * GET /api/me/following?cursor&limit — signed in: the organisers the caller
 * follows, most recently followed first, up to 50 a page. Only approved
 * organisers (a taken-down one drops out; the follow is kept).
 */
export const listMyFollowing: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  const rows = await db.query<{ id: string; display_name: string; notify: boolean; created_at: string | Date }>(
    `select o.id, o.display_name, f.notify_new_events as notify, f.created_at
       from public.organiser_follows f
       join public.organisers o on o.id = f.organiser_id and o.status = 'approved'
      where f.user_id = $1
      order by f.created_at desc, f.organiser_id
      limit $2 offset $3`,
    [caller.userId, limit + 1, offset],
  );
  const items: FollowedOrganiser[] = rows.map((r) => ({
    organiserId: r.id,
    displayName: r.display_name,
    notifyNewEvents: r.notify,
    followedAt: new Date(r.created_at).toISOString(),
  }));
  return okPrivate(toPage(items, offset, limit));
};

/**
 * GET /api/me/following/events?cursor&limit — signed in: published events
 * that haven't ended from the organisers the caller follows (approved ones),
 * soonest first, up to 50 a page, in the feed's public shape (the home's
 * "From organisers you follow").
 */
export const listFollowingEvents: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  const rows = await db.query(
    `${EVENT_SELECT}
      where e.organiser_id in (select f.organiser_id from public.organiser_follows f where f.user_id = $1)
        and e.status = 'published' and e.ends_at > now() and o.status = 'approved'
      order by e.starts_at, e.id
      limit $2 offset $3`,
    [caller.userId, limit + 1, offset],
  );
  return okPrivate(toPage(rows.map(toPublicEventFromRow), offset, limit));
};

/**
 * POST /api/follows/unsubscribe {token} — public (an email's unsubscribe
 * link is the credential). Turns that follow's new-event emails off; the
 * follow stays. 200 (idempotent); 400 malformed; 404 unknown, unfollowed
 * since, or older than 90 days.
 */
export const unsubscribeFollow: Handler = async (req, _params, { db }) => {
  const body = await readJson(req);
  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN_PATTERN.test(token)) fail({ token: "This link is incomplete. Open it from your email again." });
  const [row] = await db.query<{ result: string; organiser_id: string | null }>(
    `select * from private.unsubscribe_follow($1)`,
    [createHash("sha256").update(token, "utf8").digest("hex")],
  );
  if (row.result !== "unsubscribed") throw new HttpError(404, LINK_NOT_FOUND);
  const [organiser] = await db.query<{ display_name: string }>(
    `select display_name from public.organisers where id = $1 and status = 'approved'`,
    [row.organiser_id],
  );
  const result: UnsubscribeFollowResult = {
    status: "unsubscribed",
    ...(organiser ? { organiserName: organiser.display_name } : {}),
  };
  return okPrivate(result);
};
