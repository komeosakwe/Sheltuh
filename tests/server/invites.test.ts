import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clientKey } from "@/lib/server/client-key";
import type { EmailMessage } from "@/lib/server/email";
import { adminListOrganisers } from "@/lib/server/handlers/admin";
import {
  acceptInvite,
  adminCreateInvite,
  adminListInvites,
  adminResendInvite,
  adminRevokeInvite,
  getInviteAccountLink,
  getMyInvite,
  INVITE_LIMITS,
  viewInvite,
} from "@/lib/server/handlers/invites";
import { applyAsOrganiser, getMyOrganiser } from "@/lib/server/handlers/organisers";
import { FakeAuthAdmin, SITE_URL, TestApi, WEBHOOK_SECRET } from "./helpers/api";
import { application, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// Account invites: docs/architecture.md, "Account invites";
// supabase/migrations/20261108000000_account_invites.sql;
// lib/server/handlers/invites.ts.

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

const INVITEE = "Invitee@Example.com";
const sha256 = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

const organiserBody = (overrides: Record<string, unknown> = {}) => ({
  kind: "organiser",
  email: INVITEE,
  consent: true,
  organiser: { ...application, instagramHandle: "@static.collective" },
  ...overrides,
});
const memberBody = (overrides: Record<string, unknown> = {}) => ({ kind: "member", email: INVITEE, consent: true, ...overrides });

function create(body: unknown, token = admin.token) {
  return api.call(adminCreateInvite, { token, body });
}

/** The token in the newest invite email (from its fragment). */
function lastToken(): string {
  const message = api.sendEmail.mock.calls.at(-1)?.[0] as EmailMessage;
  const match = /\/invite#token=([A-Za-z0-9_-]{43})/.exec(message.text);
  if (!match) throw new Error("no invite link in the last email");
  return match[1];
}

async function createOrganiserInvite(overrides: Record<string, unknown> = {}) {
  const res = await create(organiserBody(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { inviteId: res.body.invite.inviteId as string, token: lastToken(), res };
}

async function inviteRows() {
  return api.db.query<Record<string, unknown>>(`select * from private.account_invites order by created_at, id`);
}

const view = (token: string) => api.call(viewInvite, { body: { token } });
const accountLink = (token: string, headers?: Record<string, string>) =>
  api.call(getInviteAccountLink, { body: { token }, headers });
const accept = (inviteId: string, token: string) => api.call(acceptInvite, { token, body: { inviteId } });

/**
 * A db.query stand-in that runs `hook` once just before the first query
 * matching `pattern`, then passes every query to the real `db`.
 */
function passThroughAfter(db: TestApi["db"], pattern: RegExp, hook: () => Promise<void>) {
  const real = db.query.bind(db);
  let fired = false;
  return (async (text: string, params?: unknown[]) => {
    if (!fired && pattern.test(text)) {
      fired = true;
      await hook();
    }
    return real(text, params);
  }) as TestApi["db"]["query"];
}

describe("creating an invite (POST /api/admin/invites)", () => {
  it("saves an organiser invite, stores only the token's hash, and emails a fragment link", async () => {
    const res = await create(organiserBody());
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.emailSent).toBe(true);
    expect(res.body.invite).toMatchObject({
      kind: "organiser",
      email: INVITEE,
      status: "pending",
      organiserName: application.displayName,
      invitedBy: admin.userId,
      sendCount: 1,
    });
    expect(res.body.invite).not.toHaveProperty("lastSendFailedAt");
    const days = (Date.parse(res.body.invite.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThanOrEqual(14);

    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const message = api.sendEmail.mock.calls[0][0];
    expect(message.to).toBe(INVITEE);
    const token = lastToken();
    expect(message.html).toContain(`href="${SITE_URL}/invite#token=${token}"`);

    const [row] = await inviteRows();
    expect(row.token_hash).toBe(sha256(token));
    // The token itself is nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.organiser_profile).toEqual({
      display_name: application.displayName,
      contact_email: application.contactEmail,
      description: application.description,
      categories: application.categories,
      website_url: application.websiteUrl,
      instagram_handle: "static.collective",
      tiktok_handle: null,
      facebook_page: null,
      x_handle: null,
      featured_video_provider: null,
      featured_video_id: null,
    });
  });

  it("saves a member invite without organiser details", async () => {
    const res = await create(memberBody());
    expect(res.status).toBe(201);
    expect(res.body.invite).toMatchObject({ kind: "member", status: "pending" });
    expect(res.body.invite).not.toHaveProperty("organiserName");
    expect((await inviteRows())[0].organiser_profile).toBeNull();
  });

  it("is admin only", async () => {
    expect((await api.call(adminCreateInvite, { body: memberBody() })).status).toBe(401);
    const member = await api.signUp();
    expect((await create(memberBody(), member.token)).status).toBe(403);
    expect(await inviteRows()).toEqual([]);
  });

  it("validates the body: kind, email, consent and (organisers) the application's rules, bio included", async () => {
    const res = await create({ kind: "other", email: "not an email", consent: "yes" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["consent", "email", "kind"]);

    expect((await create(memberBody({ consent: false }))).body.fieldErrors).toEqual({
      consent: "Confirm they asked to be invited.",
    });
    expect((await create(organiserBody({ organiser: undefined }))).body.fieldErrors).toEqual({
      organiser: "Enter the organiser's details.",
    });
    const noBio = await create(organiserBody({ organiser: { ...application, description: "  ", categories: [] } }));
    expect(noBio.status).toBe(400);
    expect(Object.keys(noBio.body.fieldErrors).sort()).toEqual(["organiser.categories", "organiser.description"]);
    const badSite = await create(organiserBody({ organiser: { ...application, websiteUrl: "http://static.example" } }));
    expect(Object.keys(badSite.body.fieldErrors)).toEqual(["organiser.websiteUrl"]);
    expect((await create(memberBody({ organiser: application }))).body.fieldErrors).toEqual({
      organiser: "A member invite has no organiser details.",
    });
    expect((await create(memberBody({ email: "Name <a@example.com>" }))).body.fieldErrors).toHaveProperty("email");
    expect(await inviteRows()).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a second pending invite for the same address, ignoring case (409)", async () => {
    await createOrganiserInvite();
    const again = await create(memberBody({ email: "INVITEE@example.COM" }));
    expect(again.status).toBe(409);
    expect(again.body.fieldErrors.email).toMatch(/already has an invite waiting/);
    expect(await inviteRows()).toHaveLength(1);
  });

  it("allows a new invite once the earlier one expired (marking it expired)", async () => {
    const first = await createOrganiserInvite();
    await api.db.query(`update private.account_invites set expires_at = now() - interval '1 second'`);
    const again = await create(memberBody());
    expect(again.status).toBe(201);
    const rows = await inviteRows();
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      [first.inviteId, "expired"],
      [again.body.invite.inviteId, "pending"],
    ]);
  });

  it("refuses an organiser invite for an address whose account already has an organiser (409); a member invite is fine", async () => {
    const owner = await api.signUp({ email: "invitee@example.com" });
    await api.call(applyAsOrganiser, { token: owner.token, body: application });
    const res = await create(organiserBody());
    expect(res.status).toBe(409);
    expect(res.body.fieldErrors.email).toMatch(/already has an organiser/);
    expect((await create(memberBody())).status).toBe(201);
  });

  it("is 503 without the invite key, before anything is written", async () => {
    api.authAdmin = undefined;
    const res = await create(organiserBody());
    expect(res.status).toBe(503);
    expect(await inviteRows()).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect(await api.db.query(`select * from private.rate_limits where bucket = 'account_invites'`)).toEqual([]);
  });

  it("caps each admin at 20 an hour and everyone at 100 a day (429); a refusal takes no allowance", async () => {
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'account_invites', now(), $2)`,
      [admin.userId, INVITE_LIMITS.adminHourly.hits],
    );
    const res = await create(memberBody());
    expect(res.status).toBe(429);
    expect(await inviteRows()).toEqual([]);
    expect(await api.db.query(`select hits from private.rate_limits where bucket = 'account_invites'`)).toEqual([
      { hits: INVITE_LIMITS.adminHourly.hits },
    ]);
    expect(await api.db.query(`select * from private.platform_rate_limits where bucket = 'account_invites_daily'`)).toEqual([]);

    // Another admin has their own hourly allowance, but the daily one is shared.
    const other = await signUpAdmin(api);
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('account_invites_daily', now(), $1)`,
      [INVITE_LIMITS.platformDaily.hits],
    );
    expect((await create(memberBody(), other.token)).status).toBe(429);
    // The other admin's hit was given back with the refusal.
    expect(await api.db.query(`select * from private.rate_limits where user_id = $1`, [other.userId])).toEqual([]);
    await api.db.query(`delete from private.platform_rate_limits`);
    expect((await create(memberBody(), other.token)).status).toBe(201);
  });

  it("refusals (already invited, already an organiser) don't use the allowance", async () => {
    await createOrganiserInvite();
    for (let i = 0; i < 3; i += 1) expect((await create(memberBody())).status).toBe(409);
    expect(await api.db.query(`select hits from private.rate_limits where bucket = 'account_invites'`)).toEqual([{ hits: 1 }]);
  });

  it("still saves the invite when the email fails: emailSent false, recorded, logged without the address or token", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let sentToken = "";
    api.sendEmail.mockImplementationOnce(async (message) => {
      sentToken = /token=([A-Za-z0-9_-]{43})/.exec(message.text)![1];
      throw new Error(`SMTP refused ${message.to}: ${message.text}`);
    });
    const res = await create(organiserBody());
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.invite.lastSendFailedAt).toEqual(expect.any(String));
    expect(errors).toHaveBeenCalled();
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain(sentToken);
    expect(logged.toLowerCase()).not.toContain("invitee@example.com");
  });
});

