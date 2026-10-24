/**
 * Event clips (supabase/migrations/20261106000000_event_clips.sql and
 * 20261106000100_event_clip_dimensions.sql; docs/design/event-clips.md): one
 * optional short, silent H.264 clip per event, shown when someone presses
 * Play on the event's image.
 *
 * Upload flow (the bytes never pass through this app on the way in, so
 * Vercel's request body limit doesn't apply):
 *   1. POST …/clip/uploads {sizeBytes, contentType}: a signed Storage upload
 *      URL for uploads/{eventId}/{callerId}/{uploadId}.mp4 in the private
 *      `event-clips` bucket. The path is always built here (event from the
 *      URL, account from the token, a fresh upload id): never taken from the
 *      client. 20 a day per account (take_rate_limit 'event_clip_uploads').
 *   2. The browser PUTs the file to that URL (lib/api/clips.ts).
 *   3. PUT …/clip {uploadId, description, rightsConfirmed: true}: the server
 *      checks the staged object's size, downloads it (capped), checks and
 *      neutralises it (lib/server/mp4.ts), writes the result itself to
 *      clips/{eventId}/{uploadId}.mp4, and records it with
 *      private.put_event_clip, which re-checks who may act with the event
 *      row locked. The staged object, and any clip it replaced, are deleted
 *      after the response (deps.defer); the daily sweep (sweepEventClips,
 *      run from the trending cron) catches anything that slips through.
 *
 * Who may act: the same rules as event photos. An organiser, on their own
 * event (someone else's is a 404) while it's a draft or rejected (409
 * otherwise). An admin, on any event whatever its status, logged `edited`
 * with an optional reason; no expectedUpdatedAt check (as for photos), but
 * every clip write bumps the event's updated_at, so an admin's save from an
 * older version is stale (409).
 *
 * Reading: GET …/clip?v= redirects (302) a published event's clip to a
 * 1-hour signed URL (cached 5 minutes, so a takedown stops new plays within
 * 5 minutes; a URL already handed out works up to an hour). GET
 * …/clip/preview gives the owner or an admin a 10-minute signed URL for any
 * status. Without SUPABASE_CLIP_STORAGE_KEY every route that needs Storage
 * is a 503; removing a clip, and changing its description, still work.
 */
