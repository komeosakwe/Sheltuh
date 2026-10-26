import nodemailer from "nodemailer";
import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEventReviewEmail,
  buildOrganiserReviewEmail,
  eventReviewQueueLink,
  MAX_ADMIN_NOTIFY_EMAILS,
  organiserReviewQueueLink,
  parseAdminNotifyEmails,
  reviewEventStart,
} from "@/lib/server/admin-review-email";
import { mailOptions } from "@/lib/server/email";
import { drainEmailOutbox } from "@/lib/server/email-outbox";
import {
  adminApproveEvent,
  adminApproveOrganiser,
  adminRejectEvent,
  adminRejectOrganiser,
  adminSummary,
} from "@/lib/server/handlers/admin";
import { adminCreateEvent, adminCreateOrganiser } from "@/lib/server/handlers/admin-authoring";
import { adminListEmailJobs, runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { createEventDraft, submitEventForReview, updateEventDraft } from "@/lib/server/handlers/events";
import { applyAsOrganiser, resubmitOrganiser } from "@/lib/server/handlers/organisers";
import { CRON_SECRET, SITE_URL, TestApi } from "./helpers/api";
import { application, approvedOrganiser, draftEvent, eventInput, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// The admins' "waiting for your review" emails: docs/architecture.md, "Admin
// review emails"; supabase/migrations/20261107000000_admin_review_emails.sql.

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string; email: string };
let organiser: { token: string; userId: string; email: string; organiserId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  serverUrl = testDb.url;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  // The setup's own application email: reviewed (approved) before it was sent, so nothing went out.
  await api.runDeferred();
  api.sendEmail.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface JobRow {
  id: string;
  kind: string;
  status: string;
  event_id: string | null;
  organiser_id: string | null;
  attempts: number;
  due: boolean;
  next_attempt_at: Date;
  sent_at: Date | null;
}

async function reviewJobs(kind?: "event_review" | "organiser_review") {
  return api.db.query<JobRow>(
    `select j.id::text, j.kind, j.status, j.event_id, j.organiser_id, j.attempts, j.next_attempt_at <= now() as due,
            j.next_attempt_at, j.sent_at
       from private.email_outbox j
      where j.kind in ('event_review', 'organiser_review') and ($1::text is null or j.kind = $1)
      order by j.id`,
    [kind ?? null],
  );
}

const submit = (eventId: string, token = organiser.token) =>
  api.call(submitEventForReview, { token, params: { eventId }, method: "POST" });
const approveEvent = (eventId: string) =>
  api.call(adminApproveEvent, { token: admin.token, params: { eventId }, method: "POST" });
const rejectEvent = (eventId: string) =>
  api.call(adminRejectEvent, { token: admin.token, params: { eventId }, body: { reason: "Add a photo." } });
const recipients = () => api.sendEmail.mock.calls.map(([message]) => message.to).sort();
const sent = () => api.sendEmail.mock.calls.map(([message]) => message);

describe("an event submitted for review", () => {
  it("queues one job with the submission and emails each admin with a confirmed address, straight after the response", async () => {
    const second = await api.signUp({ admin: true, email: "second-admin@sheltuh.test" });
    await api.signUp({ admin: true, email: "unconfirmed-admin@sheltuh.test", emailVerified: false });
    await api.signUp({ email: "member@example.com" });
    const draft = await draftEvent(api, organiser);

    const res = await submit(draft.eventId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_review");
    const jobs = await reviewJobs();
    expect(jobs).toMatchObject([{ kind: "event_review", status: "pending", event_id: draft.eventId, due: true }]);
    expect(api.sendEmail).not.toHaveBeenCalled(); // not before the response

    await api.runDeferred();
    expect(recipients()).toEqual([admin.email, second.email].sort());
    const [message] = sent();
    expect(message.subject).toBe("Event submitted for review");
    expect(message.text).toContain("As submitted by the organiser:\nTitle: Neon Static");
    expect(message.text).toContain(`Organiser: ${application.displayName}`);
    expect(message.text).toContain(`Starts ${reviewEventStart(draft.startsAt)}`);
    expect(reviewEventStart(draft.startsAt)).toMatch(/6 March 2027, 8:00 pm AEDT$/);
    expect(message.text).toContain(`${SITE_URL}/admin/events?status=pending_review`);
    expect(message.html).toContain(`href="${SITE_URL}/admin/events?status=pending_review"`);
    expect(message.text).toContain("An event is waiting for review");

    const [job] = await reviewJobs();
    expect(job).toMatchObject({ status: "sent", attempts: 1 });
    const [{ n }] = await api.db.query<{ n: number }>(
      `select count(*)::int as n from private.email_job_recipients where job_id = $1::bigint`,
      [job.id],
    );
    expect(n).toBe(2);
  });

  it("says nothing about buyers or the organiser's contact details, and the job stores no address or content", async () => {
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    await api.runDeferred();
    const [message] = sent();
    for (const part of [message.subject, message.text, message.html]) {
      expect(part).not.toContain(application.contactEmail);
      expect(part).not.toContain(organiser.email);
      expect(part).not.toContain("Four bands"); // the description
      expect(part).not.toContain("71 Johnston St"); // the venue address
      expect(part).not.toContain("<img"); // no tracking pixel, no remote image
    }
    // No address anywhere in the text (not even the recipient's).
    expect(message.text).not.toMatch(/@/);
    const rows = await api.db.query<{ job: string }>(
      `select row_to_json(j)::text as job from private.email_outbox j where j.kind = 'event_review'`,
    );
    expect(rows[0].job).not.toContain("@");
    const hashes = await api.db.query<{ recipient_hash: string }>(`select recipient_hash from private.email_job_recipients`);
    for (const { recipient_hash } of hashes) expect(recipient_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("goes to ADMIN_NOTIFY_EMAILS instead of the admin accounts when it's set", async () => {
    api.adminNotifyEmails = ["ops@sheltuh.test", "kome@sheltuh.test"];
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    await api.runDeferred();
    expect(recipients()).toEqual(["kome@sheltuh.test", "ops@sheltuh.test"]);
  });

  it("isn't queued for a draft that's only saved, or edited, without being submitted", async () => {
    const created = await api.call(createEventDraft, { token: organiser.token, body: eventInput() });
    expect(created.status).toBe(201);
    const edited = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId: created.body.eventId },
      body: eventInput({ title: "Neon Static II" }),
      method: "PATCH",
    });
    expect(edited.status).toBe(200);
    await api.runDeferred();
    expect(await reviewJobs()).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("isn't queued for events an admin creates (for an organiser or a platform-managed one), or for a platform organiser", async () => {
    const platform = await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: { ...application, displayName: "Sheltüh Presents", contactEmail: "events@sheltuh.example" },
    });
    expect(platform.status).toBe(201);
    for (const organiserId of [organiser.organiserId, platform.body.organiserId as string]) {
      const res = await api.call(adminCreateEvent, {
        token: admin.token,
        body: { ...eventInput({ ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }] }), organiserId },
      });
      expect(res.status).toBe(201);
    }
    await api.runDeferred();
    expect(await reviewJobs()).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("a refused submission queues nothing, and a second submit while in review adds nothing", async () => {
    const draft = await draftEvent(api, organiser);
    const other = await approvedOrganiser(api, admin, { displayName: "Other" });
    await api.runDeferred();
    api.sendEmail.mockClear();
    expect((await submit(draft.eventId, other.token)).status).toBe(404);
    expect(await reviewJobs("event_review")).toEqual([]);
    expect((await submit(draft.eventId)).status).toBe(200);
    expect((await submit(draft.eventId)).status).toBe(409); // already pending: nothing more queued
    expect(await reviewJobs("event_review")).toHaveLength(1);
  });

  it("is dropped, unsent, when an admin reviews the event first", async () => {
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    expect(await reviewJobs()).toHaveLength(1);
    expect((await approveEvent(draft.eventId)).status).toBe(200);
    expect(await reviewJobs()).toEqual([]);
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("isn't sent by a worker that finds the event already reviewed (skipped, not retried)", async () => {
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    // As if the worker leased it just before the approval (a leased job isn't dropped).
    await api.db.query(
      `update private.email_outbox set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() - interval '1 second'
        where kind = 'event_review'`,
    );
    await approveEvent(draft.eventId);
    expect(await drainEmailOutbox(api.deps, { kind: "event_review" })).toMatchObject({ claimed: 1, failed: 1 });
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect(await reviewJobs()).toMatchObject([{ status: "failed" }]);
  });

  it("notifies a resubmission, no sooner than an hour after the last email about the same event", async () => {
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect((await rejectEvent(draft.eventId)).status).toBe(200);

    expect((await submit(draft.eventId)).status).toBe(200);
    const jobs = await reviewJobs();
    expect(jobs).toHaveLength(2);
    const [first, second] = jobs;
    expect(second).toMatchObject({ status: "pending", due: false });
    const gap = second.next_attempt_at.getTime() - (first.sent_at as Date).getTime();
    expect(gap).toBe(60 * 60 * 1000);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1); // still the first one only

    // An hour later (the cron route sends it).
    await api.db.query(`update private.email_outbox set next_attempt_at = now() where id = $1::bigint`, [second.id]);
    expect((await api.call(runEmailOutboxCron, { token: CRON_SECRET })).body).toMatchObject({ claimed: 1, sent: 1 });
    expect(api.sendEmail).toHaveBeenCalledTimes(2);
    const resent = sent()[1];
    expect(resent.subject).toBe("Event resubmitted for review");
    expect(resent.text).toContain("An event was resubmitted for review");
  });

  it("sends a resubmission straight away when the last email was over an hour ago", async () => {
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    await api.runDeferred();
    await rejectEvent(draft.eventId);
    await api.db.query(`update private.email_outbox set sent_at = now() - interval '61 minutes' where kind = 'event_review'`);
    await submit(draft.eventId);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("an organiser submitting, being rejected and resubmitting repeatedly gets at most one email waiting, an hour apart", async () => {
    const draft = await draftEvent(api, organiser);
    for (let i = 0; i < 5; i++) {
      expect((await submit(draft.eventId)).status).toBe(200);
      await api.runDeferred();
      expect((await rejectEvent(draft.eventId)).status).toBe(200);
    }
    await submit(draft.eventId);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const waiting = (await reviewJobs()).filter((j) => j.status === "pending" || j.status === "sending");
    expect(waiting).toHaveLength(1);
    expect(waiting[0].due).toBe(false);
  });

  it("queues nothing more while one is waiting (private.queue_review_email), whoever calls it", async () => {
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    const [{ queued }] = await api.db.query<{ queued: boolean }>(
      `select private.queue_review_email('event_review', $1) as queued`,
      [draft.eventId],
    );
    expect(queued).toBe(false);
    expect(await reviewJobs()).toHaveLength(1);
  });

  it("stops queueing at 100 a day platform-wide; the submission still goes through", async () => {
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('admin_review_emails_daily', now(), 100)
       on conflict (bucket) do update set window_started_at = now(), hits = 100`,
    );
    const draft = await draftEvent(api, organiser);
    const res = await submit(draft.eventId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_review");
    expect(await reviewJobs()).toEqual([]);
  });

  it("stops queueing at 10 a day per account, without taking platform slots or stopping another organiser's emails", async () => {
    const other = await approvedOrganiser(api, admin, { displayName: "Other Collective" });
    await api.runDeferred();
    api.sendEmail.mockClear();
    const platformHits = async () =>
      (
        await api.db.query<{ hits: number }>(
          `select hits from private.platform_rate_limits where bucket = 'admin_review_emails_daily'`,
        )
      )[0].hits;
    // The organiser's own application (beforeEach) was the account's first; 9 more events make 10.
    for (let i = 0; i < 9; i++) {
      const draft = await draftEvent(api, organiser, { title: `Draft ${i}` });
      expect((await submit(draft.eventId)).status).toBe(200);
    }
    expect(await reviewJobs("event_review")).toHaveLength(9);
    const before = await platformHits();

    const over = await draftEvent(api, organiser, { title: "One too many" });
    const res = await submit(over.eventId);
    expect(res.status).toBe(200); // the submission still goes through
    expect(res.body.status).toBe("pending_review");
    expect(await reviewJobs("event_review")).toHaveLength(9);
    expect(await platformHits()).toBe(before); // refused before the platform's bucket

    const theirs = await draftEvent(api, other, { title: "Their Show" });
    expect((await submit(theirs.eventId, other.token)).status).toBe(200);
    expect((await reviewJobs("event_review")).filter((j) => j.event_id === theirs.eventId)).toHaveLength(1);
    await api.runDeferred();
    expect(sent().some((m) => m.text.includes("Their Show"))).toBe(true);
    expect(sent().some((m) => m.text.includes("One too many"))).toBe(false);
  });

  it("retries only the admins a partial failure missed", async () => {
    const second = await api.signUp({ admin: true, email: "second-admin@sheltuh.test" });
    api.sendEmail.mockImplementation(async (message) => {
      if (message.to === second.email) throw new Error(`550 mailbox unavailable: ${second.email}`);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    await api.runDeferred();
    const [job] = await reviewJobs();
    expect(job).toMatchObject({ status: "pending", attempts: 1, due: false });
    const [{ last_error }] = await api.db.query<{ last_error: string }>(
      `select last_error from private.email_outbox where id = $1::bigint`,
      [job.id],
    );
    expect(last_error).not.toContain("@");
    expect(errors.mock.calls.flat().join(" ")).not.toContain("@");

    api.sendEmail.mockReset();
    api.sendEmail.mockResolvedValue(undefined);
    await api.db.query(`update private.email_outbox set next_attempt_at = now() where id = $1::bigint`, [job.id]);
    expect(await drainEmailOutbox(api.deps)).toMatchObject({ claimed: 1, sent: 1 });
    expect(recipients()).toEqual([second.email]); // not the admin who already had it
  });

  it("isn't sent to a banned or deleted admin account (a ban that has ended counts again)", async () => {
    const banned = await api.signUp({ admin: true, email: "banned-admin@sheltuh.test" });
    const deleted = await api.signUp({ admin: true, email: "deleted-admin@sheltuh.test" });
    const unbanned = await api.signUp({ admin: true, email: "unbanned-admin@sheltuh.test" });
    await api.db.query(`update auth.users set banned_until = now() + interval '100 years' where id = $1`, [banned.userId]);
    await api.db.query(`update auth.users set deleted_at = now() where id = $1`, [deleted.userId]);
    await api.db.query(`update auth.users set banned_until = now() - interval '1 day' where id = $1`, [unbanned.userId]);
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    await api.runDeferred();
    expect(recipients()).toEqual([admin.email, unbanned.email].sort());
  });

  it("stops before its lease runs short, and the retry reaches only the admins it missed", async () => {
    const second = await api.signUp({ admin: true, email: "second-admin@sheltuh.test" });
    const realNow = Date.now.bind(Date);
    let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + elapsed);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The first send takes 61 seconds: under a minute of the 2-minute lease is left for the next.
    api.sendEmail.mockImplementationOnce(async () => {
      elapsed += 61_000;
    });
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const [first] = recipients();
    const [job] = await reviewJobs();
    expect(job).toMatchObject({ status: "pending", attempts: 1, due: false });
    const [{ last_error }] = await api.db.query<{ last_error: string }>(
      `select last_error from private.email_outbox where id = $1::bigint`,
      [job.id],
    );
    expect(last_error).toContain("lease");

    api.sendEmail.mockClear();
    await api.db.query(`update private.email_outbox set next_attempt_at = now() where id = $1::bigint`, [job.id]);
    expect(await drainEmailOutbox(api.deps)).toMatchObject({ claimed: 1, sent: 1 });
    expect(recipients()).toEqual([admin.email, second.email].filter((email) => email !== first));
  });

  it("is skipped, with one log line and no address, when there's nobody to send to", async () => {
    await api.db.query(`update auth.users set raw_app_meta_data = '{}'::jsonb`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await draftEvent(api, organiser, { title: "One" });
    const second = await draftEvent(api, organiser, { title: "Two" });
    await submit(first.eventId);
    await submit(second.eventId);
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect((await reviewJobs()).map((j) => j.status)).toEqual(["failed", "failed"]);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("@");
  });

  it("isn't in the admin email list (ticket emails only) or its failure counts", async () => {
    await api.db.query(`update auth.users set raw_app_meta_data = '{}'::jsonb where id <> $1`, [admin.userId]);
    api.sendEmail.mockRejectedValue(new Error("SMTP down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    await api.runDeferred();
    await api.db.query(`update private.email_outbox set status = 'failed' where kind = 'event_review'`);
    for (const status of ["failed", "pending", "sent"]) {
      const list = await api.call(adminListEmailJobs, { token: admin.token, query: { status } });
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([]);
    }
    const summary = await api.call(adminSummary, { token: admin.token });
    expect(summary.body.emailsFailed.count).toBe(0);
    expect(summary.body.emailsRetrying.count).toBe(0);
  });
});

describe("an organiser application", () => {
  const apply = (token: string, body: Record<string, unknown> = {}) =>
    api.call(applyAsOrganiser, { token, body: { ...application, displayName: "Fresh Faces", ...body } });

  it("emails each admin once, with the organiser's name and the queue link only", async () => {
    const applicant = await api.signUp();
    const res = await apply(applicant.token);
    expect(res.status).toBe(201);
    expect(await reviewJobs("organiser_review")).toMatchObject([
      { status: "pending", organiser_id: res.body.organiserId, due: true },
    ]);
    await api.runDeferred();
    expect(recipients()).toEqual([admin.email]);
    const [message] = sent();
    expect(message.subject).toBe("Organiser application to review");
    expect(message.text).toContain("As submitted by the organiser:\nOrganiser name: Fresh Faces");
    expect(message.text).toContain(`${SITE_URL}/admin/organisers`);
    expect(message.html).toContain(`href="${SITE_URL}/admin/organisers"`);
    for (const part of [message.subject, message.text, message.html]) {
      expect(part).not.toContain(application.contactEmail);
      expect(part).not.toContain(applicant.email);
      expect(part).not.toContain(application.description);
      expect(part).not.toContain(application.websiteUrl);
    }
    expect(await reviewJobs("organiser_review")).toMatchObject([{ status: "sent" }]);
  });

  it("emails again when a rejected application is resubmitted (throttled like events)", async () => {
    const applicant = await api.signUp();
    const res = await apply(applicant.token);
    await api.runDeferred();
    const organiserId = res.body.organiserId as string;
    const rejected = await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId },
      body: { reason: "Tell us more." },
    });
    expect(rejected.status).toBe(200);
    await api.db.query(`update private.email_outbox set sent_at = now() - interval '2 hours' where organiser_id = $1`, [
      organiserId,
    ]);

    const resubmitted = await api.call(resubmitOrganiser, {
      token: applicant.token,
      body: { ...application, displayName: "Fresh Faces Collective" },
      method: "PATCH",
    });
    expect(resubmitted.status).toBe(200);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(2);
    expect(sent()[1].subject).toBe("Organiser application to review");
    expect(sent()[1].text).toContain("Organiser name: Fresh Faces Collective");
  });

  it("is dropped when an admin approves the application before it's sent", async () => {
    const applicant = await api.signUp();
    const res = await apply(applicant.token);
    await api.call(adminApproveOrganiser, {
      token: admin.token,
      params: { organiserId: res.body.organiserId },
      method: "POST",
    });
    expect(await reviewJobs("organiser_review")).toEqual([]);
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("isn't queued once the applicant's account has had 10 review emails today", async () => {
    const applicant = await api.signUp();
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'review_emails', now(), 10)`,
      [applicant.userId],
    );
    const res = await apply(applicant.token);
    expect(res.status).toBe(201);
    expect(await reviewJobs("organiser_review")).toEqual([]);
  });

  it("isn't queued by an approved organiser's profile edit, a refused application or an admin-created organiser", async () => {
    const edit = await api.call(resubmitOrganiser, {
      token: organiser.token,
      body: { description: "New bio." },
      method: "PATCH",
    });
    expect(edit.status).toBe(200);
    expect((await api.call(applyAsOrganiser, { token: organiser.token, body: application })).status).toBe(409);
    const invalid = await api.signUp();
    expect((await apply(invalid.token, { contactEmail: "nope" })).status).toBe(400);
    await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: { ...application, displayName: "Sheltüh Presents", contactEmail: "events@sheltuh.example" },
    });
    await api.runDeferred();
    expect(await reviewJobs("organiser_review")).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();
  });
});

describe("the deploy window", () => {
  it("the previous release's claim (claim_email_outbox) leaves review jobs alone", async () => {
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    const claimed = await api.db.query(`select * from private.claim_email_outbox(10, '2 minutes'::interval, 6, null, null)`);
    expect(claimed).toEqual([]);
    expect(await reviewJobs()).toMatchObject([{ status: "pending", attempts: 0 }]);
  });
});

describe("the review emails' content", () => {
  it("are plain addresses to one recipient each, through the SMTP options", async () => {
    const message = buildEventReviewEmail({
      to: "ops@sheltuh.test",
      title: "Neon‮ Static\r\nBcc: x@evil.test",
      organiserName: "Rogue‏\nRecords",
      startsAt: "2027-03-06T09:00:00.000Z",
      resubmitted: false,
      siteUrl: SITE_URL,
    });
    expect(message.subject).toBe("Event submitted for review");
    expect(message.text).toContain("Title: Neon Static Bcc: x@evil.test");
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const info = await transport.sendMail(mailOptions("Sheltüh <support@sheltuh.test>", message));
    const headers = (info.message as Buffer).toString("utf8").split("\n\n")[0];
    expect(headers).toMatch(/^To: ops@sheltuh\.test$/m);
    expect(headers).not.toMatch(/^bcc:/im);
    expect(message.html).not.toContain("‮");
  });

  it("keep organiser-supplied text out of the subject and preheader, and label it in the body", () => {
    const phish = "URGENT: admin password reset required";
    const emails = [
      buildEventReviewEmail({
        to: "ops@sheltuh.test",
        title: phish,
        organiserName: phish,
        startsAt: "2027-03-06T09:00:00.000Z",
        resubmitted: false,
        siteUrl: SITE_URL,
      }),
      buildEventReviewEmail({
        to: "ops@sheltuh.test",
        title: phish,
        organiserName: phish,
        startsAt: "2027-03-06T09:00:00.000Z",
        resubmitted: true,
        siteUrl: SITE_URL,
      }),
      buildOrganiserReviewEmail({ to: "ops@sheltuh.test", organiserName: phish, siteUrl: SITE_URL }),
    ];
    expect(emails.map((m) => m.subject)).toEqual([
      "Event submitted for review",
      "Event resubmitted for review",
      "Organiser application to review",
    ]);
    for (const message of emails) {
      expect(message.subject).not.toContain("URGENT");
      // The preheader (the inbox preview) is the hidden first div; the title tag is the fixed headline.
      const preheader = message.html.match(/<div style="display:none[^>]*>([^<]*)/)![1];
      expect(preheader).not.toContain("URGENT");
      expect(message.html.match(/<title>([^<]*)<\/title>/)![1]).not.toContain("URGENT");
      expect(message.text).toContain("As submitted by the organiser:");
      expect(message.html).toContain("As submitted by the organiser:");
    }
  });

  it("escape organiser-supplied text in the HTML", () => {
    const message = buildOrganiserReviewEmail({ to: "ops@sheltuh.test", organiserName: "<script>x</script>", siteUrl: SITE_URL });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&#60;script&#62;");
  });

  it("link to the queues", () => {
    expect(eventReviewQueueLink(SITE_URL)).toBe(`${SITE_URL}/admin/events?status=pending_review`);
    expect(organiserReviewQueueLink(SITE_URL)).toBe(`${SITE_URL}/admin/organisers`);
  });
});

describe("parseAdminNotifyEmails (ADMIN_NOTIFY_EMAILS)", () => {
  it("splits on commas, trims, skips blanks, keeps repeats once and counts invalid entries", () => {
    expect(parseAdminNotifyEmails(undefined)).toEqual({ emails: [], ignored: 0 });
    expect(parseAdminNotifyEmails("")).toEqual({ emails: [], ignored: 0 });
    expect(parseAdminNotifyEmails(" ops@sheltuh.test , ,Kome@Sheltuh.test,kome@sheltuh.test ")).toEqual({
      emails: ["ops@sheltuh.test", "Kome@Sheltuh.test"],
      ignored: 0,
    });
    expect(parseAdminNotifyEmails("Ops <ops@sheltuh.test>, a@b.test; c@d.test, nope")).toEqual({
      emails: [],
      ignored: 3,
    });
  });

  it(`keeps at most ${MAX_ADMIN_NOTIFY_EMAILS}`, () => {
    const list = Array.from({ length: MAX_ADMIN_NOTIFY_EMAILS + 2 }, (_, i) => `a${i}@sheltuh.test`).join(",");
    const parsed = parseAdminNotifyEmails(list);
    expect(parsed.emails).toHaveLength(MAX_ADMIN_NOTIFY_EMAILS);
    expect(parsed.ignored).toBe(2);
  });
});

// Two sessions at once: only a real server (PGlite is one connection). Run
// with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrency (real Postgres only)", () => {
  async function waitUntilBlocked(conn: postgres.Sql) {
    const [{ pid }] = await conn.unsafe("select pg_backend_pid() as pid");
    return async () => {
      for (let i = 0; ; i++) {
        const [row] = await api.db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (row?.wait_event_type === "Lock") return;
        if (i > 200) throw new Error("never blocked");
        await new Promise((r) => setTimeout(r, 25));
      }
    };
  }

  it("two queue attempts for the same event at once: the second waits, then adds nothing", async () => {
    const draft = await draftEvent(api, organiser);
    // In review without a job (as if the platform cap had been reached then).
    await api.db.query(`update public.events set status = 'pending_review' where id = $1`, [draft.eventId]);
    await api.db.query(`delete from private.email_outbox where kind = 'event_review'`);
    const queue = (conn: postgres.Sql) =>
      conn.unsafe(`select private.queue_review_email('event_review', $1) as queued`, [draft.eventId]);
    const one = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const two = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      await one.unsafe("begin");
      expect((await queue(one))[0].queued).toBe(true);
      const blocked = await waitUntilBlocked(two);
      const pending = queue(two).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].queued).toBe(false);
    } finally {
      await one.end();
      await two.end();
    }
    expect(await reviewJobs()).toHaveLength(1);
  });

  it("a worker claiming while an approval drops the job: it skips the locked job (no wait), and nothing is sent", async () => {
    const draft = await draftEvent(api, organiser);
    await submit(draft.eventId);
    expect(await reviewJobs()).toHaveLength(1);
    const one = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const two = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      await one.unsafe("begin");
      const [approved] = await one.unsafe(
        `select private.transition_event($1, array['pending_review']::public.event_status[], 'published', 'approved', $2) as moved`,
        [draft.eventId, admin.userId],
      );
      expect(approved.moved).toBe(true); // the job is deleted, uncommitted
      const claimed = await two.unsafe(`select * from private.lease_outbox_jobs(10, '2 minutes'::interval, 6, null, 'event_review')`);
      expect(claimed).toEqual([]); // skip locked: not taken, not waited for
      await one.unsafe("commit");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await reviewJobs()).toEqual([]);
    expect(await drainEmailOutbox(api.deps)).toMatchObject({ claimed: 0 });
    expect(api.sendEmail).not.toHaveBeenCalled();
  });
});
