import { MAX_MEMBER_PHOTOS } from "@/lib/member-photo-rules";
import { memberPhotosEnabled } from "@/lib/member-photos-flag";
import { requireCaller, requireVerifiedCaller } from "../auth";
import { encodeMemberPhoto, readMemberPhotoUpload } from "../avatar";
import type { Db } from "../db";
import { createdPrivate, HttpError, noContentPrivate, okPrivate, readJson } from "../http";
import { parsePhotoDescription } from "../member-profile-input";
import { isUuid } from "../pagination";
import { PROFILE_COLUMNS, toProfile } from "../records";
import type { Handler } from "../route";
import type { MemberPhotoResult } from "../types";
import { avatarResponse, AVATAR_VIEW_RATE_LIMIT, logAdminRead } from "./member-profiles";
import { CALLER_SUSPENDED, NO_PROFILE, profileState, SUSPENDED } from "./profiles";

/**
 * Member photos (docs/architecture.md, "Member photos"): up to
 * MAX_MEMBER_PHOTOS photos on a member profile, beside the profile photo,
 * seen by exactly whoever may see the profile (private.member_profile_visible,
 * re-checked on every fetch). Stored as the server re-encoded them
 * (lib/server/avatar.ts encodeMemberPhoto), in private.profile_photos. The
 * caller's own writes are keyed on the token's user id, so there's no way to
 * address anyone else's photos: another member's photo id is the same 404 as
 * an unknown one. New uploads only while NEXT_PUBLIC_MEMBER_PHOTOS is "1"
 * (lib/member-photos-flag.ts); describing, deleting and seeing photos don't
 * depend on it.
 */

const PHOTO_NOT_FOUND = "Photo not found.";
const UPLOADS_OFF = "Adding photos isn't available yet.";
const PHOTOS_FULL = `You can have up to ${MAX_MEMBER_PHOTOS} photos. Delete one to add another.`;

/**
 * Member photo uploads per member per window (bucket
 * `profile_photo_uploads`). Each one is decoded and re-encoded (CPU), and a
 * full set is 6.
 */
export const PHOTO_UPLOAD_RATE_LIMIT = { hits: 20, window: "24 hours" } as const;

/** 503 while uploads are switched off (lib/member-photos-flag.ts, read on each call). */
function requireUploadsOn(): void {
  if (!memberPhotosEnabled()) throw new HttpError(503, UPLOADS_OFF, { photo: UPLOADS_OFF });
}

/** The caller's profile with every photo, and `photoId` among them (404 if it's gone since: deleted in another tab). */
async function photoResult(db: Db, userId: string, photoId: string): Promise<MemberPhotoResult> {
  const [row] = await db.query(`select ${PROFILE_COLUMNS} from public.profiles where user_id = $1`, [userId]);
  if (!row) throw new HttpError(404, NO_PROFILE);
  const profile = toProfile(row);
  const photo = profile.photos?.find((p) => p.photoId === photoId);
  if (!photo) throw new HttpError(404, PHOTO_NOT_FOUND);
  return { photo, profile };
}

/**
 * POST /api/profiles/me/photos — the raw image (JPEG, PNG or WebP, at most
 * 4 MB, read as a stream and cut off past it). In this order, so the cheap
 * refusals come first and use nothing: a verified email (401/403); uploads
 * on (503); one read of the caller's profile, suspension and photo count
 * (403 suspended, 404 no profile, 409 `photos_full` at MAX_MEMBER_PHOTOS);
 * then the day's allowance is taken (429); the body is read (413) and
 * sniffed (400); decoded and re-encoded (400; 503 when too many are being
 * decoded on this instance); and written by private.add_profile_photo, which
 * re-checks the profile, suspension and count under the profile's lock. 201
 * with {photo, profile}; 200 with the existing photo when the same image is
 * already one of the caller's (a retried upload).
 */
