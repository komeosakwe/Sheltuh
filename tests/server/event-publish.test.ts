import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEventPublishedEmail, recentlyPublishedQueueLink } from "@/lib/server/admin-review-email";
import type { Db } from "@/lib/server/db";
import { drainEmailOutbox } from "@/lib/server/email-outbox";
import {
  adminListEvents,
  adminRejectEvent,
  adminSetEventReviewRequired,
  adminSummary,
  adminSuspendOrganiser,
  adminUnpublishEvent,
  RECENTLY_PUBLISHED_DAYS,
  SELF_PUBLISHED_WINDOW_HOURS,
} from "@/lib/server/handlers/admin";
import { getEventAnalytics } from "@/lib/server/handlers/analytics";
import { EVENT_CHANGED_WHILE_PUBLISHING, needsTicketLinkReview, publishEvent } from "@/lib/server/handlers/event-publish";
import { getMyEvent, submitEventForReview } from "@/lib/server/handlers/events";
import { applyAsOrganiser, getMyOrganiser } from "@/lib/server/handlers/organisers";
import { getPublicEventBySlug } from "@/lib/server/handlers/public-events";
import { PAYOUTS_REQUIRED_TO_PUBLISH } from "@/lib/server/payouts-refusal";
import { SITE_URL, TestApi } from "./helpers/api";
import {
  application,
  approvedOrganiser,
  draftEvent,
  publishedEvent,
  selfPublishedEvent,
  setUpPayouts,
  signUpAdmin,
} from "./helpers/fixtures";
import { seatedEvent } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// Approved organisers publish now (supabase/migrations/20261111000000_event_publish_now.sql,
// lib/server/handlers/event-publish.ts): live straight away, logged `approved` by
// the organiser's own account, with the admins told after the fact; or to the
// review queue when it needs a person.

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string; email: string };
let organiser: { token: string; userId: string; email: string; organiserId: string };

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
  await api.runDeferred();
  api.sendEmail.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const publish = (eventId: string, token = organiser.token) =>
  api.call(publishEvent, { token, params: { eventId }, method: "POST" });

/** A free Sheltüh-ticketed draft (no payouts needed). */
const freeDraft = (overrides: Record<string, unknown> = {}, owner: { token: string } = organiser) =>
  draftEvent(api, owner, {
    ticketTypes: [{ id: "ga", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }],
    ...overrides,
  });

async function log(eventId: string) {
  return api.db.query<{ action: string; actor_id: string | null; reason: string | null }>(
    `select action::text, actor_id, reason from public.event_moderation_log where event_id = $1 order by id`,
    [eventId],
  );
}

async function outbox(kind?: string) {
  return api.db.query<{ kind: string; event_id: string | null; follow_id: string | null; status: string }>(
    `select kind, event_id, follow_id, status from private.email_outbox
      where ($1::text is null or kind = $1) order by id`,
    [kind ?? null],
  );
}

async function rateHits(bucket: string): Promise<number | undefined> {
  const [row] = await api.db.query<{ hits: number }>(`select hits from private.rate_limits where bucket = $1`, [bucket]);
  return row?.hits;
}

/** A verified member following the organiser, with new-event emails on. */
async function follower() {
  const user = await api.signUp();
  await api.db.query(`insert into public.organiser_follows (user_id, organiser_id, notify_new_events) values ($1, $2, true)`, [
    user.userId,
    organiser.organiserId,
  ]);
  return user;
}

/** Expects `eventId` to have gone to review: pending, logged `submitted` by the organiser, its review email queued, nothing announced. */
async function expectSentToReview(res: { status: number; body: { status: string } }, eventId: string) {
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("pending_review");
  const entries = await log(eventId);
  expect(entries.at(-1)).toEqual({ action: "submitted", actor_id: organiser.userId, reason: null });
  expect((await outbox("event_review")).map((j) => j.event_id)).toContain(eventId);
  expect((await outbox("event_published")).map((j) => j.event_id)).not.toContain(eventId);
}

// ---------------------------------------------------------------------------
// Going live
// ---------------------------------------------------------------------------

