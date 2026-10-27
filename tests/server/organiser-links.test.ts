import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clientKey } from "@/lib/server/client-key";
import {
  adminApproveOrganiser,
  adminListOrganisers,
  adminRejectOrganiser,
  adminSuspendOrganiser,
} from "@/lib/server/handlers/admin";
import {
  adminCancelOrganiserLink,
  adminCreateOrganiserLink,
  adminListOrganiserLinks,
  joinWithOrganiserLink,
  ORGANISER_LINK_LIMITS,
  viewOrganiserLink,
} from "@/lib/server/handlers/organiser-links";
import { applyAsOrganiser, getMyOrganiser, resubmitOrganiser } from "@/lib/server/handlers/organisers";
import { ORGANISER_LINK_UNAVAILABLE } from "@/lib/invites";
import { runHandler } from "@/lib/server/route";
import { SITE_URL, TestApi, WEBHOOK_SECRET } from "./helpers/api";
import { application, approvedOrganiser, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// Organiser links: docs/architecture.md, "Organiser links";
// supabase/migrations/20261111000500_organiser_invite_links.sql;
// lib/server/handlers/organiser-links.ts.

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string; email: string };

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

afterEach(() => {
  vi.restoreAllMocks();
});

const sha256 = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const URL_PATTERN = new RegExp(`^${SITE_URL.replace(/\./g, "\\.")}/organisers/join#token=([A-Za-z0-9_-]{43})$`);
const DETAILS = { displayName: "Neon Collective", categories: ["live-music", "art"] };

