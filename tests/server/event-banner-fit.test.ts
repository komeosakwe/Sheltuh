import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pgConstraint, pgErrorCode } from "@/lib/server/db";
import { adminRejectEvent } from "@/lib/server/handlers/admin";
import { adminDeleteEventImage, adminGetEvent, adminPatchEventImageFocus, adminPutEventImage } from "@/lib/server/handlers/admin-authoring";
import { deleteEventImage, patchEventImageFocus, putEventImage } from "@/lib/server/handlers/event-images";
import { getMyEvent, submitEventForReview } from "@/lib/server/handlers/events";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { getTrendingEvents } from "@/lib/server/handlers/trending";
import type { Handler } from "@/lib/server/route";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, publishedEvent, setUpPayouts, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * The home banner's photo fit (docs/architecture.md, "Photo focus", its banner
 * fit; supabase/migrations/20261129000000_event_banner_fit.sql). The
 * focus-only behaviour of the same routes is tests/server/event-image-focus.test.ts.
 */

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

function patchDisplay(handler: Handler<{ eventId: string }>, eventId: string, body: unknown, token = organiser.token) {
  return api.call(handler, { token, params: { eventId }, method: "PATCH", body });
}

async function imageRow(eventId: string) {
  const [row] = await api.db.query<{ focus_x: number | null; focus_y: number | null; banner_fit: string }>(
    `select focus_x, focus_y, banner_fit from public.event_images where event_id = $1`,
    [eventId],
  );
  return row;
}

async function editedLog(eventId: string) {
  const after = (await api.call(adminGetEvent, { token: admin.token, params: { eventId } })).body;
  return after.moderationLog.filter((l: { action: string }) => l.action === "edited").map((l: { changes: unknown }) => l.changes);
}

/** The event's updated_at at full precision, as text (the API rounds to the millisecond). */
async function eventVersion(eventId: string): Promise<string> {
  const [row] = await api.db.query<{ v: string }>(`select updated_at::text as v from public.events where id = $1`, [eventId]);
  return row.v;
}

async function bumpedSince(eventId: string, version: string): Promise<boolean> {
  const [row] = await api.db.query<{ bumped: boolean }>(
    `select updated_at > $2::timestamptz as bumped from public.events where id = $1`,
    [eventId, version],
  );
  return row.bumped;
}

