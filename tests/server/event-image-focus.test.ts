import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pgConstraint, pgErrorCode } from "@/lib/server/db";
import { adminGetEvent, adminPatchEventImageFocus, adminPutEventImage } from "@/lib/server/handlers/admin-authoring";
import { deleteEventImage, patchEventImageFocus, putEventImage } from "@/lib/server/handlers/event-images";
import { getMyEvent, submitEventForReview } from "@/lib/server/handlers/events";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import type { Handler } from "@/lib/server/route";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, publishedEvent, setUpPayouts, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/** Photo focus (docs/architecture.md, "Photo focus"; supabase/migrations/20261115000000_event_image_focus.sql). */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

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
  await setUpPayouts(api, organiser.organiserId);
});

function putImage(handler: Handler<{ eventId: string }>, eventId: string, query = "", token = organiser.token) {
  return api.send(
    handler,
    new Request(`${SITE_URL}/api/test${query}`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: PNG }),
    { eventId },
  );
}

function patchFocus(handler: Handler<{ eventId: string }>, eventId: string, body: unknown, token = organiser.token) {
  return api.call(handler, { token, params: { eventId }, method: "PATCH", body });
}

async function focusRow(eventId: string) {
  const [row] = await api.db.query<{ focus_x: number | null; focus_y: number | null }>(
    `select focus_x, focus_y from public.event_images where event_id = $1`,
    [eventId],
  );
  return row;
}

describe("organiser photo focus", () => {
  it("saves the focus with the photo and returns it on the event", async () => {
    const draft = await draftEvent(api, organiser);
    expect(draft.imageFocus).toBeUndefined();
    const res = await putImage(putEventImage, draft.eventId, "?fx=20&fy=35");
    expect(res.status).toBe(200);
    expect(res.body.imageFocus).toEqual({ x: 20, y: 35 });
    expect(await focusRow(draft.eventId)).toEqual({ focus_x: 20, focus_y: 35 });
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: draft.eventId } });
    expect(mine.body.imageFocus).toEqual({ x: 20, y: 35 });
  });

  it("uploads with no focus as none, and accepts the bounds 0 and 100", async () => {
    const draft = await draftEvent(api, organiser);
    expect((await putImage(putEventImage, draft.eventId)).body.imageFocus).toBeUndefined();
    const edge = await putImage(putEventImage, draft.eventId, "?fx=0&fy=100");
    expect(edge.body.imageFocus).toEqual({ x: 0, y: 100 });
  });

  it.each([
    ["one without the other", "?fx=10"],
    ["one without the other (y)", "?fy=10"],
    ["over 100", "?fx=101&fy=10"],
    ["negative", "?fx=-1&fy=10"],
    ["a fraction", "?fx=1.5&fy=10"],
    ["not a number", "?fx=abc&fy=10"],
    ["empty", "?fx=&fy="],
  ])("refuses a bad focus on upload (%s) and writes nothing", async (_name, query) => {
    const draft = await draftEvent(api, organiser);
    const res = await putImage(putEventImage, draft.eventId, query);
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.imageFocus).toBeDefined();
    expect(await focusRow(draft.eventId)).toBeUndefined();
  });

  it("moves and clears the focus of the saved photo without changing its version", async () => {
    const draft = await draftEvent(api, organiser);
    const put = await putImage(putEventImage, draft.eventId, "?fx=10&fy=10");
    const moved = await patchFocus(patchEventImageFocus, draft.eventId, { focus: { x: 80, y: 25 } });
    expect(moved.status).toBe(200);
    expect(moved.body.imageFocus).toEqual({ x: 80, y: 25 });
    expect(moved.body.imageUrl).toBe(put.body.imageUrl);
    // A new version of the event, though.
    expect(Date.parse(moved.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(put.body.updatedAt));
    const cleared = await patchFocus(patchEventImageFocus, draft.eventId, { focus: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.imageFocus).toBeUndefined();
    expect(await focusRow(draft.eventId)).toEqual({ focus_x: null, focus_y: null });
  });

  it("resets the focus when the photo is replaced without one, and drops it with the photo", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId, "?fx=10&fy=10");
    const replaced = await putImage(putEventImage, draft.eventId);
    expect(replaced.body.imageFocus).toBeUndefined();
    expect(await focusRow(draft.eventId)).toEqual({ focus_x: null, focus_y: null });

    await putImage(putEventImage, draft.eventId, "?fx=60&fy=40");
    const del = await api.call(deleteEventImage, { token: organiser.token, params: { eventId: draft.eventId }, method: "DELETE" });
    expect(del.body.imageFocus).toBeUndefined();
    expect(await focusRow(draft.eventId)).toBeUndefined();
    // A new photo after the delete doesn't inherit it.
    expect((await putImage(putEventImage, draft.eventId)).body.imageFocus).toBeUndefined();
  });

  it.each([
    ["no focus key", {}],
    ["a string", { focus: "50,50" }],
    ["an array", { focus: [1, 2] }],
    ["only x", { focus: { x: 5 } }],
    ["a fraction", { focus: { x: 5.5, y: 5 } }],
    ["out of range", { focus: { x: 5, y: 120 } }],
    ["numbers as strings", { focus: { x: "5", y: "5" } }],
  ])("refuses a bad focus body (%s)", async (_name, body) => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId, "?fx=1&fy=2");
    const res = await patchFocus(patchEventImageFocus, draft.eventId, body);
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.imageFocus).toBeDefined();
    expect(await focusRow(draft.eventId)).toEqual({ focus_x: 1, focus_y: 2 });
  });

  it("is 409 with no photo, 401 without a token, and 404 for someone else's event", async () => {
    const draft = await draftEvent(api, organiser);
    const noPhoto = await patchFocus(patchEventImageFocus, draft.eventId, { focus: { x: 1, y: 1 } });
    expect(noPhoto.status).toBe(409);
    await putImage(putEventImage, draft.eventId, "?fx=1&fy=1");

    const anon = await api.call(patchEventImageFocus, { params: { eventId: draft.eventId }, method: "PATCH", body: { focus: null } });
    expect(anon.status).toBe(401);

    const other = await approvedOrganiser(api, admin, { contactEmail: "other-org@example.com", displayName: "Other Org" });
    const stranger = await patchFocus(patchEventImageFocus, draft.eventId, { focus: { x: 9, y: 9 } }, other.token);
    expect(stranger.status).toBe(404);
    const strangerPut = await putImage(putEventImage, draft.eventId, "?fx=9&fy=9", other.token);
    expect(strangerPut.status).toBe(404);
    expect(await focusRow(draft.eventId)).toEqual({ focus_x: 1, focus_y: 1 });
  });

  it("is locked while the event is pending review (409), for the upload and the focus alike", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId, "?fx=1&fy=1");
    const submitted = await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    expect(submitted.status).toBe(200);
    expect((await patchFocus(patchEventImageFocus, draft.eventId, { focus: { x: 2, y: 2 } })).status).toBe(409);
    expect((await putImage(putEventImage, draft.eventId, "?fx=2&fy=2")).status).toBe(409);
    expect(await focusRow(draft.eventId)).toEqual({ focus_x: 1, focus_y: 1 });
  });
});