/** A new link: its id, token and the create response. */
async function createLink(token = admin.token) {
  const res = await api.call(adminCreateOrganiserLink, { token, method: "POST" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const match = URL_PATTERN.exec(res.body.url);
  if (!match) throw new Error(`unexpected link url: ${res.body.url}`);
  return { linkId: res.body.link.linkId as string, token: match[1], res };
}

const view = (token: unknown, headers?: Record<string, string>) => api.call(viewOrganiserLink, { body: { token }, headers });
const join = (callerToken: string | undefined, body: Record<string, unknown>, headers?: Record<string, string>) =>
  api.call(joinWithOrganiserLink, { token: callerToken, body, headers });
const cancel = (linkId: string, token = admin.token) =>
  api.call(adminCancelOrganiserLink, { token, params: { linkId }, method: "POST" });
const list = (token = admin.token, query?: Record<string, string>) => api.call(adminListOrganiserLinks, { token, query });

/** The link ran out a second ago (made 7 days before that). */
const expireLink = (linkId: string) =>
  api.db.query(
    `update private.organiser_invite_links
        set created_at = now() - interval '7 days 1 second', expires_at = now() - interval '1 second' where id = $1`,
    [linkId],
  );

async function linkRows() {
  return api.db.query<Record<string, unknown>>(`select * from private.organiser_invite_links order by created_at, id`);
}
async function organiserRows() {
  return api.db.query<Record<string, unknown>>(
    `select owner_user_id, display_name, contact_email, description, categories::text[] as categories, status, reviewed_by
       from public.organisers order by created_at`,
  );
}

/** The admins' "joined with a link" jobs. */
const joinedJobs = () =>
  api.db.query<{ organiser_id: string; status: string }>(
    `select organiser_id, status from private.email_outbox where kind = 'organiser_joined' order by id`,
  );

function expectUnavailable(res: { status: number; body: { error: string; code?: string } }) {
  expect(res.status).toBe(404);
  expect(res.body.error).toBe(ORGANISER_LINK_UNAVAILABLE);
  expect(res.body.code).toBe("unavailable");
}

describe("creating a link (POST /api/admin/organiser-links)", () => {
  it("returns the link's URL once, with the token in the fragment; stores only its hash; 7 days", async () => {
    const { token, res } = await createLink();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.link).toEqual({
      linkId: expect.any(String),
      status: "active",
      createdAt: expect.any(String),
      createdBy: admin.userId,
      createdByEmail: admin.email,
      expiresAt: expect.any(String),
    });
    const days = (Date.parse(res.body.link.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);

    const [row] = await linkRows();
    expect(row.token_hash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
    // A fresh token each time.
    const second = await createLink();
    expect(second.token).not.toBe(token);
  });

  it("is admin only: create, list and cancel", async () => {
    const { linkId } = await createLink();
    const member = await api.signUp();
    expect((await api.call(adminCreateOrganiserLink, { method: "POST" })).status).toBe(401);
    expect((await api.call(adminCreateOrganiserLink, { token: member.token, method: "POST" })).status).toBe(403);
    expect((await api.call(adminListOrganiserLinks, {})).status).toBe(401);
    expect((await list(member.token)).status).toBe(403);
    expect((await api.call(adminCancelOrganiserLink, { params: { linkId }, method: "POST" })).status).toBe(401);
    expect((await cancel(linkId, member.token)).status).toBe(403);
    expect((await linkRows()).map((r) => r.status)).toEqual(["active"]);
  });

  it("caps each admin at 20 an hour and everyone at 50 a day (429); a refusal takes no allowance", async () => {
    const { hits } = ORGANISER_LINK_LIMITS.adminHourly;
    for (let i = 0; i < hits; i += 1) await createLink();
    const over = await api.call(adminCreateOrganiserLink, { token: admin.token, method: "POST" });
    expect(over.status).toBe(429);
    expect(over.body).not.toHaveProperty("url");
    expect(await linkRows()).toHaveLength(hits);
    // The platform's day: the refusal above took no hit from it.
    const [daily] = await api.db.query<{ hits: number }>(
      `select hits from private.platform_rate_limits where bucket = 'organiser_invite_links_daily'`,
    );
    expect(daily.hits).toBe(hits);

    await api.db.query(
      `update private.platform_rate_limits set hits = $1 where bucket = 'organiser_invite_links_daily'`,
      [ORGANISER_LINK_LIMITS.platformDaily.hits],
    );
    const other = await signUpAdmin(api);
    expect((await api.call(adminCreateOrganiserLink, { token: other.token, method: "POST" })).status).toBe(429);
    const [mine] = await api.db.query<{ hits: number }>(
      `select hits from private.rate_limits where user_id = $1 and bucket = 'organiser_invite_links'`,
      [other.userId],
    );
    expect(mine).toBeUndefined();
  });
});

describe("listing and cancelling", () => {
  it("lists every link newest first with its state, who made it and the organiser it made; never a token", async () => {
    const used = await createLink();
    const cancelled = await createLink();
    const expired = await createLink();
    const active = await createLink();
    const person = await api.signUp();
    expect((await join(person.token, { token: used.token, ...DETAILS })).status).toBe(200);
    expect((await cancel(cancelled.linkId)).status).toBe(200);
    await api.db.query(
      `update private.organiser_invite_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
        where id = $1`,
      [expired.linkId],
    );

    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.items.map((l: { linkId: string; status: string }) => [l.linkId, l.status])).toEqual([
      [active.linkId, "active"],
      [cancelled.linkId, "cancelled"],
      [used.linkId, "used"],
      [expired.linkId, "expired"],
    ]);
    const usedItem = res.body.items[2];
    expect(usedItem).toMatchObject({
      createdByEmail: admin.email,
      organiserName: DETAILS.displayName,
      organiserId: expect.any(String),
      usedAt: expect.any(String),
    });
    expect(res.body.items[1].cancelledAt).toEqual(expect.any(String));
    const text = JSON.stringify(res.body);
    for (const link of [used, cancelled, expired, active]) {
      expect(text).not.toContain(link.token);
      expect(text).not.toContain(sha256(link.token));
    }

    const page = await list(admin.token, { limit: "2" });
    expect(page.body.items).toHaveLength(2);
    expect(page.body.nextCursor).toEqual(expect.any(String));
    const next = await list(admin.token, { limit: "2", cursor: page.body.nextCursor });
    expect(next.body.items.map((l: { linkId: string }) => l.linkId)).toEqual([used.linkId, expired.linkId]);
    expect(next.body.nextCursor).toBeUndefined();
  });

  it("cancelling stops the link at once; only an active, unexpired link can be cancelled", async () => {
    const { linkId, token } = await createLink();
    const res = await cancel(linkId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toMatchObject({ linkId, status: "cancelled", cancelledAt: expect.any(String) });
    expect((await linkRows())[0].cancelled_by).toBe(admin.userId);
    expectUnavailable(await view(token));
    const person = await api.signUp();
    expectUnavailable(await join(person.token, { token, ...DETAILS }));
    expect(await organiserRows()).toEqual([]);

    expect((await cancel(linkId)).status).toBe(409);
    expect((await cancel(crypto.randomUUID())).status).toBe(404);
    expect((await cancel("not-a-uuid")).status).toBe(404);

    const used = await createLink();
    expect((await join(person.token, { token: used.token, ...DETAILS })).status).toBe(200);
    expect((await cancel(used.linkId)).status).toBe(409);
    const lapsed = await createLink();
    await api.db.query(
      `update private.organiser_invite_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 second'
        where id = $1`,
      [lapsed.linkId],
    );
    expect((await cancel(lapsed.linkId)).status).toBe(409);
  });
});

describe("the join page's check (POST /api/organiser-links/view)", () => {
  it("says when the link works until, changing nothing", async () => {
    const { token, res } = await createLink();
    const viewed = await view(token);
    expect(viewed.status).toBe(200);
    expect(viewed.headers.get("cache-control")).toBe("private, no-store");
    expect(viewed.body).toEqual({ expiresAt: res.body.link.expiresAt });
    expect(JSON.stringify(viewed.body)).not.toContain(token);
    expect((await linkRows())[0]).toMatchObject({ status: "active", used_at: null });
  });

  it("one 404 for malformed, unknown, used, expired and cancelled links, and a creator who's no longer an admin", async () => {
    expectUnavailable(await view(undefined));
    expectUnavailable(await view("too-short"));
    expectUnavailable(await view(randomBytes(32).toString("base64url")));

    const used = await createLink();
    const person = await api.signUp();
    await join(person.token, { token: used.token, ...DETAILS });
    expectUnavailable(await view(used.token));

    const expired = await createLink();
    await expireLink(expired.linkId);
    expectUnavailable(await view(expired.token));

    // Read-only: a demoted creator's link reads as unavailable, but view marks nothing.
    const demoted = await createLink();
    await api.db.query(`update auth.users set raw_app_meta_data = '{}' where id = $1`, [admin.userId]);
    expectUnavailable(await view(demoted.token));
    expect((await linkRows()).find((r) => r.id === demoted.linkId)?.status).toBe("active");
  });

  it("at most 60 checks an hour per client (429), whatever the token", async () => {
    const { token } = await createLink();
    const { bucket, hits } = ORGANISER_LINK_LIMITS.viewsPerClient;
    const ip = "203.0.113.20";
    await api.db.query(
      `insert into private.client_rate_limits (client_key, bucket, window_started_at, hits) values ($1, $2, now(), $3)`,
      [clientKey(ip, WEBHOOK_SECRET), bucket, hits],
    );
    expect((await view(token, { "x-forwarded-for": ip })).status).toBe(429);
    expect((await view(token, { "x-forwarded-for": "203.0.113.21" })).status).toBe(200);
  });
});

describe("joining (POST /api/organiser-links/join)", () => {
  it("an account with no organiser: approved at once, named as typed, their verified email as contact; the link is used up", async () => {
    const { linkId, token } = await createLink();
    const person = await api.signUp({ email: "Mia@Example.com" });
    const res = await join(person.token, { token, displayName: "  Neon Collective ", categories: ["live-music", "art"] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({ organiserId: expect.any(String), displayName: "Neon Collective" });

    expect(await organiserRows()).toEqual([
      {
        owner_user_id: person.userId,
        display_name: "Neon Collective",
        contact_email: "Mia@Example.com",
        description: "",
        categories: ["live-music", "art"],
        status: "approved",
        reviewed_by: admin.userId,
      },
    ]);
    const own = await api.call(getMyOrganiser, { token: person.token });
    expect(own.body).toMatchObject({ organiserId: res.body.organiserId, status: "approved", payoutsEnabled: false });

    // Logged for admins, and no "organiser to review" email: approved from the start.
    const queue = await api.call(adminListOrganisers, { token: admin.token, query: { status: "approved" } });
    const listed = queue.body.items.find((o: { organiserId: string }) => o.organiserId === res.body.organiserId);
    expect(listed.recentEdits).toEqual([
      { kind: "invite_accepted", at: expect.any(String), changes: { status: { old: null, new: "approved" } } },
    ]);
    await api.runDeferred();
    expect(await api.db.query(`select id from private.email_outbox where kind = 'organiser_review'`)).toEqual([]);

    expect((await linkRows())[0]).toMatchObject({
      id: linkId,
      status: "used",
      used_by: person.userId,
      organiser_id: res.body.organiserId,
    });

    // The same account again (a retry, a second tab): the same answer, nothing new.
    const again = await join(person.token, { token, ...DETAILS });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(res.body);
    expect(await organiserRows()).toHaveLength(1);
    // Anyone else: used.
    const other = await api.signUp();
    expectUnavailable(await join(other.token, { token, ...DETAILS }));
    expect(await organiserRows()).toHaveLength(1);
  });

  it("needs a signed-in account with a verified email (401, 403), and the name and categories for a new organiser (400)", async () => {
    const { token } = await createLink();
    expect((await join(undefined, { token, ...DETAILS })).status).toBe(401);
    const unverified = await api.signUp({ emailVerified: false });
    expect((await join(unverified.token, { token, ...DETAILS })).status).toBe(403);

    const person = await api.signUp();
    const none = await join(person.token, { token });
    expect(none.status).toBe(400);
    expect(Object.keys(none.body.fieldErrors).sort()).toEqual(["categories", "displayName"]);
    const blank = await join(person.token, { token, displayName: "   ", categories: [] });
    expect(Object.keys(blank.body.fieldErrors).sort()).toEqual(["categories", "displayName"]);
    const tooLong = await join(person.token, { token, displayName: "x".repeat(121), categories: ["art"] });
    expect(Object.keys(tooLong.body.fieldErrors)).toEqual(["displayName"]);
    const badCategory = await join(person.token, { token, displayName: "Neon", categories: ["karaoke"] });
    expect(Object.keys(badCategory.body.fieldErrors)).toEqual(["categories"]);
    expectUnavailable(await join(person.token, { token: "cut-short", ...DETAILS }));

    expect(await organiserRows()).toEqual([]);
    expect((await linkRows())[0].status).toBe("active");
  });

  it("a pending application is approved as it was submitted (the typed details are ignored), dropping its review email", async () => {
    const person = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: person.token, body: application });
    expect(applied.status).toBe(201);
    const pendingJobs = () =>
      api.db.query(`select id from private.email_outbox where kind = 'organiser_review' and status = 'pending'`);
    expect(await pendingJobs()).toHaveLength(1);

    const { token } = await createLink();
    const res = await join(person.token, { token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ organiserId: applied.body.organiserId, displayName: application.displayName });
    expect(await organiserRows()).toEqual([
      expect.objectContaining({
        display_name: application.displayName,
        contact_email: application.contactEmail,
        description: application.description,
        status: "approved",
        reviewed_by: admin.userId,
      }),
    ]);
    expect(await pendingJobs()).toEqual([]);
    // The admins hear about the approval instead.
    expect(await joinedJobs()).toEqual([{ organiser_id: applied.body.organiserId, status: "pending" }]);
    const [entry] = await api.db.query<{ kind: string; changed_fields: unknown }>(
      `select kind, changed_fields from private.organiser_profile_edits`,
    );
    expect(entry).toEqual({ kind: "invite_accepted", changed_fields: { status: { old: "pending", new: "approved" } } });
    expect((await linkRows())[0]).toMatchObject({ status: "used", organiser_id: applied.body.organiserId });

    // Sent details don't rename it.
    const second = await api.signUp();
    await api.call(applyAsOrganiser, { token: second.token, body: { ...application, displayName: "Own name" } });
    const other = await createLink();
    const renamed = await join(second.token, { token: other.token, ...DETAILS });
    expect(renamed.body.displayName).toBe("Own name");
  });

  it("an approved, rejected or taken-down organiser is refused (409), and the link stays unused", async () => {
    const { linkId, token } = await createLink();
    const approved = await approvedOrganiser(api, admin);
    const already = await join(approved.token, { token, ...DETAILS });
    expect(already.status).toBe(409);
    expect(already.body.code).toBe("already_organiser");

    const rejected = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: rejected.token, body: application });
    await api.db.query(`update public.organisers set status = 'rejected', rejection_reason = 'No.' where id = $1`, [
      applied.body.organiserId,
    ]);
    const refused = await join(rejected.token, { token, ...DETAILS });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("rejected");

    const suspended = await approvedOrganiser(api, admin);
    const takedown = await api.call(adminSuspendOrganiser, {
      token: admin.token,
      params: { organiserId: suspended.organiserId },
      body: { reason: "Fake listings." },
    });
    expect(takedown.status).toBe(200);
    const down = await join(suspended.token, { token, ...DETAILS });
    expect(down.status).toBe(409);
    expect(down.body.code).toBe("rejected");

    expect((await linkRows())[0]).toMatchObject({ id: linkId, status: "active", used_at: null });
    expect((await view(token)).status).toBe(200);
    expect(
      await api.db.query(`select status::text from public.organisers order by created_at`),
    ).toEqual([{ status: "approved" }, { status: "rejected" }, { status: "rejected" }]);
    expect(await api.db.query(`select id from private.organiser_profile_edits where kind = 'invite_accepted'`)).toEqual([]);
  });

  it("an organiser taken down, then resubmitted (pending again), is refused (409): the link stays unused, the organiser pending", async () => {
    const { linkId, token } = await createLink();
    const owner = await approvedOrganiser(api, admin);
    const takedown = await api.call(adminSuspendOrganiser, {
      token: admin.token,
      params: { organiserId: owner.organiserId },
      body: { reason: "Fake listings." },
    });
    expect(takedown.status).toBe(200);
    const resubmitted = await api.call(resubmitOrganiser, { token: owner.token, body: application, method: "PATCH" });
    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(200);
    expect(resubmitted.body.status).toBe("pending");

    for (const body of [{ token }, { token, ...DETAILS }]) {
      const refused = await join(owner.token, body);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("rejected");
    }

    expect((await linkRows())[0]).toMatchObject({ id: linkId, status: "active", used_at: null, used_by: null });
    expect((await view(token)).status).toBe(200);
    expect(
      await api.db.query(`select status::text, reviewed_by from public.organisers where id = $1`, [owner.organiserId]),
    ).toEqual([{ status: "pending", reviewed_by: null }]);
    expect(await api.db.query(`select id from private.organiser_profile_edits where kind = 'invite_accepted'`)).toEqual([]);
    expect(await joinedJobs()).toEqual([]);

    // An admin's review still decides it; and the unused link still works for someone else.
    const approved = await api.call(adminApproveOrganiser, {
      token: admin.token,
      params: { organiserId: owner.organiserId },
      method: "POST",
    });
    expect(approved.status).toBe(200);
    const other = await api.signUp();
    expect((await join(other.token, { token, ...DETAILS })).status).toBe(200);
  });

  it("an application an admin rejected (not taken down) and that was resubmitted can be approved by a link", async () => {
    // Nothing durable records a plain rejection (the resubmission clears it),
    // so this is the same as joining with a fresh account: documented in
    // docs/architecture.md, "Organiser links".
    const person = await api.signUp();
    const applied = await api.call(applyAsOrganiser, { token: person.token, body: application });
    const organiserId = applied.body.organiserId as string;
    const rejected = await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId },
      body: { reason: "Tell us more." },
    });
    expect(rejected.status).toBe(200);
    const resubmitted = await api.call(resubmitOrganiser, { token: person.token, body: application, method: "PATCH" });
    expect(resubmitted.status).toBe(200);

    const { token } = await createLink();
    const res = await join(person.token, { token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.organiserId).toBe(organiserId);
    expect(await api.db.query(`select status::text from public.organisers where id = $1`, [organiserId])).toEqual([
      { status: "approved" },
    ]);
  });

  it("a new organiser's name can't carry control or invisible characters (400)", async () => {
    const { token } = await createLink();
    const person = await api.signUp();
    for (const displayName of [
      "Neon\u202ECollective", // right-to-left override (Cf)
      "Neon\u200BCollective", // zero-width space (Cf)
      "Neon\u2066Collective\u2069", // isolates (Cf)
      "Neon\u00ADCollective", // soft hyphen (Cf)
      "Neon\u0007Collective", // bell (Cc)
      "Neon\nCollective", // line feed (Cc)
      "Neon\u2028Collective", // line separator
    ]) {
      const res = await join(person.token, { token, displayName, categories: ["art"] });
      expect(res.status, JSON.stringify(displayName)).toBe(400);
      expect(res.body.fieldErrors).toEqual({ displayName: "Use letters, numbers, spaces and punctuation only." });
    }
    expect(await organiserRows()).toEqual([]);
    expect((await linkRows())[0].status).toBe("active");

    // Accents, emoji and punctuation are fine.
    const ok = await join(person.token, { token, displayName: "Café Ünïcode ✨ & Co.", categories: ["art"] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.displayName).toBe("Café Ünïcode ✨ & Co.");
  });

  it("categories: at most 5 as sent (400), repeats dropped", async () => {
    const { token } = await createLink();
    const person = await api.signUp();
    const tooMany = await join(person.token, {
      token,
      displayName: "Neon",
      categories: ["live-music", "art", "workshop", "pop-up", "theatre", "art"],
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.fieldErrors).toEqual({ categories: "Choose up to 5 categories." });
    const huge = await join(person.token, { token, displayName: "Neon", categories: Array(1000).fill("art") });
    expect(huge.body.fieldErrors).toEqual({ categories: "Choose up to 5 categories." });
    expect(await organiserRows()).toEqual([]);

    const res = await join(person.token, { token, displayName: "Neon", categories: ["art", "art", "live-music", "art"] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await organiserRows())[0].categories).toEqual(["art", "live-music"]);
  });

  it("emails the admins once that an organiser joined, straight after the response; not on a retry", async () => {
    const second = await api.signUp({ admin: true, email: "second-admin@sheltuh.test" });
    const { token } = await createLink();
    const person = await api.signUp();
    const res = await join(person.token, { token, ...DETAILS });
    expect(res.status).toBe(200);
    expect(await joinedJobs()).toEqual([{ organiser_id: res.body.organiserId, status: "pending" }]);
    expect(api.sendEmail).not.toHaveBeenCalled(); // not before the response

    await api.runDeferred();
    const messages = api.sendEmail.mock.calls.map(([message]) => message);
    expect(messages.map((m) => m.to).sort()).toEqual([admin.email, second.email].sort());
    for (const message of messages) {
      expect(message.subject).toBe("Organiser joined with a link");
      expect(message.text).toContain(`Organiser name: ${DETAILS.displayName}`);
      expect(message.text).toContain(`${SITE_URL}/admin/organisers?status=approved`);
      expect(message.text).not.toContain(token);
      expect(message.text).not.toContain(person.email);
    }
    expect(await joinedJobs()).toEqual([{ organiser_id: res.body.organiserId, status: "sent" }]);

    // The same account again: the same 200, no second email.
    expect((await join(person.token, { token, ...DETAILS })).status).toBe(200);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(2);
    expect(await joinedJobs()).toHaveLength(1);
  });

  it("the joined email is only leased by kind (a previous release's cron never takes one), and not sent once the organiser is taken down", async () => {
    const { token } = await createLink();
    const person = await api.signUp();
    const res = await join(person.token, { token, ...DETAILS });
    const lease = (kind: string | null) =>
      api.db.query<{ job_kind: string }>(`select job_kind from private.lease_outbox_jobs(10, '2 minutes', 6, null, $1)`, [
        kind,
      ]);
    expect((await lease(null)).map((j) => j.job_kind)).not.toContain("organiser_joined");
    expect((await lease("organiser_joined")).map((j) => j.job_kind)).toEqual(["organiser_joined"]);
    // Let it be leased again now.
    await api.db.query(`update private.email_outbox set status = 'pending', lease_expires_at = null, lease_token = null
                         where kind = 'organiser_joined'`);

    await api.call(adminSuspendOrganiser, {
      token: admin.token,
      params: { organiserId: res.body.organiserId },
      body: { reason: "Fake listings." },
    });
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("404 for expired and cancelled links; a creator who's no longer an admin cancels the link (cancelled_by null)", async () => {
    const person = await api.signUp();
    const expired = await createLink();
    await expireLink(expired.linkId);
    expectUnavailable(await join(person.token, { token: expired.token, ...DETAILS }));

    const cancelled = await createLink();
    await cancel(cancelled.linkId);
    expectUnavailable(await join(person.token, { token: cancelled.token, ...DETAILS }));

    const demoted = await createLink();
    await api.db.query(`update auth.users set raw_app_meta_data = '{}' where id = $1`, [admin.userId]);
    expectUnavailable(await join(person.token, { token: demoted.token, ...DETAILS }));
    const row = (await linkRows()).find((r) => r.id === demoted.linkId);
    expect(row).toMatchObject({ status: "cancelled", cancelled_by: null });
    expect(row?.cancelled_at).not.toBeNull();

    // Deleted (created_by set null): the same.
    const other = await signUpAdmin(api);
    const orphan = await createLink(other.token);
    await api.db.query(`delete from auth.users where id = $1`, [other.userId]);
    expectUnavailable(await join(person.token, { token: orphan.token, ...DETAILS }));
    expect(await organiserRows()).toEqual([]);
  });

  it("at most 10 tries an hour per account and 30 per client (429), counting failures too", async () => {
    const { token } = await createLink();
    const person = await api.signUp();
    const { hits } = ORGANISER_LINK_LIMITS.joinsPerAccount;
    for (let i = 0; i < hits; i += 1) {
      expectUnavailable(await join(person.token, { token: randomBytes(32).toString("base64url"), ...DETAILS }));
    }
    expect((await join(person.token, { token, ...DETAILS })).status).toBe(429);
    expect(await organiserRows()).toEqual([]);

    const ip = "198.51.100.30";
    const { bucket, hits: clientHits } = ORGANISER_LINK_LIMITS.joinsPerClient;
    await api.db.query(
      `insert into private.client_rate_limits (client_key, bucket, window_started_at, hits) values ($1, $2, now(), $3)`,
      [clientKey(ip, WEBHOOK_SECRET), bucket, clientHits],
    );
    const fresh = await api.signUp();
    expect((await join(fresh.token, { token, ...DETAILS }, { "x-forwarded-for": ip })).status).toBe(429);
    expect((await join(fresh.token, { token, ...DETAILS }, { "x-forwarded-for": "198.51.100.31" })).status).toBe(200);
  });

  it("the token never reaches a log, and no response but the admin's create carries it", async () => {
    const spies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
    ];
    const { linkId, token } = await createLink();
    const person = await api.signUp();
    const responses = [
      await view(token), // no client IP: the per-client limit is skipped, with a warning
      await join(person.token, { token }), // 400
      await join(person.token, { token, ...DETAILS }),
      await join(person.token, { token, ...DETAILS }),
      await list(),
      await cancel(linkId),
    ];
    // Without the secret the per-client limits fail open, logged.
    const noSecret = await runHandler(
      viewOrganiserLink,
      new Request(`${SITE_URL}/api/test`, { method: "POST", body: JSON.stringify({ token }) }),
      {},
      {
        ...api.deps,
        stripeWebhookSecret: () => {
          throw new Error("STRIPE_WEBHOOK_SECRET is not set");
        },
      },
    );
    responses.push({ status: noSecret.status, body: await noSecret.json(), headers: noSecret.headers });

    expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    for (const spy of spies) {
      for (const args of spy.mock.calls) {
        expect(JSON.stringify(args)).not.toContain(token);
        expect(JSON.stringify(args)).not.toContain(sha256(token));
      }
    }
    for (const res of responses) {
      expect(JSON.stringify(res.body ?? {})).not.toContain(token);
    }
  });
});

describe("races", () => {
  it("two accounts joining with one link at once: exactly one organiser", async () => {
    const { token } = await createLink();
    const [a, b] = await Promise.all([api.signUp(), api.signUp()]);
    const results = await Promise.all([
      join(a.token, { token, ...DETAILS, displayName: "A" }),
      join(b.token, { token, ...DETAILS, displayName: "B" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(await organiserRows()).toHaveLength(1);
    const winner = results.find((r) => r.status === 200)!;
    expect((await linkRows())[0]).toMatchObject({ status: "used", organiser_id: winner.body.organiserId });
    expect(await api.db.query(`select kind from private.organiser_profile_edits`)).toEqual([{ kind: "invite_accepted" }]);
  });

  it("the same account joining twice at once: one organiser, both answers the same", async () => {
    const { token } = await createLink();
    const person = await api.signUp();
    const [a, b] = await Promise.all([join(person.token, { token, ...DETAILS }), join(person.token, { token, ...DETAILS })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    expect(await organiserRows()).toHaveLength(1);
  });

  it("a cancel racing a join: exactly one wins", async () => {
    const { linkId, token } = await createLink();
    const person = await api.signUp();
    const [cancelled, joined] = await Promise.all([cancel(linkId), join(person.token, { token, ...DETAILS })]);
    const [row] = await linkRows();
    if (cancelled.status === 200) {
      expectUnavailable(joined);
      expect(row.status).toBe("cancelled");
      expect(await organiserRows()).toEqual([]);
    } else {
      expect(cancelled.status).toBe(409);
      expect(joined.status).toBe(200);
      expect(row.status).toBe("used");
    }
  });

  it("a join racing an application: one organiser, approved either way or the join 409 with the link unused", async () => {
    const { token } = await createLink();
    const person = await api.signUp();
    const [joined, applied] = await Promise.all([
      join(person.token, { token, ...DETAILS }),
      api.call(applyAsOrganiser, { token: person.token, body: application }),
    ]);
    const organisers = await organiserRows();
    expect(organisers).toHaveLength(1);
    const [row] = await linkRows();
    if (joined.status === 200) {
      // The join created it (the application 409) or approved the application that won.
      expect(organisers[0].status).toBe("approved");
      expect(row.status).toBe("used");
    } else {
      expect(applied.status).toBe(201);
      expect(joined.status).toBe(409);
      expect(joined.body.code).toBe("conflict");
      expect(row.status).toBe("active");
    }
  });
});

describe("the table's rules hold whatever the API does", () => {
  it("statuses with their times, a hashed token, an expiry after creation", async () => {
    const insert = (status: string, usedAt: string | null = null, cancelledAt: string | null = null, hash?: string) =>
      api.db.query(
        `insert into private.organiser_invite_links (token_hash, status, expires_at, used_at, cancelled_at)
         values ($1, $2, now() + interval '1 day', $3::timestamptz, $4::timestamptz)`,
        [hash ?? sha256(crypto.randomUUID()), status, usedAt, cancelledAt],
      );
    const now = new Date().toISOString();
    await insert("active");
    await insert("used", now);
    await insert("cancelled", null, now);
    await expect(insert("used")).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("cancelled")).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("active", now)).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("expired")).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("active", null, null, "not-a-hash")).rejects.toThrow(/check constraint|violates/i);
    await expect(
      api.db.query(`insert into private.organiser_invite_links (token_hash, expires_at) values ($1, now() - interval '1 day')`, [
        sha256("x"),
      ]),
    ).rejects.toThrow(/check constraint|violates/i);
  });
});

describe("retention (purge_operational_data)", () => {
  it("deletes links 90 days after they were used, cancelled or expired; keeps the rest", async () => {
    const ids: Record<string, string> = {};
    for (const name of ["usedOld", "usedNew", "cancelledOld", "expiredOld", "active"]) {
      ids[name] = (await createLink()).linkId;
    }
    const set = (name: string, assignments: string) =>
      api.db.query(`update private.organiser_invite_links set ${assignments} where id = $1`, [ids[name]]);
    await set("usedOld", `status = 'used', used_at = now() - interval '91 days'`);
    await set("usedNew", `status = 'used', used_at = now() - interval '89 days'`);
    await set("cancelledOld", `status = 'cancelled', cancelled_at = now() - interval '91 days'`);
    await set("expiredOld", `created_at = now() - interval '98 days', expires_at = now() - interval '91 days'`);

    const [counts] = await api.db.query<Record<string, number>>(`select * from private.purge_operational_data()`);
    expect(counts.organiser_invite_links_deleted).toBe(3);
    // The other counts are still there.
    expect(counts).toHaveProperty("account_invites_deleted");
    expect(counts).toHaveProperty("checkout_attempts_deleted");
    const left = await api.db.query<{ id: string }>(`select id from private.organiser_invite_links`);
    expect(left.map((r) => r.id).sort()).toEqual([ids.usedNew, ids.active].sort());
  });
});
