import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drainEmailOutbox } from "@/lib/server/email-outbox";
import { adminApproveEvent, adminSuspendOrganiser, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { getAnalyticsOverview } from "@/lib/server/handlers/analytics";
import { submitEventForReview } from "@/lib/server/handlers/events";
import {
  FOLLOW_LIMITS,
  FOLLOWER_NOTIFY,
  followOrganiser,
  getFollow,
  listFollowingEvents,
  listMyFollowing,
  unfollowOrganiser,
  unsubscribeFollow,
} from "@/lib/server/handlers/follows";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { FOLLOWER_COUNT_THRESHOLD } from "@/lib/server/records";
import type { EventRecord } from "@/lib/server/types";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// Following organisers, "events hosted" and new-event emails:
// docs/architecture.md, "Following organisers";
// supabase/migrations/20261024000200_organiser_follows.sql.

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

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
});

const params = (organiserId = organiser.organiserId) => ({ organiserId });
const follow = (token: string | undefined, body: unknown = {}, organiserId?: string) =>
  api.call(followOrganiser, { token, params: params(organiserId), body });
const status = (token: string, organiserId?: string) => api.call(getFollow, { token, params: params(organiserId) });
const unfollow = (token: string, organiserId?: string) =>
  api.call(unfollowOrganiser, { token, params: params(organiserId), method: "DELETE" });
const publicProfile = (organiserId = organiser.organiserId) =>
  api.call(getPublicOrganiserProfile, { params: { organiserId } });

/** `n` verified members following the organiser (inserted directly, for counts). */
async function followers(n: number, organiserId = organiser.organiserId) {
  const users = [];
  for (let i = 0; i < n; i++) {
    const user = await api.signUp();
    await api.db.query(`insert into public.organiser_follows (user_id, organiser_id, notify_new_events) values ($1, $2, true)`, [
      user.userId,
      organiserId,
    ]);
    users.push(user);
  }
  return users;
}

async function jobs() {
  return api.db.query<{ id: string; status: string; follow_id: string; due: boolean; next_attempt_at: Date }>(
    `select j.id::text, j.status, j.follow_id, j.next_attempt_at <= now() as due, j.next_attempt_at
       from private.email_outbox j where j.kind = 'organiser_new_events' order by j.id`,
  );
}

/** Publishes a new event for the organiser and runs what the approval deferred (the emails). */
async function publishAndSend(overrides: Record<string, unknown> = {}) {
  const event = await publishedEvent(api, organiser, admin, overrides);
  await api.runDeferred();
  return event;
}

const sentTo = (email: string) => api.sendEmail.mock.calls.map(([m]) => m).filter((m) => m.to === email);

function tokenFrom(text: string): string {
  const match = /\/following\/unsubscribe#token=([A-Za-z0-9_-]{43})/.exec(text);
  if (!match) throw new Error("no unsubscribe link");
  return match[1];
}

// ---------------------------------------------------------------------------
// Following
// ---------------------------------------------------------------------------

