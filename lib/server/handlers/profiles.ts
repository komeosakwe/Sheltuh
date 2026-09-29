import { requireCaller, requireVerifiedCaller } from "../auth";
import { HttpError, ok, readJson } from "../http";
import { parseProfileInput } from "../profile-input";
import { PROFILE_COLUMNS, toProfile } from "../records";
import type { Handler } from "../route";
import { fail } from "../validation";

/**
 * The caller's own social profile. Every query is keyed on the token's user
 * id, so there's no way to address anyone else's.
 */

/** GET /api/profiles/me */
export const getMyProfile: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const [row] = await db.query(`select ${PROFILE_COLUMNS} from public.profiles where user_id = $1`, [caller.userId]);
  if (!row) throw new HttpError(404, "You haven't set up a profile yet.");
  return ok(toProfile(row));
};

/**
 * PUT /api/profiles/me — creates the profile ({displayName, adultConfirmed:
 * true}) or renames it ({displayName}). Needs a verified email, like
 * everything else in Who's Going.
 */
export const putMyProfile: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const input = parseProfileInput(await readJson(req));

  if (input.adultConfirmed) {
    // Creates, or renames an existing profile. An existing adult
    // confirmation is kept, not refreshed.
    const [row] = await db.query(
      `insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, $2, now())
       on conflict (user_id) do update set display_name = excluded.display_name
       returning ${PROFILE_COLUMNS}`,
      [caller.userId, input.displayName],
    );
    return ok(toProfile(row));
  }

  // Rename only. With no profile to rename, this is a create without the
  // adult confirmation, which profiles.adult_confirmed_at (not null) forbids.
  const [row] = await db.query(
    `update public.profiles set display_name = $2 where user_id = $1 returning ${PROFILE_COLUMNS}`,
    [caller.userId, input.displayName],
  );
  if (!row) fail({ adultConfirmed: "Confirm you're 18 or over to create a profile." });
  return ok(toProfile(row));
};

/**
 * DELETE /api/profiles/me — deletes the profile and, by cascade in the same
 * statement, every Who's Going opt-in. Idempotent. Signed in is enough:
 * removing your own data is never gated on verification.
 */
export const deleteMyProfile: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  await db.query(`delete from public.profiles where user_id = $1`, [caller.userId]);
  return new Response(null, { status: 204 });
};
