import { requireCaller, requireVerifiedCaller } from "../auth";
import { encodeAvatar, readAvatarUpload } from "../avatar";
import type { Db } from "../db";
import { HttpError, noContentPrivate, okPrivate, readJson } from "../http";
import { parseProfilePatch } from "../member-profile-input";
import { parseProfileInput } from "../profile-input";
import { PROFILE_COLUMNS, toProfile } from "../records";
import type { Handler } from "../route";
import { fail } from "../validation";
import { avatarResponse } from "./member-profiles";

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
 * statement, every Who's Going opt-in, the photo, bio and Instagram handle
 * (a recreated profile starts hidden, with a new profile id). Idempotent. Signed in is enough:
 * removing your own data is never gated on verification. A suspension
 * (private.social_suspensions) is kept.
 */
export const deleteMyProfile: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  await db.query(`delete from public.profiles where user_id = $1`, [caller.userId]);
  return noContentPrivate();
};

/** Where the caller stands: has a profile, and is suspended (both false/false for a stranger). */
async function profileState(db: Db, userId: string) {
  const [state] = await db.query<{ has_profile: boolean; suspended: boolean }>(
    `select exists (select 1 from public.profiles where user_id = $1) as has_profile, ${CALLER_SUSPENDED} as suspended`,
    [userId],
  );
  return state;
}

/** 403 suspended, 404 no profile: why a write to the caller's own profile found nothing. */
async function refuseProfileWrite(db: Db, userId: string): Promise<never> {
  const state = await profileState(db, userId);
  if (state.suspended) throw new HttpError(403, SUSPENDED);
  throw new HttpError(404, NO_PROFILE);
}

/**
 * PATCH /api/profiles/me {displayName?, profileVisible?, bio?, instagramHandle?}
 * — the member profile's settings (docs/architecture.md, "Member profiles").
 * Fields left out are unchanged; null or blank clears bio or the handle.
 * Verified email, an existing profile (404) and not suspended (403).
 */
export const patchMyProfile: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const patch = parseProfilePatch(await readJson(req));
  const has = (field: keyof typeof patch) => patch[field] !== undefined;
  const [row] = await db.query(
    `update public.profiles
        set display_name = case when $2 then $3 else display_name end,
            profile_visible = case when $4 then $5::boolean else profile_visible end,
            bio = case when $6 then $7 else bio end,
            instagram_handle = case when $8 then $9 else instagram_handle end
      where user_id = $1 and not ${CALLER_SUSPENDED}
      returning ${PROFILE_COLUMNS}`,
    [
      caller.userId,
      has("displayName"),
      patch.displayName ?? null,
      has("profileVisible"),
      patch.profileVisible ?? null,
      has("bio"),
      patch.bio ?? null,
      has("instagramHandle"),
      patch.instagramHandle ?? null,
    ],
  );
  if (!row) return refuseProfileWrite(db, caller.userId);
  return okPrivate(toProfile(row));
};

/**
 * Photo uploads per member per window. Each one is decoded and re-encoded
 * (CPU), and nobody changes their photo more than a few times a day.
 */
export const AVATAR_UPLOAD_RATE_LIMIT = { hits: 20, window: "24 hours" } as const;

/**
 * PUT /api/profiles/me/avatar — the raw image (JPEG, PNG or WebP, at most
 * 5 MB, read as a stream and cut off past it: 413). Re-encoded server-side to
 * a square WebP and a thumbnail with every piece of metadata stripped
 * (lib/server/avatar.ts); the upload itself is never stored. Verified email,
 * a profile (404), not suspended (403), 20 uploads a day (429). Answers with
 * the profile.
 */
export const putMyAvatar: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const state = await profileState(db, caller.userId);
  if (state.suspended) throw new HttpError(403, SUSPENDED);
  if (!state.has_profile) throw new HttpError(404, NO_PROFILE);
  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'avatar_uploads', $2, $3::interval) as allowed`,
    [caller.userId, AVATAR_UPLOAD_RATE_LIMIT.hits, AVATAR_UPLOAD_RATE_LIMIT.window],
  );
  if (!allowed) throw new HttpError(429, "You've changed your photo a lot today. Try again tomorrow.");

  const { image, thumb } = await encodeAvatar(await readAvatarUpload(req));

  // Profile and suspension checked again in the write itself: the upload
  // may have taken a while.
  const written = await db.query(
    `insert into private.profile_avatars (user_id, image, thumb)
     select p.user_id, $2::bytea, $3::bytea from public.profiles p
      where p.user_id = $1 and not ${CALLER_SUSPENDED}
     on conflict (user_id) do update set image = excluded.image, thumb = excluded.thumb, updated_at = now()
     returning user_id`,
    [caller.userId, image, thumb],
  );
  if (written.length === 0) return refuseProfileWrite(db, caller.userId);
  const [row] = await db.query(`select ${PROFILE_COLUMNS} from public.profiles where user_id = $1`, [caller.userId]);
  return okPrivate(toProfile(row));
};

/** DELETE /api/profiles/me/avatar — removes the photo. Signed in is enough; idempotent (204). */
export const deleteMyAvatar: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  await db.query(`delete from private.profile_avatars where user_id = $1`, [caller.userId]);
  return noContentPrivate();
};

/** GET /api/profiles/me/avatar[?size=thumb] — the caller's own photo, whatever their profile's visibility. */
export const getMyAvatar: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  const [row] = await db.query<{ data: Uint8Array; version: string }>(
    `select case when $2 then a.thumb else a.image end as data,
            floor(extract(epoch from a.updated_at) * 1000)::bigint::text as version
       from private.profile_avatars a where a.user_id = $1`,
    [caller.userId, thumb],
  );
  if (!row) throw new HttpError(404, "No photo.");
  return avatarResponse(req, row.data, row.version, thumb);
};