describe("following an organiser", () => {
  it("201 the first time (emails off unless chosen), 200 after (idempotent), and GET shows it", async () => {
    const m = await api.signUp();
    expect((await status(m.token)).body).toEqual({ following: false, notifyNewEvents: false });
    const first = await follow(m.token);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ following: true, notifyNewEvents: false });
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const again = await follow(m.token);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ following: true, notifyNewEvents: false });
    expect((await status(m.token)).body).toEqual({ following: true, notifyNewEvents: false });
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from public.organiser_follows`);
    expect(n).toBe(1);
  });

  it("the email choice is made when following, and sending it again changes it", async () => {
    const m = await api.signUp();
    expect((await follow(m.token, { notifyNewEvents: false })).body.notifyNewEvents).toBe(false);
    expect((await follow(m.token)).body.notifyNewEvents).toBe(false);
    expect((await follow(m.token, { notifyNewEvents: true })).body.notifyNewEvents).toBe(true);
    // Left out, an existing follow's choice is kept; anything but a boolean (null included) is a 400.
    expect((await follow(m.token)).body.notifyNewEvents).toBe(true);
    for (const notifyNewEvents of ["yes", null, 1, "true"]) {
      expect((await follow(m.token, { notifyNewEvents })).status).toBe(400);
    }
    expect((await status(m.token)).body.notifyNewEvents).toBe(true);
  });

  it("unfollowing is 204 and idempotent", async () => {
    const m = await api.signUp();
    await follow(m.token);
    expect((await unfollow(m.token)).status).toBe(204);
    expect((await unfollow(m.token)).status).toBe(204);
    expect((await status(m.token)).body.following).toBe(false);
  });

  it("needs sign-in (401) and a verified email (403); only approved organisers (404); not your own (400)", async () => {
    expect((await follow(undefined)).status).toBe(401);
    const unverified = await api.signUp({ emailVerified: false });
    expect((await follow(unverified.token)).status).toBe(403);

    const m = await api.signUp();
    const pending = await api.signUp();
    const applied = await api.call((await import("@/lib/server/handlers/organisers")).applyAsOrganiser, {
      token: pending.token,
      body: { displayName: "Pending", contactEmail: "p@example.com", description: "x", categories: ["art"] },
    });
    expect((await follow(m.token, {}, applied.body.organiserId)).status).toBe(404);
    expect((await follow(m.token, {}, crypto.randomUUID())).status).toBe(404);
    expect((await follow(m.token, {}, "nope")).status).toBe(404);
    expect((await status(m.token, applied.body.organiserId)).status).toBe(404);
    expect((await follow(organiser.token)).status).toBe(400);
  });

  it("caps follows per account (409) and new follows per hour (429); an existing follow still answers 200", async () => {
    const m = await api.signUp();
    await follow(m.token);
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'organiser_follows', now(), $2)
       on conflict (user_id, bucket) do update set hits = excluded.hits`,
      [m.userId, FOLLOW_LIMITS.newFollows.hits],
    );
    const other = await approvedOrganiser(api, admin, { displayName: "Other" });
    expect((await follow(m.token, {}, other.organiserId)).status).toBe(429);
    expect((await follow(m.token)).status).toBe(200);

    const capped = await api.signUp();
    await api.db.query(
      `with o as (
         insert into public.organisers (display_name, contact_email, description, categories, status)
         select 'Org ' || g, 'org' || g || '@sheltuh.com.au', 'x', array['art']::public.event_category[], 'approved'
           from generate_series(1, $2) g
         returning id)
       insert into public.organiser_follows (user_id, organiser_id) select $1, id from o`,
      [capped.userId, FOLLOW_LIMITS.maxFollows],
    );
    expect((await follow(capped.token)).status).toBe(409);
  });

  it("goes with the account", async () => {
    const m = await api.signUp();
    await follow(m.token);
    await api.db.query(`delete from auth.users where id = $1`, [m.userId]);
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from public.organiser_follows`);
    expect(n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Public counts
// ---------------------------------------------------------------------------

describe("public organiser profile", () => {
  it(`shows the follower count only from ${FOLLOWER_COUNT_THRESHOLD}`, async () => {
    await followers(FOLLOWER_COUNT_THRESHOLD - 1);
    expect((await publicProfile()).body.followerCount).toBeNull();
    await followers(1);
    expect((await publicProfile()).body.followerCount).toBe(FOLLOWER_COUNT_THRESHOLD);
  });

  it("counts events hosted: published events that have ended, nothing else", async () => {
    const past = await publishedEvent(api, organiser, admin, { title: "Past" });
    const unpublishedPast = await publishedEvent(api, organiser, admin, { title: "Unpublished past" });
    await publishedEvent(api, organiser, admin, { title: "Upcoming" });
    const draftPast = await draftEvent(api, organiser, { title: "Draft past" });
    await api.db.query(
      `update public.events set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = any($1::uuid[])`,
      [[past.eventId, unpublishedPast.eventId, draftPast.eventId]],
    );
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: unpublishedPast.eventId }, method: "POST" });
    expect((await publicProfile()).body.eventsHosted).toBe(1);
  });
});

describe("organiser analytics", () => {
  it("shows the organiser the exact follower count", async () => {
    await followers(2);
    const res = await api.call(getAnalyticsOverview, { token: organiser.token });
    expect(res.status).toBe(200);
    expect(res.body.followerCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The member's lists
// ---------------------------------------------------------------------------

describe("GET /me/following and /me/following/events", () => {
  it("lists followed organisers newest first, without taken-down ones", async () => {
    const m = await api.signUp();
    const second = await approvedOrganiser(api, admin, { displayName: "Second" });
    await follow(m.token, { notifyNewEvents: false });
    await api.db.query(`update public.organiser_follows set created_at = now() - interval '1 hour'`);
    await follow(m.token, { notifyNewEvents: true }, second.organiserId);

    const res = await api.call(listMyFollowing, { token: m.token });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.items).toEqual([
      { organiserId: second.organiserId, displayName: "Second", notifyNewEvents: true, followedAt: expect.any(String) },
      {
        organiserId: organiser.organiserId,
        displayName: "Static Collective",
        notifyNewEvents: false,
        followedAt: expect.any(String),
      },
    ]);
    const page = await api.call(listMyFollowing, { token: m.token, query: { limit: "1" } });
    expect(page.body.items).toHaveLength(1);
    expect(page.body.nextCursor).toBeDefined();

    await api.call(adminSuspendOrganiser, { token: admin.token, params: { organiserId: second.organiserId }, body: { reason: "x" } });
    expect((await api.call(listMyFollowing, { token: m.token })).body.items.map((o: { displayName: string }) => o.displayName)).toEqual([
      "Static Collective",
    ]);
    expect((await api.call(listMyFollowing, {})).status).toBe(401);
  });

  it("lists upcoming published events from followed organisers, soonest first, paginated", async () => {
    const m = await api.signUp();
    await follow(m.token);
    const later = await publishedEvent(api, organiser, admin, {
      title: "Later",
      start: { date: "2027-06-01", time: "20:00" },
      end: { date: "2027-06-01", time: "23:00" },
    });
    const sooner = await publishedEvent(api, organiser, admin, { title: "Sooner" });
    const ended = await publishedEvent(api, organiser, admin, { title: "Ended" });
    await api.db.query(
      `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute' where id = $1`,
      [ended.eventId],
    );
    await draftEvent(api, organiser, { title: "Draft" });
    const stranger = await approvedOrganiser(api, admin, { displayName: "Not followed" });
    await publishedEvent(api, stranger, admin, { title: "Not followed" });

    const res = await api.call(listFollowingEvents, { token: m.token });
    expect(res.body.items.map((e: EventRecord) => e.eventId)).toEqual([sooner.eventId, later.eventId]);
    // The feed's public shape: no moderation log, status or private fields.
    expect(res.body.items[0].moderationLog).toBeUndefined();
    expect(res.body.items[0].soldOut).toBe(false);
    const page = await api.call(listFollowingEvents, { token: m.token, query: { limit: "1" } });
    expect(page.body.items.map((e: EventRecord) => e.title)).toEqual(["Sooner"]);
    const next = await api.call(listFollowingEvents, { token: m.token, query: { limit: "1", cursor: page.body.nextCursor } });
    expect(next.body.items.map((e: EventRecord) => e.title)).toEqual(["Later"]);
  });
});

