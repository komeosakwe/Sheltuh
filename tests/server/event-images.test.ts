import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteEventImage, getEventImage, putEventImage } from "@/lib/server/handlers/event-images";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { adminApproveEvent } from "@/lib/server/handlers/admin";
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
    expect((await getRaw(draft.eventId)).status).toBe(401);
    const other = await api.signUp();
    expect((await getRaw(draft.eventId, other.token)).status).toBe(404);
    expect((await getRaw(draft.eventId, admin.token)).status).toBe(200);
  });

  it("serves a published event's image publicly with long-lived caching", async () => {
    const draft = await draftEvent(api, organiser);
    await put(draft.eventId, PNG);
    const params = { eventId: draft.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    const approved = await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
    expect(approved.body.imageUrl).toBeDefined();

    const read = await getRaw(draft.eventId);
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toContain("immutable");
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
});
