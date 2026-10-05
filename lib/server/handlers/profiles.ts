import { requireCaller, requireVerifiedCaller } from "../auth";
import { HttpError, noContentPrivate, okPrivate, readJson } from "../http";
import { parseProfileInput } from "../profile-input";
import { PROFILE_COLUMNS, toProfile } from "../records";
import type { Handler } from "../route";
import { fail } from "../validation";

/**
 * The caller's own social profile. Every query is keyed on the token's user
 * id, so there's no way to address anyone else's. Responses are private and
 * never cached.
 */

const NO_PROFILE = "You haven't set up a profile yet.";
const SUSPENDED = "Your profile can't be changed right now.";

/** SQL: the caller ($1) is suspended from social features. */
const CALLER_SUSPENDED = `exists (select 1 from private.social_suspensions s where s.user_id = $1)`;

/** GET /api/profiles/me */
export const getMyProfile: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const [row] = await db.query(`select ${PROFILE_COLUMNS} from public.profiles where user_id = $1`, [caller.userId]);
  if (!row) throw new HttpError(404, NO_PROFILE);
  return okPrivate(toProfile(row));
};

/**
 * PUT /api/profiles/me — creates the profile ({displayName, adultConfirmed:
 * true}) or renames it ({displayName}). Needs a verified email, like
 * everything else in Who's Going. A suspended member can do neither (403):
 * a suspension outlives the profile, so deleting and recreating it doesn't
 * lift one.
 */
export const putMyProfile: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const body = await readJson(req);
  const input = parseProfileInput(body);

  if (input.adultConfirmed) {
    // Creates, or renames an existing profile. An existing adult
    // confirmation is kept, not refreshed. The suspension check is part of
    // the same statement.
    const [row] = await db.query(
      `insert into public.profiles (user_id, display_name, adult_confirmed_at)
       select $1, $2, now() where not ${CALLER_SUSPENDED}
       on conflict (user_id) do update set display_name = excluded.display_name
       returning ${PROFILE_COLUMNS}`,
      [caller.userId, input.displayName],
    );
    if (!row) throw new HttpError(403, SUSPENDED);
    return okPrivate(toProfile(row));
  }

  // Rename only.
  const [row] = await db.query(
    `update public.profiles set display_name = $2
      where user_id = $1 and not ${CALLER_SUSPENDED}
      returning ${PROFILE_COLUMNS}`,
    [caller.userId, input.displayName],
  );
  if (row) return okPrivate(toProfile(row));

  const [state] = await db.query<{ has_profile: boolean; suspended: boolean }>(
    `select exists (select 1 from public.profiles where user_id = $1) as has_profile, ${CALLER_SUSPENDED} as suspended`,
    [caller.userId],
  );
  if (state.suspended) throw new HttpError(403, SUSPENDED);
  // An explicit `adultConfirmed: false` is a create attempt without the
  // confirmation. With the field left out it's a rename, and there's nothing
  // to rename (e.g. the profile was deleted in another tab).
  if (body.adultConfirmed === false) fail({ adultConfirmed: "Confirm you're 18 or over to create a profile." });
  throw new HttpError(404, NO_PROFILE);
};

/**
 * DELETE /api/profiles/me — deletes the profile and, by cascade in the same
 * statement, every Who's Going opt-in. Idempotent. Signed in is enough:
 * removing your own data is never gated on verification. A suspension
 * (private.social_suspensions) is kept.
 */
export const deleteMyProfile: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  await db.query(`delete from public.profiles where user_id = $1`, [caller.userId]);
  return noContentPrivate();
};