describe("public payload", () => {
  it("carries imageFocus on a published event (list and slug), and omits it without one", async () => {
    const withFocus = await publishedEvent(api, organiser, admin, { title: "Focused night" });
    expect((await putImage(adminPutEventImage, withFocus.eventId, "?fx=70&fy=30", admin.token)).status).toBe(200);
    const plain = await publishedEvent(api, organiser, admin, { title: "Plain night" });
    await putImage(adminPutEventImage, plain.eventId, "", admin.token);

    const bySlug = await api.call(getPublicEventBySlug, { params: { slug: withFocus.slug } });
    expect(bySlug.body.imageFocus).toEqual({ x: 70, y: 30 });
    expect(Object.keys(bySlug.body.imageFocus)).toEqual(["x", "y"]);
    const plainBySlug = await api.call(getPublicEventBySlug, { params: { slug: plain.slug } });
    expect("imageFocus" in plainBySlug.body).toBe(false);

    const list = await api.call(listPublicEvents);
    const items = list.body.items as { eventId: string; imageFocus?: unknown }[];
    expect(items.find((e) => e.eventId === withFocus.eventId)?.imageFocus).toEqual({ x: 70, y: 30 });
    expect(items.find((e) => e.eventId === plain.eventId)).not.toHaveProperty("imageFocus");
  });
});

