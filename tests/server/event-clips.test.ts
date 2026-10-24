import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIP_MESSAGES, MAX_CLIP_BYTES } from "@/lib/clip-rules";
import type { Db } from "@/lib/server/db";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import {
  adminCreateClipUpload,
  adminDeleteEventClip,
  adminPutEventClip,
  CLIP_ATTACH_RATE_LIMIT,
  CLIP_PREVIEW_LIFETIME_SECONDS,
  CLIP_REDIRECT_CACHE_CONTROL,
  CLIP_STALE_REDIRECT_CACHE_CONTROL,
  CLIP_UPLOAD_RATE_LIMIT,
  CLIP_URL_LIFETIME_SECONDS,
  createClipUpload,
  deleteEventClip,
  finalClipPath,
  getEventClip,
  getEventClipPreview,
  clipUploadsEnabled,
  putEventClip,
  stagedClipPath,
  sweepEventClips,
} from "@/lib/server/handlers/event-clips";
import { getMyEvent, submitEventForReview } from "@/lib/server/handlers/events";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { runTrendingCron } from "@/lib/server/handlers/trending";
import { SHELTUH_TEAM_ACTOR } from "@/lib/api/types";
import type { AdminEventRecord, EventRecord } from "@/lib/server/types";
import { CRON_SECRET, FAKE_STORAGE_ORIGIN, FakeClipStorage, SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, eventInput, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * The event clip routes (lib/server/handlers/event-clips.ts) over a fake
 * Storage (FakeClipStorage), with uploads switched on
 * (NEXT_PUBLIC_EVENT_CLIPS=1) unless a test says otherwise. The SQL
 * functions' own rules, locks and races are in event-clips-migration.test.ts.
 */

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.resolve(import.meta.dirname, "../fixtures/clips", name)));
/** 160 × 90, 1 s, H.264, no audio; with a planted title (in udta) the server must strip. */
const H264 = fixture("h264.mp4");
const H264_MOV = fixture("h264.mov");
const DESCRIPTION = "Four bands in a warehouse, the crowd dancing under red lights.";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_EVENT_CLIPS", "1");
  await reset();
  await api.db.query(`delete from storage.objects`);
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function storage(): FakeClipStorage {
  if (!api.clipStorage) throw new Error("no clip storage");
  return api.clipStorage;
}

/** `token` null: signed out. */
function requestUpload(
  eventId: string,
  token: string | null = organiser.token,
  body: unknown = { sizeBytes: H264.length, contentType: "video/mp4" },
  handler = createClipUpload,
) {
  return api.call(handler, { token: token ?? undefined, params: { eventId }, body, method: "POST" });
}

function attach(eventId: string, body: Record<string, unknown>, token: string | null = organiser.token, handler = putEventClip) {
  return api.call(handler, {
    token: token ?? undefined,
    params: { eventId },
    body: { description: DESCRIPTION, rightsConfirmed: true, ...body },
    method: "PUT",
  });
}

function remove(eventId: string, token: string | null = organiser.token, handler = deleteEventClip, body?: unknown) {
  return api.call(handler, { token: token ?? undefined, params: { eventId }, method: "DELETE", ...(body === undefined ? {} : { body }) });
}

/** Steps 1 and 2: an upload URL, and the browser's upload of `bytes` to it. Returns the upload id. */
async function uploaded(
  eventId: string,
  bytes: Uint8Array = H264,
  who: { token: string; userId: string } = organiser,
  handler = createClipUpload,
) {
  const res = await requestUpload(eventId, who.token, { sizeBytes: bytes.length, contentType: "video/mp4" }, handler);
  if (res.status !== 201) throw new Error(`upload URL refused: ${JSON.stringify(res.body)}`);
  const uploadId = res.body.uploadId as string;
  storage().put(stagedClipPath(eventId, who.userId, uploadId), bytes);
  return uploadId;
}

/** All three steps for the organiser's event. */
async function withClip(eventId: string, bytes: Uint8Array = H264) {
  const uploadId = await uploaded(eventId, bytes);
  const res = await attach(eventId, { uploadId });
  if (res.status !== 200) throw new Error(`attach failed: ${JSON.stringify(res.body)}`);
  await api.runDeferred();
  return { uploadId, event: res.body as EventRecord };
}

function indexOf(bytes: Uint8Array, text: string): number {
  return Buffer.from(bytes).indexOf(Buffer.from(text, "latin1"));
}

async function clipRow(eventId: string) {
  const [row] = await api.db.query<{
    object_path: string;
    size_bytes: number;
    width: number;
    height: number;
    description: string;
    rights_confirmed_at: string;
  }>(
    `select object_path, size_bytes, width, height, description, rights_confirmed_at::text
       from private.event_clips where event_id = $1`,
    [eventId],
  );
  return row;
}

/** The clip's current version (the `v` of its URL), or undefined with none. */
async function clipVersion(eventId: string): Promise<string | undefined> {
  const [row] = await api.db.query<{ v: string }>(
    `select floor(extract(epoch from updated_at) * 1000)::bigint::text as v from private.event_clips where event_id::text = $1`,
    [eventId],
  );
  return row?.v;
}