export const postMyPhoto: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  requireUploadsOn();
  const [state] = await db.query<{ has_profile: boolean; suspended: boolean; photos: number }>(
    `select exists (select 1 from public.profiles where user_id = $1) as has_profile, ${CALLER_SUSPENDED} as suspended,
            (select count(*)::int from private.profile_photos ph where ph.user_id = $1) as photos`,
    [caller.userId],
  );
  if (state.suspended) throw new HttpError(403, SUSPENDED);
  if (!state.has_profile) throw new HttpError(404, NO_PROFILE);
  if (state.photos >= MAX_MEMBER_PHOTOS) throw new HttpError(409, PHOTOS_FULL, undefined, { code: "photos_full" });

  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'profile_photo_uploads', $2, $3::interval) as allowed`,
    [caller.userId, PHOTO_UPLOAD_RATE_LIMIT.hits, PHOTO_UPLOAD_RATE_LIMIT.window],
  );
  if (!allowed) throw new HttpError(429, "You've added a lot of photos today. Try again tomorrow.");

  const { image, thumb, width, height } = await encodeMemberPhoto(await readMemberPhotoUpload(req));

  const [written] = await db.query<{ result: string; photo_id: string | null }>(
    `select result, photo_id from private.add_profile_photo($1, $2::bytea, $3::bytea, $4, $5)`,
    [caller.userId, image, thumb, width, height],
  );
  if ((written.result === "added" || written.result === "exists") && !written.photo_id) {
    throw new Error(`add_profile_photo returned ${written.result} without a photo id`);
  }
  const photoId = written.photo_id ?? "";
  switch (written.result) {
    case "added":
      return createdPrivate(await photoResult(db, caller.userId, photoId));
    case "exists":
      return okPrivate(await photoResult(db, caller.userId, photoId));
    case "full":
      throw new HttpError(409, PHOTOS_FULL, undefined, { code: "photos_full" });
    case "suspended":
      throw new HttpError(403, SUSPENDED);
    case "no_profile":
      throw new HttpError(404, NO_PROFILE);
    default:
      throw new Error(`Unexpected add_profile_photo result: ${written.result}`);
  }
};

/**
 * PATCH /api/profiles/me/photos/[photoId] {description} — sets (or, with
 * null or blank, clears) one of the caller's photos' description
 * (parsePhotoDescription: 400). Verified email (403), not suspended (403);
 * a photo that isn't the caller's, or doesn't exist, is a 404. 200 with
 * {photo, profile}.
 */
export const patchMyPhoto: Handler<{ photoId: string }> = async (req, params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const description = parsePhotoDescription(await readJson(req));
  if (!isUuid(params.photoId)) throw new HttpError(404, PHOTO_NOT_FOUND);
  const [updated] = await db.query<{ id: string }>(
    `update private.profile_photos ph set description = $3
      where ph.id = $2 and ph.user_id = $1 and not ${CALLER_SUSPENDED}
      returning ph.id`,
    [caller.userId, params.photoId, description],
  );
  if (!updated) {
    if ((await profileState(db, caller.userId)).suspended) throw new HttpError(403, SUSPENDED);
    throw new HttpError(404, PHOTO_NOT_FOUND);
  }
  // The stored id (Postgres's canonical lower case), whatever case the URL used.
  return okPrivate(await photoResult(db, caller.userId, updated.id));
};

/**
 * DELETE /api/profiles/me/photos/[photoId] — removes one of the caller's
 * photos. Signed in is enough (a suspended or unverified member can always
 * remove their own); idempotent (204), and another member's photo id or a
 * malformed one is a no-op too.
 */
export const deleteMyPhoto: Handler<{ photoId: string }> = async (req, { photoId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (isUuid(photoId)) {
    await db.query(`delete from private.profile_photos where id = $1 and user_id = $2`, [photoId, caller.userId]);
  }
  return noContentPrivate();
};

/**
 * GET /api/profiles/[profileId]/photos/[photoId][?size=thumb] — the photo
 * (fitted inside 1080 px) or its 320 px square thumbnail, never public: the
 * same rule as the profile photo (GET /profiles/{id}/avatar). Verified
 * members who may see the profile now (private.member_profile_visible),
 * rate-limited with the profile photos (`avatar_views`, 429), and admins
 * (moderation, logged by ids), whatever its visibility. Anything else is the
 * same 404, malformed ids and another member's photo id under this profile
 * included. `private, no-cache` with an ETag (the photo id: its bytes never
 * change), and a 304 only once the gate has passed.
 */
export const getMemberPhoto: Handler<{ profileId: string; photoId: string }> = async (
  req,
  params,
  { db, verifyAccessToken },
) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (!caller.isAdmin && (!caller.emailVerified || !caller.email)) {
    throw new HttpError(403, "Verify your email address first.");
  }
  if (!isUuid(params.profileId) || !isUuid(params.photoId)) throw new HttpError(404, PHOTO_NOT_FOUND);
  // Lower case, as Postgres prints uuids, so the ETag and log are the same whatever case the URL used.
  const profileId = params.profileId.toLowerCase();
  const photoId = params.photoId.toLowerCase();
  if (!caller.isAdmin) {
    const [{ allowed }] = await db.query<{ allowed: boolean }>(
      `select private.take_rate_limit($1, 'avatar_views', $2, $3::interval) as allowed`,
      [caller.userId, AVATAR_VIEW_RATE_LIMIT.hits, AVATAR_VIEW_RATE_LIMIT.window],
    );
    if (!allowed) throw new HttpError(429, "Too many requests. Try again in a few minutes.");
  }
  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  const [row] = await db.query<{ data: Uint8Array }>(
    `select case when $4 then ph.thumb else ph.image end as data
       from public.profiles p
       join private.profile_photos ph on ph.user_id = p.user_id
      where p.public_id = $2 and ph.id = $3
        and ($5 or p.user_id = private.member_profile_visible($1, $2))`,
    [caller.userId, profileId, photoId, thumb, caller.isAdmin],
  );
  if (!row) throw new HttpError(404, PHOTO_NOT_FOUND);
  if (caller.isAdmin) {
    logAdminRead(caller.userId, `${thumb ? "the thumbnail of " : ""}photo ${photoId} of member profile ${profileId}`);
  }
  return avatarResponse(req, row.data, photoId, thumb);
};