import { requireAdmin, requireCaller, type Caller } from "../auth";
import { ClipStorageError, SIGNED_UPLOAD_URL_LIFETIME_MS, type ClipStorage } from "../clip-storage";
import { pgErrorCode, type Db } from "../db";
import type { Deps } from "../deps";
import { createdPrivate, HttpError, okPrivate, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { clipProblemMessage, sanitiseClip } from "../mp4";
import { isUuid } from "../pagination";
import { ADMIN_EVENT_SELECT, toAdminEvent } from "../records";
import type { Handler } from "../route";
import type { AdminEventRecord, EventRecord } from "../types";
import { fail } from "../validation";
import { MAX_TICKETING_REASON_LENGTH } from "./admin";
import { requireEvent, requireOwnEvent } from "./event-queries";
import { findOrganiserByOwner, requireApprovedOrganiser } from "./organiser-guard";
import {
  CLIP_MESSAGES,
  CLIP_UPLOAD_CONTENT_TYPES,
  MAX_CLIP_BYTES,
  MAX_CLIP_DESCRIPTION_LENGTH,
  type ClipUploadContentType,
} from "@/lib/clip-rules";

/** Upload URLs per account per day (organisers and admins alike). */
export const CLIP_UPLOAD_RATE_LIMIT = { hits: 20, window: "1 day" } as const;
/**
 * Clips checked at once per server instance, and how many more may wait:
 * each holds up to 10 MB twice (download, upload), so a burst queues, and
 * past the queue it's a 503.
 */
export const CLIP_PROCESS_CONCURRENCY = { running: 2, waiting: 6 } as const;
/** The public redirect's signed URL. */
export const CLIP_URL_LIFETIME_SECONDS = 60 * 60;
/** The owner's or admin's preview URL. */
export const CLIP_PREVIEW_LIFETIME_SECONDS = 10 * 60;
/** The public redirect (the URL is versioned; not `immutable`, so a takedown stops new plays within 5 minutes). */
export const CLIP_REDIRECT_CACHE_CONTROL = "public, max-age=300, s-maxage=300";
/** The sweep: staged uploads, and final clips nothing refers to, older than this are deleted. */
export const CLIP_SWEEP_AGE = "1 day";
/** Objects the sweep deletes per run at most (the rest wait for the next). */
export const CLIP_SWEEP_BATCH = 500;

const EVENT_NOT_FOUND = "Event not found.";
const CLIP_NOT_FOUND = "Clip not found.";
const NO_CLIP = "This event has no clip.";
/** Reading (GET, preview) when Storage isn't there: the viewer shows its own copy. */
const CLIPS_UNAVAILABLE = "Clips aren't available right now.";

const PG_NOT_NULL_VIOLATION = "23502";

const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where the browser uploads: bound to the event and the uploading account. */
export function stagedClipPath(eventId: string, userId: string, uploadId: string): string {
  return `uploads/${eventId}/${userId}/${uploadId}.mp4`;
}

/** Where the server writes the checked clip (event_clips_object_path_check). */
export function finalClipPath(eventId: string, uploadId: string): string {
  return `clips/${eventId}/${uploadId}.mp4`;
}

const unavailable = () => new HttpError(503, CLIP_MESSAGES.unavailable, { clip: CLIP_MESSAGES.unavailable });

function requireStorage(deps: Deps): ClipStorage {
  const storage = deps.clipStorage();
  if (!storage) throw unavailable();
  return storage;
}

/** A Storage failure is a 503 (logged without anything personal); anything else goes on as it was. */
function storageFailed(err: unknown, message: string = CLIP_MESSAGES.unavailable): never {
  if (err instanceof ClipStorageError) {
    console.error(err.message);
    throw new HttpError(503, message, message === CLIP_MESSAGES.unavailable ? { clip: message } : undefined);
  }
  throw err;
}

/** Deletes objects after the response; a failure is logged (Deps.defer) and left for the sweep. */
function removeLater(deps: Deps, paths: (string | null | undefined)[]): void {
  const storage = deps.clipStorage();
  const objects = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (!storage || objects.length === 0) return;
  deps.defer(() => storage.remove(objects));
}

// ---------------------------------------------------------------------------
// Per-instance processing slots (as lib/server/avatar.ts's encoder)
// ---------------------------------------------------------------------------

let running = 0;
const waiting: (() => void)[] = [];

async function inClipSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < CLIP_PROCESS_CONCURRENCY.running) {
    running += 1;
  } else {
    if (waiting.length >= CLIP_PROCESS_CONCURRENCY.waiting) throw unavailable();
    // The slot is handed over by the finishing job (running stays the same).
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

// ---------------------------------------------------------------------------
// Who's acting
// ---------------------------------------------------------------------------

/** The caller and the event, checked: an organiser's own event, or any event for an admin. */
interface Actor {
  caller: Caller;
  /** null for an admin (put_event_clip's p_organiser_id). */
  organiserId: string | null;
  event: EventRecord;
}

/** An approved organiser's own event (404 otherwise), still a draft or rejected (409 with `lockedMessage` otherwise). */
async function organiserActor(req: Request, eventId: string, deps: Deps, lockedMessage: string): Promise<Actor> {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  const event = await requireOwnEvent(deps.db, organiser.organiserId, eventId);
  if (event.status !== "draft" && event.status !== "rejected") {
    throw new HttpError(409, lockedMessage, { clip: lockedMessage });
  }
  return { caller, organiserId: organiser.organiserId, event };
}

async function findAdminEvent(db: Db, eventId: string): Promise<AdminEventRecord | undefined> {
  if (!isUuid(eventId)) return undefined;
  const [row] = await db.query(`${ADMIN_EVENT_SELECT} where e.id = $1`, [eventId]);
  return row ? toAdminEvent(row) : undefined;
}

async function requireAdminEvent(db: Db, eventId: string): Promise<AdminEventRecord> {
  const event = await findAdminEvent(db, eventId);
  if (!event) throw new HttpError(404, EVENT_NOT_FOUND);
  return event;
}

async function adminActor(req: Request, eventId: string, deps: Deps): Promise<Actor> {
  const caller = await requireAdmin(req, deps.verifyAccessToken);
  return { caller, organiserId: null, event: await requireAdminEvent(deps.db, eventId) };
}

/** The response after a write: the organiser's view of their event, or the admin's record. */
async function respond(actor: Actor, deps: Deps): Promise<Response> {
  const eventId = actor.event.eventId;
  return okPrivate(
    actor.organiserId === null ? await requireAdminEvent(deps.db, eventId) : await requireEvent(deps.db, eventId),
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

type Errors = Record<string, string>;

/** An admin's optional reason (1–500 characters when given), shown in the event's log. */
function parseReason(value: unknown, errors: Errors): string | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  return (
    parseMessageText(value, "reason", errors, {
      allowLinks: true,
      label: "Reasons",
      maxLength: MAX_TICKETING_REASON_LENGTH,
    }) || null
  );
}

interface UploadRequest {
  sizeBytes: number;
  contentType: ClipUploadContentType;
}

function parseUploadRequest(body: Record<string, unknown>): UploadRequest {
  const { sizeBytes, contentType } = body;
  if (typeof sizeBytes === "number" && Number.isInteger(sizeBytes) && sizeBytes > MAX_CLIP_BYTES) {
    const message = CLIP_MESSAGES.tooLarge(sizeBytes);
    throw new HttpError(413, message, { clip: message });
  }
  if (
    typeof sizeBytes !== "number" ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 1 ||
    typeof contentType !== "string" ||
    !(CLIP_UPLOAD_CONTENT_TYPES as readonly string[]).includes(contentType.toLowerCase())
  ) {
    fail({ clip: CLIP_MESSAGES.notMp4 });
  }
  return { sizeBytes, contentType: contentType.toLowerCase() as ClipUploadContentType };
}

interface AttachRequest {
  /** Lower-case; undefined for a description-only change. */
  uploadId?: string;
  description: string;
  reason: string | null;
}

function parseAttachRequest(body: Record<string, unknown>, admin: boolean): AttachRequest {
  const errors: Errors = {};
  let uploadId: string | undefined;
  if (body.uploadId !== undefined && body.uploadId !== null) {
    if (typeof body.uploadId === "string" && UUID_LOWER.test(body.uploadId.toLowerCase())) {
      uploadId = body.uploadId.toLowerCase();
    } else {
      errors.clip = CLIP_MESSAGES.uploadExpired;
    }
  }
  let description = "";
  if (typeof body.description !== "string" || !body.description.trim()) {
    errors.description = CLIP_MESSAGES.describe;
  } else {
    description = parseMessageText(body.description, "description", errors, {
      allowLinks: true,
      label: "Descriptions",
      maxLength: MAX_CLIP_DESCRIPTION_LENGTH,
    });
    if (!description && !errors.description) errors.description = CLIP_MESSAGES.describe;
  }
  if (body.rightsConfirmed !== true) errors.rightsConfirmed = CLIP_MESSAGES.rights;
  const reason = admin ? parseReason(body.reason, errors) : null;
  if (Object.keys(errors).length > 0) fail(errors);
  return { uploadId, description, reason };
}

// ---------------------------------------------------------------------------
// The shared steps
// ---------------------------------------------------------------------------

async function issueUploadUrl(actor: Actor, req: Request, deps: Deps): Promise<Response> {
  parseUploadRequest(await readJson(req));
  const storage = requireStorage(deps);
  const [{ allowed }] = await deps.db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'event_clip_uploads', $2, $3::interval) as allowed`,
    [actor.caller.userId, CLIP_UPLOAD_RATE_LIMIT.hits, CLIP_UPLOAD_RATE_LIMIT.window],
  );
  if (!allowed) throw new HttpError(429, CLIP_MESSAGES.rateLimited, { clip: CLIP_MESSAGES.rateLimited });

  const uploadId = crypto.randomUUID();
  const issuedAt = Date.now();
  let url: string;
  try {
    ({ url } = await storage.createUploadUrl(stagedClipPath(actor.event.eventId, actor.caller.userId, uploadId)));
  } catch (err) {
    storageFailed(err);
  }
  return createdPrivate({
    uploadId,
    uploadUrl: url,
    expiresAt: new Date(issuedAt + SIGNED_UPLOAD_URL_LIFETIME_MS).toISOString(),
    maxBytes: MAX_CLIP_BYTES,
  });
}

type PutResult = "updated" | "unchanged" | "no_clip" | "not_found" | "not_editable";

/** What processUpload found: the final object and what's recorded about it. */
interface CheckedClip {
  path: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
}

/**
 * private.put_event_clip. `path` null: the description only; a path that's
 * already the event's clip: a replay (its stored details are kept, so
 * `clip` may be null then too).
 */
async function putClip(
  db: Db,
  actor: Actor,
  path: string | null,
  clip: CheckedClip | null,
  description: string,
  reason: string | null,
): Promise<{ result: PutResult; old_object_path: string | null }> {
  const [row] = await db.query<{ result: PutResult; old_object_path: string | null }>(
    `select result, old_object_path
       from private.put_event_clip($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      actor.event.eventId,
      actor.caller.userId,
      actor.organiserId,
      path,
      clip?.sizeBytes ?? null,
      clip?.durationMs ?? null,
      clip?.width ?? null,
      clip?.height ?? null,
      description,
      reason,
    ],
  );
  return row;
}