describe("admin photo focus", () => {
  it("sets, moves and clears the focus on a published event, logging each change (and nothing when unchanged)", async () => {
    const event = await publishedEvent(api, organiser, admin);
    expect((await patchFocus(adminPatchEventImageFocus, event.eventId, { focus: { x: 1, y: 1 } }, admin.token)).status).toBe(409);

    const put = await putImage(adminPutEventImage, event.eventId, "?fx=10&fy=20", admin.token);
    expect(put.status).toBe(200);
    expect(put.body.imageFocus).toEqual({ x: 10, y: 20 });
    const moved = await patchFocus(adminPatchEventImageFocus, event.eventId, { focus: { x: 90, y: 5 } }, admin.token);
    expect(moved.body.imageFocus).toEqual({ x: 90, y: 5 });
    expect(moved.body.imageUrl).toBe(put.body.imageUrl);
    await patchFocus(adminPatchEventImageFocus, event.eventId, { focus: { x: 90, y: 5 } }, admin.token); // unchanged
    const cleared = await patchFocus(adminPatchEventImageFocus, event.eventId, { focus: null }, admin.token);
    expect(cleared.body.imageFocus).toBeUndefined();
    // A replacement with no focus after a set one resets it, and says so.
    await putImage(adminPutEventImage, event.eventId, "?fx=3&fy=4", admin.token);
    await putImage(adminPutEventImage, event.eventId, "", admin.token);

    const after = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    expect(after.status).toBe("published");
    expect(
      after.moderationLog.filter((l: { action: string }) => l.action === "edited").map((l: { changes: unknown }) => l.changes),
    ).toEqual([
      { image: { old: null, new: "set" }, imageFocus: { old: null, new: { x: 10, y: 20 } } },
      { imageFocus: { old: { x: 10, y: 20 }, new: { x: 90, y: 5 } } },
      { imageFocus: { old: { x: 90, y: 5 }, new: null } },
      { image: { old: "set", new: "set" }, imageFocus: { old: null, new: { x: 3, y: 4 } } },
      { image: { old: "set", new: "set" }, imageFocus: { old: { x: 3, y: 4 }, new: null } },
    ]);
  });

  it("requires an admin (401, 403), 404 for an unknown event, and 400 for a bad focus", async () => {
    const event = await publishedEvent(api, organiser, admin);
    await putImage(adminPutEventImage, event.eventId, "?fx=10&fy=20", admin.token);
    const body = { focus: { x: 5, y: 5 } };
    expect((await api.call(adminPatchEventImageFocus, { params: { eventId: event.eventId }, method: "PATCH", body })).status).toBe(401);
    expect((await patchFocus(adminPatchEventImageFocus, event.eventId, body, organiser.token)).status).toBe(403);
    expect((await patchFocus(adminPatchEventImageFocus, crypto.randomUUID(), body, admin.token)).status).toBe(404);
    expect((await patchFocus(adminPatchEventImageFocus, "not-a-uuid", body, admin.token)).status).toBe(404);
    const bad = await patchFocus(adminPatchEventImageFocus, event.eventId, { focus: { x: 5, y: 101 } }, admin.token);
    expect(bad.status).toBe(400);
    expect(bad.body.fieldErrors.imageFocus).toBeDefined();
    expect((await putImage(adminPutEventImage, event.eventId, "?fx=5", admin.token)).status).toBe(400);
    expect(await focusRow(event.eventId)).toEqual({ focus_x: 10, focus_y: 20 });
  });

  it("the organiser sees the admin's focus change in the event's log as the Sheltüh team", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId, "", organiser.token);
    await patchFocus(adminPatchEventImageFocus, draft.eventId, { focus: { x: 40, y: 60 } }, admin.token);
    const mine = (await api.call(getMyEvent, { token: organiser.token, params: { eventId: draft.eventId } })).body;
    const edited = mine.moderationLog.filter((l: { action: string }) => l.action === "edited");
    expect(edited).toHaveLength(1);
    expect(edited[0].changes).toEqual({ imageFocus: { old: null, new: { x: 40, y: 60 } } });
    expect(edited[0].by).toBe("Sheltüh team");
  });
});

describe("database constraint", () => {
  it("allows both or neither, within 0..100", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId);
    const attempt = async (x: number | null, y: number | null) => {
      try {
        await api.db.query(`update public.event_images set focus_x = $2, focus_y = $3 where event_id = $1`, [draft.eventId, x, y]);
        return null;
      } catch (err) {
        return { code: pgErrorCode(err), constraint: pgConstraint(err) };
      }
    };
    const violation = { code: "23514", constraint: "event_images_focus_check" };
    expect(await attempt(10, null)).toEqual(violation);
    expect(await attempt(null, 10)).toEqual(violation);
    expect(await attempt(101, 10)).toEqual(violation);
    expect(await attempt(10, -1)).toEqual(violation);
    expect(await attempt(0, 100)).toBeNull();
    expect(await attempt(null, null)).toBeNull();
  });
});
