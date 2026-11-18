import { requireCaller } from "../auth";
import { HttpError, okPrivate, readJson, tooManyRequests, windowSeconds } from "../http";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import { requireEvent, requireOwnEvent } from "./event-queries";
import { parseFocusQuery, parseImageDisplayBody } from "../validation";
import { findOrganiserByOwner, requireApprovedOrganiser } from "./organiser-guard";
import { encodeEventImage, EVENT_IMAGE_UPLOAD_RATE_LIMIT, type EncodedEventImage } from "../event-image";
import { MAX_EVENT_IMAGE_BYTES, readCappedBytes, sniffImageType } from "../image-upload";

// Moved to a leaf module (so the re-encoders can share them without an import
// cycle); re-exported here, where they used to live.
export { MAX_EVENT_IMAGE_BYTES, readCappedBytes, sniffImageType };

const EDIT_LOCKED_MESSAGE = "This event can't be edited while it's pending review or published.";

/**
 * The uploaded image, ready to store: raw bytes of at most
 * MAX_EVENT_IMAGE_BYTES (413 otherwise), whose own bytes are a JPEG, PNG or
 * WebP (400 otherwise), then re-encoded server-side by encodeEventImage
 * (lib/server/event-image.ts): EXIF orientation applied, and no metadata
 * (EXIF, GPS, camera, ICC, XMP) kept. The upload itself is never returned, so
 * it can't be stored as sent. Shared with the admin's upload
 * (admin-authoring.ts).
 */
export async function readEventImage(req: Request): Promise<EncodedEventImage> {
  const tooLarge = () =>
    new HttpError(413, "That image is too large.", { image: "Use an image under 2 MB." });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_EVENT_IMAGE_BYTES) throw tooLarge();
  // Read as a stream and stop at the cap, so a request with no Content-Length
  // (chunked) can't make the server buffer an arbitrarily large body first.
  const bytes = await readCappedBytes(req, MAX_EVENT_IMAGE_BYTES);
  if (!bytes) throw tooLarge();

  if (!sniffImageType(bytes)) {
    throw new HttpError(400, "That file isn't a supported image.", { image: "Upload a JPEG, PNG or WebP image." });
  }
  return encodeEventImage(bytes);
}

/**
 * PUT /api/events/[eventId]/image[?fx=&fy=] — raw image bytes, stored only as
 * readEventImage re-encodes them (no metadata); only while the event is a
 * draft or rejected. `fx` / `fy` (whole percentages 0..100, both or
 * neither; 400 otherwise) set the photo's focus point; none means no focus, so
 * replacing a photo resets it. EVENT_IMAGE_UPLOAD_RATE_LIMIT uploads a day per
 * organiser account (429 with Retry-After, before the body is read: each
 * upload is up to two full-resolution encodes in the shared decode slots).
 */
