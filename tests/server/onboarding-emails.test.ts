import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApproveOrganiser, adminRejectOrganiser } from "@/lib/server/handlers/admin";
import { runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { acceptInvite, adminCreateInvite } from "@/lib/server/handlers/invites";
import { joinWithOrganiserLink, adminCreateOrganiserLink } from "@/lib/server/handlers/organiser-links";
import { applyAsOrganiser, resubmitOrganiser } from "@/lib/server/handlers/organisers";
import type { EmailMessage } from "@/lib/server/email";
import {
  buildMemberWelcomeEmail,
  buildOrganiserNextStepsEmail,
  buildOrganiserWelcomeEmail,
} from "@/lib/server/onboarding-email";
import { CRON_SECRET, SITE_URL, TestApi } from "./helpers/api";
import { application, approvedOrganiser, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// Onboarding emails: docs/architecture.md, "Onboarding emails";
// supabase/migrations/20261111000700_onboarding_emails.sql;
// lib/server/email-outbox.ts (deliverOnboardingEmail).

let api: TestApi;
let reset: () => Promise<void>;

beforeAll(async () => {
  const testDb = await createTestDb({ onboardingEmails: true });
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Accounts here start with no welcome record, as a new account does (TestApi.signUp otherwise records one). */
const signUp = (options: Parameters<TestApi["signUp"]>[0] = {}) => api.signUp({ welcomed: false, ...options });

type Kind = "member_welcome" | "organiser_welcome_pending" | "organiser_welcome_approved" | "organiser_next_steps";

/** Which onboarding email a sent message is (by building each for its recipient and comparing), or "other". */
function classify(message: EmailMessage): Kind | "other" {
  const to = message.to;
  const candidates: [Kind, EmailMessage][] = [
    ["member_welcome", buildMemberWelcomeEmail({ to, siteUrl: SITE_URL })],
    ["organiser_welcome_pending", buildOrganiserWelcomeEmail({ to, status: "pending", siteUrl: SITE_URL })],
    ["organiser_welcome_approved", buildOrganiserWelcomeEmail({ to, status: "approved", siteUrl: SITE_URL })],
    ["organiser_next_steps", buildOrganiserNextStepsEmail({ to, siteUrl: SITE_URL })],
  ];
  return candidates.find(([, built]) => built.subject === message.subject && built.text === message.text)?.[0] ?? "other";
}

/** The onboarding emails the API has sent to `email` (anything else it sent them, an invite say, isn't listed). */
function sentTo(email: string): Kind[] {
  return api.sendEmail.mock.calls
    .map(([message]) => message)
    .filter((message) => message.to === email)
    .map(classify)
    .filter((kind): kind is Kind => kind !== "other");
}

function cron() {
  return api.send(
    runEmailOutboxCron,
    new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
  );
}

const records = (userId: string) =>
  api.db.query<{ kind: string }>(`select kind from private.onboarding_emails where user_id = $1 order by kind`, [userId]);

const jobs = () =>
  api.db.query<{ id: string; kind: string; status: string; last_error: string | null; onboarding_id: string | null; secs: number }>(
    `select id::text, kind, status, last_error, onboarding_id, extract(epoch from (next_attempt_at - now()))::float as secs
       from private.email_outbox where kind = 'onboarding' order by id`,
  );

/** Makes every waiting onboarding job due now (the next steps are queued an hour ahead). */
const makeDue = () => api.db.query(`update private.email_outbox set next_attempt_at = now() where kind = 'onboarding' and status = 'pending'`);

/** An organiser with an owner, applied for as the API does; the deferred sends are left for the test to run. */
async function apply(user: { token: string }) {
  const res = await api.call(applyAsOrganiser, { token: user.token, body: application });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.organiserId as string;
}

const approve = (adminToken: string, organiserId: string) =>
  api.call(adminApproveOrganiser, { token: adminToken, params: { organiserId }, method: "POST" });

describe("member welcome", () => {
  it("is sent once to a confirmed account, however often or concurrently the cron runs", async () => {
    const member = await signUp({ email: "member@example.com" });

    expect((await cron()).status).toBe(200);
    await cron();
    await Promise.all([cron(), cron(), cron()]);
    await cron();

    expect(sentTo(member.email)).toEqual(["member_welcome"]);
    expect(await records(member.userId)).toEqual([{ kind: "member_welcome" }]);
    const rows = await jobs();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
  });

  it("is not queued until the email is confirmed, and goes out once it is", async () => {
    const member = await signUp({ emailVerified: false });
    await cron();
    expect(sentTo(member.email)).toEqual([]);
    expect(await records(member.userId)).toEqual([]);

    await api.db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [member.userId]);
    await cron();
    await cron();
    expect(sentTo(member.email)).toEqual(["member_welcome"]);
  });

  it("is not sent to a banned or deleted account, or one with no email address", async () => {
    const banned = await signUp();
    const deleted = await signUp();
    const noEmail = await signUp();
    const expiredBan = await signUp();
    await api.db.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [banned.userId]);
    await api.db.query(`update auth.users set deleted_at = now() where id = $1`, [deleted.userId]);
    await api.db.query(`update auth.users set email = null where id = $1`, [noEmail.userId]);
    await api.db.query(`update auth.users set banned_until = now() - interval '1 day' where id = $1`, [expiredBan.userId]);

    await cron();

    expect(sentTo(banned.email)).toEqual([]);
    expect(sentTo(deleted.email)).toEqual([]);
    expect(await records(banned.userId)).toEqual([]);
    expect(await records(deleted.userId)).toEqual([]);
    expect(await records(noEmail.userId)).toEqual([]);
    // A ban that has ended doesn't count.
    expect(sentTo(expiredBan.email)).toEqual(["member_welcome"]);
  });

  it("is skipped, not retried, when the account is banned or unconfirmed after it was queued", async () => {
    const banned = await signUp();
    const unconfirmed = await signUp();
    await api.db.query(`select private.queue_member_welcomes(50)`);
    await api.db.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [banned.userId]);
    await api.db.query(`update auth.users set email_confirmed_at = null where id = $1`, [unconfirmed.userId]);

    await cron();

    expect(sentTo(banned.email)).toEqual([]);
    expect(sentTo(unconfirmed.email)).toEqual([]);
    const rows = await jobs();
    expect(rows.map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(rows.map((r) => r.last_error).sort()).toEqual([
      "the account is banned or deleted",
      "the account's email address isn't confirmed",
    ]);
    // Still recorded, so it is never queued again.
    await cron();
    expect(await jobs()).toHaveLength(2);
  });

  it("is not sent for accounts that existed when the migration was applied (backfill), but is for later ones", async () => {
    // The migration's backfill section, run against accounts and organisers made "before" it.
    const migration = readFileSync(
      path.resolve(import.meta.dirname, "../../supabase/migrations/20261111000700_onboarding_emails.sql"),
      "utf8",
    );
    const backfill = migration.slice(migration.indexOf("-- Backfill"), migration.indexOf("-- Grants")).split(";\n");

    const admin = await signUpAdmin(api);
    const old = await signUp();
    const oldOrganiser = await signUp();
    const oldPending = await signUp();
    const approvedId = await apply(oldOrganiser);
    await approve(admin.token, approvedId);
    const pendingId = await apply(oldPending);
    // "Before the migration": no records, no jobs, deferred sends never ran.
    api.deferred.length = 0;
    await api.db.query(`delete from private.onboarding_emails`);
    expect(await jobs()).toEqual([]);

    for (const statement of backfill.filter((s) => /insert into/.test(s))) await api.db.query(statement);
    expect((await records(old.userId)).map((r) => r.kind)).toEqual(["member_welcome"]);
    expect((await records(oldOrganiser.userId)).map((r) => r.kind)).toEqual([
      "member_welcome",
      "organiser_next_steps",
      "organiser_welcome",
    ]);
    expect((await records(oldPending.userId)).map((r) => r.kind)).toEqual(["member_welcome", "organiser_welcome"]);
    expect(await jobs()).toEqual([]);

    await cron();
    // (The pending application's review email goes to the admins, as ever.)
    expect(api.sendEmail.mock.calls.map(([m]) => classify(m)).filter((k) => k !== "other")).toEqual([]);

    // A new account is welcomed; a backfilled pending application still gets its next steps once approved.
    const fresh = await signUp();
    await approve(admin.token, pendingId);
    await api.runDeferred();
    await makeDue();
    await cron();
    expect(sentTo(fresh.email)).toEqual(["member_welcome"]);
    expect(sentTo(oldPending.email)).toEqual(["organiser_next_steps"]);
    expect(sentTo(old.email)).toEqual([]);
    expect(sentTo(oldOrganiser.email)).toEqual([]);
  });

  it("holds the platform's daily cap (300) and leaves the rest, oldest first, for the next window", async () => {
    const accounts = [];
    for (let i = 0; i < 4; i++) {
      accounts.push(await signUp());
      await api.db.query(`update auth.users set email_confirmed_at = now() - interval '${4 - i} hours' where id = $1`, [
        accounts[i].userId,
      ]);
    }
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('onboarding_emails_daily', now(), 298)`,
    );

    await cron();
    expect(accounts.map((a) => sentTo(a.email).length)).toEqual([1, 1, 0, 0]);
    expect(await records(accounts[2].userId)).toEqual([]);
    await cron();
    expect(accounts.map((a) => sentTo(a.email).length)).toEqual([1, 1, 0, 0]);

    // A day later the window has reset.
    await api.db.query(
      `update private.platform_rate_limits set window_started_at = now() - interval '2 days' where bucket = 'onboarding_emails_daily'`,
    );
    await cron();
    expect(accounts.map((a) => sentTo(a.email).length)).toEqual([1, 1, 1, 1]);
  });

  it("is removed with the account: record and job", async () => {
    const member = await signUp();
    await api.db.query(`select private.queue_member_welcomes(50)`);
    expect(await jobs()).toHaveLength(1);

    await api.db.query(`delete from auth.users where id = $1`, [member.userId]);

    expect(await records(member.userId)).toEqual([]);
    expect(await jobs()).toEqual([]);
  });

  it("a cron run before the migration is applied still sends the rest (undefined_function is tolerated)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const member = await signUp();
    await api.db.query(`select private.queue_member_welcomes(50)`);
    const real = api.db;
    const old = new TestApi({
      query: async (text, params) => {
        if (/queue_member_welcomes/.test(text)) throw Object.assign(new Error("function does not exist"), { code: "42883" });
        return real.query(text, params);
      },
    });
    const res = await old.send(
      runEmailOutboxCron,
      new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ claimed: 1, sent: 1 });
    expect(old.sendEmail.mock.calls.map(([m]) => m.to)).toEqual([member.email]);
    expect(warn).toHaveBeenCalled();
  });
});

describe("organiser emails", () => {
  it("an application sends one pending-variant welcome after the response, to the account's address, never the contact email", async () => {
    const user = await signUp({ email: "owner@example.com" });
    await apply(user);
    // Nothing is sent inside the request.
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect((await jobs()).map((j) => j.status)).toEqual(["pending"]);

    await api.runDeferred();
    expect(sentTo(user.email)).toEqual(["organiser_welcome_pending"]);
    expect(api.sendEmail.mock.calls.map(([m]) => m.to)).not.toContain(application.contactEmail);
    expect((await records(user.userId)).map((r) => r.kind)).toEqual(["organiser_welcome"]);

    await cron();
    await cron();
    // The cron adds the member welcome only: still one organiser welcome, and no next steps.
    expect(sentTo(user.email).filter((k) => k === "organiser_welcome_pending")).toHaveLength(1);
    expect(sentTo(user.email)).not.toContain("organiser_next_steps");
  });

  it("an approval before the welcome went out sends the approved wording only", async () => {
    const admin = await signUpAdmin(api);
    const user = await signUp();
    const organiserId = await apply(user);
    await approve(admin.token, organiserId);
    await api.runDeferred();

    expect(sentTo(user.email)).toEqual(["organiser_welcome_approved"]);
  });

  it("resubmitting or approving again never sends a second welcome or next steps", async () => {
    const admin = await signUpAdmin(api);
    const user = await signUp();
    const organiserId = await apply(user);
    await api.runDeferred();

    for (let round = 0; round < 2; round++) {
      const rejected = await api.call(adminRejectOrganiser, {
        token: admin.token,
        params: { organiserId },
        method: "POST",
        body: { reason: "Not yet." },
      });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
      const resubmitted = await api.call(resubmitOrganiser, { token: user.token, body: application, method: "PATCH" });
      expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(200);
    }
    await approve(admin.token, organiserId);
    // Taken down and reinstated.
    await api.db.query(`update public.organisers set status = 'rejected' where id = $1`, [organiserId]);
    await api.call(resubmitOrganiser, { token: user.token, body: application, method: "PATCH" });
    await approve(admin.token, organiserId);
    await api.runDeferred();
    await makeDue();
    await cron();
    await cron();

    expect(sentTo(user.email).sort()).toEqual(["member_welcome", "organiser_next_steps", "organiser_welcome_pending"].sort());
    expect((await records(user.userId)).map((r) => r.kind)).toEqual(["member_welcome", "organiser_next_steps", "organiser_welcome"]);
  });

  it("approval queues the next steps an hour later, not sooner", async () => {
    const admin = await signUpAdmin(api);
    const user = await signUp();
    const organiserId = await apply(user);
    await api.runDeferred();
    await approve(admin.token, organiserId);
    await api.runDeferred();
    await cron();

    expect(sentTo(user.email)).not.toContain("organiser_next_steps");
    const waiting = (await jobs()).filter((j) => j.status === "pending");
    expect(waiting).toHaveLength(1);
    expect(waiting[0].secs).toBeGreaterThan(3500);
    expect(waiting[0].secs).toBeLessThanOrEqual(3600);

    await makeDue();
    await cron();
    expect(sentTo(user.email).filter((k) => k === "organiser_next_steps")).toHaveLength(1);
  });

  it("an accepted organiser invite sends the approved welcome now and the next steps in an hour", async () => {
    const admin = await signUpAdmin(api);
    const invitee = await signUp({ email: "invitee@example.com" });
    const created = await api.call(adminCreateInvite, {
      token: admin.token,
      body: { kind: "organiser", email: invitee.email, consent: true, organiser: application },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const accepted = await api.call(acceptInvite, { token: invitee.token, body: { inviteId: created.body.invite.inviteId } });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    await api.runDeferred();
    expect(sentTo(invitee.email)).toEqual(["organiser_welcome_approved"]);

    await cron();
    expect(sentTo(invitee.email).filter((k) => k === "organiser_next_steps")).toHaveLength(0);
    await makeDue();
    await cron();
    expect(sentTo(invitee.email).filter((k) => k === "organiser_next_steps")).toHaveLength(1);
  });

  it("joining with an organiser link sends the approved welcome now and the next steps in an hour", async () => {
    const admin = await signUpAdmin(api);
    const user = await signUp();
    const link = await api.call(adminCreateOrganiserLink, { token: admin.token, method: "POST" });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const token = /token=([A-Za-z0-9_-]{43})$/.exec(link.body.url)![1];

    const joined = await api.call(joinWithOrganiserLink, {
      token: user.token,
      body: { token, displayName: "Neon Collective", categories: ["live-music"] },
    });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    await api.runDeferred();
    expect(sentTo(user.email)).toEqual(["organiser_welcome_approved"]);
    await makeDue();
    await cron();
    expect(sentTo(user.email).filter((k) => k === "organiser_next_steps")).toHaveLength(1);
  });

  it("an organiser with no owner is never emailed", async () => {
    await api.db.query(
      `insert into public.organisers (display_name, contact_email, description, categories, status)
       values ('Ownerless', 'x@example.com', 'd', array['live-music']::public.event_category[], 'pending')`,
    );
    await api.db.query(`update public.organisers set status = 'approved' where display_name = 'Ownerless'`);
    await cron();
    expect(await api.db.query(`select 1 from private.onboarding_emails`)).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("an application rejected before the welcome went out is skipped, not sent", async () => {
    const admin = await signUpAdmin(api);
    const user = await signUp();
    const organiserId = await apply(user);
    await api.call(adminRejectOrganiser, { token: admin.token, params: { organiserId }, method: "POST", body: { reason: "No." } });
    await api.runDeferred();

    expect(sentTo(user.email)).toEqual([]);
    const rows = await jobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", last_error: "the application was rejected" });
  });

  it("an error queueing never fails the organiser's own change", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await api.db.query(`alter table private.email_outbox add constraint tmp_no_onboarding check (kind <> 'onboarding') not valid`);
    try {
      const user = await signUp();
      const res = await api.call(applyAsOrganiser, { token: user.token, body: application });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const stored = await api.db.query(`select 1 from public.organisers where owner_user_id = $1`, [user.userId]);
      expect(stored).toHaveLength(1);
      // The record is rolled back with the failed job, so nothing is half-queued.
      expect(await records(user.userId)).toEqual([]);
    } finally {
      await api.db.query(`alter table private.email_outbox drop constraint tmp_no_onboarding`);
    }
  });
});

describe("the outbox", () => {
  it("leasing without a kind never takes onboarding or organiser_joined jobs; asking by name does", async () => {
    const admin = await signUpAdmin(api);
    const organiser = await approvedOrganiser(api, admin);
    await signUp(); // gets a member welcome
    await api.db.query(`select private.queue_member_welcomes(50)`);
    await api.db.query(`insert into private.email_outbox (kind, organiser_id) values ('organiser_joined', $1)`, [
      organiser.organiserId,
    ]);
    // Make the organiser's next steps due too.
    await makeDue();

    const lease = (kind: string | null) =>
      api.db.query<{ job_kind: string }>(`select * from private.lease_outbox_jobs(50, '2 minutes'::interval, 6, null, $1)`, [kind]);
    expect(await lease(null)).toEqual([]);
    expect((await lease("organiser_joined")).map((r) => r.job_kind)).toEqual(["organiser_joined"]);
    const onboarding = await lease("onboarding");
    expect(onboarding).toHaveLength(3); // the organiser's welcome and next steps, and the member's welcome
    expect(new Set(onboarding.map((r) => r.job_kind))).toEqual(new Set(["onboarding"]));
  });

  it("an onboarding job and a waiting organiser_review job for the same organiser coexist, and draining onboarding leaves the review", async () => {
    const user = await signUp();
    const organiserId = await apply(user);
    const all = await api.db.query<{ kind: string; status: string }>(
      `select kind, status from private.email_outbox where kind in ('organiser_review', 'onboarding') order by kind`,
    );
    expect(all).toEqual([
      { kind: "onboarding", status: "pending" },
      { kind: "organiser_review", status: "pending" },
    ]);

    await api.runDeferred();
    const after = await api.db.query<{ kind: string; status: string }>(
      `select kind, status from private.email_outbox where kind in ('organiser_review', 'onboarding') order by kind`,
    );
    // Only the review email's own deferred run may touch it; the onboarding job was sent.
    expect(after.find((r) => r.kind === "onboarding")?.status).toBe("sent");
    expect(organiserId).toBeTruthy();
  });

  it("the kind check ties onboarding to its own key and no other kind to it", async () => {
    const admin = await signUpAdmin(api);
    const organiser = await approvedOrganiser(api, admin);
    const [{ id }] = await api.db.query<{ id: string }>(`select id from private.onboarding_emails order by id limit 1`);

    const org = organiser.organiserId;
    const insert = (kind: string, columns: Record<string, string>) =>
      api.db.query(
        `insert into private.email_outbox (kind, ${Object.keys(columns).join(", ")})
         values ($1, ${Object.keys(columns).map((_, i) => `$${i + 2}`).join(", ")})`,
        [kind, ...Object.values(columns)],
      );

    // Not onboarding without its key, nor with another key alongside it.
    await expect(insert("onboarding", { organiser_id: org })).rejects.toMatchObject({ code: "23514" });
    await expect(insert("onboarding", { onboarding_id: id, organiser_id: org })).rejects.toMatchObject({ code: "23514" });
    // Other kinds can't carry an onboarding key (not even next to their own).
    await expect(insert("organiser_review", { onboarding_id: id, organiser_id: org })).rejects.toMatchObject({ code: "23514" });
    await expect(insert("organiser_joined", { onboarding_id: id })).rejects.toMatchObject({ code: "23514" });
    await expect(insert("ops_alert", { onboarding_id: id })).rejects.toMatchObject({ code: "23514" });
    await expect(insert("event_review", { onboarding_id: id })).rejects.toMatchObject({ code: "23514" });
  });

  it("one job per record, ever", async () => {
    const member = await signUp();
    await api.db.query(`select private.queue_member_welcomes(50)`);
    const [{ onboarding_id }] = await jobs();
    await expect(
      api.db.query(`insert into private.email_outbox (kind, onboarding_id) values ('onboarding', $1)`, [onboarding_id]),
    ).rejects.toMatchObject({ code: "23505" });
    // And the function never queues a second record or job.
    expect(await api.db.query<{ n: number }>(`select private.queue_onboarding_email($1, 'member_welcome', now()) as n`, [member.userId])).toEqual([
      { n: false },
    ]);
    expect(await jobs()).toHaveLength(1);
  });

  it("the purge of sent jobs does not bring a welcome back", async () => {
    const member = await signUp();
    await cron();
    expect(sentTo(member.email)).toEqual(["member_welcome"]);
    await api.db.query(`update private.email_outbox set sent_at = now() - interval '100 days'`);
    await api.db.query(`select * from private.purge_operational_data()`);
    expect(await jobs()).toEqual([]);

    await cron();
    expect(sentTo(member.email)).toEqual(["member_welcome"]);
  });
});