/** A refusal from put_event_clip / delete_event_clip as an HTTP error. */
function refusal(result: string, lockedMessage: string): HttpError | null {
  switch (result) {
    case "not_found":
      return new HttpError(404, EVENT_NOT_FOUND);
    case "not_editable":
      return new HttpError(409, lockedMessage, { clip: lockedMessage });
    case "no_clip":
      return new HttpError(404, NO_CLIP);
    default:
      return null;
  }
}

/**
 * Checks the staged upload and writes the clean copy to its final path.
 * 410 if the upload isn't there; 413 over the cap (from its size, before
 * downloading anything); 400 if it isn't a clip we accept. A refused upload
 * is deleted (after the response).
 */
async function processUpload(actor: Actor, uploadId: string, deps: Deps): Promise<CheckedClip> {
  const storage = requireStorage(deps);
  const staged = stagedClipPath(actor.event.eventId, actor.caller.userId, uploadId);
  const final = finalClipPath(actor.event.eventId, uploadId);
  const expired = () => new HttpError(410, CLIP_MESSAGES.uploadExpired, { clip: CLIP_MESSAGES.uploadExpired });
  const tooLarge = (sizeBytes: number) => {
    removeLater(deps, [staged]);
    const message = clipProblemMessage("too_large", { sizeBytes });
    return new HttpError(413, message, { clip: message });
  };

  let info: { size: number } | null;
  try {
    info = await storage.info(staged);
  } catch (err) {
    storageFailed(err);
  }
  if (!info) throw expired();
  if (info.size > MAX_CLIP_BYTES) throw tooLarge(info.size);

  return inClipSlot(async () => {
    let bytes: Uint8Array | "missing" | "too_large";
    try {
      bytes = await storage.download(staged, MAX_CLIP_BYTES);
    } catch (err) {
      storageFailed(err);
    }
    if (bytes === "missing") throw expired();
    if (bytes === "too_large") throw tooLarge(info.size > MAX_CLIP_BYTES ? info.size : MAX_CLIP_BYTES + 1);

    const check = sanitiseClip(bytes);
    if (!check.ok) {
      removeLater(deps, [staged]);
      throw new HttpError(400, check.message, { clip: check.message });
    }
    try {
      await storage.upload(final, bytes, "video/mp4");
    } catch (err) {
      storageFailed(err);
    }
    return {
      path: final,
      sizeBytes: bytes.length,
      durationMs: check.info.durationMs,
      width: check.info.width,
      height: check.info.height,
    };
  });
}