/** GET …/clip?v=…: by default at the clip's current version (any version for an event without one). */
async function getClip(eventId: string, token?: string, v?: string | null) {
  const version = v === undefined ? ((await clipVersion(eventId)) ?? "1") : v;
  return api.send(
    getEventClip,
    new Request(`${SITE_URL}/api/events/${eventId}/clip${version === null ? "" : `?v=${version}`}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { eventId },
  );
}

async function uploadRow(uploadId: string) {
  const [row] = await api.db.query<{ event_id: string; user_id: string; consumed: boolean }>(
    `select event_id, user_id, consumed_at is not null as consumed from private.event_clip_uploads where id = $1`,
    [uploadId],
  );
  return row;
}

describe("POST /events/{id}/clip/uploads", () => {
  it("issues a private upload URL for a path bound to the event and the caller", async () => {
    const draft = await draftEvent(api, organiser);
    const before = Date.now();
    const res = await requestUpload(draft.eventId);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({
      uploadId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      uploadUrl: expect.stringContaining(`${FAKE_STORAGE_ORIGIN}/storage/v1/object/upload/sign/event-clips/uploads/`),
      expiresAt: expect.any(String),
      maxBytes: MAX_CLIP_BYTES,
    });
    const expires = Date.parse(res.body.expiresAt);
    expect(expires - before).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000 - 1000);
    expect(expires - before).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 5000);
    expect(storage().calls).toEqual([
      { op: "createUploadUrl", paths: [`uploads/${draft.eventId}/${organiser.userId}/${res.body.uploadId}.mp4`] },
    ]);
    // Recorded with its event and account, not yet used.
    expect(await uploadRow(res.body.uploadId)).toEqual({ event_id: draft.eventId, user_id: organiser.userId, consumed: false });
  });

  it("503 with uploads switched off (NEXT_PUBLIC_EVENT_CLIPS not 1), for organisers and admins, with nothing issued", async () => {
    const draft = await draftEvent(api, organiser);
    for (const value of ["", "0", "true"]) {
      vi.stubEnv("NEXT_PUBLIC_EVENT_CLIPS", value);
      expect(clipUploadsEnabled()).toBe(false);
      for (const [token, handler] of [
        [organiser.token, createClipUpload],
        [admin.token, adminCreateClipUpload],
      ] as const) {
        const res = await requestUpload(draft.eventId, token, undefined, handler);
        expect(res.status, value).toBe(503);
        expect(res.body).toEqual({ error: CLIP_MESSAGES.unavailable, fieldErrors: { clip: CLIP_MESSAGES.unavailable } });
      }
    }
    // Still 401 / 404 first.
    expect((await requestUpload(draft.eventId, null)).status).toBe(401);
    expect((await requestUpload(crypto.randomUUID())).status).toBe(404);
    expect(storage().calls).toEqual([]);
    const [row] = await api.db.query<{ n: number }>(`select count(*)::int as n from private.event_clip_uploads`);
    expect(row.n).toBe(0);

    vi.stubEnv("NEXT_PUBLIC_EVENT_CLIPS", "1");
    expect(clipUploadsEnabled()).toBe(true);
    expect((await requestUpload(draft.eventId)).status).toBe(201);
  });

  it("401 signed out, 403 not an approved organiser, 404 someone else's event or no event", async () => {
    const draft = await draftEvent(api, organiser);
    expect((await requestUpload(draft.eventId, null)).status).toBe(401);
    const member = await api.signUp();
    expect((await requestUpload(draft.eventId, member.token)).status).toBe(403);
    const other = await approvedOrganiser(api, admin);
    expect((await requestUpload(draft.eventId, other.token)).status).toBe(404);
    expect((await requestUpload(crypto.randomUUID())).status).toBe(404);
    expect((await requestUpload("not-an-id")).status).toBe(404);
    expect(storage().calls).toEqual([]);
  });

  it("409 once the event is submitted or published", async () => {
    const draft = await draftEvent(api, organiser);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    const res = await requestUpload(draft.eventId);
    expect(res.status).toBe(409);
    expect(res.body.fieldErrors).toEqual({ clip: CLIP_MESSAGES.editLocked });
    const published = await publishedEvent(api, organiser, admin);
    expect((await requestUpload(published.eventId)).status).toBe(409);
  });

  it("413 over 10 MB and 400 for a type or size that can't be a clip, before anything is issued", async () => {
    const draft = await draftEvent(api, organiser);
    const tooBig = await requestUpload(draft.eventId, organiser.token, { sizeBytes: Math.round(12.3 * 1024 * 1024), contentType: "video/mp4" });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.fieldErrors).toEqual({
      clip: "This clip is 12.3 MB. Clips can be up to 10 MB: export at 1080p or lower and try again.",
    });
    for (const body of [
      { sizeBytes: 1000, contentType: "video/webm" },
      { sizeBytes: 1000, contentType: "image/png" },
      { sizeBytes: 0, contentType: "video/mp4" },
      { sizeBytes: 1.5, contentType: "video/mp4" },
      { sizeBytes: "1000", contentType: "video/mp4" },
      {},
    ]) {
      const res = await requestUpload(draft.eventId, organiser.token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.fieldErrors).toEqual({ clip: CLIP_MESSAGES.notMp4 });
    }
    expect((await requestUpload(draft.eventId, organiser.token, { sizeBytes: 1000, contentType: "video/quicktime" })).status).toBe(201);
    expect(storage().count("createUploadUrl")).toBe(1);
  });

  it("429 past 20 upload URLs a day, per account", async () => {
    const draft = await draftEvent(api, organiser);
    for (let i = 0; i < CLIP_UPLOAD_RATE_LIMIT.hits; i++) expect((await requestUpload(draft.eventId)).status).toBe(201);
    const refused = await requestUpload(draft.eventId);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ error: CLIP_MESSAGES.rateLimited, fieldErrors: { clip: CLIP_MESSAGES.rateLimited } });
    // Someone else's allowance is their own.
    const other = await approvedOrganiser(api, admin);
    const theirs = await draftEvent(api, other);
    expect((await requestUpload(theirs.eventId, other.token)).status).toBe(201);
  });

  it("503 without Storage configured (and no allowance used)", async () => {
    const draft = await draftEvent(api, organiser);
    api.clipStorage = undefined;
    const res = await requestUpload(draft.eventId);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: CLIP_MESSAGES.unavailable, fieldErrors: { clip: CLIP_MESSAGES.unavailable } });
    const [row] = await api.db.query<{ n: number }>(
      `select count(*)::int as n from private.rate_limits where bucket = 'event_clip_uploads'`,
    );
    expect(row.n).toBe(0);
  });

  it("503 when Storage doesn't answer", async () => {
    const draft = await draftEvent(api, organiser);
    storage().failing.add("createUploadUrl");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await requestUpload(draft.eventId)).status).toBe(503);
    expect(error).toHaveBeenCalledWith("Clip storage createUploadUrl failed (HTTP 500).");
    error.mockRestore();
  });
});

describe("PUT /events/{id}/clip", () => {
  it("checks the upload, writes a clean copy, and shows the clip on the event", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    const res = await attach(draft.eventId, { uploadId });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const event = res.body as EventRecord;
    expect(event.clip).toEqual({
      url: expect.stringMatching(new RegExp(`^/api/events/${draft.eventId}/clip\\?v=\\d{13}$`)),
      durationMs: 1000,
      width: 160,
      height: 90,
      description: DESCRIPTION,
    });
    expect(Date.parse(event.updatedAt)).toBeGreaterThan(Date.parse(draft.updatedAt));

    // The final object is the server's own copy: same length, as video/mp4, its location and title gone.
    const final = storage().objects.get(finalClipPath(draft.eventId, uploadId));
    expect(final?.contentType).toBe("video/mp4");
    expect(final?.bytes.length).toBe(H264.length);
    expect(indexOf(H264, "Planted")).toBeGreaterThan(0);
    expect(indexOf(final!.bytes, "Planted")).toBe(-1);
    expect(indexOf(final!.bytes, "udta")).toBe(-1);
    expect(await clipRow(draft.eventId)).toMatchObject({ size_bytes: H264.length, width: 160, height: 90 });

    // The staged upload goes after the response.
    const staged = stagedClipPath(draft.eventId, organiser.userId, uploadId);
    expect(storage().objects.has(staged)).toBe(true);
    await api.runDeferred();
    expect(storage().objects.has(staged)).toBe(false);

    // The organiser's own read of the event shows it too; nothing is logged for an organiser.
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: draft.eventId } });
    expect(mine.body.clip).toEqual(event.clip);
    expect(mine.body.moderationLog).toEqual([]);
  });

  it("accepts a QuickTime file", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId, H264_MOV);
    expect((await attach(draft.eventId, { uploadId })).status).toBe(200);
  });

  it("refuses an upload that isn't there, or belongs to another account or event: 410", async () => {
    const draft = await draftEvent(api, organiser);
    const other = await draftEvent(api, organiser);
    const expectGone = async (uploadId: string) => {
      const res = await attach(draft.eventId, { uploadId });
      expect(res.status).toBe(410);
      expect(res.body).toEqual({ error: CLIP_MESSAGES.uploadExpired, fieldErrors: { clip: CLIP_MESSAGES.uploadExpired } });
    };
    await expectGone(crypto.randomUUID());
    // The admin's upload for this event is under the admin's account.
    await expectGone(await uploaded(draft.eventId, H264, admin, adminCreateClipUpload));
    // Another event's upload.
    await expectGone(await uploaded(other.eventId));
    expect(storage().count("download")).toBe(0);
    expect(await clipRow(draft.eventId)).toBeUndefined();
  });

  it("refuses an oversized upload from its size alone, without downloading it, and deletes it", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    const staged = stagedClipPath(draft.eventId, organiser.userId, uploadId);
    const big = new Uint8Array(MAX_CLIP_BYTES + 1);
    big.set(H264);
    storage().put(staged, big);
    const res = await attach(draft.eventId, { uploadId });
    expect(res.status).toBe(413);
    expect(res.body.fieldErrors).toEqual({ clip: CLIP_MESSAGES.tooLarge(MAX_CLIP_BYTES + 1) });
    expect(storage().count("download")).toBe(0);
    await api.runDeferred();
    expect(storage().objects.has(staged)).toBe(false);
  });

  it("400 with the spec's message for a file that isn't a clip we accept, and deletes it", async () => {
    const draft = await draftEvent(api, organiser);
    for (const [name, message] of [
      ["h264-aac.mp4", "Clips can’t have sound — export without audio."],
      ["hevc.mp4", CLIP_MESSAGES.hevc],
      ["fragmented.mp4", CLIP_MESSAGES.unreadable],
    ] as const) {
      const uploadId = await uploaded(draft.eventId, fixture(name));
      const res = await attach(draft.eventId, { uploadId });
      expect(res.status, name).toBe(400);
      expect(res.body.fieldErrors, name).toEqual({ clip: message });
      await api.runDeferred();
      expect(storage().objects.has(stagedClipPath(draft.eventId, organiser.userId, uploadId))).toBe(false);
    }
    const webm = await uploaded(draft.eventId, Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1));
    expect((await attach(draft.eventId, { uploadId: webm })).body.fieldErrors).toEqual({ clip: CLIP_MESSAGES.notMp4 });
    expect(storage().count("upload")).toBe(0);
    expect(await clipRow(draft.eventId)).toBeUndefined();
  });

  it("requires a description, and the rights confirmation with an upload, with the spec's messages", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    for (const [body, fieldErrors] of [
      [{ uploadId, description: "" }, { description: CLIP_MESSAGES.describe }],
      [{ uploadId, description: "   " }, { description: CLIP_MESSAGES.describe }],
      [{ uploadId, description: undefined }, { description: CLIP_MESSAGES.describe }],
      [{ uploadId, rightsConfirmed: false }, { rightsConfirmed: CLIP_MESSAGES.rights }],
      [{ uploadId, rightsConfirmed: "true" }, { rightsConfirmed: CLIP_MESSAGES.rights }],
      [{ uploadId: "not-an-id" }, { clip: CLIP_MESSAGES.uploadExpired }],
      [{ uploadId, description: "x".repeat(301) }, { description: "Must be 300 characters or fewer." }],
    ] as const) {
      const res = await attach(draft.eventId, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.fieldErrors).toEqual(fieldErrors);
    }
    expect(storage().count("info")).toBe(0);
    expect((await attach(draft.eventId, { uploadId, description: `  ${"x".repeat(300)}  ` })).status).toBe(200);
  });

  it("a description-only change needs no rights confirmation (ignored if sent) and keeps the rights date, organiser and admin", async () => {
    const draft = await draftEvent(api, organiser);
    await withClip(draft.eventId);
    // An old attach: any rewrite of the date would show.
    await api.db.query(`update private.event_clips set rights_confirmed_at = now() - interval '3 days' where event_id = $1`, [
      draft.eventId,
    ]);
    const confirmedAt = (await clipRow(draft.eventId)).rights_confirmed_at;
    for (const [extra, description] of [
      [{ rightsConfirmed: undefined }, "Without the box."],
      [{ rightsConfirmed: false }, "With the box unticked."],
      [{ rightsConfirmed: "yes" }, "With nonsense in it."],
      [{ rightsConfirmed: true }, "With the box ticked."],
    ] as const) {
      const res = await attach(draft.eventId, { ...extra, description });
      expect(res.status, description).toBe(200);
      expect(res.body.clip.description).toBe(description);
      expect((await clipRow(draft.eventId)).rights_confirmed_at, description).toBe(confirmedAt);
    }
    const byAdmin = await attach(draft.eventId, { description: "An admin's words.", rightsConfirmed: undefined }, admin.token, adminPutEventClip);
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.moderationLog.at(-1)).toMatchObject({ changes: { clipDescription: { new: "An admin's words." } } });
    expect((await clipRow(draft.eventId)).rights_confirmed_at).toBe(confirmedAt);
  });

  it("a new upload re-dates the rights", async () => {
    const draft = await draftEvent(api, organiser);
    await withClip(draft.eventId);
    await api.db.query(`update private.event_clips set rights_confirmed_at = now() - interval '3 days' where event_id = $1`, [
      draft.eventId,
    ]);
    const old = (await clipRow(draft.eventId)).rights_confirmed_at;
    await withClip(draft.eventId, H264_MOV);
    expect(Date.parse((await clipRow(draft.eventId)).rights_confirmed_at)).toBeGreaterThan(Date.parse(old));
  });

  it("an event locked while the upload was checked: 409, nothing attached, the staged copy deleted, the final one left for the sweep", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    const real = api.db;
    const locking: Db = {
      async query<T>(text: string, params?: unknown[]) {
        if (text.includes("private.put_event_clip")) {
          await real.query(`update public.events set status = 'pending_review' where id = $1`, [draft.eventId]);
        }
        return real.query<T>(text, params);
      },
    };
    const lockedApi = Object.assign(Object.create(Object.getPrototypeOf(api)) as TestApi, api, { db: locking });
    const res = await lockedApi.call(putEventClip, {
      token: organiser.token,
      params: { eventId: draft.eventId },
      body: { uploadId, description: DESCRIPTION, rightsConfirmed: true },
      method: "PUT",
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: CLIP_MESSAGES.editLocked, fieldErrors: { clip: CLIP_MESSAGES.editLocked } });
    expect(await clipRow(draft.eventId)).toBeUndefined();
    await lockedApi.runDeferred();
    // Never deleted on a refusal: the sweep removes it once it's a day old and unreferenced.
    expect(storage().objects.has(finalClipPath(draft.eventId, uploadId))).toBe(true);
    expect(storage().calls.filter((c) => c.op === "remove").flatMap((c) => c.paths)).toEqual([
      stagedClipPath(draft.eventId, organiser.userId, uploadId),
    ]);
    expect(storage().objects.has(stagedClipPath(draft.eventId, organiser.userId, uploadId))).toBe(false);
  });

  it("a database error while recording leaves both objects for the sweep", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    const real = api.db;
    const failing: Db = {
      async query<T>(text: string, params?: unknown[]) {
        if (text.includes("private.put_event_clip")) throw new Error("connection lost");
        return real.query<T>(text, params);
      },
    };
    const failingApi = Object.assign(Object.create(Object.getPrototypeOf(api)) as TestApi, api, { db: failing });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await failingApi.call(putEventClip, {
      token: organiser.token,
      params: { eventId: draft.eventId },
      body: { uploadId, description: DESCRIPTION, rightsConfirmed: true },
      method: "PUT",
    });
    error.mockRestore();
    expect(res.status).toBe(500);
    await failingApi.runDeferred();
    expect(storage().count("remove")).toBe(0);
    expect(storage().objects.has(finalClipPath(draft.eventId, uploadId))).toBe(true);
  });

  it("a replay of the attached upload changes nothing (or only the description), with no new copy", async () => {
    const draft = await draftEvent(api, organiser);
    const { uploadId, event } = await withClip(draft.eventId);
    const uploads = storage().count("upload");
    const again = await attach(draft.eventId, { uploadId });
    expect(again.status).toBe(200);
    expect(again.body.clip).toEqual(event.clip);
    expect(again.body.updatedAt).toBe(event.updatedAt);
    const renamed = await attach(draft.eventId, { uploadId, description: "A new description." });
    expect(renamed.status).toBe(200);
    expect(renamed.body.clip).toMatchObject({ description: "A new description.", width: 160, height: 90 });
    expect(renamed.body.clip.url).not.toBe(event.clip?.url);
    expect(storage().count("upload")).toBe(uploads);
    expect(storage().count("download")).toBe(1);
  });

  it("attaches an upload once: claimed before the download, a used one that isn't the clip any more is 410", async () => {
    const draft = await draftEvent(api, organiser);
    const first = await withClip(draft.eventId);
    expect(await uploadRow(first.uploadId)).toMatchObject({ consumed: true });
    await withClip(draft.eventId, H264_MOV);
    // The first upload again (its staged object put back, as a replaying client can't but an attacker might try).
    storage().put(stagedClipPath(draft.eventId, organiser.userId, first.uploadId), H264);
    const downloads = storage().count("download");
    const res = await attach(draft.eventId, { uploadId: first.uploadId });
    expect(res.status).toBe(410);
    expect(res.body).toEqual({ error: CLIP_MESSAGES.uploadExpired, fieldErrors: { clip: CLIP_MESSAGES.uploadExpired } });
    expect(storage().count("download")).toBe(downloads);
  });

  it("refuses an upload id issued over a day ago: 410", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    await api.db.query(`update private.event_clip_uploads set created_at = now() - interval '25 hours' where id = $1`, [uploadId]);
    expect((await attach(draft.eventId, { uploadId })).status).toBe(410);
    expect(storage().count("info")).toBe(0);
  });

  it("two PUTs of one upload at once: it's checked and written once, and the attached clip's object stays", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    const [a, b] = await Promise.all([attach(draft.eventId, { uploadId }), attach(draft.eventId, { uploadId })]);
    // The loser either lost the claim (410) or, arriving after the winner
    // attached, was a replay of the attached clip (200, nothing processed).
    const statuses = [a.status, b.status].sort();
    expect([
      [200, 200],
      [200, 410],
    ]).toContainEqual(statuses);
    expect(storage().count("download")).toBe(1);
    expect(storage().count("upload")).toBe(1);
    await api.runDeferred();
    const final = finalClipPath(draft.eventId, uploadId);
    expect((await clipRow(draft.eventId)).object_path).toBe(final);
    expect(storage().objects.has(final)).toBe(true);
    // A later replay is still the description-only no-op.
    const again = await attach(draft.eventId, { uploadId, description: "Later words." });
    expect(again.status).toBe(200);
    expect(again.body.clip.description).toBe("Later words.");
    expect(storage().objects.has(final)).toBe(true);
  });

  it("429 past 20 checked uploads a day, per account", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'event_clip_attaches', now(), $2)`,
      [organiser.userId, CLIP_ATTACH_RATE_LIMIT.hits],
    );
    const res = await attach(draft.eventId, { uploadId });
    expect(res.status).toBe(429);
    expect(res.body.fieldErrors).toEqual({ clip: CLIP_MESSAGES.rateLimited });
    expect(await uploadRow(uploadId)).toMatchObject({ consumed: false });
    expect(storage().count("info")).toBe(0);
    // Description changes aren't counted.
    await api.db.query(`delete from private.rate_limits`);
    await attach(draft.eventId, { uploadId });
    await api.db.query(`update private.rate_limits set hits = $1 where bucket = 'event_clip_attaches'`, [CLIP_ATTACH_RATE_LIMIT.hits + 1]);
    expect((await attach(draft.eventId, { description: "New words." })).status).toBe(200);
  });

  it("with uploads switched off: 503 for an upload (organiser and admin), description changes still work", async () => {
    const draft = await draftEvent(api, organiser);
    const { uploadId } = await withClip(draft.eventId);
    const pending = await uploaded(draft.eventId);
    const infos = storage().count("info");
    vi.stubEnv("NEXT_PUBLIC_EVENT_CLIPS", "");
    for (const id of [pending, uploadId]) {
      const res = await attach(draft.eventId, { uploadId: id });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: CLIP_MESSAGES.unavailable, fieldErrors: { clip: CLIP_MESSAGES.unavailable } });
    }
    const adminRes = await attach(draft.eventId, { uploadId: pending }, admin.token, adminPutEventClip);
    expect(adminRes.status).toBe(503);
    expect(await uploadRow(pending)).toMatchObject({ consumed: false });
    expect(storage().count("info")).toBe(infos);

    expect((await attach(draft.eventId, { description: "Words, uploads off." })).body.clip.description).toBe("Words, uploads off.");
    expect(
      (await attach(draft.eventId, { description: "Admin words, uploads off." }, admin.token, adminPutEventClip)).status,
    ).toBe(200);
    expect((await api.call(getEventClipPreview, { token: organiser.token, params: { eventId: draft.eventId } })).status).toBe(200);
    expect((await remove(draft.eventId)).status).toBe(200);
  });

  it("replacing a clip deletes the old object after the response", async () => {
    const draft = await draftEvent(api, organiser);
    const first = await withClip(draft.eventId);
    const second = await withClip(draft.eventId, H264_MOV);
    expect(second.event.clip?.url).not.toBe(first.event.clip?.url);
    expect(storage().objects.has(finalClipPath(draft.eventId, first.uploadId))).toBe(false);
    expect(storage().objects.has(finalClipPath(draft.eventId, second.uploadId))).toBe(true);
    expect((await clipRow(draft.eventId)).object_path).toBe(finalClipPath(draft.eventId, second.uploadId));
  });

  it("without an uploadId, changes only the description (404 with no clip), even without Storage", async () => {
    const draft = await draftEvent(api, organiser);
    const none = await attach(draft.eventId, {});
    expect(none.status).toBe(404);
    expect(none.body.error).toBe("This event has no clip.");
    const { event } = await withClip(draft.eventId);
    api.clipStorage = undefined;
    const res = await attach(draft.eventId, { description: "Just the words changed." });
    expect(res.status).toBe(200);
    expect(res.body.clip).toMatchObject({ description: "Just the words changed.", durationMs: 1000 });
    expect(res.body.clip.url).not.toBe(event.clip?.url);
  });

  it("503 for a new upload without Storage, or when it fails mid-way (nothing attached)", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    const fake = storage();
    api.clipStorage = undefined;
    expect((await attach(draft.eventId, { uploadId })).status).toBe(503);
    api.clipStorage = fake;
    fake.failing.add("download");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await attach(draft.eventId, { uploadId });
    error.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.fieldErrors).toEqual({ clip: CLIP_MESSAGES.unavailable });
    expect(await clipRow(draft.eventId)).toBeUndefined();
    // Storage's failure gives the claim back: the same upload goes through once Storage is back.
    expect(await uploadRow(uploadId)).toMatchObject({ consumed: false });
    fake.failing.delete("download");
    expect((await attach(draft.eventId, { uploadId })).status).toBe(200);
  });

  it("401, 403, 404 and 409 as for the upload URL", async () => {
    const draft = await draftEvent(api, organiser);
    const uploadId = await uploaded(draft.eventId);
    expect((await attach(draft.eventId, { uploadId }, null)).status).toBe(401);
    expect((await attach(draft.eventId, { uploadId }, (await api.signUp()).token)).status).toBe(403);
    expect((await attach(draft.eventId, { uploadId }, (await approvedOrganiser(api, admin)).token)).status).toBe(404);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    expect((await attach(draft.eventId, { uploadId })).status).toBe(409);
    expect(storage().count("info")).toBe(0);
  });
});