describe("listing invites (GET /api/admin/invites)", () => {
  it("lists one status, newest first, with expired worked out from the link's expiry", async () => {
    const a = await createOrganiserInvite({ email: "a@example.com" });
    const b = await createOrganiserInvite({ email: "b@example.com" });
    const c = await createOrganiserInvite({ email: "c@example.com" });
    await api.db.query(`update private.account_invites set expires_at = now() - interval '1 minute' where id = $1`, [b.inviteId]);
    await api.call(adminRevokeInvite, { token: admin.token, params: { inviteId: c.inviteId }, method: "POST" });

    const list = async (status?: string) => {
      const res = await api.call(adminListInvites, { token: admin.token, query: status ? { status } : {} });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      return res.body.items.map((i: { inviteId: string; status: string }) => [i.inviteId, i.status]);
    };
    expect(await list()).toEqual([[a.inviteId, "pending"]]);
    expect(await list("expired")).toEqual([[b.inviteId, "expired"]]);
    expect(await list("revoked")).toEqual([[c.inviteId, "revoked"]]);
    expect(await list("accepted")).toEqual([]);

    const res = await api.call(adminListInvites, { token: admin.token, query: { status: "nope" } });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ status: "Unknown status." });
  });

  it("pages with a cursor, and is admin only", async () => {
    for (const email of ["a@example.com", "b@example.com", "c@example.com"]) await create(memberBody({ email }));
    const first = await api.call(adminListInvites, { token: admin.token, query: { limit: "2" } });
    expect(first.body.items.map((i: { email: string }) => i.email)).toEqual(["c@example.com", "b@example.com"]);
    const second = await api.call(adminListInvites, {
      token: admin.token,
      query: { limit: "2", cursor: first.body.nextCursor },
    });
    expect(second.body.items.map((i: { email: string }) => i.email)).toEqual(["a@example.com"]);
    expect(second.body.nextCursor).toBeUndefined();
    // Never the token or its hash.
    expect(JSON.stringify(first.body)).not.toMatch(/token|hash/i);

    expect((await api.call(adminListInvites, {})).status).toBe(401);
    const member = await api.signUp();
    expect((await api.call(adminListInvites, { token: member.token })).status).toBe(403);
  });
});