async function attachClip(actor: Actor, req: Request, deps: Deps): Promise<Response> {
  const input = parseAttachRequest(await readJson(req), actor.organiserId === null);
  const { db } = deps;
  const eventId = actor.event.eventId;

  if (input.uploadId === undefined) {
    // The description only.
    const { result } = await putClip(db, actor, null, null, input.description, input.reason);
    const refused = refusal(result, CLIP_MESSAGES.editLocked);
    if (refused) throw refused;
    return respond(actor, deps);
  }

  const final = finalClipPath(eventId, input.uploadId);
  // A replay of the clip that's already attached: nothing to check or copy
  // again (and its staged upload may be gone); only the description can change.
  const [current] = await db.query<{ object_path: string }>(
    `select object_path from private.event_clips where event_id = $1`,
    [eventId],
  );
  if (current?.object_path === final) {
    let replay: PutResult | undefined;
    try {
      replay = (await putClip(db, actor, final, null, input.description, input.reason)).result;
    } catch (err) {
      // Replaced by another clip since the read above: the write had no
      // details to insert it with (not null). Check and attach it afresh.
      if (pgErrorCode(err) !== PG_NOT_NULL_VIOLATION) throw err;
    }
    if (replay !== undefined) {
      const refused = refusal(replay, CLIP_MESSAGES.editLocked);
      if (refused) throw refused;
      removeLater(deps, [stagedClipPath(eventId, actor.caller.userId, input.uploadId)]);
      return respond(actor, deps);
    }
  }

  const clip = await processUpload(actor, input.uploadId, deps);
  const staged = stagedClipPath(eventId, actor.caller.userId, input.uploadId);
  // Who may act is checked again here, with the event row locked: the upload
  // took a while, and the event may have been submitted or approved since.
  let written: { result: PutResult; old_object_path: string | null };
  try {
    written = await putClip(db, actor, clip.path, clip, input.description, input.reason);
  } catch (err) {
    removeLater(deps, [final]);
    throw err;
  }
  const refused = refusal(written.result, CLIP_MESSAGES.editLocked);
  if (refused) {
    // Nothing attached: neither copy is wanted.
    removeLater(deps, [final, staged]);
    throw refused;
  }
  removeLater(deps, [staged, written.old_object_path]);
  return respond(actor, deps);
}