describe("organiser banner fit", () => {
  it("sets and resets the fit of a draft's photo, without touching its focus or the photo's version", async () => {
    const draft = await draftEvent(api, organiser);
    const put = await putImage(putEventImage, draft.eventId, "?fx=20&fy=30");
    expect(put.body.bannerFit).toBeUndefined();
    expect(await imageRow(draft.eventId)).toEqual({ focus_x: 20, focus_y: 30, banner_fit: "crop" });
    const before = await eventVersion(draft.eventId);

    const whole = await patchDisplay(patchEventImageFocus, draft.eventId, { bannerFit: "whole" });
    expect(whole.status).toBe(200);
    expect(whole.body.bannerFit).toBe("whole");
    expect(whole.body.imageFocus).toEqual({ x: 20, y: 30 });
    expect(whole.body.imageUrl).toBe(put.body.imageUrl);
    expect(await imageRow(draft.eventId)).toEqual({ focus_x: 20, focus_y: 30, banner_fit: "whole" });
    // A new version of the event (an admin's open editor goes stale), not of the photo.
    expect(await bumpedSince(draft.eventId, before)).toBe(true);
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: draft.eventId } });
    expect(mine.body.bannerFit).toBe("whole");

    const crop = await patchDisplay(patchEventImageFocus, draft.eventId, { bannerFit: "crop" });
    expect(crop.status).toBe(200);
    expect("bannerFit" in crop.body).toBe(false);
    expect(await imageRow(draft.eventId)).toEqual({ focus_x: 20, focus_y: 30, banner_fit: "crop" });
  });

  it("changes the focus and the fit together in one request, and a focus-only body keeps the fit", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId, "?fx=20&fy=30");
    const both = await patchDisplay(patchEventImageFocus, draft.eventId, { focus: { x: 70, y: 10 }, bannerFit: "whole" });
    expect(both.status).toBe(200);
    expect(both.body.imageFocus).toEqual({ x: 70, y: 10 });
    expect(both.body.bannerFit).toBe("whole");

    const cleared = await patchDisplay(patchEventImageFocus, draft.eventId, { focus: null });
    expect(cleared.body.imageFocus).toBeUndefined();
    expect(cleared.body.bannerFit).toBe("whole");
    expect(await imageRow(draft.eventId)).toEqual({ focus_x: null, focus_y: null, banner_fit: "whole" });
  });

  it("refuses the whole body when either part is bad (400), writing nothing", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId, "?fx=1&fy=2");
    const cases: [unknown, string[]][] = [
      [{}, ["imageFocus"]],
      [{ bannerFit: "contain" }, ["bannerFit"]],
      [{ bannerFit: null }, ["bannerFit"]],
      [{ bannerFit: "WHOLE" }, ["bannerFit"]],
      [{ bannerFit: true }, ["bannerFit"]],
      [{ focus: { x: 50, y: 50 }, bannerFit: "stretch" }, ["bannerFit"]],
      [{ focus: { x: 500, y: 50 }, bannerFit: "whole" }, ["imageFocus"]],
      [{ focus: "middle", bannerFit: 1 }, ["bannerFit", "imageFocus"]],
    ];
    for (const [body, fields] of cases) {
      const res = await patchDisplay(patchEventImageFocus, draft.eventId, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(Object.keys(res.body.fieldErrors).sort(), JSON.stringify(body)).toEqual(fields);
    }
    expect(await imageRow(draft.eventId)).toEqual({ focus_x: 1, focus_y: 2, banner_fit: "crop" });
  });

  it("is 409 with no photo, 401 without a token, and 404 for someone else's event", async () => {
    const draft = await draftEvent(api, organiser);
    const noPhoto = await patchDisplay(patchEventImageFocus, draft.eventId, { bannerFit: "whole" });
    expect(noPhoto.status).toBe(409);
    expect(noPhoto.body.error).toBe("Add a photo first.");
    await putImage(putEventImage, draft.eventId);

    const anon = await api.call(patchEventImageFocus, { params: { eventId: draft.eventId }, method: "PATCH", body: { bannerFit: "whole" } });
    expect(anon.status).toBe(401);
    const other = await approvedOrganiser(api, admin, { contactEmail: "other-org@example.com", displayName: "Other Org" });
    expect((await patchDisplay(patchEventImageFocus, draft.eventId, { bannerFit: "whole" }, other.token)).status).toBe(404);
    expect((await patchDisplay(patchEventImageFocus, crypto.randomUUID(), { bannerFit: "whole" })).status).toBe(404);
    expect(await imageRow(draft.eventId)).toMatchObject({ banner_fit: "crop" });
  });

  it("only an admin changes it once the event is pending or published (409); a rejected event is the organiser's again", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId);
    const params = { eventId: draft.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    expect((await patchDisplay(patchEventImageFocus, draft.eventId, { bannerFit: "whole" })).status).toBe(409);

    await api.call(adminRejectEvent, { token: admin.token, params, body: { reason: "Wrong date." } });
    const rejected = await patchDisplay(patchEventImageFocus, draft.eventId, { bannerFit: "whole" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.bannerFit).toBe("whole");

    const published = await publishedEvent(api, organiser, admin, { title: "Live now" });
    await putImage(adminPutEventImage, published.eventId, "", admin.token);
    const locked = await patchDisplay(patchEventImageFocus, published.eventId, { bannerFit: "whole" });
    expect(locked.status).toBe(409);
    expect(await imageRow(published.eventId)).toMatchObject({ banner_fit: "crop" });
  });

  it("keeps the fit when the photo is replaced, and drops it with the photo", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId, "?fx=10&fy=10");
    await patchDisplay(patchEventImageFocus, draft.eventId, { bannerFit: "whole" });

    const replaced = await putImage(putEventImage, draft.eventId);
    expect(replaced.body.bannerFit).toBe("whole");
    // The focus belongs to the old photo and resets; the fit is a choice about the banner and stays.
    expect(await imageRow(draft.eventId)).toEqual({ focus_x: null, focus_y: null, banner_fit: "whole" });
    const byAdmin = await putImage(adminPutEventImage, draft.eventId, "", admin.token);
    expect(byAdmin.body.bannerFit).toBe("whole");

    const del = await api.call(deleteEventImage, { token: organiser.token, params: { eventId: draft.eventId }, method: "DELETE" });
    expect("bannerFit" in del.body).toBe(false);
    expect(await imageRow(draft.eventId)).toBeUndefined();
    const fresh = await putImage(putEventImage, draft.eventId);
    expect(fresh.body.bannerFit).toBeUndefined();
    expect(await imageRow(draft.eventId)).toMatchObject({ banner_fit: "crop" });
  });
});

