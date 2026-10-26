import { requireCaller } from "../auth";
import { HttpError, okPrivate } from "../http";
import { encodeLogo, LOGO_UPLOAD_RATE_LIMIT, readLogoUpload } from "../organiser-logo";
import { isUuid } from "../pagination";
import { toOwnOrganiserView } from "../records";
import type { Handler } from "../route";
import { findOrganiserByOwner } from "./organiser-guard";

/**
 * Organiser logos (docs/architecture.md, "Organiser profiles";
 * supabase/migrations/20261105000000_organiser_logos.sql). The organiser is
 * always the caller's own, from the token. Writes go through the private.*
 * functions, which lock the organiser row and log the change.
 */

const NO_ORGANISER = "No organiser application found.";
const NOT_APPROVED = "Your organiser application must be approved before you can add a logo.";
const LOGO_NOT_FOUND = "Logo not found.";

/**
 * An approved organiser's logo at its current version (`?v=` as
 * organiserLogoUrls gives it): the CDN may share it. An hour in browsers, 23
 * more at the CDN, so a takedown (suspension) or a new logo stops being
 * served within a day. Not `immutable`, for the same reason.
 */
export const LOGO_CACHE = "public, max-age=3600, s-maxage=82800";
/** Any other `v` (none, or not the current one): browser only, never shared (see EVENT_IMAGE_UNVERSIONED_CACHE). */
export const LOGO_UNVERSIONED_CACHE = "private, max-age=3600";

/**
 * PUT /api/organisers/me/logo — the raw image (JPEG, PNG or WebP, at most
 * 2 MB, read as a stream and cut off past it: 413). Re-encoded server-side
 * (lib/server/organiser-logo.ts); the upload itself is never stored. An
 * approved organiser only (403, checked before the body is read), 20 uploads
 * a day (429). 409 if the organiser stopped being approved during the
 * upload. Answers with the caller's organiser record, `logoUrl` included.
 */
export const putMyOrganiserLogo: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await findOrganiserByOwner(db, caller.userId);
  if (!organiser || organiser.status !== "approved") throw new HttpError(403, NOT_APPROVED);

  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'organiser_logo_uploads', $2, $3::interval) as allowed`,
    [caller.userId, LOGO_UPLOAD_RATE_LIMIT.hits, LOGO_UPLOAD_RATE_LIMIT.window],
  );
  if (!allowed) throw new HttpError(429, "You've changed your logo a lot today. Try again tomorrow.");

  const { image, thumb } = await encodeLogo(await readLogoUpload(req));

  // Approval is checked again in the write, with the organiser row locked:
  // the upload may have taken a while.
  const [{ result }] = await db.query<{ result: "updated" | "not_approved" | "not_found" }>(
    `select private.put_organiser_logo($1, $2::bytea, $3::bytea) as result`,
    [caller.userId, image, thumb],
  );
  if (result === "not_found") throw new HttpError(404, NO_ORGANISER);
  if (result === "not_approved") throw new HttpError(409, "Your organiser account changed while the logo was uploading.");
  const record = await findOrganiserByOwner(db, caller.userId);
  if (!record) throw new HttpError(404, NO_ORGANISER);
  return okPrivate(toOwnOrganiserView(record));
};

/**
 * DELETE /api/organisers/me/logo — removes the caller's organiser's logo,
 * whatever its status (a suspended organiser can still take theirs down).
 * Idempotent: 200 with the organiser record either way; 404 with no organiser.
 */
export const deleteMyOrganiserLogo: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const [{ result }] = await db.query<{ result: "deleted" | "unchanged" | "not_found" }>(
    `select private.delete_organiser_logo($1) as result`,
    [caller.userId],
  );
  if (result === "not_found") throw new HttpError(404, NO_ORGANISER);
  const record = await findOrganiserByOwner(db, caller.userId);
  if (!record) throw new HttpError(404, NO_ORGANISER);
  return okPrivate(toOwnOrganiserView(record));
};

/** A strong ETag for a logo version and size, as the route sends it. */
function logoEtag(version: string, thumb: boolean): string {
  return `"${version}-${thumb ? "t" : "f"}"`;
}

/** The version an If-None-Match header names for this size, if it's exactly one of our ETags. */
function claimedVersion(req: Request, thumb: boolean): string | null {
  const match = /^"(\d{1,20})-([ft])"$/.exec(req.headers.get("if-none-match") ?? "");
  return match && match[2] === (thumb ? "t" : "f") ? match[1] : null;
}

/**
 * GET /api/organisers/[organiserId]/logo[?size=thumb][&v=…] — the logo as
 * WebP (512 px, or the 96 px thumbnail). Public while the organiser is
 * approved: whatever `v` says, the current logo is served, but only at the
 * current version may the CDN share it (LOGO_CACHE; LOGO_UNVERSIONED_CACHE
 * otherwise). Otherwise only an admin or the organiser's owner, with a bearer
 * token, never cached; anyone else gets the same 404 as an unknown organiser
 * or one without a logo (a missing token included), so nothing leaks. ETag,
 * 304 on a matching If-None-Match.
 */
export const getOrganiserLogo: Handler<{ organiserId: string }> = async (
  req,
  { organiserId },
  { db, verifyAccessToken },
) => {
  if (!isUuid(organiserId)) throw new HttpError(404, LOGO_NOT_FOUND);
  const query = new URL(req.url).searchParams;
  const thumb = query.get("size") === "thumb";
  // One query (both tables by primary key). The image is only read when the
  // client doesn't already have this version.
  const [row] = await db.query<{
    status: string;
    owner_user_id: string | null;
    version: string;
    data: Uint8Array | null;
  }>(
    `select o.status::text as status, o.owner_user_id, v.version,
            case when v.version = $3::text then null when $2::boolean then l.thumb else l.image end as data
       from public.organisers o
       join private.organiser_logos l on l.organiser_id = o.id
      cross join lateral (select floor(extract(epoch from l.updated_at) * 1000)::bigint::text as version) v
      where o.id = $1`,
    [organiserId, thumb, claimedVersion(req, thumb)],
  );
  if (!row) throw new HttpError(404, LOGO_NOT_FOUND);

  const approved = row.status === "approved";
  if (!approved) {
    let caller;
    try {
      caller = await requireCaller(req, verifyAccessToken);
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 401) throw new HttpError(404, LOGO_NOT_FOUND);
      throw err;
    }
    if (!caller.isAdmin && caller.userId !== row.owner_user_id) throw new HttpError(404, LOGO_NOT_FOUND);
  }

  const headers = {
    "content-type": "image/webp",
    "x-content-type-options": "nosniff",
    "cache-control": !approved
      ? "private, no-store"
      : query.get("v") === row.version
        ? LOGO_CACHE
        : LOGO_UNVERSIONED_CACHE,
    etag: logoEtag(row.version, thumb),
  };
  if (row.data === null) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(row.data), { status: 200, headers });
};