async function removeClip(actor: Actor, req: Request, deps: Deps): Promise<Response> {
  let reason: string | null = null;
  if (actor.organiserId === null) {
    const errors: Errors = {};
    reason = parseReason((await readJson(req)).reason, errors);
    if (Object.keys(errors).length > 0) fail(errors);
  }
  const [row] = await deps.db.query<{ result: "deleted" | "unchanged" | "not_found" | "not_editable"; old_object_path: string | null }>(
    `select result, old_object_path from private.delete_event_clip($1, $2, $3, $4)`,
    [actor.event.eventId, actor.caller.userId, actor.organiserId, reason],
  );
  const refused = refusal(row.result, CLIP_MESSAGES.removeLocked);
  if (refused) throw refused;
  // Without Storage configured the object stays until the sweep can run.
  removeLater(deps, [row.old_object_path]);
  return respond(actor, deps);
}

// ---------------------------------------------------------------------------
// Organiser routes
// ---------------------------------------------------------------------------

/**
 * POST /api/events/[eventId]/clip/uploads — {sizeBytes, contentType}: 201
 * {uploadId, uploadUrl, expiresAt, maxBytes}, private. The browser PUTs the
 * file to uploadUrl (lib/api/clips.ts, uploadClipToStorage), then calls PUT
 * …/clip with the uploadId. 400 (fieldErrors.clip) a size or type that can't
 * be a clip; 404 not their event; 409 not a draft or rejected; 413 over
 * 10 MB; 429 over 20 a day; 503 Storage unavailable.
 */
export const createClipUpload: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const actor = await organiserActor(req, eventId, deps, CLIP_MESSAGES.editLocked);
  return issueUploadUrl(actor, req, deps);
};

/**
 * PUT /api/events/[eventId]/clip — {uploadId?, description, rightsConfirmed:
 * true}. With an uploadId: checks and attaches that upload (replacing any
 * clip; a replay of the attached one only updates the description). Without
 * one: changes the description of the event's clip (404 if it has none).
 * 200 with the event (its `clip` set). 400 fieldErrors (clip, description,
 * rightsConfirmed); 404; 409 the event was submitted or approved (nothing
 * attached); 410 the upload expired or isn't there; 413; 503.
 */
export const putEventClip: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const actor = await organiserActor(req, eventId, deps, CLIP_MESSAGES.editLocked);
  return attachClip(actor, req, deps);
};

/** DELETE /api/events/[eventId]/clip — removes the clip (200 with the event; also with none). 404; 409. */
export const deleteEventClip: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const actor = await organiserActor(req, eventId, deps, CLIP_MESSAGES.removeLocked);
  return removeClip(actor, req, deps);
};

// ---------------------------------------------------------------------------
// Admin routes: any event, any status, logged `edited`
// ---------------------------------------------------------------------------

/** POST /api/admin/events/[eventId]/clip/uploads — as the organiser's, for any event. */
export const adminCreateClipUpload: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  return issueUploadUrl(await adminActor(req, eventId, deps), req, deps);
};

/** PUT /api/admin/events/[eventId]/clip — as the organiser's, plus an optional `reason`; 200 with the AdminEventRecord. */
export const adminPutEventClip: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  return attachClip(await adminActor(req, eventId, deps), req, deps);
};