describe("admin banner fit", () => {
  it("sets it on a published event with the focus or alone, logging each change and nothing when unchanged", async () => {
    const event = await publishedEvent(api, organiser, admin);
    expect((await patchDisplay(adminPatchEventImageFocus, event.eventId, { bannerFit: "whole" }, admin.token)).status).toBe(409);
    const put = await putImage(adminPutEventImage, event.eventId, "?fx=10&fy=20", admin.token);
    const before = await eventVersion(event.eventId);

    const whole = await patchDisplay(adminPatchEventImageFocus, event.eventId, { bannerFit: "whole" }, admin.token);
    expect(whole.status).toBe(200);
    expect(whole.body.status).toBe("published");
    expect(whole.body.bannerFit).toBe("whole");
    expect(whole.body.imageFocus).toEqual({ x: 10, y: 20 });
    expect(whole.body.imageUrl).toBe(put.body.imageUrl);
    expect(await bumpedSince(event.eventId, before)).toBe(true);

    // Unchanged (alone, and with the same focus): nothing written or logged.
    const same = await eventVersion(event.eventId);
    expect((await patchDisplay(adminPatchEventImageFocus, event.eventId, { bannerFit: "whole" }, admin.token)).status).toBe(200);
    await patchDisplay(adminPatchEventImageFocus, event.eventId, { focus: { x: 10, y: 20 }, bannerFit: "whole" }, admin.token);
    expect(await eventVersion(event.eventId)).toBe(same);

    const both = await patchDisplay(adminPatchEventImageFocus, event.eventId, { focus: null, bannerFit: "crop" }, admin.token);
    expect(both.body.imageFocus).toBeUndefined();
    expect("bannerFit" in both.body).toBe(false);
    // Focus only (the editor's older call): the fit is kept, only the focus is logged.
    await patchDisplay(adminPatchEventImageFocus, event.eventId, { bannerFit: "whole" }, admin.token);
    await patchDisplay(adminPatchEventImageFocus, event.eventId, { focus: { x: 5, y: 6 } }, admin.token);
    expect(await imageRow(event.eventId)).toEqual({ focus_x: 5, focus_y: 6, banner_fit: "whole" });

    expect(await editedLog(event.eventId)).toEqual([
      { image: { old: null, new: "set" }, imageFocus: { old: null, new: { x: 10, y: 20 } } },
      { bannerFit: { old: "crop", new: "whole" } },
      { imageFocus: { old: { x: 10, y: 20 }, new: null }, bannerFit: { old: "whole", new: "crop" } },
      { bannerFit: { old: "crop", new: "whole" } },
      { imageFocus: { old: null, new: { x: 5, y: 6 } } },
    ]);
  });

  it("the organiser sees the admin's change in the event's log as the Sheltüh team", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId);
    await patchDisplay(adminPatchEventImageFocus, draft.eventId, { bannerFit: "whole" }, admin.token);
    const mine = (await api.call(getMyEvent, { token: organiser.token, params: { eventId: draft.eventId } })).body;
    expect(mine.bannerFit).toBe("whole");
    const edited = mine.moderationLog.filter((l: { action: string }) => l.action === "edited");
    expect(edited).toHaveLength(1);
    expect(edited[0].changes).toEqual({ bannerFit: { old: "crop", new: "whole" } });
    expect(edited[0].by).toBe("Sheltüh team");
  });

  it("requires an admin (401, 403), 404 for an unknown event, 400 for a bad body", async () => {
    const event = await publishedEvent(api, organiser, admin);
    await putImage(adminPutEventImage, event.eventId, "", admin.token);
    const body = { bannerFit: "whole" };
    expect((await api.call(adminPatchEventImageFocus, { params: { eventId: event.eventId }, method: "PATCH", body })).status).toBe(401);
    expect((await patchDisplay(adminPatchEventImageFocus, event.eventId, body, organiser.token)).status).toBe(403);
    expect((await patchDisplay(adminPatchEventImageFocus, crypto.randomUUID(), body, admin.token)).status).toBe(404);
    expect((await patchDisplay(adminPatchEventImageFocus, "not-a-uuid", body, admin.token)).status).toBe(404);
    const bad = await patchDisplay(adminPatchEventImageFocus, event.eventId, { bannerFit: "cover" }, admin.token);
    expect(bad.status).toBe(400);
    expect(bad.body.fieldErrors).toEqual({ bannerFit: expect.any(String) });
    const neither = await patchDisplay(adminPatchEventImageFocus, event.eventId, {}, admin.token);
    expect(neither.status).toBe(400);
    expect(neither.body.fieldErrors).toEqual({ imageFocus: expect.any(String) });
    expect(await imageRow(event.eventId)).toEqual({ focus_x: null, focus_y: null, banner_fit: "crop" });
    expect(await editedLog(event.eventId)).toEqual([{ image: { old: null, new: "set" } }]);
  });

  it("an admin's delete drops it with the photo, and the next photo starts cropped", async () => {
    const event = await publishedEvent(api, organiser, admin);
    await putImage(adminPutEventImage, event.eventId, "", admin.token);
    await patchDisplay(adminPatchEventImageFocus, event.eventId, { bannerFit: "whole" }, admin.token);
    const deleted = await api.call(adminDeleteEventImage, { token: admin.token, params: { eventId: event.eventId }, method: "DELETE" });
    expect("bannerFit" in deleted.body).toBe(false);
    expect((await putImage(adminPutEventImage, event.eventId, "", admin.token)).body.bannerFit).toBeUndefined();
  });
});