export const putEventImage: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const event = await requireOwnEvent(db, organiser.organiserId, eventId);
  if (event.status !== "draft" && event.status !== "rejected") {
    throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  }

  const focus = parseFocusQuery(req.url);

  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'event_image_uploads', $2, $3::interval) as allowed`,
    [caller.userId, EVENT_IMAGE_UPLOAD_RATE_LIMIT.hits, EVENT_IMAGE_UPLOAD_RATE_LIMIT.window],
  );
  if (!allowed) {
    throw tooManyRequests(
      "You've uploaded a lot of event photos today. Try again tomorrow.",
      windowSeconds(EVENT_IMAGE_UPLOAD_RATE_LIMIT.window),
    );
  }

  const { bytes, contentType } = await readEventImage(req);

  // Ownership and "still a draft/rejected" are re-checked inside the write
  // itself (with the event row locked), not just before the body was read:
  // otherwise a slow upload could land after the event was submitted and
  // approved, putting an unreviewed image on a published event. The event row
  // is locked for no key update before the image row, the order every image
  // writer uses: the event_images_touch_event trigger then bumps the event's
  // updated_at (20261023000100_review_hardening.sql), so an admin editing the
  // event sees a new version.
  const written = await db.query(
    `insert into public.event_images (event_id, content_type, data, focus_x, focus_y)
     select e.id, $2::text, $3::bytea, $5::smallint, $6::smallint
       from public.events e
      where e.id = $1 and e.organiser_id = $4 and e.status in ('draft', 'rejected')
        for no key update of e
     on conflict (event_id) do update set content_type = excluded.content_type,
       data = excluded.data, focus_x = excluded.focus_x, focus_y = excluded.focus_y, updated_at = now()
     returning event_id`,
    [eventId, contentType, bytes, organiser.organiserId, focus?.x ?? null, focus?.y ?? null],
  );
  if (written.length === 0) throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  return okPrivate(await requireEvent(db, eventId));
};

/**
 * PATCH /api/events/[eventId]/image — `{ "focus"?: { "x", "y" } | null,
 * "bannerFit"?: "crop" | "whole" }` (at least one; parseImageDisplayBody):
 * moves (or clears) the focus point and/or sets how the home banner shows the
 * saved photo, in one write, without touching its bytes or version. An absent
 * key keeps the stored value. Draft or rejected events only (409: on a
 * published event only an admin may change either), and only with a photo (409).
 */
export const patchEventImageFocus: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const event = await requireOwnEvent(db, organiser.organiserId, eventId);
  const display = parseImageDisplayBody(await readJson(req));
  if (event.status !== "draft" && event.status !== "rejected") {
    throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  }
  // The event row first (for no key update), then the image: see putEventImage.
  // Focus and fit change together or not at all (one statement).
  const updated = await db.query(
    `with e as (
       select e.id from public.events e
        where e.id = $1 and e.organiser_id = $2 and e.status in ('draft', 'rejected')
          for no key update
     )
     update public.event_images i
        set focus_x = case when $3::boolean then $4::smallint else i.focus_x end,
            focus_y = case when $3::boolean then $5::smallint else i.focus_y end,
            banner_fit = coalesce($6::text, i.banner_fit)
       from e
      where i.event_id = e.id
      returning i.event_id`,
    [eventId, organiser.organiserId, display.setFocus, display.focus?.x ?? null, display.focus?.y ?? null, display.bannerFit],
  );
  if (updated.length === 0) {
    const current = await requireEvent(db, eventId);
    if (current.status !== "draft" && current.status !== "rejected") throw new HttpError(409, EDIT_LOCKED_MESSAGE);
    throw new HttpError(409, "Add a photo first.");
  }
  return okPrivate(await requireEvent(db, eventId));
};

/** DELETE /api/events/[eventId]/image */
export const deleteEventImage: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const event = await requireOwnEvent(db, organiser.organiserId, eventId);
  if (event.status !== "draft" && event.status !== "rejected") {
    throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  }
  // The event row first (for no key update), then the image: see putEventImage.
  const deleted = await db.query(
    `with e as (
       select e.id from public.events e
        where e.id = $1 and e.organiser_id = $2 and e.status in ('draft', 'rejected')
          for no key update
     )
     delete from public.event_images i using e
      where i.event_id = e.id
      returning i.event_id`,
    [eventId, organiser.organiserId],
  );
  // Nothing deleted is fine (no image), unless the event was locked meanwhile.
  if (deleted.length === 0) {
    const current = await requireEvent(db, eventId);
    if (current.status !== "draft" && current.status !== "rejected") throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  }
  return okPrivate(await requireEvent(db, eventId));
};

/**
 * A published event's image at its current version (`?v=` as EVENT_SELECT's
 * image_url gives it): the CDN may share it, for an hour, so a takedown
 * (unpublish) or a replaced image stops being served within about an hour
 * without a manual purge. Not `immutable`, for the same reason.
 *
 * `max-age` equals `s-maxage` on purpose. A browser counts the CDN copy's
 * `Age` against `max-age` (RFC 9111 §4.2.3), so with a shorter `max-age` a
 * copy that sat at the CDN longer than that would arrive already stale and
 * be re-requested on every view. Equal, a copy is never stale on arrival and
 * the whole chain (CDN plus browser) still ends an hour after the function
 * answered. A CDN that dropped `Age` would stretch that to two hours at most.
 * Revalidation is cheap either way: the ETag gets a 304 without the bytes.
 */
export const EVENT_IMAGE_CACHE = "public, max-age=3600, s-maxage=3600";
export const EVENT_IMAGE_UNVERSIONED_CACHE = "private, max-age=3600";

function imageEtag(version: string): string {
  return `"${version}"`;
}

/** The version an If-None-Match header names, if it's exactly one of our ETags. */
function claimedImageVersion(req: Request): string | null {
  const match = /^"(\d{1,20})"$/.exec(req.headers.get("if-none-match") ?? "");
  return match ? match[1] : null;
}

/**
 * GET /api/events/[eventId]/image?v= — public for published events (shared
 * at the CDN only at the current version: EVENT_IMAGE_CACHE). For anything
 * else only the owning organiser or an admin may read it, via a bearer
 * token, and it's never cached. ETag (the version) and Last-Modified; a
 * matching If-None-Match gets a 304 with the same headers, after the same
 * access check, and the bytes aren't even read.
 */
export const getEventImage: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  if (!isUuid(eventId)) throw new HttpError(404, "Image not found.");
  const [row] = await db.query<{
    content_type: string;
    data: Uint8Array | null;
    status: string;
    organiser_id: string;
    version: string;
  }>(
    `select i.content_type, e.status::text as status, e.organiser_id, v.version,
            case when v.version = $2::text then null else i.data end as data
       from public.event_images i
       join public.events e on e.id = i.event_id
      cross join lateral (select floor(extract(epoch from i.updated_at))::bigint::text as version) v
      where i.event_id = $1`,
    [eventId, claimedImageVersion(req)],
  );
  if (!row) throw new HttpError(404, "Image not found.");

  const published = row.status === "published";
  if (!published) {
    // Same 404 whether the event doesn't exist or you just aren't allowed to
    // see it — an anonymous caller mustn't learn that an unpublished image exists.
    let caller;
    try {
      caller = await requireCaller(req, verifyAccessToken);
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 401) throw new HttpError(404, "Image not found.");
      throw err;
    }
    const organiser = caller.isAdmin ? undefined : await findOrganiserByOwner(db, caller.userId);
    if (!caller.isAdmin && organiser?.organiserId !== row.organiser_id) throw new HttpError(404, "Image not found.");
  }

  const currentVersion = new URL(req.url).searchParams.get("v") === row.version;
  const headers = {
    "content-type": row.content_type,
    "x-content-type-options": "nosniff",
    "cache-control": !published
      ? "private, no-store"
      : currentVersion
        ? EVENT_IMAGE_CACHE
        : EVENT_IMAGE_UNVERSIONED_CACHE,
    etag: imageEtag(row.version),
    "last-modified": new Date(Number(row.version) * 1000).toUTCString(),
  };
  if (row.data === null) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(row.data), { status: 200, headers });
};
