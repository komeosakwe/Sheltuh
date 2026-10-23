import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminApproveEvent,
  adminApproveOrganiser,
  adminListEvents,
  adminListOrganisers,
  adminRejectOrganiser,
  adminSuspendOrganiser,
  MAX_SUSPEND_REASON_LENGTH,
} from "@/lib/server/handlers/admin";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import { applyAsOrganiser, getMyOrganiser, resubmitOrganiser } from "@/lib/server/handlers/organisers";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { ADMIN_ORGANISER_EDIT_LIMIT } from "@/lib/server/records";
import { stripeWebhookRequest, TestApi } from "./helpers/api";
import {
  application,
  approvedOrganiser,
  draftEvent,
  enablePayouts,
  insertOrder,
  publishedEvent,
  signUpAdmin,
} from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
});

const PAID_TICKETS = [
  { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 },
];

function suspend(organiserId: string, body: unknown = { reason: "Impersonating another venue." }, token = admin.token) {
  return api.call(adminSuspendOrganiser, { token, params: { organiserId }, body });
}

function patchMe(token: string, body: unknown) {
  return api.call(resubmitOrganiser, { token, body, method: "PATCH" });
}

async function organiserRow(organiserId: string) {
  const [row] = await api.db.query<{ status: string; rejection_reason: string | null; reviewed_by: string | null }>(
    `select status::text as status, rejection_reason, reviewed_by from public.organisers where id = $1`,
    [organiserId],
  );
  return row;
}

async function eventStatus(eventId: string) {
  const [row] = await api.db.query<{ status: string; rejection_reason: string | null }>(
    `select status::text as status, rejection_reason from public.events where id = $1`,
    [eventId],
  );
  return row;
}

async function logRows(organiserId: string) {
  return api.db.query<{ kind: string; actor_id: string | null; changed_fields: unknown; reason: string | null }>(
    `select kind, actor_id, changed_fields, reason from private.organiser_profile_edits
      where organiser_id = $1 order by id`,
    [organiserId],
  );
}

async function adminItem(status: string, organiserId: string) {
  const res = await api.call(adminListOrganisers, { token: admin.token, query: { status } });
  expect(res.status).toBe(200);
  return res.body.items.find((i: { organiserId: string }) => i.organiserId === organiserId);
}

describe("POST /admin/organisers/{id}/suspend: access", () => {
  it("is 401 signed out or with a forged token, 403 for a non-admin (the organiser included), and changes nothing", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const stranger = await api.signUp();

    expect((await api.call(adminSuspendOrganiser, { params: { organiserId: organiser.organiserId }, body: { reason: "x" } })).status).toBe(401);
    expect((await suspend(organiser.organiserId, { reason: "x" }, "forged")).status).toBe(401);
    const asStranger = await suspend(organiser.organiserId, { reason: "x" }, stranger.token);
    expect(asStranger.status).toBe(403);
    expect(asStranger.body.error).toMatch(/admin/i);
    expect((await suspend(organiser.organiserId, { reason: "x" }, organiser.token)).status).toBe(403);

    expect((await organiserRow(organiser.organiserId)).status).toBe("approved");
    expect(await logRows(organiser.organiserId)).toEqual([]);
  });
});