describe("resending and revoking", () => {
  const resend = (inviteId: string) =>
    api.call(adminResendInvite, { token: admin.token, params: { inviteId }, method: "POST" });
  const revoke = (inviteId: string) =>
    api.call(adminRevokeInvite, { token: admin.token, params: { inviteId }, method: "POST" });
  const sendable = () => api.db.query(`update private.account_invites set last_sent_at = now() - interval '2 minutes'`);

  it("a resend emails a new link (the old one is a 404), 14 days from now, and resets the link count", async () => {
    const { inviteId, token: oldToken } = await createOrganiserInvite();
    await api.db.query(
      `update private.account_invites set expires_at = now() + interval '1 day', links_issued = 4, last_send_failed_at = now()`,
    );
    expect((await resend(inviteId)).status).toBe(429); // sent less than a minute ago
    await sendable();
    const res = await resend(inviteId);
    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.invite).toMatchObject({ status: "pending", sendCount: 2 });
    expect(res.body.invite).not.toHaveProperty("lastSendFailedAt");
    expect(Date.parse(res.body.invite.expiresAt) - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    const newToken = lastToken();
    expect(newToken).not.toBe(oldToken);
    expect((await view(oldToken)).status).toBe(404);
    expect((await view(newToken)).status).toBe(200);
    const [row] = await inviteRows();
    expect(row).toMatchObject({ links_issued: 0, last_sent_by: admin.userId, token_hash: sha256(newToken) });
  });

  it("revives an expired invite; refuses an accepted or revoked one (409), an unknown one (404), and is 503 without the key", async () => {
    const { inviteId, token } = await createOrganiserInvite();
    await api.db.query(`update private.account_invites set expires_at = now() - interval '1 second'`);
    expect((await view(token)).status).toBe(410);
    await sendable();
    expect((await resend(inviteId)).status).toBe(200);
    expect((await view(lastToken())).status).toBe(200);

    expect((await revoke(inviteId)).status).toBe(200);
    await sendable();
    expect((await resend(inviteId)).status).toBe(409);
    expect((await resend(crypto.randomUUID())).status).toBe(404);
    expect((await resend("not-a-uuid")).status).toBe(404);
    api.authAdmin = undefined;
    expect((await resend(inviteId)).status).toBe(503);
  });

  it("a resend of an invite that expired after the address got a new one is 409", async () => {
    const first = await createOrganiserInvite();
    await api.db.query(`update private.account_invites set expires_at = now() - interval '1 second'`);
    await create(memberBody());
    await sendable();
    const res = await resend(first.inviteId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/another invite waiting/);
  });

  it("a resend takes the same allowances", async () => {
    const { inviteId } = await createOrganiserInvite();
    await sendable();
    await api.db.query(`update private.rate_limits set hits = $1 where bucket = 'account_invites'`, [
      INVITE_LIMITS.adminHourly.hits,
    ]);
    expect((await resend(inviteId)).status).toBe(429);
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("revoking stops the link at once; a second revoke is 409, and only pending, unexpired invites can be revoked", async () => {
    const { inviteId, token } = await createOrganiserInvite();
    const res = await revoke(inviteId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inviteId, status: "revoked", revokedAt: expect.any(String) });
    const gone = await view(token);
    expect(gone.status).toBe(410);
    expect(gone.body.code).toBe("revoked");
    expect((await revoke(inviteId)).status).toBe(409);
    expect((await revoke(crypto.randomUUID())).status).toBe(404);
    expect((await revoke("nope")).status).toBe(404);

    const other = await createOrganiserInvite({ email: "other@example.com" });
    await api.db.query(`update private.account_invites set expires_at = now() - interval '1 second' where id = $1`, [
      other.inviteId,
    ]);
    expect((await revoke(other.inviteId)).status).toBe(409);

    const member = await api.signUp();
    expect((await api.call(adminRevokeInvite, { token: member.token, params: { inviteId }, method: "POST" })).status).toBe(403);
  });
});

describe("the invite page (view and account-link)", () => {
  it("view shows the invite without changing anything", async () => {
    const { token } = await createOrganiserInvite();
    const before = await inviteRows();
    const res = await view(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({
      kind: "organiser",
      maskedEmail: expect.stringMatching(/^I\*+@Example\.com$/),
      organiserName: application.displayName,
      expiresAt: expect.any(String),
      account: "new",
      passwordSetup: true,
    });
    expect(await inviteRows()).toEqual(before);

    // An existing confirmed account: sign in instead. No key: the ordinary sign-up.
    await api.signUp({ email: "invitee@example.com" });
    api.authAdmin = undefined;
    expect((await view(token)).body).toMatchObject({ account: "existing", passwordSetup: false });
  });

  it("view: 400 malformed, 404 unknown, 410 expired or used", async () => {
    expect((await view("short")).status).toBe(400);
    expect((await api.call(viewInvite, { body: {} })).status).toBe(400);
    expect((await view("B".repeat(43))).status).toBe(404);

    const { token } = await createOrganiserInvite();
    await api.db.query(`update private.account_invites set expires_at = now() - interval '1 second'`);
    const expired = await view(token);
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe("expired");
  });

  it("account-link asks Supabase Auth for the invite's address and returns the token hash", async () => {
    const { token } = await createOrganiserInvite();
    const res = await accountLink(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({ tokenHash: expect.stringMatching(/^pkce_hash_/) });
    expect(api.authAdmin!.calls).toEqual([INVITEE]);
    expect((await inviteRows())[0].links_issued).toBe(1);
  });

  it("account-link: 409 has_account when the address already has a confirmed account (asking Supabase nothing), or Supabase says so", async () => {
    const { token } = await createOrganiserInvite();
    const existing = await api.signUp({ email: "invitee@example.com" });
    const res = await accountLink(token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("has_account");
    expect(api.authAdmin!.calls).toEqual([]);
    expect(api.authAdmin!.deleted).toEqual([]);

    api.authAdmin!.existing.add("invitee@example.com");
    await api.db.query(`delete from auth.users where id = $1`, [existing.userId]);
    const exists = await accountLink(token);
    expect(exists.status).toBe(409);
    expect(exists.body.code).toBe("has_account");
  });

  it("account-link: 400, 404, 410 (code), 503 without the key or when Supabase fails (logged without the address)", async () => {
    expect((await accountLink("x")).status).toBe(400);
    expect((await accountLink("C".repeat(43))).status).toBe(404);
    const { inviteId, token } = await createOrganiserInvite();

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    api.authAdmin!.failing = true;
    const failed = await accountLink(token);
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe("unavailable");
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toMatch(/invitee@example\.com/i);
    expect(logged).not.toContain(token);

    api.authAdmin = undefined;
    const off = await accountLink(token);
    expect(off.status).toBe(503);
    expect(off.body.code).toBe("unavailable");

    api.authAdmin = new FakeAuthAdmin(api.db);
    await api.call(adminRevokeInvite, { token: admin.token, params: { inviteId }, method: "POST" });
    const revoked = await accountLink(token);
    expect(revoked.status).toBe(410);
    expect(revoked.body.code).toBe("revoked");
    expect(api.authAdmin.calls).toEqual([]);
  });

  it("account-link: at most 10 per link, and 20 an hour per client (429)", async () => {
    const { token } = await createOrganiserInvite();
    for (let i = 0; i < INVITE_LIMITS.linksPerInvite; i += 1) expect((await accountLink(token)).status).toBe(200);
    expect((await accountLink(token)).status).toBe(429);
    expect(api.authAdmin!.calls).toHaveLength(INVITE_LIMITS.linksPerInvite);

    const second = await createOrganiserInvite({ email: "second@example.com" });
    const ip = "203.0.113.9";
    const { bucket, hits } = INVITE_LIMITS.linkRequestsPerClient;
    await api.db.query(
      `insert into private.client_rate_limits (client_key, bucket, window_started_at, hits) values ($1, $2, now(), $3)`,
      [clientKey(ip, WEBHOOK_SECRET), bucket, hits],
    );
    expect((await accountLink(second.token, { "x-forwarded-for": ip })).status).toBe(429);
    expect((await accountLink(second.token, { "x-forwarded-for": "203.0.113.10" })).status).toBe(200);
  });

  it("account-link: made-up tokens from a shared client don't use its allowance (only a token matching an invite counts)", async () => {
    const { token } = await createOrganiserInvite();
    const ip = "198.51.100.7";
    const { bucket, hits } = INVITE_LIMITS.linkRequestsPerClient;
    for (let i = 0; i <= hits; i += 1) {
      const junk = await accountLink(randomBytes(32).toString("base64url"), { "x-forwarded-for": ip });
      expect(junk.status).toBe(404);
    }
    expect(await api.db.query(`select * from private.client_rate_limits where bucket = $1`, [bucket])).toEqual([]);
    expect((await accountLink(token, { "x-forwarded-for": ip })).status).toBe(200);
    expect(await api.db.query(`select hits from private.client_rate_limits where bucket = $1`, [bucket])).toEqual([{ hits: 1 }]);

    // A matched token counts even when the invite can't be used any more.
    await api.call(adminRevokeInvite, { token: admin.token, params: { inviteId: (await inviteRows())[0].id as string }, method: "POST" });
    expect((await accountLink(token, { "x-forwarded-for": ip })).status).toBe(410);
    expect(await api.db.query(`select hits from private.client_rate_limits where bucket = $1`, [bucket])).toEqual([{ hits: 2 }]);
  });
});

describe("account-link and an account someone registered first with the invited address", () => {
  /** An unconfirmed account with a password, as Supabase's ordinary sign-up leaves it before confirmation. */
  async function preRegister(email = "invitee@example.com") {
    const id = crypto.randomUUID();
    await api.db.query(
      `insert into auth.users (id, email, raw_app_meta_data, encrypted_password) values ($1, $2, '{}', '$2a$10$someoneelse')`,
      [id, email],
    );
    return id;
  }

  async function accountsFor(email = "invitee@example.com") {
    return api.db.query<{ id: string; email_confirmed_at: string | null; encrypted_password: string | null }>(
      `select id, email_confirmed_at, encrypted_password from auth.users where lower(email) = lower($1)`,
      [email],
    );
  }

  it("deletes the unconfirmed account, then mints for a new passwordless one", async () => {
    const { token } = await createOrganiserInvite();
    const squatter = await preRegister();
    const res = await accountLink(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tokenHash: expect.stringMatching(/^pkce_hash_/) });
    expect(api.authAdmin!.deleted).toEqual([squatter]);
    expect(api.authAdmin!.calls).toEqual([INVITEE]);
    const accounts = await accountsFor();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).not.toBe(squatter);
    expect(accounts[0]).toMatchObject({ email_confirmed_at: null, encrypted_password: null });

    // Pressed again: the passwordless account from the first press is replaced too.
    const first = accounts[0].id;
    expect((await accountLink(token)).status).toBe(200);
    expect(api.authAdmin!.deleted).toEqual([squatter, first]);
    expect(await accountsFor()).toHaveLength(1);
  });

  it("never deletes a confirmed account: 409 has_account, nothing minted", async () => {
    const { token } = await createOrganiserInvite();
    // The link step's own check refuses it first...
    const owner = await api.signUp({ email: "invitee@example.com" });
    expect((await accountLink(token)).body.code).toBe("has_account");
    // ...and an account confirmed between that check and the deletion is caught by the re-check.
    const squatter = await preRegister("INVITEE@example.com");
    await api.db.query(`delete from auth.users where id = $1`, [owner.userId]);
    const confirmJustBefore = passThroughAfter(api.db, /from auth\.users u where u\.id = \$1/, async () => {
      await api.db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [squatter]);
    });
    vi.spyOn(api.db, "query").mockImplementation(confirmJustBefore);
    const res = await accountLink(token);
    vi.restoreAllMocks();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("has_account");
    expect(api.authAdmin!.deleted).toEqual([]);
    expect(api.authAdmin!.calls).toEqual([]);
    expect(await accountsFor()).toEqual([expect.objectContaining({ id: squatter })]);
  });

  it("leaves an unconfirmed account that has signed in alone: 503, nothing deleted or minted", async () => {
    const { token } = await createOrganiserInvite();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const squatter = await preRegister();
    await api.db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [squatter]);
    const res = await accountLink(token);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("unavailable");
    expect(api.authAdmin!.deleted).toEqual([]);
    expect(api.authAdmin!.calls).toEqual([]);
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/invitee@example\.com/i);
  });

  it("a failed deletion mints nothing: 503 unavailable, logged without the address or token", async () => {
    const { token } = await createOrganiserInvite();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const squatter = await preRegister();
    api.authAdmin!.failingDelete = true;
    const res = await accountLink(token);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("unavailable");
    expect(api.authAdmin!.calls).toEqual([]);
    expect(await accountsFor()).toEqual([expect.objectContaining({ id: squatter })]);
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).toContain("delete_user");
    expect(logged).not.toMatch(/invitee@example\.com/i);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(squatter);
  });

  it("withholds the token when the address is registered again between the deletion and the minting (503)", async () => {
    const { token } = await createOrganiserInvite();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await preRegister();
    let again = "";
    api.authAdmin!.beforeGenerate = async () => {
      api.authAdmin!.beforeGenerate = undefined;
      again = await preRegister();
    };
    const res = await accountLink(token);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("unavailable");
    expect(res.body).not.toHaveProperty("tokenHash");
    // Supabase reused the new registration (password and all): the token never left the server.
    expect(await accountsFor()).toEqual([expect.objectContaining({ id: again })]);
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/invitee@example\.com/i);

    // The next press replaces it.
    expect((await accountLink(token)).status).toBe(200);
    expect((await accountsFor())[0].id).not.toBe(again);
  });

  it("view says `unconfirmed` when the address has only an unconfirmed account (the password-reset fallback)", async () => {
    const { token } = await createOrganiserInvite();
    const squatter = await preRegister();
    expect((await view(token)).body).toMatchObject({ account: "unconfirmed", passwordSetup: true });
    api.authAdmin = undefined;
    expect((await view(token)).body).toMatchObject({ account: "unconfirmed", passwordSetup: false });
    // Read-only: nothing deleted.
    expect(await accountsFor()).toEqual([expect.objectContaining({ id: squatter })]);
    // A confirmed account as well: `existing`.
    await api.signUp({ email: "Invitee@example.com" });
    expect((await view(token)).body.account).toBe("existing");
  });
});