describe("the function, atomically", () => {
  it("rolls the focus back with a bad fit, logging nothing", async () => {
    const event = await publishedEvent(api, organiser, admin);
    await putImage(adminPutEventImage, event.eventId, "?fx=10&fy=20", admin.token);
    let error: unknown;
    try {
      await api.db.query(`select private.admin_set_event_image_display($1, $2, true, 50::smallint, 50::smallint, 'stretch')`, [
        event.eventId,
        admin.userId,
      ]);
    } catch (err) {
      error = err;
    }
    expect({ code: pgErrorCode(error), constraint: pgConstraint(error) }).toEqual({ code: "23514", constraint: "event_images_banner_fit_check" });
    expect(await imageRow(event.eventId)).toEqual({ focus_x: 10, focus_y: 20, banner_fit: "crop" });
    expect(await editedLog(event.eventId)).toHaveLength(1);
  });

  it("returns not_found, no_image, unchanged and updated", async () => {
    const draft = await draftEvent(api, organiser);
    const call = async (eventId: string, fit: string | null) => {
      const [row] = await api.db.query<{ r: string }>(
        `select private.admin_set_event_image_display($1, $2, false, null, null, $3) as r`,
        [eventId, admin.userId, fit],
      );
      return row.r;
    };
    expect(await call(crypto.randomUUID(), "whole")).toBe("not_found");
    expect(await call(draft.eventId, "whole")).toBe("no_image");
    await putImage(putEventImage, draft.eventId);
    expect(await call(draft.eventId, null)).toBe("unchanged");
    expect(await call(draft.eventId, "crop")).toBe("unchanged");
    expect(await call(draft.eventId, "whole")).toBe("updated");
  });
});