describe("POST /admin/organisers/{id}/suspend: takedown", () => {
  it("rejects the organiser with the reason, unpublishes their events and rejects pending submissions, in one step", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const other = await approvedOrganiser(api, admin, { displayName: "Unrelated Org" });
    const live = await publishedEvent(api, organiser, admin, { title: "Live" });
    const pending = await draftEvent(api, organiser, { title: "Pending" });
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: pending.eventId }, method: "POST" });
    const draft = await draftEvent(api, organiser, { title: "Draft" });
    const othersEvent = await publishedEvent(api, other, admin, { title: "Someone else's" });
    const paidOrder = await insertOrder(api, live, "fan@example.com", "paid");

    const res = await suspend(organiser.organiserId, { reason: "  Impersonating another venue.  " });
    expect(res.status).toBe(200);
    // Admin responses are about named people: never cached.
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(res.body).sort()).toEqual(["eventsUnpublished", "organiser", "submissionsRejected"]);
    expect(res.body).toMatchObject({ eventsUnpublished: 1, submissionsRejected: 1 });
    expect(res.body.organiser).toMatchObject({
      organiserId: organiser.organiserId,
      status: "rejected",
      rejectionReason: "Impersonating another venue.",
      reviewedBy: admin.userId,
    });
    expect(res.body.organiser.recentEdits).toEqual([
      {
        kind: "suspended",
        at: expect.any(String),
        changes: { status: { old: "approved", new: "rejected" } },
        reason: "Impersonating another venue.",
      },
    ]);

    // Events: published → draft, pending review → rejected (with the reason); drafts and other organisers untouched.
    expect(await eventStatus(live.eventId)).toEqual({ status: "draft", rejection_reason: "Impersonating another venue." });
    expect(await eventStatus(pending.eventId)).toEqual({ status: "rejected", rejection_reason: "Impersonating another venue." });
    expect((await eventStatus(draft.eventId)).status).toBe("draft");
    expect((await eventStatus(othersEvent.eventId)).status).toBe("published");

    // Each move is in the event moderation log, by the admin, with the reason.
    const log = await api.db.query<{ event_id: string; action: string; actor_id: string; reason: string }>(
      `select event_id, action::text as action, actor_id, reason from public.event_moderation_log
        where event_id = any($1::uuid[]) and action in ('unpublished', 'rejected') order by action`,
      [[live.eventId, pending.eventId]],
    );
    expect(log).toEqual([
      { event_id: pending.eventId, action: "rejected", actor_id: admin.userId, reason: "Impersonating another venue." },
      { event_id: live.eventId, action: "unpublished", actor_id: admin.userId, reason: "Impersonating another venue." },
    ]);

    // Nothing is deleted: the paid order and its event are still there.
    const [order] = await api.db.query<{ status: string }>(`select status::text as status from public.orders where id = $1`, [paidOrder]);
    expect(order.status).toBe("paid");
    const [{ count }] = await api.db.query<{ count: number }>(
      `select count(*)::int as count from public.events where organiser_id = $1`,
      [organiser.organiserId],
    );
    expect(count).toBe(3);

    // The takedown is logged against the admin.
    expect(await logRows(organiser.organiserId)).toEqual([
      {
        kind: "suspended",
        actor_id: admin.userId,
        changed_fields: { status: { old: "approved", new: "rejected" } },
        reason: "Impersonating another venue.",
      },
    ]);
  });

  it("takes everything public down: profile, event page, feed and checkout", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const live = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    expect((await api.call(getPublicOrganiserProfile, { params: { organiserId: organiser.organiserId } })).status).toBe(200);

    expect((await suspend(organiser.organiserId)).status).toBe(200);

    expect((await api.call(getPublicOrganiserProfile, { params: { organiserId: organiser.organiserId } })).status).toBe(404);
    expect((await api.call(getPublicEventBySlug, { params: { slug: live.slug } })).status).toBe(404);
    const feed = await api.call(listPublicEvents);
    expect(feed.body.items.map((e: { eventId: string }) => e.eventId)).not.toContain(live.eventId);
    const checkout = await api.call(createCheckout, {
      params: { eventId: live.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] },
    });
    expect(checkout.status).toBe(404);
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();

    // The organiser sees the decision like a rejection, and can't act as an organiser any more.
    const mine = await api.call(getMyOrganiser, { token: organiser.token });
    expect(mine.body).toMatchObject({ status: "rejected", rejectionReason: "Impersonating another venue." });
    expect(mine.body.reviewedBy).toBeUndefined();
    expect(mine.body.recentEdits).toBeUndefined();
    const draft = await draftEvent(api, organiser).catch((err: Error) => err);
    expect(draft).toBeInstanceOf(Error);
  });

  it("refunds a payment that completes after the takedown, through the usual unpublished-event path", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const live = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    const started = await api.call(createCheckout, {
      params: { eventId: live.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] },
    });
    expect(started.status).toBe(201);
    const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;

    expect((await suspend(organiser.organiserId)).status).toBe(200);

    const webhook = stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          object: "checkout.session",
          client_reference_id: orderId,
          payment_status: "paid",
          payment_intent: "pi_test_1",
          customer_details: { email: "buyer@example.com" },
        },
      },
    });
    expect((await api.send(stripeWebhook, webhook)).status).toBe(200);

    const [order] = await api.db.query<{ status: string }>(`select status::text as status from public.orders where id = $1`, [orderId]);
    expect(order.status).toBe("refunded");
    expect(api.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_test_1", reverse_transfer: true, refund_application_fee: true }),
      { idempotencyKey: `oversold-refund-${orderId}` },
    );
    const [{ sold }] = await api.db.query<{ sold: number }>(
      `select quantity_sold as sold from public.ticket_types where event_id = $1`,
      [live.eventId],
    );
    expect(sold).toBe(0);
  });

  it("is a 409 unless the organiser is approved, and a second suspension changes nothing", async () => {
    const pendingUser = await api.signUp();
    const pending = await api.call(applyAsOrganiser, { token: pendingUser.token, body: application });
    const rejectedUser = await api.signUp();
    const rejected = await api.call(applyAsOrganiser, { token: rejectedUser.token, body: application });
    await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId: rejected.body.organiserId },
      body: { reason: "No" },
    });

    for (const organiserId of [pending.body.organiserId, rejected.body.organiserId]) {
      const res = await suspend(organiserId);
      expect(res.status).toBe(409);
      expect(await logRows(organiserId)).toEqual([]);
    }
    expect((await organiserRow(pending.body.organiserId)).status).toBe("pending");
    expect(await organiserRow(rejected.body.organiserId)).toMatchObject({ status: "rejected", rejection_reason: "No" });

    const organiser = await approvedOrganiser(api, admin);
    const secondAdmin = await signUpAdmin(api);
    expect((await suspend(organiser.organiserId, { reason: "First" })).status).toBe(200);
    const again = await suspend(organiser.organiserId, { reason: "Second" }, secondAdmin.token);
    expect(again.status).toBe(409);
    expect(await organiserRow(organiser.organiserId)).toEqual({
      status: "rejected",
      rejection_reason: "First",
      reviewed_by: admin.userId,
    });
    expect((await logRows(organiser.organiserId)).map((r) => r.reason)).toEqual(["First"]);
  });

  it("two admins suspending at once: exactly one succeeds", async () => {
    const organiser = await approvedOrganiser(api, admin);
    await publishedEvent(api, organiser, admin);
    const secondAdmin = await signUpAdmin(api);
    const results = await Promise.all([
      suspend(organiser.organiserId, { reason: "A" }),
      suspend(organiser.organiserId, { reason: "B" }, secondAdmin.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await logRows(organiser.organiserId)).toHaveLength(1);
    const [{ count }] = await api.db.query<{ count: number }>(
      `select count(*)::int as count from public.event_moderation_log where action = 'unpublished'`,
    );
    expect(count).toBe(1);
  });

  it("is a 404 for an unknown organiser or an id that isn't a uuid", async () => {
    for (const organiserId of [crypto.randomUUID(), "not-a-uuid"]) {
      const res = await suspend(organiserId);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Organiser not found." });
    }
  });

  it.each([
    ["missing", {}],
    ["blank", { reason: "   " }],
    ["not a string", { reason: 42 }],
    ["too long", { reason: "a".repeat(MAX_SUSPEND_REASON_LENGTH + 1) }],
    ["a NUL", { reason: "bad\u0000reason" }],
    ["a bidi override", { reason: "reason ‮txt.exe" }],
    ["a zero-width space", { reason: "rea​son" }],
  ])("needs a clean reason of at most 500 characters (%s: 400, nothing changed)", async (_case, body) => {
    const organiser = await approvedOrganiser(api, admin);
    const res = await suspend(organiser.organiserId, body);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["reason"]);
    expect((await organiserRow(organiser.organiserId)).status).toBe("approved");
    expect(await logRows(organiser.organiserId)).toEqual([]);
  });

  it(`accepts a reason of exactly ${MAX_SUSPEND_REASON_LENGTH} characters`, async () => {
    const organiser = await approvedOrganiser(api, admin);
    const reason = "é".repeat(MAX_SUSPEND_REASON_LENGTH);
    const res = await suspend(organiser.organiserId, { reason });
    expect(res.status).toBe(200);
    expect(res.body.organiser.rejectionReason).toBe(reason);
  });
});

