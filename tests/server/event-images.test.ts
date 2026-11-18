import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteEventImage,
  EVENT_IMAGE_CACHE,
  EVENT_IMAGE_UNVERSIONED_CACHE,
  getEventImage,
  putEventImage,
} from "@/lib/server/handlers/event-images";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { adminApproveEvent } from "@/lib/server/handlers/admin";
import { adminPutEventImage } from "@/lib/server/handlers/admin-authoring";
import { EVENT_IMAGE_UPLOAD_RATE_LIMIT } from "@/lib/server/event-image";
import { windowSeconds } from "@/lib/server/http";
import { runHandler } from "@/lib/server/route";
import type { Db } from "@/lib/server/db";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, setUpPayouts, signUpAdmin } from "./helpers/fixtures";
import { testPng } from "./helpers/images";
import { createTestDb } from "./helpers/test-db";

const PNG = testPng();
const SITE = "https://sheltuh.test/api/test";

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
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  // Its events have paid tickets (eventInput), which need payouts to be submitted or published.
  await setUpPayouts(api, organiser.organiserId);
});

function put(eventId: string, body: BodyInit, token = organiser.token) {
  return api.send(
    putEventImage,
    new Request(SITE, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body }),
    { eventId },
  );
}

async function getRaw(eventId: string, token?: string, version?: string, extraHeaders: Record<string, string> = {}) {
  const url = version === undefined ? SITE : `${SITE}?v=${encodeURIComponent(version)}`;
  const req = new Request(url, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
  });
  return (await import("@/lib/server/route")).runHandler(getEventImage, req, { eventId }, api.deps);
}

/** The photo as stored: the upload re-encoded (lib/server/event-image.ts), so not the uploaded bytes themselves. */
async function storedBytes(eventId: string): Promise<Uint8Array> {
  const [row] = await api.db.query<{ data: Uint8Array }>(`select data from public.event_images where event_id = $1`, [eventId]);
  return new Uint8Array(row.data);
}

/** A Db that locks the event for review just before the statement containing `trigger` runs. */
function lockingDb(real: Db, eventId: string, trigger: string): Db {
  return {
    async query<T>(text: string, params?: unknown[]) {
      if (text.includes(trigger)) {
        await real.query(`update public.events set status = 'pending_review' where id = $1`, [eventId]);
      }
      return real.query<T>(text, params);
    },
  };
}