describe("POST /events/{id}/publish: live now", () => {
  it("publishes a draft, logged `approved` by the organiser's own account, so ticketing is locked as after an admin's approval", async () => {
    const draft = await freeDraft();
    const res = await publish(draft.eventId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toMatchObject({ eventId: draft.eventId, status: "published", ticketingLocked: true });
    expect(res.body.rejectionReason).toBeUndefined();
    // The organiser's own entry: their id, never the Sheltüh team's.
    expect(res.body.moderationLog).toEqual([expect.objectContaining({ action: "approved", by: organiser.userId })]);
    expect(await log(draft.eventId)).toEqual([{ action: "approved", actor_id: organiser.userId, reason: null }]);

    const pub = await api.call(getPublicEventBySlug, { params: { slug: draft.slug } });
    expect(pub.status).toBe(200);
    // Counted against the account's daily publishes.
    expect(await rateHits("event_publishes")).toBe(1);
  });

  it("a paid event once payouts are set up", async () => {
    const draft = await draftEvent(api, organiser);
    await setUpPayouts(api, organiser.organiserId);
    expect((await publish(draft.eventId)).body.status).toBe("published");
  });

  it("an external event on a known ticketing site", async () => {
    const draft = await draftEvent(api, organiser, {
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon-static",
      ticketTypes: [],
    });
    expect((await publish(draft.eventId)).body.status).toBe("published");
  });

  it("queues the followers' email and the admins' published email, and sends both after the response", async () => {
    const fan = await follower();
    const draft = await freeDraft();
    expect((await publish(draft.eventId)).status).toBe(200);
    expect(await outbox("organiser_new_events")).toHaveLength(1);
    expect(await outbox("event_published")).toEqual([
      { kind: "event_published", event_id: draft.eventId, follow_id: null, status: "pending" },
    ]);
    // Nothing waits for review.
    expect(await outbox("event_review")).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();

    await api.runDeferred();
    const sent = api.sendEmail.mock.calls.map(([m]) => m);
    expect(sent.filter((m) => m.to === fan.email)).toHaveLength(1);
    const adminMail = sent.filter((m) => m.to === admin.email);
    expect(adminMail).toHaveLength(1);
    const [mail] = adminMail;
    expect(mail.subject).toBe("Event published by an organiser");
    expect(mail.text).toContain("As submitted by the organiser:");
    expect(mail.text).toContain(`Title: ${draft.title}`);
    expect(mail.text).toContain(`Organiser: ${application.displayName}`);
    expect(mail.text).toContain("Tickets: on Sheltüh");
    expect(mail.text).toContain(`${SITE_URL}/admin/events?status=published&view=recent`);
    // No venue, description or buyer data.
    expect(mail.text).not.toContain(draft.venueAddress);
    expect(mail.text).not.toContain(draft.description);
    expect(mail.html).not.toContain(draft.venueAddress);
    expect((await outbox("event_published"))[0].status).toBe("sent");
  });

  it("the admins' email names an external event's ticket site by its host", () => {
    const mail = buildEventPublishedEmail({
      to: "admin@sheltuh.test",
      title: "Neon Static\r\nBcc: someone",
      organiserName: "Static Collective",
      startsAt: "2027-03-06T09:00:00.000Z",
      ticketHost: "events.humanitix.com",
      siteUrl: SITE_URL,
    });
    expect(mail.subject).toBe("Event published by an organiser");
    expect(mail.text).toContain("Tickets: sold on events.humanitix.com");
    // The organiser's text is kept to one line.
    expect(mail.text).not.toMatch(/Neon Static\r?\nBcc/);
    expect(recentlyPublishedQueueLink(SITE_URL)).toBe(`${SITE_URL}/admin/events?status=published&view=recent`);
  });

  it("is idempotent: publishing again changes nothing and queues nothing more", async () => {
    const draft = await freeDraft();
    await publish(draft.eventId);
    const again = await publish(draft.eventId);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("published");
    expect((await log(draft.eventId)).filter((e) => e.action === "approved")).toHaveLength(1);
    expect(await outbox("event_published")).toHaveLength(1);
    expect(await rateHits("event_publishes")).toBe(1);
  });

  it("concurrent publishes of one event: one goes live, the other is a repeat", async () => {
    const draft = await freeDraft();
    const results = await Promise.all([publish(draft.eventId), publish(draft.eventId)]);
    expect(results.map((r) => [r.status, r.body.status])).toEqual([
      [200, "published"],
      [200, "published"],
    ]);
    expect((await log(draft.eventId)).filter((e) => e.action === "approved")).toHaveLength(1);
    expect(await outbox("event_published")).toHaveLength(1);
    expect(await rateHits("event_publishes")).toBe(1);
  });

  it("an admin unpublishing before the admins' email is sent drops it", async () => {
    const draft = await freeDraft();
    await publish(draft.eventId);
    const res = await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: draft.eventId }, method: "POST" });
    expect(res.status).toBe(200);
    expect(await outbox("event_published")).toEqual([]);
    await api.runDeferred();
    expect(api.sendEmail.mock.calls.filter(([m]) => m.to === admin.email)).toEqual([]);
  });

  it("an `event_published` job is only leased when asked for by kind (a previous release's cron never takes one)", async () => {
    const draft = await freeDraft();
    await publish(draft.eventId);
    const lease = (kind: string | null) =>
      api.db.query<{ job_kind: string }>(`select job_kind from private.lease_outbox_jobs(10, '2 minutes'::interval, 6, null, $1)`, [
        kind,
      ]);
    expect((await lease(null)).map((j) => j.job_kind)).not.toContain("event_published");
    expect((await lease("event_published")).map((j) => j.job_kind)).toEqual(["event_published"]);
  });

  it("the cron's drain sends a due `event_published` job", async () => {
    const draft = await freeDraft();
    await publish(draft.eventId);
    api.deferred.length = 0; // not the route's own run
    const summary = await drainEmailOutbox(api.deps);
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect((await outbox("event_published"))[0].status).toBe("sent");
    expect(api.sendEmail.mock.calls.filter(([m]) => m.subject === "Event published by an organiser")).toHaveLength(1);
  });

  it("the existing review path is unchanged: /submit still waits for an admin", async () => {
    const draft = await freeDraft();
    const res = await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    expect(res.body.status).toBe("pending_review");
    const event = await publishedEvent(api, organiser, admin);
    expect(event.status).toBe("published");
    expect(event.moderationLog.map((e) => e.action)).toEqual(["submitted", "approved"]);
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe("POST /events/{id}/publish: refusals", () => {
  it("401 without a token; 403 for a member who isn't an approved organiser", async () => {
    const draft = await freeDraft();
    expect((await api.call(publishEvent, { params: { eventId: draft.eventId }, method: "POST" })).status).toBe(401);
    const member = await api.signUp();
    expect((await publish(draft.eventId, member.token)).status).toBe(403);
    const applicant = await api.signUp();
    await api.call(applyAsOrganiser, { token: applicant.token, body: { ...application, displayName: "Pending Collective" } });
    expect((await publish(draft.eventId, applicant.token)).status).toBe(403);
    expect((await log(draft.eventId))).toEqual([]);
  });

  it("404 for another organiser's event, or an id that can't be one", async () => {
    const other = await approvedOrganiser(api, admin, { displayName: "Other Collective", contactEmail: "other@static.example" });
    const theirs = await freeDraft({}, other);
    const res = await publish(theirs.eventId);
    expect(res.status).toBe(404);
    expect((await api.db.query<{ status: string }>(`select status::text from public.events where id = $1`, [theirs.eventId]))[0].status).toBe(
      "draft",
    );
    expect((await publish("not-a-uuid")).status).toBe(404);
  });

  it("a suspended organiser can't publish (403), and their published events are taken down", async () => {
    const live = await selfPublishedEvent(api, organiser, {
      ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    const draft = await freeDraft();
    const suspended = await api.call(adminSuspendOrganiser, {
      token: admin.token,
      params: { organiserId: organiser.organiserId },
      body: { reason: "Impersonating another venue." },
    });
    expect(suspended.status).toBe(200);
    expect(suspended.body.eventsUnpublished).toBe(1);
    expect((await publish(draft.eventId)).status).toBe(403);
    expect((await publish(live.eventId)).status).toBe(403);
  });

  it("the database refuses a takedown's organiser even if the API's check ran first", async () => {
    const draft = await freeDraft();
    await api.db.query(`update public.organisers set status = 'rejected' where id = $1`, [organiser.organiserId]);
    const [row] = await api.db.query<{ result: string }>(`select private.publish_event($1, $2, $3, null, false) as result`, [
      draft.eventId,
      organiser.organiserId,
      organiser.userId,
    ]);
    expect(row.result).toBe("not_found");
  });

  it("only the organiser's owner can be the actor", async () => {
    const draft = await freeDraft();
    const [row] = await api.db.query<{ result: string }>(`select private.publish_event($1, $2, $3, null, false) as result`, [
      draft.eventId,
      organiser.organiserId,
      admin.userId,
    ]);
    expect(row.result).toBe("not_found");
    expect(await log(draft.eventId)).toEqual([]);
  });

  it("409 `in_review` when it's already waiting for review", async () => {
    const draft = await freeDraft();
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    const res = await publish(draft.eventId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("in_review");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("409 `payouts_required` for paid tickets without payouts; nothing written", async () => {
    const draft = await draftEvent(api, organiser);
    const res = await publish(draft.eventId);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "payouts_required", error: PAYOUTS_REQUIRED_TO_PUBLISH });
    expect(await log(draft.eventId)).toEqual([]);
    expect(await rateHits("event_publishes")).toBeUndefined();
  });

  it("409 `event_ended` once its end has passed", async () => {
    const draft = await freeDraft();
    await api.db.query(
      `update public.events set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = $1`,
      [draft.eventId],
    );
    const res = await publish(draft.eventId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("event_ended");
    expect(await log(draft.eventId)).toEqual([]);
  });

  it("409 `event_changed` when the ticket link changes between the check and the publish", async () => {
    const draft = await draftEvent(api, organiser, {
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon-static",
      ticketTypes: [],
    });
    // Another request swaps the link for an unknown site just before the publish runs.
    const racing = new TestApi({
      query: async (text, params) => {
        if (text.includes("private.publish_event")) {
          await api.db.query(`update public.events set external_ticket_url = 'https://tickets.example.com.au/x' where id = $1`, [
            draft.eventId,
          ]);
        }
        return api.db.query(text, params);
      },
    } satisfies Db);
    const token = racing.tokenFor({ userId: organiser.userId, email: organiser.email, emailVerified: true, isAdmin: false });
    const res = await racing.call(publishEvent, { token, params: { eventId: draft.eventId }, method: "POST" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "event_changed", error: EVENT_CHANGED_WHILE_PUBLISHING });
    expect(await log(draft.eventId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// To review instead
// ---------------------------------------------------------------------------

describe("POST /events/{id}/publish: to review instead", () => {
  it("an organiser whose events an admin reviews", async () => {
    const set = await api.call(adminSetEventReviewRequired, {
      token: admin.token,
      params: { organiserId: organiser.organiserId },
      body: { required: true, reason: "New venue, checking a few first." },
    });
    expect(set.status).toBe(200);
    const draft = await freeDraft();
    await expectSentToReview(await publish(draft.eventId), draft.eventId);
    // No publish slot taken by an event going to review anyway.
    expect(await rateHits("event_publishes")).toBeUndefined();
  });

  it("an event an admin rejected", async () => {
    const draft = await freeDraft();
    const params = { eventId: draft.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    await api.call(adminRejectEvent, { token: admin.token, params, body: { reason: "Add the set times." } });
    await expectSentToReview(await publish(draft.eventId), draft.eventId);
  });

  it("an event an admin unpublished (with a reason the organiser sees), cleared when it's sent again", async () => {
    const live = await selfPublishedEvent(api, organiser, {
      ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    const params = { eventId: live.eventId };
    const unpublished = await api.call(adminUnpublishEvent, {
      token: admin.token,
      params,
      body: { reason: "The venue says this date isn't confirmed." },
    });
    expect(unpublished.status).toBe(200);
    expect(unpublished.body).toMatchObject({ status: "draft", rejectionReason: "The venue says this date isn't confirmed." });
    const mine = await api.call(getMyEvent, { token: organiser.token, params });
    expect(mine.body.rejectionReason).toBe("The venue says this date isn't confirmed.");
    expect(mine.body.moderationLog.at(-1)).toMatchObject({
      action: "unpublished",
      reason: "The venue says this date isn't confirmed.",
    });

    const res = await publish(live.eventId);
    await expectSentToReview(res, live.eventId);
    expect(res.body.rejectionReason).toBeUndefined();

    // The admins' review email says it's back.
    await api.runDeferred();
    const subjects = api.sendEmail.mock.calls.map(([m]) => m.subject);
    expect(subjects).toContain("Event resubmitted for review");
  });

  it("an event with a seat map", async () => {
    const { event } = await seatedEvent(api, organiser, admin, { publish: false });
    await expectSentToReview(await publish(event.eventId), event.eventId);
  });

  it("a ticket link on a site that isn't a known ticketing site (including an international name)", async () => {
    for (const externalTicketUrl of ["https://tickets.example.com.au/neon", "https://xn--hmanitix-r2a.com/neon"]) {
      const draft = await draftEvent(api, organiser, { ticketingMode: "external", externalTicketUrl, ticketTypes: [] });
      await expectSentToReview(await publish(draft.eventId), draft.eventId);
    }
    expect(needsTicketLinkReview({ ticketingMode: "external", externalTicketUrl: "https://www.eventbrite.com.au/e/1" })).toBe(false);
    expect(needsTicketLinkReview({ ticketingMode: "sheltuh" })).toBe(false);
  });

  it("past the account's 10 publishes in 24 hours, without using up its review emails", async () => {
    for (let i = 0; i < 10; i++) {
      const draft = await freeDraft({ title: `Night ${i + 1}` });
      expect((await publish(draft.eventId)).body.status).toBe("published");
    }
    const eleventh = await freeDraft({ title: "Night 11" });
    await expectSentToReview(await publish(eleventh.eventId), eleventh.eventId);
    expect(await outbox("event_published")).toHaveLength(10);
  });

  it("past the platform's 100 publishes in 24 hours", async () => {
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('event_self_publishes_daily', now(), 100)`,
    );
    const draft = await freeDraft();
    await expectSentToReview(await publish(draft.eventId), draft.eventId);
  });
});

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

describe("admin: unpublish reason", () => {
  it("is optional, and refused when it isn't clean text of at most 500 characters", async () => {
    const live = await selfPublishedEvent(api, organiser, {
      ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    const params = { eventId: live.eventId };
    for (const reason of ["x".repeat(501), "Bad\u0007reason", 42]) {
      const res = await api.call(adminUnpublishEvent, { token: admin.token, params, body: { reason } });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.reason).toBeDefined();
    }
    const blank = await api.call(adminUnpublishEvent, { token: admin.token, params, body: { reason: "   " } });
    expect(blank.status).toBe(200);
    expect(blank.body.rejectionReason).toBeUndefined();
  });
});

describe("admin: the review switch", () => {
  const setReview = (body: unknown, organiserId = organiser.organiserId, token = admin.token) =>
    api.call(adminSetEventReviewRequired, { token, params: { organiserId }, body });

  it("turns review on and off, logged with the reason; the organiser sees the flag", async () => {
    const on = await setReview({ required: true, reason: "Checking their first events." });
    expect(on.status).toBe(200);
    expect(on.headers.get("cache-control")).toBe("private, no-store");
    expect(on.body.eventReviewRequired).toBe(true);
    expect(on.body.recentEdits[0]).toMatchObject({ kind: "profile_edit", byStaff: true, reason: "Checking their first events." });
    const me = await api.call(getMyOrganiser, { token: organiser.token });
    expect(me.body.eventReviewRequired).toBe(true);

    // Already on: unchanged, nothing logged.
    const again = await setReview({ required: true, reason: "Again." });
    expect(again.body.recentEdits).toHaveLength(1);

    const off = await setReview({ required: false, reason: "They're fine." });
    expect(off.body.eventReviewRequired).toBe(false);
    const stored = await api.db.query<{ changed_fields: unknown; actor_id: string }>(
      `select changed_fields, actor_id from private.organiser_profile_edits where organiser_id = $1 order by id`,
      [organiser.organiserId],
    );
    expect(stored).toEqual([
      { changed_fields: { event_review_required: { old: "off", new: "on" } }, actor_id: admin.userId },
      { changed_fields: { event_review_required: { old: "on", new: "off" } }, actor_id: admin.userId },
    ]);
    const draft = await freeDraft();
    expect((await publish(draft.eventId)).body.status).toBe("published");
  });

  it("400 for a missing boolean or reason, 404 unknown, 403 for a non-admin", async () => {
    expect((await setReview({ required: "yes", reason: "x" })).body.fieldErrors.required).toBeDefined();
    expect((await setReview({ required: true })).body.fieldErrors.reason).toBeDefined();
    expect((await setReview({ required: true, reason: "x" }, crypto.randomUUID())).status).toBe(404);
    expect((await setReview({ required: true, reason: "x" }, "nope")).status).toBe(404);
    expect((await setReview({ required: true, reason: "x" }, organiser.organiserId, organiser.token)).status).toBe(403);
  });
});

describe("admin: recently published and the home's count", () => {
  const recent = (query: Record<string, string> = {}) =>
    api.call(adminListEvents, { token: admin.token, query: { status: "published", recent: "1", ...query } });
  const summary = async () => (await api.call(adminSummary, { token: admin.token })).body;

  it("lists recent publishes newest first, with who published them; the summary counts the organisers' own", async () => {
    const byAdmin = await publishedEvent(api, organiser, admin, { title: "Approved by admin" });
    const self = await selfPublishedEvent(api, organiser, {
      title: "Self published",
      ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    const old = await selfPublishedEvent(api, organiser, {
      title: "Long ago",
      ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    await api.db.query(
      `update public.event_moderation_log set created_at = now() - make_interval(days => $2::int + 1)
        where event_id = $1 and action = 'approved'`,
      [old.eventId, RECENTLY_PUBLISHED_DAYS],
    );
    await api.db.query(
      `update public.event_moderation_log set created_at = created_at - interval '1 minute'
        where event_id = $1 and action = 'approved'`,
      [byAdmin.eventId],
    );

    const res = await recent();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.items.map((e: { title: string; publishedBy: string }) => [e.title, e.publishedBy])).toEqual([
      ["Self published", "organiser"],
      ["Approved by admin", "sheltuh"],
    ]);
    expect(typeof res.body.items[0].publishedAt).toBe("string");

    // Every published admin record says who published it; other statuses don't.
    const all = await api.call(adminListEvents, { token: admin.token, query: { status: "published" } });
    expect(all.body.items.find((e: { eventId: string }) => e.eventId === old.eventId).publishedBy).toBe("organiser");
    const draft = await freeDraft();
    const drafts = await api.call(adminListEvents, { token: admin.token, query: { status: "draft" } });
    const draftItem = drafts.body.items.find((e: { eventId: string }) => e.eventId === draft.eventId);
    expect(draftItem.publishedAt).toBeUndefined();
    expect(draftItem.publishedBy).toBeUndefined();

    expect((await summary()).eventsPublishedByOrganisers).toEqual({ count: 1, windowHours: SELF_PUBLISHED_WINDOW_HOURS });
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: self.eventId }, method: "POST" });
    expect((await summary()).eventsPublishedByOrganisers.count).toBe(0);
    expect((await recent()).body.items.map((e: { title: string }) => e.title)).toEqual(["Approved by admin"]);
  });

  it("recent needs status=published; it isn't counted past the window", async () => {
    const res = await api.call(adminListEvents, { token: admin.token, query: { status: "pending_review", recent: "1" } });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.recent).toBeDefined();
    expect((await recent({ recent: "maybe" })).status).toBe(400);

    const self = await selfPublishedEvent(api, organiser, {
      ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    await api.db.query(
      `update public.event_moderation_log set created_at = now() - make_interval(hours => $2::int + 1)
        where event_id = $1 and action = 'approved'`,
      [self.eventId, SELF_PUBLISHED_WINDOW_HOURS],
    );
    expect((await summary()).eventsPublishedByOrganisers.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Everything that reads "approved" treats a self-publish as published
// ---------------------------------------------------------------------------

describe("compatibility with readers of the `approved` entry", () => {
  /** "YYYY-MM-DD", `days` from today (UTC: a day either way doesn't matter here). */
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  it("trending: eligible once the organiser's own approval is 6 hours old", async () => {
    const live = await selfPublishedEvent(api, organiser, {
      start: { date: inDays(10), time: "20:00" },
      end: { date: inDays(10), time: "23:00" },
      ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }],
    });
    for (let i = 0; i < 3; i++) {
      const fan = await api.signUp();
      await api.db.query(`insert into public.event_favourites (user_id, event_id) values ($1, $2)`, [fan.userId, live.eventId]);
    }
    const ranked = async () => {
      await api.db.query(`select * from private.refresh_trending(now())`);
      return (await api.db.query<{ event_id: string }>(`select event_id from private.trending_snapshot`)).map((r) => r.event_id);
    };
    expect(await ranked()).not.toContain(live.eventId);
    await api.db.query(
      `update public.event_moderation_log set created_at = now() - interval '7 hours' where event_id = $1 and action = 'approved'`,
      [live.eventId],
    );
    expect(await ranked()).toContain(live.eventId);
  });

  it("analytics: everPublished", async () => {
    const live = await selfPublishedEvent(api, organiser, {
      ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    const res = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: live.eventId } });
    expect(res.status).toBe(200);
    expect(res.body.event.everPublished).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema and module boundaries
// ---------------------------------------------------------------------------

describe("schema", () => {
  it("the new and redefined functions pin search_path, aren't security definer and aren't client-executable", async () => {
    const names = ["drop_published_email", "lease_outbox_jobs", "publish_event", "queue_review_email", "set_event_review_required"];
    const rows = await api.db.query<{ fn: string; pinned: boolean; definer: boolean; client: boolean }>(
      `select p.proname as fn,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as pinned,
              p.prosecdef as definer,
              has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) order by 1`,
      [names],
    );
    expect(rows).toEqual(names.map((fn) => ({ fn, pinned: true, definer: false, client: false })));
    const [column] = await api.db.query<{ is_nullable: string; column_default: string }>(
      `select is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'organisers' and column_name = 'event_review_required'`,
    );
    expect(column).toEqual({ is_nullable: "NO", column_default: "false" });
  });
});

describe("module boundaries", () => {
  const ROOT = path.resolve(import.meta.dirname, "../..");

  /** Every repo module `entry` loads at runtime (type-only imports are erased), by relative path. */
  function runtimeImports(entry: string): Set<string> {
    const seen = new Set<string>();
    const visit = (file: string) => {
      const rel = path.relative(ROOT, file);
      if (seen.has(rel)) return;
      seen.add(rel);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/^(import|export)\s+(type\s+)?[^;'"]*?from\s+["']([^"']+)["']/gm)) {
        if (match[2]) continue;
        const spec = match[3];
        const base = spec.startsWith("@/")
          ? path.join(ROOT, spec.slice(2))
          : spec.startsWith(".")
            ? path.resolve(path.dirname(file), spec)
            : null;
        if (!base) continue;
        const resolved = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), base].find((candidate) => {
          try {
            readFileSync(candidate);
            return true;
          } catch {
            return false;
          }
        });
        if (resolved) visit(resolved);
      }
    };
    visit(path.join(ROOT, entry));
    return seen;
  }

  it("the publish route doesn't load the suburb table (event-input, lib/location, lib/localities)", () => {
    const loaded = runtimeImports("app/api/events/[eventId]/publish/route.ts");
    // Walked to the bottom (these are only reached through other modules).
    for (const deep of ["lib/server/handlers/event-publish.ts", "lib/server/email-outbox.ts", "lib/server/records.ts", "lib/ticketing.ts"]) {
      expect(loaded).toContain(deep);
    }
    // And it would see the suburb table where it is loaded.
    expect(runtimeImports("lib/server/handlers/events.ts")).toContain("lib/localities.ts");
    for (const heavy of ["lib/server/event-input.ts", "lib/server/handlers/events.ts", "lib/location.ts", "lib/localities.ts"]) {
      expect(loaded).not.toContain(heavy);
    }
  });

  it("neither do the venue search routes (app/api/places/*)", () => {
    for (const entry of ["app/api/places/autocomplete/route.ts", "app/api/places/details/route.ts"]) {
      const loaded = runtimeImports(entry);
      for (const deep of ["lib/server/handlers/places.ts", "lib/server/places.ts", "lib/server/records.ts"]) {
        expect(loaded, entry).toContain(deep);
      }
      for (const heavy of ["lib/server/event-input.ts", "lib/server/handlers/events.ts", "lib/location.ts", "lib/localities.ts"]) {
        expect(loaded, entry).not.toContain(heavy);
      }
    }
    expect(runtimeImports("app/api/events/[eventId]/publish/route.ts")).toContain("lib/server/location-refusal.ts");
  });
});