describe("accepting (GET /api/invites/me, POST /api/invites/accept)", () => {
  it("an organiser invite: the verified invitee gets an approved organiser, logged invite_accepted, with no review email", async () => {
    const { inviteId } = await createOrganiserInvite();
    const invitee = await api.signUp({ email: "invitee@EXAMPLE.com" });

    const me = await api.call(getMyInvite, { token: invitee.token });
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      inviteId,
      kind: "organiser",
      organiserName: application.displayName,
      expiresAt: expect.any(String),
    });

    const res = await accept(inviteId, invitee.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({ kind: "organiser", organiserId: expect.any(String) });

    const own = await api.call(getMyOrganiser, { token: invitee.token });
    expect(own.body).toMatchObject({
      organiserId: res.body.organiserId,
      ownerUserId: invitee.userId,
      displayName: application.displayName,
      contactEmail: application.contactEmail,
      description: application.description,
      categories: application.categories,
      websiteUrl: application.websiteUrl,
      instagramHandle: "static.collective",
      status: "approved",
    });
    const [organiser] = await api.db.query(`select reviewed_by, reviewed_at from public.organisers where id = $1`, [
      res.body.organiserId,
    ]);
    expect(organiser.reviewed_by).toBe(admin.userId);
    expect(organiser.reviewed_at).not.toBeNull();

    // The admins' queue shows it, with the log entry.
    const queue = await api.call(adminListOrganisers, { token: admin.token, query: { status: "approved" } });
    const listed = queue.body.items.find((o: { organiserId: string }) => o.organiserId === res.body.organiserId);
    expect(listed.recentEdits).toEqual([
      { kind: "invite_accepted", at: expect.any(String), changes: { status: { old: null, new: "approved" } } },
    ]);

    // Approved from the start: the "organiser to review" trigger doesn't fire.
    await api.runDeferred();
    expect(await api.db.query(`select id from private.email_outbox where kind = 'organiser_review'`)).toEqual([]);
    expect(api.sendEmail).toHaveBeenCalledTimes(1); // the invite only

    const [invite] = await inviteRows();
    expect(invite).toMatchObject({
      status: "accepted",
      accepted_by: invitee.userId,
      accepted_organiser_id: res.body.organiserId,
    });
    expect((await api.call(adminListInvites, { token: admin.token, query: { status: "accepted" } })).body.items).toEqual([
      expect.objectContaining({ inviteId, status: "accepted", acceptedOrganiserId: res.body.organiserId }),
    ]);

    // Idempotent for the same account; nothing waiting any more; the link reads "used".
    expect((await accept(inviteId, invitee.token)).body).toEqual(res.body);
    expect(await api.db.query(`select id from public.organisers where owner_user_id = $1`, [invitee.userId])).toHaveLength(1);
    expect((await api.call(getMyInvite, { token: invitee.token })).status).toBe(404);
  });

  it("a member invite is accepted with nothing else created", async () => {
    const res = await create(memberBody());
    const invitee = await api.signUp({ email: "invitee@example.com" });
    const accepted = await accept(res.body.invite.inviteId, invitee.token);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ kind: "member" });
    expect(await api.db.query(`select id from public.organisers`)).toEqual([]);
    const token = lastToken();
    const used = await view(token);
    expect(used.status).toBe(410);
    expect(used.body.code).toBe("used");
  });

  it("is only for a verified email equal to the invite's: 401, 403 unverified, 404 someone else", async () => {
    const { inviteId } = await createOrganiserInvite();
    expect((await api.call(acceptInvite, { body: { inviteId } })).status).toBe(401);
    expect((await api.call(getMyInvite, {})).status).toBe(401);

    const unverified = await api.signUp({ email: "invitee@example.com", emailVerified: false });
    expect((await accept(inviteId, unverified.token)).status).toBe(403);
    expect((await api.call(getMyInvite, { token: unverified.token })).status).toBe(403);

    const stranger = await api.signUp({ email: "stranger@example.com" });
    expect((await accept(inviteId, stranger.token)).status).toBe(404);
    expect((await api.call(getMyInvite, { token: stranger.token })).status).toBe(404);
    expect((await accept("not-a-uuid", stranger.token)).status).toBe(404);
    expect((await accept(crypto.randomUUID(), stranger.token)).status).toBe(404);
    // Even the admin who sent it can't accept it.
    expect((await accept(inviteId, admin.token)).status).toBe(404);
    expect((await inviteRows())[0].status).toBe("pending");
  });

  it("410 when revoked, expired, or used by another account (code)", async () => {
    const { inviteId } = await createOrganiserInvite();
    const invitee = await api.signUp({ email: "invitee@example.com" });
    await api.db.query(`update private.account_invites set expires_at = now() - interval '1 second'`);
    expect((await api.call(getMyInvite, { token: invitee.token })).status).toBe(404);
    const expired = await accept(inviteId, invitee.token);
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe("expired");

    const second = await create(memberBody());
    await api.call(adminRevokeInvite, { token: admin.token, params: { inviteId: second.body.invite.inviteId }, method: "POST" });
    const revoked = await accept(second.body.invite.inviteId, invitee.token);
    expect(revoked.status).toBe(410);
    expect(revoked.body.code).toBe("revoked");

    // Accepted, then the account deleted and the address signed up again: a different account.
    const third = await create(memberBody({ email: "again@example.com" }));
    const firstAccount = await api.signUp({ email: "again@example.com" });
    expect((await accept(third.body.invite.inviteId, firstAccount.token)).status).toBe(200);
    await api.db.query(`delete from auth.users where id = $1`, [firstAccount.userId]);
    const secondAccount = await api.signUp({ email: "again@example.com" });
    const used = await accept(third.body.invite.inviteId, secondAccount.token);
    expect(used.status).toBe(410);
    expect(used.body.code).toBe("used");
  });

  it("an invite whose inviter is no longer an admin (demoted or deleted) is revoked: view, me, link, accept, resend", async () => {
    const { inviteId, token } = await createOrganiserInvite();
    const member = await createOrganiserInvite({ email: "member@example.com" });
    const invitee = await api.signUp({ email: "invitee@example.com" });
    await api.db.query(`update auth.users set raw_app_meta_data = '{}' where id = $1`, [admin.userId]);

    // Read-only views: 410 revoked / nothing waiting, and nothing written.
    const viewed = await view(token);
    expect(viewed.status).toBe(410);
    expect(viewed.body.code).toBe("revoked");
    expect((await api.call(getMyInvite, { token: invitee.token })).status).toBe(404);
    expect((await inviteRows()).map((r) => r.status)).toEqual(["pending", "pending"]);

    const res = await accept(inviteId, invitee.token);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("revoked");
    expect(await api.db.query(`select id from public.organisers`)).toEqual([]);
    expect((await inviteRows())[0]).toMatchObject({ status: "revoked", revoked_by: null });
    expect((await inviteRows())[0].revoked_at).not.toBeNull();

    // The link step marks it too, and asks Supabase nothing.
    const link = await accountLink(member.token);
    expect(link.status).toBe(410);
    expect(link.body.code).toBe("revoked");
    expect(api.authAdmin!.calls).toEqual([]);
    expect((await inviteRows())[1].status).toBe("revoked");

    // Another admin can't revive one by resending it.
    const other = await signUpAdmin(api);
    const third = await createOrganiserInvite({ email: "third@example.com" });
    await api.db.query(`update private.account_invites set last_sent_at = now() - interval '2 minutes'`);
    await api.db.query(`delete from auth.users where id = $1`, [admin.userId]); // deleted: invited_by becomes null
    const resent = await api.call(adminResendInvite, { token: other.token, params: { inviteId: third.inviteId }, method: "POST" });
    expect(resent.status).toBe(409);
    expect((await inviteRows())[2]).toMatchObject({ status: "revoked", invited_by: null });
    expect(api.sendEmail).toHaveBeenCalledTimes(3); // the three invites only
  });

  it("409 when the account already has an organiser (any status), with nothing written", async () => {
    const invitee = await api.signUp({ email: "invitee@example.com" });
    const { inviteId } = await createOrganiserInvite();
    // Applied after the invite was created (create refuses it otherwise).
    expect((await api.call(applyAsOrganiser, { token: invitee.token, body: { ...application, displayName: "Own" } })).status).toBe(
      201,
    );
    const res = await accept(inviteId, invitee.token);
    expect(res.status).toBe(409);
    expect(await api.db.query(`select display_name, status from public.organisers`)).toEqual([
      { display_name: "Own", status: "pending" },
    ]);
    expect((await inviteRows())[0].status).toBe("pending");
    expect(await api.db.query(`select * from private.organiser_profile_edits`)).toEqual([]);
  });

  it("two accepts at once: one organiser, both answers the same", async () => {
    const { inviteId } = await createOrganiserInvite();
    const invitee = await api.signUp({ email: "invitee@example.com" });
    const [a, b] = await Promise.all([accept(inviteId, invitee.token), accept(inviteId, invitee.token)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    expect(await api.db.query(`select id from public.organisers where owner_user_id = $1`, [invitee.userId])).toHaveLength(1);
    expect(await api.db.query(`select kind from private.organiser_profile_edits`)).toEqual([{ kind: "invite_accepted" }]);
  });

  it("an accept racing an application: one organiser, the loser 409", async () => {
    const { inviteId } = await createOrganiserInvite();
    const invitee = await api.signUp({ email: "invitee@example.com" });
    const [accepted, applied] = await Promise.all([
      accept(inviteId, invitee.token),
      api.call(applyAsOrganiser, { token: invitee.token, body: application }),
    ]);
    // Accept wins: 200, and the application is 409. The application wins: 201, and accept is 409.
    expect([[200, 409], [409, 201]]).toContainEqual([accepted.status, applied.status]);
    expect(await api.db.query(`select id from public.organisers where owner_user_id = $1`, [invitee.userId])).toHaveLength(1);
  });

  it("a revoke racing an accept: exactly one wins", async () => {
    const { inviteId } = await createOrganiserInvite();
    const invitee = await api.signUp({ email: "invitee@example.com" });
    const [revoked, accepted] = await Promise.all([
      api.call(adminRevokeInvite, { token: admin.token, params: { inviteId }, method: "POST" }),
      accept(inviteId, invitee.token),
    ]);
    const [invite] = await inviteRows();
    if (revoked.status === 200) {
      expect(accepted.status).toBe(410);
      expect(invite.status).toBe("revoked");
      expect(await api.db.query(`select id from public.organisers`)).toEqual([]);
    } else {
      expect(revoked.status).toBe(409);
      expect(accepted.status).toBe(200);
      expect(invite.status).toBe("accepted");
    }
  });
});