describe("DELETE /events/{id}/clip", () => {
  it("removes the clip and its object; a second call is fine", async () => {
    const draft = await draftEvent(api, organiser);
    const { uploadId } = await withClip(draft.eventId);
    const res = await remove(draft.eventId);
    expect(res.status).toBe(200);
    expect(res.body.clip).toBeUndefined();
    expect("clip" in res.body).toBe(false);
    await api.runDeferred();
    expect(storage().objects.has(finalClipPath(draft.eventId, uploadId))).toBe(false);
    const again = await remove(draft.eventId);
    expect(again.status).toBe(200);
  });

  it("works without Storage (the object waits for the sweep); 409 once published; 404 not theirs", async () => {
    const draft = await draftEvent(api, organiser);
    await withClip(draft.eventId);
    api.clipStorage = undefined;
    expect((await remove(draft.eventId)).status).toBe(200);
    expect(await clipRow(draft.eventId)).toBeUndefined();
    const published = await publishedEvent(api, organiser, admin);
    const locked = await remove(published.eventId);
    expect(locked.status).toBe(409);
    expect(locked.body.fieldErrors).toEqual({ clip: CLIP_MESSAGES.removeLocked });
    expect((await remove(draft.eventId, (await approvedOrganiser(api, admin)).token)).status).toBe(404);
  });
});

