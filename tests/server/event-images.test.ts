import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteEventImage, getEventImage, putEventImage } from "@/lib/server/handlers/event-images";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { adminApproveEvent } from "@/lib/server/handlers/admin";
import { runHandler } from "@/lib/server/route";
import type { Db } from "@/lib/server/db";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
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
});

function put(eventId: string, body: BodyInit, token = organiser.token) {
  return api.send(
    putEventImage,
    new Request(SITE, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body }),
    { eventId },
  );
}

async function getRaw(eventId: string, token?: string) {
  const req = new Request(SITE, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return (await import("@/lib/server/route")).runHandler(getEventImage, req, { eventId }, api.deps);
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
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);
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

  it("serves a published event's image publicly, cached for a day (not forever, so a takedown takes effect)", async () => {
    const draft = await draftEvent(api, organiser);
    await put(draft.eventId, PNG);
    const params = { eventId: draft.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    const approved = await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
    expect(approved.body.imageUrl).toBeDefined();

    const read = await getRaw(draft.eventId);
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("public, max-age=86400");
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