describe("event images", () => {
  it("stores an image, exposes a versioned imageUrl, and lets the owner read it back", async () => {
    const draft = await draftEvent(api, organiser);
    expect(draft.imageUrl).toBeUndefined();

    const res = await put(draft.eventId, PNG);
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toMatch(new RegExp(`^/api/events/${draft.eventId}/image\\?v=\\d+$`));

    const read = await getRaw(draft.eventId, organiser.token);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    const served = new Uint8Array(await read.arrayBuffer());
    expect(served).toEqual(await storedBytes(draft.eventId));
    // The same picture, re-encoded server-side.
    const [uploaded, stored] = await Promise.all([sharp(PNG).metadata(), sharp(served).metadata()]);
    expect([stored.format, stored.width, stored.height]).toEqual(["png", uploaded.width, uploaded.height]);
  });

  it("keeps a draft's image private: not anonymous, not other organisers", async () => {
    const draft = await draftEvent(api, organiser);
    await put(draft.eventId, PNG);
    // Same answer as for an image that doesn't exist — nothing to learn from probing.
    expect((await getRaw(draft.eventId)).status).toBe(404);
    expect((await getRaw(crypto.randomUUID())).status).toBe(404);
    const other = await api.signUp();
    expect((await getRaw(draft.eventId, other.token)).status).toBe(404);
    expect((await getRaw(draft.eventId, admin.token)).status).toBe(200);
  });

  it("serves a published event's image publicly; shared at the CDN only at its current version, for an hour", async () => {
    const draft = await draftEvent(api, organiser);
    await put(draft.eventId, PNG);
    const params = { eventId: draft.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    const approved = await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
    const version = new URL(approved.body.imageUrl, SITE).searchParams.get("v")!;
    expect(version).toMatch(/^\d+$/);

    // At the URL the API gives out: an hour at the CDN, and max-age as long
    // so a CDN copy isn't stale on arrival (a takedown is gone within about
    // an hour; never `immutable`).
    expect(EVENT_IMAGE_CACHE).toBe("public, max-age=3600, s-maxage=3600");
    const current = await getRaw(draft.eventId, undefined, version);
    expect(current.status).toBe(200);
    expect(current.headers.get("cache-control")).toBe(EVENT_IMAGE_CACHE);
    expect(current.headers.get("etag")).toBe(`"${version}"`);
    expect(current.headers.get("last-modified")).toBe(new Date(Number(version) * 1000).toUTCString());
    expect(new Uint8Array(await current.arrayBuffer())).toEqual(await storedBytes(draft.eventId));
    // The same for a signed-in caller: nothing in it depends on who asks.
    const signedIn = await getRaw(draft.eventId, organiser.token, version);
    expect(signedIn.headers.get("cache-control")).toBe(EVENT_IMAGE_CACHE);

    // Any other `v` (none, an old one, a guessed future one) still gets the
    // current image, but for the browser only: never shared under a URL that
    // could outlive a replacement.
    expect(EVENT_IMAGE_UNVERSIONED_CACHE).toBe("private, max-age=3600");
    for (const v of [undefined, "", String(Number(version) - 1), String(Number(version) + 60), `${version}x`]) {
      const res = await getRaw(draft.eventId, undefined, v);
      expect([v, res.status, res.headers.get("cache-control")]).toEqual([v, 200, EVENT_IMAGE_UNVERSIONED_CACHE]);
    }

    // A matching If-None-Match: 304, no body, the same cache header and ETag
    // as the 200 it stands for (shared only at the current `v`).
    const etag = { "if-none-match": `"${version}"` };
    const notModified = await getRaw(draft.eventId, undefined, version, etag);
    expect([notModified.status, notModified.headers.get("cache-control"), notModified.headers.get("etag")]).toEqual([
      304,
      EVENT_IMAGE_CACHE,
      `"${version}"`,
    ]);
    expect((await notModified.arrayBuffer()).byteLength).toBe(0);
    const notModifiedUnversioned = await getRaw(draft.eventId, undefined, undefined, etag);
    expect([notModifiedUnversioned.status, notModifiedUnversioned.headers.get("cache-control")]).toEqual([
      304,
      EVENT_IMAGE_UNVERSIONED_CACHE,
    ]);
    // An old version's ETag, a weak or listed one, or garbage: the image.
    for (const header of [`"${Number(version) - 1}"`, `W/"${version}"`, `"${version}", "1"`, "*", version]) {
      const res = await getRaw(draft.eventId, undefined, version, { "if-none-match": header });
      expect([header, res.status]).toEqual([header, 200]);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(await storedBytes(draft.eventId));
    }

    // Unpublished again: private, whatever `v` says, and only for the owner or an admin.
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [draft.eventId]);
    expect((await getRaw(draft.eventId, undefined, version)).status).toBe(404);
    // A matching ETag doesn't get round the access check either.
    expect((await getRaw(draft.eventId, undefined, version, etag)).status).toBe(404);
    const owner = await getRaw(draft.eventId, organiser.token, version);
    expect([owner.status, owner.headers.get("cache-control")]).toEqual([200, "private, no-store"]);
    const ownerNotModified = await getRaw(draft.eventId, organiser.token, version, etag);
    expect([ownerNotModified.status, ownerNotModified.headers.get("cache-control")]).toEqual([304, "private, no-store"]);
  });

  it("rejects non-images (by content, not by declared type) and oversized files", async () => {
    const draft = await draftEvent(api, organiser);
    const text = await put(draft.eventId, new TextEncoder().encode("<script>alert(1)</script>"));
    expect(text.status).toBe(400);
    expect(text.body.fieldErrors.image).toBeDefined();

    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await put(draft.eventId, big)).status).toBe(413);
  });

  it("can replace and delete an image, but not once the event is locked", async () => {
    const draft = await draftEvent(api, organiser);
    const params = { eventId: draft.eventId };
    await put(draft.eventId, PNG);
    expect((await put(draft.eventId, PNG)).status).toBe(200);

    const removed = await api.call(deleteEventImage, { token: organiser.token, params, method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(removed.body.imageUrl).toBeUndefined();
    expect((await getRaw(draft.eventId, organiser.token)).status).toBe(404);

    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    expect((await put(draft.eventId, PNG)).status).toBe(409);
  });

  it("won't let another organiser upload to someone else's event", async () => {
    const draft = await draftEvent(api, organiser);
    const other = await approvedOrganiser(api, admin, { contactEmail: "other@example.com", displayName: "Other" });
    expect((await put(draft.eventId, PNG, other.token)).status).toBe(404);
  });

  it("counts bytes as it reads: an endless upload with no Content-Length is cut off, not buffered", async () => {
    const draft = await draftEvent(api, organiser);
    const chunk = new Uint8Array(512 * 1024);
    chunk.set(PNG);
    // Never closes. Reading it to the end (as `await req.arrayBuffer()` would) never finishes.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "PUT",
      headers: { authorization: `Bearer ${organiser.token}` },
      body,
      duplex: "half", // Node's fetch needs this for streamed request bodies
    };
    const req = new Request(SITE, init);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await api.send(putEventImage, req, { eventId: draft.eventId });
    expect(res.status).toBe(413);
  }, 10_000);

  it("refuses an upload that lands after the event was locked for review (no unreviewed image on a live event)", async () => {
    const draft = await draftEvent(api, organiser);
    // The event passes the up-front "is it editable?" check, then is submitted
    // while the request is still in flight — modelled by locking it just before
    // the image write runs.
    const racingDb = lockingDb(api.db, draft.eventId, "insert into public.event_images");
    const req = new Request(SITE, {
      method: "PUT",
      headers: { authorization: `Bearer ${organiser.token}` },
      body: PNG,
    });
    const res = await runHandler(putEventImage, req, { eventId: draft.eventId }, { ...api.deps, db: racingDb });
    expect(res.status).toBe(409);
    const [{ n }] = await api.db.query<{ n: string }>(`select count(*)::text as n from public.event_images`);
    expect(n).toBe("0");
  });

  it(`allows ${EVENT_IMAGE_UPLOAD_RATE_LIMIT.hits} uploads a day per organiser account: the next is a 429 with Retry-After, and nothing is written`, async () => {
    const first = await draftEvent(api, organiser);
    const second = await draftEvent(api, organiser);
    // All but one of the day's uploads already used.
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'event_image_uploads', now(), $2)`,
      [organiser.userId, EVENT_IMAGE_UPLOAD_RATE_LIMIT.hits - 1],
    );
    expect((await put(first.eventId, PNG)).status).toBe(200);
    const before = await storedBytes(first.eventId);

    // Over the limit: refused whichever event it's for, with nothing stored or replaced.
    for (const eventId of [second.eventId, first.eventId]) {
      const res = await put(eventId, testPng(1));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe(String(windowSeconds(EVENT_IMAGE_UPLOAD_RATE_LIMIT.window)));
    }
    expect(await api.db.query(`select 1 from public.event_images where event_id = $1`, [second.eventId])).toEqual([]);
    expect(await storedBytes(first.eventId)).toEqual(before);
  });

  it("doesn't limit an admin's uploads, even on an organiser whose allowance is used up", async () => {
    const draft = await draftEvent(api, organiser);
    for (const userId of [organiser.userId, admin.userId]) {
      await api.db.query(
        `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'event_image_uploads', now(), $2)`,
        [userId, EVENT_IMAGE_UPLOAD_RATE_LIMIT.hits],
      );
    }
    expect((await put(draft.eventId, PNG)).status).toBe(429);
    const res = await api.send(
      adminPutEventImage,
      new Request(SITE, { method: "PUT", headers: { authorization: `Bearer ${admin.token}` }, body: PNG }),
      { eventId: draft.eventId },
    );
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toBeDefined();
  });

  it("won't delete an image from an event locked meanwhile", async () => {
    const draft = await draftEvent(api, organiser);
    await put(draft.eventId, PNG);
    const racingDb = lockingDb(api.db, draft.eventId, "delete from public.event_images");
    const req = new Request(SITE, { method: "DELETE", headers: { authorization: `Bearer ${organiser.token}` } });
    const res = await runHandler(deleteEventImage, req, { eventId: draft.eventId }, { ...api.deps, db: racingDb });
    expect(res.status).toBe(409);
    const [{ n }] = await api.db.query<{ n: string }>(`select count(*)::text as n from public.event_images`);
    expect(n).toBe("1");
  });
});