describe("admin clip routes", () => {
  it("attaches to a published event, logged with the versions and reason; the organiser sees the Sheltüh team", async () => {
    const published = await publishedEvent(api, organiser, admin);
    const uploadId = await uploaded(published.eventId, H264, admin, adminCreateClipUpload);
    const res = await attach(published.eventId, { uploadId, reason: "Organiser sent it by email." }, admin.token, adminPutEventClip);
    expect(res.status).toBe(200);
    const event = res.body as AdminEventRecord;
    expect(event.organiserPlatformManaged).toBe(false);
    const version = new URL(event.clip!.url, SITE_URL).searchParams.get("v");
    const entry = event.moderationLog.at(-1);
    expect(entry).toMatchObject({
      action: "edited",
      by: admin.userId,
      reason: "Organiser sent it by email.",
      changes: { clip: { old: null, new: version }, clipDescription: { old: null, new: DESCRIPTION } },
    });
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: published.eventId } });
    expect(mine.body.moderationLog.at(-1)).toMatchObject({ action: "edited", by: SHELTUH_TEAM_ACTOR });
  });

  it("removes with an optional reason, logged; 401 / 403 / 404", async () => {
    const published = await publishedEvent(api, organiser, admin);
    const uploadId = await uploaded(published.eventId, H264, admin, adminCreateClipUpload);
    await attach(published.eventId, { uploadId }, admin.token, adminPutEventClip);
    const res = await remove(published.eventId, admin.token, adminDeleteEventClip, { reason: "Rights complaint." });
    expect(res.status).toBe(200);
    expect(res.body.moderationLog.at(-1)).toMatchObject({ action: "edited", reason: "Rights complaint.", changes: { clip: { new: null } } });
    expect((await remove(published.eventId, null, adminDeleteEventClip)).status).toBe(401);
    expect((await remove(published.eventId, organiser.token, adminDeleteEventClip)).status).toBe(403);
    expect((await remove(crypto.randomUUID(), admin.token, adminDeleteEventClip)).status).toBe(404);
    expect((await requestUpload(crypto.randomUUID(), admin.token, undefined, adminCreateClipUpload)).status).toBe(404);
    expect((await requestUpload(published.eventId, organiser.token, undefined, adminCreateClipUpload)).status).toBe(403);
  });

  it("an admin's save from before a clip change is stale (409)", async () => {
    const published = await publishedEvent(api, organiser, admin);
    const opened = published.updatedAt;
    const uploadId = await uploaded(published.eventId, H264, admin, adminCreateClipUpload);
    await attach(published.eventId, { uploadId }, admin.token, adminPutEventClip);
    const res = await api.call(adminUpdateEvent, {
      token: admin.token,
      params: { eventId: published.eventId },
      body: { ...eventInput(), ticketTypes: published.ticketTypes, ticketingMode: "sheltuh", expectedUpdatedAt: opened },
      method: "PATCH",
    });
    expect(res.status).toBe(409);
  });
});