describe("after a takedown", () => {
  it("an event can't be published for a suspended organiser, even one that reached review in a race", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const draft = await draftEvent(api, organiser);
    expect((await suspend(organiser.organiserId)).status).toBe(200);

    // A submission that passed the approved check just before the takedown, landing just after it.
    await api.db.query(`select private.transition_event($1, array['draft']::public.event_status[], 'pending_review', 'submitted', $2)`, [
      draft.eventId,
      organiser.userId,
    ]);
    const res = await api.call(adminApproveEvent, { token: admin.token, params: { eventId: draft.eventId }, method: "POST" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/organiser isn't approved/);
    expect((await eventStatus(draft.eventId)).status).toBe("pending_review");
    const listed = await api.call(adminListEvents, { token: admin.token, query: { status: "published" } });
    expect(listed.body.items).toEqual([]);
  });

  it("the organiser can apply again; the takedown stays on their log for the reviewing admin, and reinstatement doesn't republish anything", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const live = await publishedEvent(api, organiser, admin);
    expect((await suspend(organiser.organiserId, { reason: "Fake venue" })).status).toBe(200);

    const resubmitted = await patchMe(organiser.token, { ...application, description: "We fixed it." });
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body).toMatchObject({ status: "pending" });
    expect(resubmitted.body.rejectionReason).toBeUndefined();

    // The pending application's row no longer says why it was rejected, but its log does.
    const item = await adminItem("pending", organiser.organiserId);
    expect(item.rejectionReason).toBeUndefined();
    expect(item.recentEdits).toEqual([expect.objectContaining({ kind: "suspended", reason: "Fake venue" })]);

    const approved = await api.call(adminApproveOrganiser, {
      token: admin.token,
      params: { organiserId: organiser.organiserId },
      method: "POST",
    });
    expect(approved.status).toBe(200);
    expect(approved.body.recentEdits).toHaveLength(1);
    expect((await eventStatus(live.eventId)).status).toBe("draft");
    // Their events go through review again like any other.
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: live.eventId }, method: "POST" });
    const republished = await api.call(adminApproveEvent, { token: admin.token, params: { eventId: live.eventId }, method: "POST" });
    expect(republished.status).toBe(200);
    expect(republished.body.status).toBe("published");
  });
});

