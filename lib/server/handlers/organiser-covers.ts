import { requireCaller } from "../auth";
import { HttpError, okPrivate, tooManyRequests, windowSeconds } from "../http";
import { COVER_UPLOAD_RATE_LIMIT, encodeCover, readCoverUpload } from "../organiser-cover";
import { isUuid } from "../pagination";
import { toOwnOrganiserView } from "../records";
import type { Handler } from "../route";
import { findOrganiserByOwner } from "./organiser-guard";

/**
 * Organiser cover images (docs/architecture.md, "Organiser profiles";
 * supabase/migrations/20261128000000_organiser_covers.sql). As the logo
 * (organiser-logos.ts): the organiser is always the caller's own, from the
 * token, and writes go through the private.* functions, which lock the
 * organiser row and log the change.
 */

const NO_ORGANISER = "No organiser application found.";
const NOT_APPROVED = "Your organiser application must be approved before you can add a cover image.";
const COVER_NOT_FOUND = "Cover not found.";

/**
 * An approved organiser's cover at its current version (`?v=` as
 * organiserCoverUrls gives it): the CDN may share it for an hour, as a logo
 * (LOGO_CACHE), so a takedown or a new cover stops being served within about
 * an hour. `max-age` equals `s-maxage` so a CDN copy is never stale on
 * arrival in the browser.
 */
export const COVER_CACHE = "public, max-age=3600, s-maxage=3600";
/** Any other `v` (none, or not the current one): browser only, never shared. */
export const COVER_UNVERSIONED_CACHE = "private, max-age=3600";

/**
 * PUT /api/organisers/me/cover — the raw image (JPEG, PNG or WebP, at most
 * 4 MB, read as a stream and cut off past it: 413). Re-encoded server-side
 * (lib/server/organiser-cover.ts); the upload itself is never stored. An
 * approved organiser only (403, checked before the body is read), 20 uploads
 * a day (429). 409 if the organiser stopped being approved during the
 * upload. Answers with the caller's organiser record, `coverUrl` included.
 */
export const putMyOrganiserCover: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await findOrganiserByOwner(db, caller.userId);
  if (!organiser || organiser.status !== "approved") throw new HttpError(403, NOT_APPROVED);

  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'organiser_cover_uploads', $2, $3::interval) as allowed`,
    [caller.userId, COVER_UPLOAD_RATE_LIMIT.hits, COVER_UPLOAD_RATE_LIMIT.window],
  );
  if (!allowed) {
    throw tooManyRequests(
      "You've changed your cover image a lot today. Try again tomorrow.",
      windowSeconds(COVER_UPLOAD_RATE_LIMIT.window),
    );
  }

  const { image, small } = await encodeCover(await readCoverUpload(req));

  // Approval is checked again in the write, with the organiser row locked:
  // the upload may have taken a while.
  const [{ result }] = await db.query<{ result: "updated" | "not_approved" | "not_found" }>(
    `select private.put_organiser_cover($1, $2::bytea, $3::bytea) as result`,
    [caller.userId, image, small],
  );
  if (result === "not_found") throw new HttpError(404, NO_ORGANISER);
  if (result === "not_approved") throw new HttpError(409, "Your organiser account changed while the cover was uploading.");
  const record = await findOrganiserByOwner(db, caller.userId);
  if (!record) throw new HttpError(404, NO_ORGANISER);
  return okPrivate(toOwnOrganiserView(record));
};

/**
 * DELETE /api/organisers/me/cover — removes the caller's organiser's cover,
 * whatever its status (a suspended organiser can still take theirs down).
 * Idempotent: 200 with the organiser record either way; 404 with no organiser.
 */
export const deleteMyOrganiserCover: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const [{ result }] = await db.query<{ result: "deleted" | "unchanged" | "not_found" }>(
    `select private.delete_organiser_cover($1) as result`,
    [caller.userId],
  );
  if (result === "not_found") throw new HttpError(404, NO_ORGANISER);
  const record = await findOrganiserByOwner(db, caller.userId);
  if (!record) throw new HttpError(404, NO_ORGANISER);
  return okPrivate(toOwnOrganiserView(record));
};

/** A strong ETag for a cover version and size, as the route sends it (`l`: large, `s`: small). */
function coverEtag(version: string, small: boolean): string {
  return `"${version}-${small ? "s" : "l"}"`;
}

/** The version an If-None-Match header names for this size, if it's exactly one of our ETags. */
function claimedVersion(req: Request, small: boolean): string | null {
  const match = /^"(\d{1,20})-([ls])"$/.exec(req.headers.get("if-none-match") ?? "");
  return match && match[2] === (small ? "s" : "l") ? match[1] : null;
}

/**
 * GET /api/organisers/[organiserId]/cover[?size=small][&v=…] — the cover as
 * WebP (2240 × 640, or 1120 × 320). Public while the organiser is approved:
 * whatever `v` says, the current cover is served, but only at the current
 * version may the CDN share it (COVER_CACHE; COVER_UNVERSIONED_CACHE
 * otherwise). Otherwise only an admin or the organiser's owner, with a bearer
 * token, never cached; anyone else gets the same 404 as an unknown organiser
 * or one without a cover (a missing token included), so nothing leaks. ETag,
 * 304 on a matching If-None-Match.
 */
export const getOrganiserCover: Handler<{ organiserId: string }> = async (
  req,
  { organiserId },
  { db, verifyAccessToken },
) => {
  if (!isUuid(organiserId)) throw new HttpError(404, COVER_NOT_FOUND);
  const query = new URL(req.url).searchParams;
  const small = query.get("size") === "small";
  // One query (both tables by primary key). The image is only read when the
  // client doesn't already have this version.
  const [row] = await db.query<{
    status: string;
    owner_user_id: string | null;
    version: string;
    data: Uint8Array | null;
  }>(
    `select o.status::text as status, o.owner_user_id, v.version,
            case when v.version = $3::text then null when $2::boolean then c.small else c.image end as data
       from public.organisers o
       join private.organiser_covers c on c.organiser_id = o.id
      cross join lateral (select floor(extract(epoch from c.updated_at) * 1000)::bigint::text as version) v
      where o.id = $1`,
    [organiserId, small, claimedVersion(req, small)],
  );
  if (!row) throw new HttpError(404, COVER_NOT_FOUND);

  const approved = row.status === "approved";
  if (!approved) {
    let caller;
    try {
      caller = await requireCaller(req, verifyAccessToken);
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 401) throw new HttpError(404, COVER_NOT_FOUND);
      throw err;
    }
    if (!caller.isAdmin && caller.userId !== row.owner_user_id) throw new HttpError(404, COVER_NOT_FOUND);
  }

  const headers = {
    "content-type": "image/webp",
    "x-content-type-options": "nosniff",
    "cache-control": !approved
      ? "private, no-store"
      : query.get("v") === row.version
        ? COVER_CACHE
        : COVER_UNVERSIONED_CACHE,
    etag: coverEtag(row.version, small),
  };
  if (row.data === null) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(row.data), { status: 200, headers });
};