describe("the table's rules hold whatever the API does", () => {
  it("one pending invite per address (ignoring case), a profile only on organiser invites, statuses with their times", async () => {
    const insert = (kind: string, email: string, profile: string | null, status = "pending") =>
      api.db.query(
        `insert into private.account_invites (kind, email, token_hash, organiser_profile, status, expires_at)
         values ($1, $2, $3, $4::text::jsonb, $5, now() + interval '1 day')`,
        [kind, email, sha256(crypto.randomUUID()), profile, status],
      );
    await insert("member", "x@example.com", null);
    await expect(insert("member", "X@EXAMPLE.COM", null)).rejects.toThrow(/duplicate|unique/i);
    await expect(insert("member", "y@example.com", "{}")).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("organiser", "y@example.com", null)).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("organiser", "y@example.com", "[]")).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("member", "y@example.com", null, "accepted")).rejects.toThrow(/check constraint|violates/i);
    await expect(insert("member", "y@example.com", null, "revoked")).rejects.toThrow(/check constraint|violates/i);
    await expect(
      api.db.query(
        `insert into private.account_invites (kind, email, token_hash, expires_at) values ('member', 'z@example.com', 'not-a-hash', now())`,
      ),
    ).rejects.toThrow(/check constraint|violates/i);
  });
});