describe("the profile edit log", () => {
  const socials = { instagramHandle: "static.collective", xHandle: "static_mel" };

  it("records old and new values of exactly the fields an approved organiser changes, against the owner", async () => {
    const organiser = await approvedOrganiser(api, admin, socials);

    const res = await patchMe(organiser.token, {
      description: "New bio.",
      websiteUrl: "https://new.example",
      instagramHandle: "static.collective", // unchanged: not logged
      xHandle: null, // cleared
      tiktokHandle: "@static_tt", // added
    });
    expect(res.status).toBe(200);

    expect(await logRows(organiser.organiserId)).toEqual([
      {
        kind: "profile_edit",
        actor_id: organiser.userId,
        changed_fields: {
          description: { old: application.description, new: "New bio." },
          website_url: { old: application.websiteUrl, new: "https://new.example" },
          x_handle: { old: "static_mel", new: null },
          tiktok_handle: { old: null, new: "static_tt" },
        },
        reason: null,
      },
    ]);

    const item = await adminItem("approved", organiser.organiserId);
    expect(item.recentEdits).toEqual([
      {
        kind: "profile_edit",
        at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        changes: {
          description: { old: application.description, new: "New bio." },
          websiteUrl: { old: application.websiteUrl, new: "https://new.example" },
          xHandle: { old: "static_mel", new: null },
          tiktokHandle: { old: null, new: "static_tt" },
        },
      },
    ]);
  });

  it("writes nothing for an empty edit, an edit that changes nothing, or an invalid one", async () => {
    const organiser = await approvedOrganiser(api, admin, socials);
    const [{ updated_at: before }] = await api.db.query<{ updated_at: string }>(
      `select updated_at::text from public.organisers where id = $1`,
      [organiser.organiserId],
    );

    expect((await patchMe(organiser.token, {})).status).toBe(200);
    expect((await patchMe(organiser.token, { description: application.description, instagramHandle: "@static.collective" })).status).toBe(200);
    expect((await patchMe(organiser.token, { description: "Fine", xHandle: "far_too_long_for_x" })).status).toBe(400);

    expect(await logRows(organiser.organiserId)).toEqual([]);
    const [{ updated_at: after }] = await api.db.query<{ updated_at: string }>(
      `select updated_at::text from public.organisers where id = $1`,
      [organiser.organiserId],
    );
    expect(after).toBe(before);
  });

  it("isn't written for a rejected applicant's resubmission (only approved profiles skip review)", async () => {
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: application });
    await api.call(adminRejectOrganiser, { token: admin.token, params: { organiserId: applied.body.organiserId }, body: { reason: "x" } });
    expect((await patchMe(user.token, { ...application, description: "Changed." })).status).toBe(200);
    expect(await logRows(applied.body.organiserId)).toEqual([]);
  });

  it(`lists the newest ${ADMIN_ORGANISER_EDIT_LIMIT} entries per organiser, newest first, in the admin list and decision responses`, async () => {
    const organiser = await approvedOrganiser(api, admin);
    const quiet = await approvedOrganiser(api, admin, { displayName: "Quiet Org" });
    for (let i = 1; i <= ADMIN_ORGANISER_EDIT_LIMIT + 5; i += 1) {
      expect((await patchMe(organiser.token, { description: `Bio ${i}` })).status).toBe(200);
    }

    const item = await adminItem("approved", organiser.organiserId);
    expect(item.recentEdits).toHaveLength(ADMIN_ORGANISER_EDIT_LIMIT);
    expect(item.recentEdits[0].changes.description).toEqual({ old: "Bio 24", new: "Bio 25" });
    expect(item.recentEdits.at(-1).changes.description).toEqual({ old: "Bio 5", new: "Bio 6" });
    expect((await adminItem("approved", quiet.organiserId)).recentEdits).toEqual([]);

    const suspended = await suspend(organiser.organiserId);
    expect(suspended.body.organiser.recentEdits).toHaveLength(ADMIN_ORGANISER_EDIT_LIMIT);
    expect(suspended.body.organiser.recentEdits[0].kind).toBe("suspended");
    // All 26 are kept; only the list is capped.
    expect(await logRows(organiser.organiserId)).toHaveLength(ADMIN_ORGANISER_EDIT_LIMIT + 6);
  });

  it("admin list items carry the social handles and the log; the public and the organiser never see the log", async () => {
    const organiser = await approvedOrganiser(api, admin, {
      instagramHandle: "@static.collective",
      tiktokHandle: "static_tt",
      facebookPage: "StaticCollective",
      xHandle: "static_mel",
    });
    await patchMe(organiser.token, { description: "Changed." });

    const item = await adminItem("approved", organiser.organiserId);
    expect(item).toMatchObject({
      instagramHandle: "static.collective",
      tiktokHandle: "static_tt",
      facebookPage: "StaticCollective",
      xHandle: "static_mel",
      websiteUrl: application.websiteUrl,
      contactEmail: application.contactEmail,
    });
    expect(item.recentEdits).toHaveLength(1);

    const pendingUser = await api.signUp();
    await api.call(applyAsOrganiser, { token: pendingUser.token, body: { ...application, xHandle: "pending_x" } });
    const pendingPage = await api.call(adminListOrganisers, { token: admin.token, query: { status: "pending" } });
    expect(pendingPage.body.items).toEqual([expect.objectContaining({ xHandle: "pending_x", recentEdits: [] })]);

    const mine = await api.call(getMyOrganiser, { token: organiser.token });
    expect(mine.body.recentEdits).toBeUndefined();
    const profile = await api.call(getPublicOrganiserProfile, { params: { organiserId: organiser.organiserId } });
    expect(JSON.stringify(profile.body)).not.toContain(application.description);
    expect(profile.body.recentEdits).toBeUndefined();
  });

  it("is append-only: entries can't be rewritten, but the actor is cleared when that account is deleted", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const otherAdmin = await signUpAdmin(api);
    await patchMe(organiser.token, { description: "Changed." });
    expect((await suspend(organiser.organiserId, { reason: "Gone" }, otherAdmin.token)).status).toBe(200);

    await expect(
      api.db.query(`update private.organiser_profile_edits set changed_fields = '{"description": {"old": "a", "new": "b"}}'`),
    ).rejects.toThrow(/append-only/);
    await expect(api.db.query(`update private.organiser_profile_edits set reason = 'Rewritten' where kind = 'suspended'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(
      api.db.query(`update private.organiser_profile_edits set actor_id = $1 where kind = 'suspended'`, [admin.userId]),
    ).rejects.toThrow(/append-only/);

    // Deleting the suspending admin's account (its other references are set null too).
    await api.db.query(`delete from auth.users where id = $1`, [otherAdmin.userId]);
    expect(await logRows(organiser.organiserId)).toEqual([
      expect.objectContaining({ kind: "profile_edit", actor_id: organiser.userId }),
      expect.objectContaining({ kind: "suspended", actor_id: null, reason: "Gone" }),
    ]);
  });

  it("the table's constraints hold whatever the API does", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const insert = (kind: string, fields: string, reason: string | null) =>
      api.db.query(
        `insert into private.organiser_profile_edits (organiser_id, kind, changed_fields, reason) values ($1, $2, $3::text::jsonb, $4)`,
        [organiser.organiserId, kind, fields, reason],
      );
    const change = '{"description": {"old": "a", "new": "b"}}';
    await expect(insert("other", change, null)).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("profile_edit", "{}", null)).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("profile_edit", "[]", null)).rejects.toThrow(/check constraint|violates/i);
    // A profile edit may carry a reason: an admin's (e.g. removing the featured video).
    await insert("profile_edit", change, "a reason");
    await expect(insert("suspended", change, null)).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("suspended", change, "a".repeat(501))).rejects.toThrow(/check constraint|violates/i);
    await insert("suspended", change, "ok");
  });
});

describe("organiser bio and website hardening", () => {
  it.each([
    ["NUL", "Warehouse\u0000gigs"],
    ["bell", "Warehouse\u0007gigs"],
    ["right-to-left override", "Warehouse ‮gigs"],
    ["left-to-right isolate", "Warehouse ⁦gigs⁩"],
    ["zero-width space", "Ware​house"],
    ["BOM", "﻿Warehouse"],
    ["line separator", "Warehouse gigs"],
  ])("a bio with a %s is a 400, never a 500, on apply and on edit", async (_name, description) => {
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, description } });
    expect(applied.status).toBe(400);
    expect(Object.keys(applied.body.fieldErrors)).toEqual(["description"]);

    const organiser = await approvedOrganiser(api, admin);
    const edited = await patchMe(organiser.token, { description });
    expect(edited.status).toBe(400);
    expect(Object.keys(edited.body.fieldErrors)).toEqual(["description"]);
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body.description).toBe(application.description);
  });

  it("cleans a bio like a message: line endings, trailing spaces and runs of blank lines", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const res = await patchMe(organiser.token, { description: "  Line one   \r\n\r\n\r\n\r\nLine two\t\n" });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe("Line one\n\nLine two");
  });

  it("counts a bio's 2000-character limit in characters, as the database does", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const emoji = "🎸".repeat(2000); // 4000 UTF-16 units, 2000 characters
    expect((await patchMe(organiser.token, { description: emoji })).status).toBe(200);
    const tooLong = await patchMe(organiser.token, { description: "a".repeat(2001) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.fieldErrors.description).toMatch(/2000/);
  });

  it.each([
    ["a NUL", "https://static.example/\u0000"],
    ["a zero-width space", "https://static​.example"],
    ["a space", "https://static.example/a b"],
    ["a backslash", "https://static.example\\@bank.example"],
    ["a username", "https://bank.example@static.example"],
    ["a username and password", "https://user:secret@static.example"],
    ["an empty userinfo", "https://@static.example"],
    ["a new http:// address", "http://static.example"],
  ])("a website with %s is a 400 on apply and on edit", async (_name, websiteUrl) => {
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, websiteUrl } });
    expect(applied.status).toBe(400);
    expect(Object.keys(applied.body.fieldErrors)).toEqual(["websiteUrl"]);

    const organiser = await approvedOrganiser(api, admin);
    const edited = await patchMe(organiser.token, { websiteUrl });
    expect(edited.status).toBe(400);
    expect(Object.keys(edited.body.fieldErrors)).toEqual(["websiteUrl"]);
  });

  it("keeps a stored http:// website that's sent back unchanged, but won't take a new one", async () => {
    const organiser = await approvedOrganiser(api, admin);
    await api.db.query(`update public.organisers set website_url = 'http://legacy.example' where id = $1`, [organiser.organiserId]);

    const unchanged = await patchMe(organiser.token, { websiteUrl: " http://legacy.example ", description: "Still here." });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.websiteUrl).toBe("http://legacy.example");
    expect((await logRows(organiser.organiserId)).map((r) => Object.keys(r.changed_fields as object))).toEqual([["description"]]);

    const changed = await patchMe(organiser.token, { websiteUrl: "http://other.example" });
    expect(changed.status).toBe(400);
    expect(changed.body.fieldErrors.websiteUrl).toBe("Use your site's secure address, starting with https://");
    expect((await patchMe(organiser.token, { websiteUrl: "https://legacy.example" })).status).toBe(200);

    // A rejected applicant resubmitting their stored http:// address unchanged.
    const user = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: user.token, body: application });
    await api.db.query(`update public.organisers set website_url = 'http://legacy.example' where id = $1`, [applied.body.organiserId]);
    await api.call(adminRejectOrganiser, { token: admin.token, params: { organiserId: applied.body.organiserId }, body: { reason: "x" } });
    const resubmitted = await patchMe(user.token, { ...application, websiteUrl: "http://legacy.example" });
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.websiteUrl).toBe("http://legacy.example");
  });

  it("accepts ordinary https addresses, '@' outside the host included", async () => {
    for (const websiteUrl of ["https://medium.com/@static", "https://static.example/?ref=a@b", "HTTPS://Static.Example/About#x"]) {
      const user = await api.signUp();
      const res = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, websiteUrl } });
      expect(res.status, websiteUrl).toBe(201);
      expect(res.body.websiteUrl).toBe(websiteUrl);
    }
  });
});