/** DELETE /api/admin/events/[eventId]/clip — body {reason?}; logged when there was a clip. 200 with the AdminEventRecord. */
export const adminDeleteEventClip: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  return removeClip(await adminActor(req, eventId, deps), req, deps);
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * GET /api/events/[eventId]/clip?v=… — public, published events only: a 302
 * to a 1-hour signed URL, `public, max-age=300, s-maxage=300` (`v` only
 * versions the URL). Anything else (no clip, not published, not an id) is a
 * 404, the same whoever asks; 503 without Storage.
 */
export const getEventClip: Handler<{ eventId: string }> = async (_req, { eventId }, deps) => {
  if (!isUuid(eventId)) throw new HttpError(404, CLIP_NOT_FOUND);
  const [row] = await deps.db.query<{ object_path: string }>(
    `select c.object_path
       from private.event_clips c join public.events e on e.id = c.event_id
      where c.event_id = $1 and e.status = 'published'`,
    [eventId],
  );
  if (!row) throw new HttpError(404, CLIP_NOT_FOUND);
  const storage = deps.clipStorage();
  if (!storage) throw new HttpError(503, CLIPS_UNAVAILABLE);
  let url: string;
  try {
    url = await storage.createSignedUrl(row.object_path, CLIP_URL_LIFETIME_SECONDS);
  } catch (err) {
    storageFailed(err, CLIPS_UNAVAILABLE);
  }
  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": CLIP_REDIRECT_CACHE_CONTROL, "referrer-policy": "no-referrer" },
  });
};

/**
 * GET /api/events/[eventId]/clip/preview — the event's owner (whatever their
 * organiser's status) or an admin, any event status: 200 {url, expiresAt}, a
 * 10-minute signed URL, private (a <video> can't send a bearer token). 401
 * signed out; 404 for anyone else, or no clip; 503 without Storage.
 */
export const getEventClipPreview: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, CLIP_NOT_FOUND);
  const [row] = await deps.db.query<{ object_path: string; organiser_id: string }>(
    `select c.object_path, e.organiser_id
       from private.event_clips c join public.events e on e.id = c.event_id
      where c.event_id = $1`,
    [eventId],
  );
  if (!row) throw new HttpError(404, CLIP_NOT_FOUND);
  if (!caller.isAdmin) {
    const organiser = await findOrganiserByOwner(deps.db, caller.userId);
    if (organiser?.organiserId !== row.organiser_id) throw new HttpError(404, CLIP_NOT_FOUND);
  }
  const storage = deps.clipStorage();
  if (!storage) throw new HttpError(503, CLIPS_UNAVAILABLE);
  const issuedAt = Date.now();
  let url: string;
  try {
    url = await storage.createSignedUrl(row.object_path, CLIP_PREVIEW_LIFETIME_SECONDS);
  } catch (err) {
    storageFailed(err, CLIPS_UNAVAILABLE);
  }
  return okPrivate({ url, expiresAt: new Date(issuedAt + CLIP_PREVIEW_LIFETIME_SECONDS * 1000).toISOString() });
};

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Deletes, through the Storage API (never with SQL), the bucket's objects
 * older than CLIP_SWEEP_AGE that nothing needs: staged uploads (attached or
 * not, an upload is done with within its 2-hour URL) and final clips no
 * event refers to (replaced or removed ones whose deferred delete was lost,
 * an event's clip after the event was deleted, an attach whose write
 * failed). Reads storage.objects with SQL to find them. At most
 * CLIP_SWEEP_BATCH a run. A no-op without Storage.
 */
export async function sweepEventClips(deps: Deps): Promise<{ removed: number }> {
  const storage = deps.clipStorage();
  if (!storage) return { removed: 0 };
  const rows = await deps.db.query<{ name: string }>(
    `select o.name
       from storage.objects o
      where o.bucket_id = 'event-clips'
        and o.created_at < now() - $1::interval
        and (o.name like 'uploads/%'
             or (o.name like 'clips/%'
                 and not exists (select 1 from private.event_clips c where c.object_path = o.name)))
      order by o.created_at
      limit $2`,
    [CLIP_SWEEP_AGE, CLIP_SWEEP_BATCH],
  );
  if (rows.length > 0) await storage.remove(rows.map((r) => r.name));
  return { removed: rows.length };
}

/** For the trending cron (runTrendingCron): the sweep after its response, best-effort (Deps.defer logs a failure). */
export function sweepEventClipsSoon(deps: Deps): void {
  if (!deps.clipStorage()) return;
  deps.defer(async () => {
    await sweepEventClips(deps);
  });
}
