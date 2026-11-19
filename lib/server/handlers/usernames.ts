import { requireCaller, requireVerifiedCaller } from "../auth";
import type { Db } from "../db";
import { HttpError, noContentPrivate, okPrivate, readJson, tooManyRequests, windowSeconds, type RateWindow } from "../http";
import type { Handler } from "../route";
import type { UsernameCheck } from "../types";
import { parseUsernameInput } from "../username-input";
import { readAccountSummary } from "./me";

/**
 * Member usernames (docs/architecture.md, "Usernames"): a member's own
 * optional username, set in settings. Shown to them (GET /me) and, exactly
 * where their profileId is, on their visible member profile and Who's Going
 * (records.ts). Never in a URL; nothing here, or anywhere, resolves a
 * username to a member. Every response is private, no-store, and the name is
 * never logged.
 *
 * The rules a claim obeys (one change per 30 days, any number within 24
 * hours of the first claim, a 30-day hold on every released name) are the
 * database's: private.claim_member_username.
 */

/**
 * Lookups per member, shared by PUT /me/username and POST /me/username/check
 * and taken before the lookup: far above someone choosing a name as they
 * type (the form checks after a pause), and a bound on probing which names
 * are taken.
 */
export const USERNAME_LOOKUP_RATE_LIMITS = [
  { bucket: "username_lookups", hits: 30, window: "10 minutes" },
  { bucket: "username_lookups_daily", hits: 100, window: "24 hours" },
] as const satisfies readonly { bucket: string; hits: number; window: RateWindow }[];

const TAKEN = "That username is taken. Try another.";
const SUSPENDED = "Your profile can't be changed right now.";

/** Takes one of the caller's lookups from every allowance, or throws a 429 (Retry-After: the longest refusing window). */
async function takeLookup(db: Db, userId: string): Promise<void> {
  const [short, daily] = USERNAME_LOOKUP_RATE_LIMITS;
  const [row] = await db.query<{ short: boolean; daily: boolean }>(
    `select private.take_rate_limit($1, $2, $3, $4::interval) as short,
            private.take_rate_limit($1, $5, $6, $7::interval) as daily`,
    [userId, short.bucket, short.hits, short.window, daily.bucket, daily.hits, daily.window],
  );
  if (!row.daily) throw tooManyRequests("Too many username checks today. Try again tomorrow.", windowSeconds(daily.window));
  if (!row.short) throw tooManyRequests("Too many username checks. Try again in a few minutes.", windowSeconds(short.window));
}

/**
 * PUT /api/me/username {username} — verified email. Claims the name
 * (normalised: "@Latte" is "latte") and answers the caller's AccountSummary.
 * 400 fieldErrors.username; 401 (also an account deleted meanwhile); 403
 * suspended; 409 `username_taken` (live for someone else, or held: the same
 * answer); 429 `username_change_too_soon` with `changeableAt` and
 * Retry-After; 429 past the lookup allowance. The same name again is a 200
 * that changes nothing.
 */
export const putMyUsername: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const username = parseUsernameInput(await readJson(req));
  await takeLookup(db, caller.userId);

  const [claim] = await db.query<{ result: string; changeable_at: Date | string | null }>(
    `select * from private.claim_member_username($1, $2)`,
    [caller.userId, username],
  );
  switch (claim.result) {
    case "claimed":
    case "unchanged":
      return okPrivate(await readAccountSummary(db, caller));
    case "taken":
      throw new HttpError(409, TAKEN, { username: TAKEN }, { code: "username_taken" });
    case "too_soon": {
      if (!claim.changeable_at) throw new Error("claim_member_username: too_soon without changeable_at");
      const at = new Date(claim.changeable_at);
      throw tooManyRequests(
        "You changed your username recently. You can change it again later.",
        (at.getTime() - Date.now()) / 1000,
        undefined,
        { code: "username_change_too_soon", changeableAt: at.toISOString() },
      );
    }
    case "suspended":
      throw new HttpError(403, SUSPENDED);
    case "user_unavailable":
      throw new HttpError(401, "Sign in again.");
    default:
      throw new Error(`Unexpected claim_member_username result: ${claim.result}`);
  }
};

/**
 * DELETE /api/me/username — signed in (no verified email needed, suspended
 * members included). The name is held for 30 days; the change clock isn't
 * reset. 204, idempotent.
 */
export const deleteMyUsername: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  await db.query(`select private.clear_member_username($1)`, [caller.userId]);
  return noContentPrivate();
};

/**
 * POST /api/me/username/check {username} — verified email: whether the
 * caller could have the name. A POST so the name stays out of URLs and logs.
 * `available` is false when it's live for someone else or held (the same
 * answer for both, the caller's own released name included); `yours` when
 * it's (a spelling of) the caller's current name. 400 fieldErrors.username;
 * 403 suspended (they can't claim one); 429 past the allowance it shares
 * with PUT. Doesn't say whether the caller's clock allows a change (GET /me
 * does).
 */
export const checkMyUsername: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const username = parseUsernameInput(await readJson(req));
  await takeLookup(db, caller.userId);

  const [row] = await db.query<{ suspended: boolean; yours: boolean; blocked: boolean }>(
    `select exists (select 1 from private.social_suspensions s where s.user_id = $1) as suspended,
            coalesce(u.user_id = $1, false) as yours,
            coalesce(u.user_id is distinct from $1 and (u.user_id is not null or u.held_until > now()), false) as blocked
       from (select 1) one
       left join private.member_usernames u on u.username_key = private.member_username_key($2)`,
    [caller.userId, username],
  );
  if (row.suspended) throw new HttpError(403, SUSPENDED);
  const answer: UsernameCheck = { username, available: !row.blocked, ...(row.yours ? { yours: true } : {}) };
  return okPrivate(answer);
};