describe("public payload", () => {
  it("carries bannerFit only when whole: list, slug and trending", async () => {
    const whole = await publishedEvent(api, organiser, admin, { title: "Whole poster" });
    await putImage(adminPutEventImage, whole.eventId, "", admin.token);
    await patchDisplay(adminPatchEventImageFocus, whole.eventId, { bannerFit: "whole" }, admin.token);
    const cropped = await publishedEvent(api, organiser, admin, { title: "Cropped photo" });
    await putImage(adminPutEventImage, cropped.eventId, "", admin.token);
    const noPhoto = await publishedEvent(api, organiser, admin, { title: "No photo" });

    const bySlug = await api.call(getPublicEventBySlug, { params: { slug: whole.slug } });
    expect(bySlug.body.bannerFit).toBe("whole");
    expect("bannerFit" in (await api.call(getPublicEventBySlug, { params: { slug: cropped.slug } })).body).toBe(false);

    const list = (await api.call(listPublicEvents)).body.items as { eventId: string; bannerFit?: unknown }[];
    expect(list.find((e) => e.eventId === whole.eventId)?.bannerFit).toBe("whole");
    expect(list.find((e) => e.eventId === cropped.eventId)).not.toHaveProperty("bannerFit");
    expect(list.find((e) => e.eventId === noPhoto.eventId)).not.toHaveProperty("bannerFit");

    await api.db.query(
      `insert into private.trending_snapshot (rank, event_id, score, computed_at)
       select row_number() over (order by e.title), e.id, 1, now() from public.events e where e.id = any($1::uuid[])`,
      [[whole.eventId, cropped.eventId, noPhoto.eventId]],
    );
    const trending = (await api.call(getTrendingEvents)).body.items as { event: { eventId: string; bannerFit?: unknown } }[];
    expect(trending).toHaveLength(3);
    expect(trending.find((t) => t.event.eventId === whole.eventId)?.event.bannerFit).toBe("whole");
    expect(trending.find((t) => t.event.eventId === cropped.eventId)?.event).not.toHaveProperty("bannerFit");
    expect(trending.find((t) => t.event.eventId === noPhoto.eventId)?.event).not.toHaveProperty("bannerFit");
  });
});

describe("database constraint", () => {
  it("allows only crop or whole, never null, and defaults to crop", async () => {
    const draft = await draftEvent(api, organiser);
    await putImage(putEventImage, draft.eventId);
    expect(await imageRow(draft.eventId)).toMatchObject({ banner_fit: "crop" });
    const attempt = async (fit: string | null) => {
      try {
        await api.db.query(`update public.event_images set banner_fit = $2 where event_id = $1`, [draft.eventId, fit]);
        return null;
      } catch (err) {
        return { code: pgErrorCode(err), constraint: pgConstraint(err) };
      }
    };
    expect(await attempt("contain")).toEqual({ code: "23514", constraint: "event_images_banner_fit_check" });
    expect(await attempt("")).toEqual({ code: "23514", constraint: "event_images_banner_fit_check" });
    expect((await attempt(null))?.code).toBe("23502");
    expect(await attempt("whole")).toBeNull();
    expect(await attempt("crop")).toBeNull();
  });
});