describe("GET /events/{id}/clip", () => {
  it("redirects a published event's clip to a 1-hour signed URL, cached 5 minutes", async () => {
    const draft = await draftEvent(api, organiser);
    const { uploadId } = await withClip(draft.eventId);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    const { adminApproveEvent } = await import("@/lib/server/handlers/admin");
    await api.call(adminApproveEvent, { token: admin.token, params: { eventId: draft.eventId }, method: "POST" });

    const res = await getClip(draft.eventId);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).origin).toBe(FAKE_STORAGE_ORIGIN);
    expect(res.headers.get("location")).toBe(
      `${FAKE_STORAGE_ORIGIN}/storage/v1/object/sign/event-clips/${finalClipPath(draft.eventId, uploadId)}?token=signed-${CLIP_URL_LIFETIME_SECONDS}`,
    );
    expect(res.headers.get("cache-control")).toBe(CLIP_REDIRECT_CACHE_CONTROL);
    expect(CLIP_REDIRECT_CACHE_CONTROL).toBe("public, max-age=300, s-maxage=300");

    // The public shape carries it.
    const listed = await api.call(listPublicEvents);
    expect(listed.body.items[0].clip).toMatchObject({ durationMs: 1000, width: 160, height: 90, description: DESCRIPTION });
    const bySlug = await api.call(getPublicEventBySlug, { params: { slug: draft.slug } });
    expect(bySlug.body.clip.url).toMatch(new RegExp(`^/api/events/${draft.eventId}/clip\\?v=\\d+$`));

    // After an unpublish: 404 for everyone.
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: draft.eventId }, body: { reason: "Takedown." } });
    expect((await getClip(draft.eventId)).status).toBe(404);
  });

  it("307s any other `v` (or none) to the current version, uncached, without signing anything", async () => {
    const published = await publishedEvent(api, organiser, admin);
    const uploadId = await uploaded(published.eventId, H264, admin, adminCreateClipUpload);
    const attached = await attach(published.eventId, { uploadId }, admin.token, adminPutEventClip);
    const current = await clipVersion(published.eventId);
    expect(attached.body.clip.url).toBe(`/api/events/${published.eventId}/clip?v=${current}`);
    const signs = storage().count("createSignedUrl");
    for (const v of ["1", String(Number(current) - 1), `${current}0`, "random", "", null]) {
      const res = await getClip(published.eventId, undefined, v);
      expect(res.status, String(v)).toBe(307);
      expect(res.headers.get("location")).toBe(`${SITE_URL}/api/events/${published.eventId}/clip?v=${current}`);
      expect(res.headers.get("cache-control")).toBe(CLIP_STALE_REDIRECT_CACHE_CONTROL);
    }
    expect(CLIP_STALE_REDIRECT_CACHE_CONTROL).toBe("no-store");
    // Other query parameters don't survive the redirect.
    const extra = await api.send(
      getEventClip,
      new Request(`${SITE_URL}/api/events/${published.eventId}/clip?v=1&cb=${crypto.randomUUID()}`),
      { eventId: published.eventId },
    );
    expect(extra.headers.get("location")).toBe(`${SITE_URL}/api/events/${published.eventId}/clip?v=${current}`);
    expect(storage().count("createSignedUrl")).toBe(signs);
    // The current one: the signed redirect.
    expect((await getClip(published.eventId)).status).toBe(302);
    // After a description change the old version redirects to the new one.
    await attach(published.eventId, { description: "New words." }, admin.token, adminPutEventClip);
    const moved = await getClip(published.eventId, undefined, current);
    expect(moved.status).toBe(307);
    expect(moved.headers.get("location")).toBe(`${SITE_URL}/api/events/${published.eventId}/clip?v=${await clipVersion(published.eventId)}`);
  });

  it("404 for a draft (whoever asks), no clip, or not an id; 503 without Storage", async () => {
    const draft = await draftEvent(api, organiser);
    await withClip(draft.eventId);
    expect((await getClip(draft.eventId)).status).toBe(404);
    expect((await getClip(draft.eventId, organiser.token)).status).toBe(404);
    expect((await getClip(crypto.randomUUID())).status).toBe(404);
    expect((await getClip("nope")).status).toBe(404);
    const published = await publishedEvent(api, organiser, admin);
    expect((await getClip(published.eventId)).status).toBe(404);
    // An event with no clip has no `clip` field at all.
    const bySlug = await api.call(getPublicEventBySlug, { params: { slug: published.slug } });
    expect("clip" in bySlug.body).toBe(false);
    await api.db.query(
      `insert into private.event_clips (event_id, object_path, size_bytes, duration_ms, width, height, description, rights_confirmed_at)
       values ($1, $2, 1000, 1000, 160, 90, 'x', now())`,
      [published.eventId, finalClipPath(published.eventId, crypto.randomUUID())],
    );
    api.clipStorage = undefined;
    expect((await getClip(published.eventId)).status).toBe(503);
  });
});

