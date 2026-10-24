import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIP_MESSAGES, MAX_CLIP_BYTES } from "@/lib/clip-rules";
import type { Db } from "@/lib/server/db";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import {
  adminCreateClipUpload,
  adminDeleteEventClip,
  adminPutEventClip,
  CLIP_PREVIEW_LIFETIME_SECONDS,
  CLIP_REDIRECT_CACHE_CONTROL,
  CLIP_UPLOAD_RATE_LIMIT,
  CLIP_URL_LIFETIME_SECONDS,
  createClipUpload,
  deleteEventClip,
  finalClipPath,
  getEventClip,
  getEventClipPreview,
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
 * Storage (FakeClipStorage). The SQL functions' own rules, locks and races
 * are in event-clips-migration.test.ts.
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
  await reset();
  await api.db.query(`delete from storage.objects`);
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
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
  const [row] = await api.db.query<{ object_path: string; size_bytes: number; width: number; height: number; description: string }>(
    `select object_path, size_bytes, width, height, description from private.event_clips where event_id = $1`,
    [eventId],
  );
  return row;
}

function getClip(eventId: string, token?: string) {
  return api.send(
    getEventClip,
    new Request(`${SITE_URL}/api/events/${eventId}/clip?v=1`, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
    { eventId },
  );
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

  it("requires a description and the rights confirmation, with the spec's messages", async () => {
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

  it("an event locked while the upload was checked: 409, nothing attached, both copies deleted", async () => {
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
    expect(storage().objects.has(finalClipPath(draft.eventId, uploadId))).toBe(false);
    expect(storage().objects.has(stagedClipPath(draft.eventId, organiser.userId, uploadId))).toBe(false);
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

    expect(await sweepEventClips(api.deps)).toEqual({ removed: 2 });
    expect(storage().calls.at(-1)).toEqual({ op: "remove", paths: expect.arrayContaining([staleUpload, orphan]) });
    for (const name of [kept, freshUpload, freshOrphan, "elsewhere/readme.txt"]) expect(storage().objects.has(name)).toBe(true);
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