describe("retention (purge_operational_data)", () => {
  it("deletes invites 90 days after they were accepted, revoked or expired; keeps the rest", async () => {
    const ids: Record<string, string> = {};
    for (const name of ["acceptedOld", "acceptedNew", "revokedOld", "expiredOld", "lapsedOld", "pending"]) {
      const res = await create(memberBody({ email: `${name}@example.com` }));
      ids[name] = res.body.invite.inviteId;
    }
    const set = (name: string, assignments: string) =>
      api.db.query(`update private.account_invites set ${assignments} where id = $1`, [ids[name]]);
    await set("acceptedOld", `status = 'accepted', accepted_at = now() - interval '91 days'`);
    await set("acceptedNew", `status = 'accepted', accepted_at = now() - interval '89 days'`);
    await set("revokedOld", `status = 'revoked', revoked_at = now() - interval '91 days'`);
    await set("expiredOld", `status = 'expired', expires_at = now() - interval '91 days'`);
    await set("lapsedOld", `expires_at = now() - interval '91 days'`);

    const [counts] = await api.db.query<Record<string, number>>(`select * from private.purge_operational_data()`);
    expect(counts.account_invites_deleted).toBe(4);
    const left = await api.db.query<{ email: string }>(`select email from private.account_invites order by email`);
    expect(left.map((r) => r.email)).toEqual(["acceptedNew@example.com", "pending@example.com"]);
    const [again] = await api.db.query<Record<string, number>>(`select * from private.purge_operational_data()`);
    expect(again.account_invites_deleted).toBe(0);
  });
});