describe("GET /events/{id}/clip/preview", () => {
  it("gives the owner and an admin a 10-minute URL, privately; anyone else 404", async () => {
    const draft = await draftEvent(api, organiser);
    await withClip(draft.eventId);
    const call = (token?: string) => api.call(getEventClipPreview, { token, params: { eventId: draft.eventId } });
    for (const token of [organiser.token, admin.token]) {
      const before = Date.now();
      const res = await call(token);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.body.url).toContain(`?token=signed-${CLIP_PREVIEW_LIFETIME_SECONDS}`);
      expect(Date.parse(res.body.expiresAt) - before).toBeGreaterThanOrEqual(CLIP_PREVIEW_LIFETIME_SECONDS * 1000 - 1000);
    }
    expect((await call()).status).toBe(401);
    expect((await call((await api.signUp()).token)).status).toBe(404);
    expect((await call((await approvedOrganiser(api, admin)).token)).status).toBe(404);
    const noClip = await draftEvent(api, organiser);
    expect((await api.call(getEventClipPreview, { token: organiser.token, params: { eventId: noClip.eventId } })).status).toBe(404);
  });
});

describe("the sweep", () => {
  async function object(name: string, age: string) {
    await api.db.query(
      `insert into storage.objects (bucket_id, name, created_at) values ('event-clips', $1, now() - $2::interval)`,
      [name, age],
    );
    storage().put(name, Uint8Array.of(1));
  }

  it("deletes stale staged uploads and unreferenced final clips only", async () => {
    const draft = await draftEvent(api, organiser);
    const { uploadId } = await withClip(draft.eventId);
    const kept = finalClipPath(draft.eventId, uploadId);
    await object(kept, "3 days");
    const staleUpload = stagedClipPath(draft.eventId, organiser.userId, crypto.randomUUID());
    const freshUpload = stagedClipPath(draft.eventId, organiser.userId, crypto.randomUUID());
    const orphan = finalClipPath(draft.eventId, crypto.randomUUID());
    const freshOrphan = finalClipPath(draft.eventId, crypto.randomUUID());
    await object(staleUpload, "25 hours");
    await object(freshUpload, "1 hour");
    await object(orphan, "2 days");
    await object(freshOrphan, "10 minutes");
    await object("elsewhere/readme.txt", "30 days");

    expect(await sweepEventClips(api.deps)).toEqual({ removed: 2, uploadIdsPurged: 0 });
    expect(storage().calls.at(-1)).toEqual({ op: "remove", paths: expect.arrayContaining([staleUpload, orphan]) });
    for (const name of [kept, freshUpload, freshOrphan, "elsewhere/readme.txt"]) expect(storage().objects.has(name)).toBe(true);
  });

  it("deletes issued upload ids over a day old, used or not, and only those", async () => {
    const draft = await draftEvent(api, organiser);
    const { uploadId: used } = await withClip(draft.eventId);
    const unused = await uploaded(draft.eventId);
    const fresh = await uploaded(draft.eventId);
    await api.db.query(`update private.event_clip_uploads set created_at = now() - interval '25 hours' where id = any($1::uuid[])`, [
      [used, unused],
    ]);
    expect(await sweepEventClips(api.deps)).toEqual({ removed: 0, uploadIdsPurged: 2 });
    expect(await api.db.query(`select id from private.event_clip_uploads`)).toEqual([{ id: fresh }]);
    // The attached clip's replay doesn't need its row.
    expect((await attach(draft.eventId, { uploadId: used, description: "Replayed later." })).status).toBe(200);
    // Without Storage the rows still go.
    await api.db.query(`update private.event_clip_uploads set created_at = now() - interval '2 days'`);
    api.clipStorage = undefined;
    expect(await sweepEventClips(api.deps)).toEqual({ removed: 0, uploadIdsPurged: 1 });
  });

  it("runs after the trending cron's response, and not at all without Storage", async () => {
    const draft = await draftEvent(api, organiser);
    const stale = stagedClipPath(draft.eventId, organiser.userId, crypto.randomUUID());
    await object(stale, "2 days");
    const cron = () =>
      api.send(runTrendingCron, new Request(`${SITE_URL}/api/cron/trending`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
    const res = await cron();
    expect(res.status).toBe(200);
    expect(storage().objects.has(stale)).toBe(true);
    await api.runDeferred();
    expect(storage().objects.has(stale)).toBe(false);

    api.clipStorage = undefined;
    await cron();
    expect(api.deferred).toEqual([]);
  });
});
