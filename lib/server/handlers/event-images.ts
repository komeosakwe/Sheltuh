import { requireCaller } from "../auth";
import { HttpError, ok } from "../http";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import { requireEvent, requireOwnEvent } from "./event-queries";
import { findOrganiserByOwner, requireApprovedOrganiser } from "./organiser-guard";

/** Mirrors the event_images check constraint. The client downsizes well below this. */
export const MAX_EVENT_IMAGE_BYTES = 2 * 1024 * 1024;

type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** Identifies the format from the file's own bytes — the declared Content-Type isn't trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const EDIT_LOCKED_MESSAGE = "This event can't be edited while it's pending review or published.";

/** Reads a request body, returning null as soon as it exceeds `max` bytes. */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** PUT /api/events/[eventId]/image — raw image bytes; only while the event is a draft or rejected. */
export const putEventImage: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const event = await requireOwnEvent(db, organiser.organiserId, eventId);
  if (event.status !== "draft" && event.status !== "rejected") {
    throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  }

  const tooLarge = () =>
    new HttpError(413, "That image is too large.", { image: "Use an image under 2 MB." });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_EVENT_IMAGE_BYTES) throw tooLarge();
  // Read as a stream and stop at the cap, so a request with no Content-Length
  // (chunked) can't make the server buffer an arbitrarily large body first.
  const bytes = await readCapped(req, MAX_EVENT_IMAGE_BYTES);
  if (!bytes) throw tooLarge();

  const contentType = sniffImageType(bytes);
  if (!contentType) {
    throw new HttpError(400, "That file isn't a supported image.", { image: "Upload a JPEG, PNG or WebP image." });
  }

  // Ownership and "still a draft/rejected" are re-checked inside the write
  // itself (with the event row share-locked), not just before the body was
  // read: otherwise a slow upload could land after the event was submitted and
  // approved, putting an unreviewed image on a published event.
  const written = await db.query(
    `insert into public.event_images (event_id, content_type, data)
     select e.id, $2::text, $3::bytea
       from public.events e
      where e.id = $1 and e.organiser_id = $4 and e.status in ('draft', 'rejected')
        for share of e
     on conflict (event_id) do update set content_type = excluded.content_type,
       data = excluded.data, updated_at = now()
     returning event_id`,
    [eventId, contentType, bytes, organiser.organiserId],
  );
  if (written.length === 0) throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  return ok(await requireEvent(db, eventId));
};

/** DELETE /api/events/[eventId]/image */
export const deleteEventImage: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await requireApprovedOrganiser(db, caller);
  const event = await requireOwnEvent(db, organiser.organiserId, eventId);
  if (event.status !== "draft" && event.status !== "rejected") {
    throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  }
  const deleted = await db.query(
    `delete from public.event_images i using public.events e
      where i.event_id = e.id and e.id = $1 and e.organiser_id = $2 and e.status in ('draft', 'rejected')
      returning i.event_id`,
    [eventId, organiser.organiserId],
  );
  // Nothing deleted is fine (no image), unless the event was locked meanwhile.
  if (deleted.length === 0) {
    const current = await requireEvent(db, eventId);
    if (current.status !== "draft" && current.status !== "rejected") throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  }
  return ok(await requireEvent(db, eventId));
};

/**
 * GET /api/events/[eventId]/image — public for published events (cached for a
 * day; the URL is versioned). For anything else only the owning organiser or an
 * admin may read it, via a bearer token, and it's never cached.
 */
export const getEventImage: Handler<{ eventId: string }> = async (req, { eventId }, { db, verifyAccessToken }) => {
  if (!isUuid(eventId)) throw new HttpError(404, "Image not found.");
  const [row] = await db.query<{
    content_type: string;
    data: Uint8Array;
    status: string;
    organiser_id: string;
  }>(
    `select i.content_type, i.data, e.status::text as status, e.organiser_id
       from public.event_images i join public.events e on e.id = i.event_id
      where i.event_id = $1`,
    [eventId],
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

  return new Response(new Uint8Array(row.data), {
    headers: {
      "content-type": row.content_type,
      "x-content-type-options": "nosniff",
      // Not `immutable`: a takedown (unpublish) should stop being served within a day.
      "cache-control": published ? "public, max-age=86400" : "private, no-store",
    },
  });
};
