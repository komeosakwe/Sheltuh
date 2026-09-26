import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminApproveEvent,
  adminListEvents,
  adminRejectEvent,
  adminUnpublishEvent,
} from "@/lib/server/handlers/admin";
import {
  createEventDraft,
  getMyEvent,
  listMyEvents,
  submitEventForReview,
  updateEventDraft,
} from "@/lib/server/handlers/events";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import { TestApi } from "./helpers/api";
import { application, approvedOrganiser, draftEvent, eventInput, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

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

describe("event drafts", () => {
  it("only an approved organiser can create one", async () => {
    const pending = await api.signUp();
    await api.call(applyAsOrganiser, { token: pending.token, body: application });
    const res = await api.call(createEventDraft, { token: pending.token, body: eventInput() });
    expect(res.status).toBe(403);
  });

  it("creates a draft owned by the caller's organisation, with ticket types in order", async () => {
    const res = await api.call(createEventDraft, {
      token: organiser.token,
      body: eventInput({
        ticketTypes: [
          { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 5 },
          { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50, description: "Standing" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organiserId: organiser.organiserId,
      organiserName: application.displayName,
      slug: "neon-static",
      status: "draft",
      moderationLog: [],
      // 8pm Melbourne daylight time (UTC+11) on 6 March.
      startsAt: "2027-03-06T09:00:00.000Z",
    });
    expect(res.body.ticketTypes).toEqual([
      { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 5 },
      { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50, description: "Standing" },
    ]);
  });

  it("gives a clashing title a unique slug instead of failing", async () => {
    const first = await draftEvent(api, organiser);
    const second = await draftEvent(api, organiser);
    expect(first.slug).toBe("neon-static");
    expect(second.slug).toMatch(/^neon-static-[0-9a-f]{6}$/);
  });

  it("rejects invalid input with field errors", async () => {
    const res = await api.call(createEventDraft, {
      token: organiser.token,
      body: eventInput({ title: "", end: { date: "2027-03-06", time: "19:00" }, ticketTypes: [] }),
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["end", "ticketTypes", "title"]);
  });

  it("updates a draft, adding, changing and removing ticket types", async () => {
    const draft = await draftEvent(api, organiser);
    const res = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId: draft.eventId },
      method: "PATCH",
      body: eventInput({
        title: "Neon Static II",
        ticketTypes: [{ id: "early", name: "Early bird", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 3 }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Neon Static II");
    expect(res.body.slug).toBe("neon-static"); // slugs are permanent once minted
    expect(res.body.ticketTypes.map((t: { id: string }) => t.id)).toEqual(["early"]);
  });

  it("can't edit another organisation's event — it's a 404, and nothing changes", async () => {
    const other = await approvedOrganiser(api, admin, { displayName: "Paper Moon" });
    const theirs = await draftEvent(api, other);
    const params = { eventId: theirs.eventId };

    const edit = await api.call(updateEventDraft, {
      token: organiser.token,
      params,
      method: "PATCH",
      body: eventInput({ title: "Hijacked" }),
    });
    expect(edit.status).toBe(404);
    expect((await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" })).status).toBe(404);
    expect((await api.call(getMyEvent, { token: organiser.token, params })).status).toBe(404);

    const unchanged = await api.call(getMyEvent, { token: other.token, params });
    expect(unchanged.body).toMatchObject({ title: "Neon Static", status: "draft" });
  });

  it("returns 404 for an event id that isn't a uuid", async () => {
    const res = await api.call(getMyEvent, { token: organiser.token, params: { eventId: "../../etc" } });
    expect(res.status).toBe(404);
  });

  it("lists only the caller's own events, newest first, paginated", async () => {
    const other = await approvedOrganiser(api, admin, { displayName: "Paper Moon" });
    await draftEvent(api, other, { title: "Not mine" });
    for (const title of ["First", "Second", "Third"]) await draftEvent(api, organiser, { title });

    const page1 = await api.call(listMyEvents, { token: organiser.token, query: { limit: "2" } });
    expect(page1.body.items.map((e: { title: string }) => e.title)).toEqual(["Third", "Second"]);
    const page2 = await api.call(listMyEvents, {
      token: organiser.token,
      query: { limit: "2", cursor: page1.body.nextCursor },
    });
    expect(page2.body.items.map((e: { title: string }) => e.title)).toEqual(["First"]);
    expect(page2.body.nextCursor).toBeUndefined();
  });
});

describe("review workflow", () => {
  it("submit → approve publishes, recording each step in the moderation log", async () => {
    const draft = await draftEvent(api, organiser);
    const params = { eventId: draft.eventId };

    const submitted = await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    expect(submitted.body.status).toBe("pending_review");

    const queue = await api.call(adminListEvents, { token: admin.token });
    expect(queue.body.items.map((e: { eventId: string }) => e.eventId)).toEqual([draft.eventId]);

    const approved = await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("published");
    expect(approved.body.moderationLog).toEqual([
      expect.objectContaining({ action: "submitted", by: organiser.userId }),
      expect.objectContaining({ action: "approved", by: admin.userId }),
    ]);
  });

  it("a pending or published event can't be edited or resubmitted", async () => {
    const draft = await draftEvent(api, organiser);
    const params = { eventId: draft.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });

    const edit = await api.call(updateEventDraft, { token: organiser.token, params, method: "PATCH", body: eventInput() });
    expect(edit.status).toBe(409);
    expect((await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" })).status).toBe(409);

    await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
    const editPublished = await api.call(updateEventDraft, {
      token: organiser.token,
      params,
      method: "PATCH",
      body: eventInput(),
    });
    expect(editPublished.status).toBe(409);
  });

  it("reject needs a reason; the organiser can then fix and resubmit, which clears it", async () => {
    const draft = await draftEvent(api, organiser);
    const params = { eventId: draft.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });

    expect((await api.call(adminRejectEvent, { token: admin.token, params, body: {} })).status).toBe(400);
    const rejected = await api.call(adminRejectEvent, { token: admin.token, params, body: { reason: "Add a venue photo" } });
    expect(rejected.body).toMatchObject({ status: "rejected", rejectionReason: "Add a venue photo" });

    const edited = await api.call(updateEventDraft, { token: organiser.token, params, method: "PATCH", body: eventInput() });
    expect(edited.status).toBe(200);
    const resubmitted = await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    expect(resubmitted.body.status).toBe("pending_review");
    expect(resubmitted.body.rejectionReason).toBeUndefined();
  });

  it("refuses transitions from the wrong status with 409, not a silent success", async () => {
    const draft = await draftEvent(api, organiser);
    const params = { eventId: draft.eventId };

    expect((await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" })).status).toBe(409);
    expect((await api.call(adminUnpublishEvent, { token: admin.token, params, method: "POST" })).status).toBe(409);
    expect((await api.call(adminRejectEvent, { token: admin.token, params, body: { reason: "x" } })).status).toBe(409);

    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
    // Already published: a second approval (e.g. a stale admin tab) conflicts.
    expect((await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" })).status).toBe(409);
  });

  it("unpublish sends a published event back to draft, not deleted", async () => {
    const draft = await draftEvent(api, organiser);
    const params = { eventId: draft.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });

    const res = await api.call(adminUnpublishEvent, { token: admin.token, params, method: "POST" });
    expect(res.body.status).toBe("draft");
    expect(res.body.moderationLog.at(-1)).toMatchObject({ action: "unpublished", by: admin.userId });
  });

  it("only admins can moderate — even the event's own organiser can't approve it", async () => {
    const draft = await draftEvent(api, organiser);
    const params = { eventId: draft.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });

    for (const handler of [adminApproveEvent, adminUnpublishEvent]) {
      expect((await api.call(handler, { token: organiser.token, params, method: "POST" })).status).toBe(403);
    }
    expect((await api.call(adminRejectEvent, { token: organiser.token, params, body: { reason: "x" } })).status).toBe(403);
    expect((await api.call(getMyEvent, { token: organiser.token, params })).body.status).toBe("pending_review");
  });
});