// ---------------------------------------------------------------------------
// New-event emails
// ---------------------------------------------------------------------------

describe("new-event emails", () => {
  it("one email per follower with emails on when an event is first published, with a working unsubscribe link", async () => {
    const on = await api.signUp();
    const off = await api.signUp();
    await follow(on.token, { notifyNewEvents: true });
    await follow(off.token, { notifyNewEvents: false });

    const event = await publishAndSend();
    expect(await jobs()).toEqual([expect.objectContaining({ status: "sent" })]);
    expect(sentTo(off.email)).toHaveLength(0);
    const [email] = sentTo(on.email);
    expect(email.subject).toBe(`New from Static Collective: ${event.title}`);
    expect(email.text).toContain(`${SITE_URL}/events/${event.slug}`);
    expect(email.html).toContain(event.title);
    const token = tokenFrom(email.text);
    expect(email.html).toContain(`/following/unsubscribe#token=${token}`);
    expect(email.headers).toEqual({ "List-Unsubscribe": `<${SITE_URL}/following/unsubscribe#token=${token}>` });
    // Only the token's hash is stored.
    const [{ n }] = await api.db.query<{ n: number }>(
      `select count(*)::int as n from private.organiser_follow_tokens where token_hash = encode(sha256($1::bytea), 'hex')`,
      [Buffer.from(token)],
    );
    expect(n).toBe(1);
    expect(JSON.stringify(await api.db.query(`select * from private.organiser_follow_tokens`))).not.toContain(token);

    // Unsubscribing turns emails off, keeps the follow, and is idempotent.
    const res = await api.call(unsubscribeFollow, { body: { token } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "unsubscribed", organiserName: "Static Collective" });
    expect((await api.call(unsubscribeFollow, { body: { token } })).status).toBe(200);
    expect((await status(on.token)).body).toEqual({ following: true, notifyNewEvents: false });

    await publishAndSend({ title: "Second" });
    expect(sentTo(on.email)).toHaveLength(1);
  });

  it("a failure queueing follower emails never fails the publish (a warning instead)", async () => {
    const m = await api.signUp();
    await follow(m.token, { notifyNewEvents: true });
    await api.db.query(`alter function private.notify_followers(uuid) rename to notify_followers_saved`);
    try {
      await api.db.query(`create function private.notify_followers(p_event_id uuid) returns integer
        language plpgsql set search_path = '' as $$ begin raise exception 'outbox broken'; end $$`);
      const event = await publishAndSend();
      expect(event.status).toBe("published");
      expect(await jobs()).toEqual([]);
    } finally {
      await api.db.query(`drop function if exists private.notify_followers(uuid)`);
      await api.db.query(`alter function private.notify_followers_saved(uuid) rename to notify_followers`);
    }
  });

  it("only followers whose email Supabase Auth has confirmed are queued (and checked again at send time)", async () => {
    const confirmed = await api.signUp();
    const unconfirmed = await api.signUp();
    await follow(confirmed.token, { notifyNewEvents: true });
    await follow(unconfirmed.token, { notifyNewEvents: true });
    await api.db.query(`update auth.users set email_confirmed_at = null where id = $1`, [unconfirmed.userId]);
    await publishAndSend();
    expect(sentTo(confirmed.email)).toHaveLength(1);
    expect(sentTo(unconfirmed.email)).toHaveLength(0);
    expect(await jobs()).toHaveLength(1);

    // Queued while confirmed, unconfirmed before it went (e.g. an email change): skipped at send time.
    const [job] = await jobs();
    await api.db.query(`delete from private.email_outbox`);
    await api.db.query(`insert into private.email_outbox (kind, follow_id) values ('organiser_new_events', $1)`, [job.follow_id]);
    await api.db.query(`update public.organiser_follows set notified_through = null where id = $1`, [job.follow_id]);
    await api.db.query(`update auth.users set email_confirmed_at = null where id = $1`, [confirmed.userId]);
    await drainEmailOutbox(api.deps, { kind: "organiser_new_events" });
    expect(sentTo(confirmed.email)).toHaveLength(1);
    // The same job with the address confirmed again is sent: it was the confirmation that stopped it.
    await api.db.query(`update private.email_outbox set status = 'pending', next_attempt_at = now(), attempts = 0`);
    await api.db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [confirmed.userId]);
    await drainEmailOutbox(api.deps, { kind: "organiser_new_events" });
    expect(sentTo(confirmed.email)).toHaveLength(2);
  });

  it("at most one a day per organiser: a second event the same day waits 24 hours and goes in the next email", async () => {
    const m = await api.signUp();
    await follow(m.token, { notifyNewEvents: true });
    await publishAndSend({ title: "First" });
    expect(sentTo(m.email)).toHaveLength(1);

    await publishAndSend({ title: "Second" });
    await publishAndSend({ title: "Third" });
    expect(sentTo(m.email)).toHaveLength(1);
    const [, waiting] = await jobs();
    expect(waiting).toMatchObject({ status: "pending", due: false });
    expect(waiting.next_attempt_at.getTime() - Date.now()).toBeGreaterThan((FOLLOWER_NOTIFY.perFollowerHours - 1) * 3600_000);
    expect(await jobs()).toHaveLength(2);

    // A day later: one email with both new events (not the first again).
    await api.db.query(`update private.email_outbox set next_attempt_at = now() where id = $1`, [waiting.id]);
    await drainEmailOutbox(api.deps);
    const emails = sentTo(m.email);
    expect(emails).toHaveLength(2);
    expect(emails[1].subject).toBe("2 new events from Static Collective");
    expect(emails[1].text).toContain("Second");
    expect(emails[1].text).toContain("Third");
    expect(emails[1].text).not.toContain("First");
  });

  it("publishing an event again (after an unpublish) emails nobody", async () => {
    const m = await api.signUp();
    await follow(m.token, { notifyNewEvents: true });
    const event = await publishAndSend();
    expect(sentTo(m.email)).toHaveLength(1);
    await api.db.query(`update private.email_outbox set status = 'sent' where kind = 'organiser_new_events'`);
    await api.db.query(`update public.organiser_follows set next_notify_at = null`);

    const p = { eventId: event.eventId };
    await api.call(adminUnpublishEvent, { token: admin.token, params: p, method: "POST" });
    await api.call(submitEventForReview, { token: organiser.token, params: p, method: "POST" });
    await api.call(adminApproveEvent, { token: admin.token, params: p, method: "POST" });
    await api.runDeferred();
    expect(await jobs()).toHaveLength(1);
    expect(sentTo(m.email)).toHaveLength(1);
  });

  it("events approved before the migration count as announced (only new ones are emailed)", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const [row] = await api.db.query(`select * from private.organiser_event_announcements where event_id = $1`, [
      event.eventId,
    ]);
    expect(row).toBeDefined();
  });

  it("skips an email whose events were all unpublished before it went, and one after unfollowing (cascade)", async () => {
    const m = await api.signUp();
    await follow(m.token, { notifyNewEvents: true });
    const event = await publishedEvent(api, organiser, admin);
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });
    await api.runDeferred();
    expect(sentTo(m.email)).toHaveLength(0);
    const [job] = await jobs();
    expect(job.status).toBe("failed");

    const other = await api.signUp();
    await follow(other.token, { notifyNewEvents: true });
    await publishedEvent(api, organiser, admin, { title: "New" });
    expect(await jobs()).toHaveLength(3);
    await unfollow(other.token);
    await api.runDeferred();
    expect(sentTo(other.email)).toHaveLength(0);
    // Their job went with the follow; the first follower's next email waits its 24 hours.
    expect((await jobs()).map((j) => j.status)).toEqual(["failed", "pending"]);
  });

  it("stops queueing at the platform's daily cap", async () => {
    await followers(3);
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits)
       values ('follower_notifications_daily', now(), $1)`,
      [FOLLOWER_NOTIFY.platformDaily - 1],
    );
    await publishedEvent(api, organiser, admin);
    expect(await jobs()).toHaveLength(1);
  });

  it("an event that has already ended isn't announced", async () => {
    await followers(1);
    const draft = await draftEvent(api, organiser);
    await api.db.query(
      `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute' where id = $1`,
      [draft.eventId],
    );
    await api.db.query(`update public.events set status = 'published' where id = $1`, [draft.eventId]);
    expect(await jobs()).toHaveLength(0);
  });

  it("the previous release's claim function leaves follower emails alone (deploy window)", async () => {
    await followers(1);
    await publishedEvent(api, organiser, admin);
    const claimed = await api.db.query(`select * from private.claim_outbox_jobs(10, '2 minutes'::interval, 6, null, null)`);
    expect(claimed).toEqual([]);
    expect((await jobs()).map((j) => j.status)).toEqual(["pending"]);
  });

  it("unsubscribe: 400 malformed, 404 unknown", async () => {
    expect((await api.call(unsubscribeFollow, { body: { token: "short" } })).status).toBe(400);
    expect((await api.call(unsubscribeFollow, { body: { token: "a".repeat(43) } })).status).toBe(404);
  });

  it("purge_social_data deletes unsubscribe tokens after 90 days", async () => {
    const m = await api.signUp();
    await follow(m.token, { notifyNewEvents: true });
    await publishAndSend();
    await publishAndSend({ title: "Two" });
    await api.db.query(`update private.email_outbox set next_attempt_at = now() where kind = 'organiser_new_events' and status = 'pending'`);
    await drainEmailOutbox(api.deps);
    expect(sentTo(m.email)).toHaveLength(2);
    await api.db.query(
      `update private.organiser_follow_tokens set created_at = now() - interval '91 days'
        where ctid = (select ctid from private.organiser_follow_tokens limit 1)`,
    );
    const [purged] = await api.db.query<{ follow_tokens_deleted: number }>(`select * from private.purge_social_data()`);
    expect(purged.follow_tokens_deleted).toBe(1);
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from private.organiser_follow_tokens`);
    expect(n).toBe(1);
  });
});

// Two sessions at once: only a real server (PGlite is one connection). Run
// with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrency (real Postgres only)", () => {
  async function connections() {
    return [
      postgres(serverUrl as string, { max: 1, onnotice: () => {} }),
      postgres(serverUrl as string, { max: 1, onnotice: () => {} }),
    ];
  }

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

  it("two follows racing for the last slot under the cap: one is followed, the other refused", async () => {
    const m = await api.signUp();
    await api.db.query(
      `with o as (
         insert into public.organisers (display_name, contact_email, description, categories, status)
         select 'Org ' || g, 'org' || g || '@sheltuh.com.au', 'x', array['art']::public.event_category[], 'approved'
           from generate_series(1, $2) g
         returning id)
       insert into public.organiser_follows (user_id, organiser_id) select $1, id from o`,
      [m.userId, FOLLOW_LIMITS.maxFollows - 1],
    );
    const second = await approvedOrganiser(api, admin, { displayName: "Second" });
    const call = (conn: postgres.Sql, organiserId: string) =>
      conn.unsafe(`select * from private.follow_organiser($1, $2, null, $3, 1000, '1 hour'::interval)`, [
        m.userId,
        organiserId,
        FOLLOW_LIMITS.maxFollows,
      ]);
    const [one, two] = await connections();
    try {
      await one.unsafe("begin");
      expect((await call(one, organiser.organiserId))[0].result).toBe("followed");
      const blocked = await waitUntilBlocked(two);
      const pending = call(two, second.organiserId).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("limit");
    } finally {
      await one.end();
      await two.end();
    }
    const [{ n }] = await api.db.query<{ n: number }>(
      `select count(*)::int as n from public.organiser_follows where user_id = $1`,
      [m.userId],
    );
    expect(n).toBe(FOLLOW_LIMITS.maxFollows);
  });

  it("two of an organiser's events announced at once: the second waits and adds nothing (one email waiting)", async () => {
    await followers(1);
    const first = await draftEvent(api, organiser, { title: "One" });
    const second = await draftEvent(api, organiser, { title: "Two" });
    const publish = (conn: postgres.Sql, eventId: string) =>
      conn.unsafe(`update public.events set status = 'published' where id = $1`, [eventId]);
    const [one, two] = await connections();
    try {
      await one.unsafe("begin");
      await publish(one, first.eventId);
      // The trigger is deferred: run it now, inside the transaction, so it holds the organiser's lock.
      await one.unsafe("set constraints all immediate");
      const blocked = await waitUntilBlocked(two);
      const pending = publish(two, second.eventId).execute();
      await blocked();
      await one.unsafe("commit");
      await pending;
    } finally {
      await one.end();
      await two.end();
    }
    expect((await jobs()).map((j) => j.status)).toEqual(["pending"]);
    const [{ n }] = await api.db.query<{ n: number }>(
      `select count(*)::int as n from private.organiser_event_announcements where organiser_id = $1`,
      [organiser.organiserId],
    );
    expect(n).toBe(2);
  });
});
