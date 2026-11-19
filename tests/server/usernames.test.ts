import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listGoingAttendees } from "@/lib/server/handlers/going";
import { getMe } from "@/lib/server/handlers/me";
import { adminGetMemberProfile, getMemberProfile } from "@/lib/server/handlers/member-profiles";
import { deleteMyProfile } from "@/lib/server/handlers/profiles";
import { adminListReports, createReport } from "@/lib/server/handlers/reports";
import {
  checkMyUsername,
  deleteMyUsername,
  putMyUsername,
  USERNAME_CHANGE_RATE_LIMIT,
  USERNAME_LOOKUP_RATE_LIMITS,
} from "@/lib/server/handlers/usernames";
import type { EventRecord } from "@/lib/server/types";
import { usernameKey } from "@/lib/username";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { goingMember, member, suspend, type Member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";

/**
 * Member usernames: docs/architecture.md, "Usernames";
 * lib/server/handlers/usernames.ts;
 * supabase/migrations/20261201000100_member_usernames.sql.
 */

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let mia: Member;
let sam: Member;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  serverUrl = testDb.url;
  api = new TestApi(testDb.db);
}, 120_000);

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, {
    ticketTypes: [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 100 }],
  });
  mia = await member(api, { displayName: "Mia" });
  sam = await member(api, { displayName: "Sam" });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const put = (m: { token: string } | undefined, username: unknown) =>
  api.call(putMyUsername, { token: m?.token, method: "PUT", body: { username } });
const clear = (m: { token: string } | undefined) => api.call(deleteMyUsername, { token: m?.token, method: "DELETE" });
const check = (m: { token: string } | undefined, username: unknown) =>
  api.call(checkMyUsername, { token: m?.token, body: { username } });
const me = (m: { token: string }) => api.call(getMe, { token: m.token });

async function claimed(m: Member, username: string) {
  const res = await put(m, username);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

/** Moves the member's change clock back (first and latest claim), as if those claims were that long ago. */
async function backdate(m: { userId: string }, first: string, last: string = first) {
  await api.db.query(
    `update private.member_username_changes
        set first_claimed_at = now() - $2::interval, last_claimed_at = now() - $3::interval
      where user_id = $1`,
    [m.userId, first, last],
  );
}

/** Makes every hold run out now. */
async function expireHolds() {
  await api.db.query(`update private.member_usernames set held_until = now() - interval '1 second' where user_id is null`);
}

async function rows() {
  return api.db.query<{ username: string; user_id: string | null; held: boolean }>(
    `select username, user_id, held_until is not null as held from private.member_usernames order by username collate "C"`,
  );
}

async function clock(m: { userId: string }) {
  const [row] = await api.db.query<{ first: Date | null; last: Date | null }>(
    `select first_claimed_at as first, last_claimed_at as last from private.member_username_changes where user_id = $1`,
    [m.userId],
  );
  return row;
}

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

describe("PUT /api/me/username: what a username may be (400)", () => {
  const refused: [unknown, RegExp][] = [
    [undefined, /Enter a username/],
    [42, /Enter a username/],
    ["", /Enter a username/],
    ["   ", /Enter a username/],
    ["@", /Enter a username/],
    ["ab", /at least 3/],
    ["a".repeat(21), /20 characters or fewer/],
    ["x".repeat(500), /20 characters or fewer/],
    ["mia tan", /letters a–z, numbers, _ and \./],
    ["mia-tan", /letters a–z/],
    ["zoë", /letters a–z/],
    ["mia@home", /letters a–z/],
    ["mi​a", /letters a–z/],
    ["аda_m", /letters a–z/], // Cyrillic а
    ["@@mia", /letters a–z/],
    [".mia", /Start and end/],
    ["mia.", /Start and end/],
    ["mi..a", /two dots/],
    ["___", /at least one letter/],
    ["12345", /at least one letter/],
    ["mia12345", /4 numbers or fewer/],
    ["sheltuh", /Sheltüh/],
    ["team_sheltuh", /Sheltüh/],
    ["she1tuh_fan", /Sheltüh/],
    ["shel.tuh", /Sheltüh/],
    ["official_mia", /makes a claim/],
    ["mia.verified", /makes a claim/],
    ["sold_out", /makes a claim/],
    ["admin", /makes a claim/],
    ["support", /reserved/],
    ["supp0rt", /reserved/],
    ["support_1", /reserved/],
    ["events", /reserved/],
    ["help2", /reserved/],
    ["me_", /reserved/],
    ["settings", /reserved/],
    ["bookings", /reserved/],
    // Claim and staff words run together at either end, and with digits around them.
    ["adminsupport", /makes a claim/],
    ["support.team", /makes a claim/],
    ["moderatorkate", /makes a claim/],
    ["officialtickets", /makes a claim/],
    ["verifiedmia", /makes a claim/],
    ["2admin", /reserved|makes a claim/],
    ["verified1", /makes a claim/],
    ["staffpick1", /makes a claim/],
    ["kate_security", /makes a claim/],
    ["teamhelpdesk", /makes a claim/],
    // Brand lookalikes: 5/3/4/7 read as s/e/a/t, and "sheltueh".
    ["sheltueh", /Sheltüh/],
    ["5heltuh_x", /Sheltüh/],
    ["shel7uh_fan", /Sheltüh/],
    ["5upport", /reserved/],
    ["4dmin", /reserved/],
    ["m0d3rat0r", /reserved/],
    ["mia.com", /web address/],
    ["mia.top", /web address/],
    ["is.gd", /web address/],
    ["mia.co.uk", /web address/],
    ["mia.ee", /web address/],
    ["mia.gy", /web address/],
    ["mia.ru_", /web address/],
    ["mia.co", /web address/],
    ["www.mia", /web address/],
  ];

  it.each(refused)("refuses %j", async (username, message) => {
    const res = await put(mia, username);
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.username).toMatch(message);
    // The check endpoint refuses the same.
    const checked = await check(mia, username);
    expect(checked.status).toBe(400);
    expect(checked.body.fieldErrors.username).toBe(res.body.fieldErrors.username);
  });

  it("accepts the edges: 3 and 20 characters, _ at either end, dots inside, 4 digits; a claim word inside a word", async () => {
    for (const ok of ["mia", "a".repeat(20), "_ana_", "b.e.n", "jo_2026", "badminton", "the.dot.cafe", "m4ya"]) {
      const res = await put(mia, ok);
      expect(res.status, ok).toBe(200);
      expect(res.body.username).toBe(ok);
    }
  });

  it('normalises: "@Latte" is latte, fullwidth letters fold, spaces around are trimmed', async () => {
    expect((await put(mia, "  @Latte ")).body.username).toBe("latte");
    expect((await put(mia, "ｍｉａ＿ｔ")).body.username).toBe("mia_t");
    expect((await put(mia, "＠Mocha")).body.username).toBe("mocha");
  });

  it("the database refuses what the API would, whoever writes", async () => {
    const insert = (name: string) =>
      api.db.query(`insert into private.member_usernames (username_key, username, user_id) values (private.member_username_key($1), $1, $2)`, [
        name,
        mia.userId,
      ]);
    for (const bad of ["ab", "Mia", ".mia", "mia.", "mi..a", "12345", "mia12345", "sheltuh_x", "she1tuh", "5heltuh_x", "sheltueh", "zoë", "mia tan"]) {
      await expect(insert(bad), bad).rejects.toThrow();
    }
    // A key that isn't the name's.
    await expect(
      api.db.query(`insert into private.member_usernames (username_key, username, user_id) values ('nope', 'mia', $1)`, [mia.userId]),
    ).rejects.toThrow(/member_usernames_key_check/);
    // A live name can't pass straight to another account, and a hold needs its end.
    await insert("latte");
    await expect(api.db.query(`update private.member_usernames set user_id = $1`, [sam.userId])).rejects.toThrow(
      /straight to another account/,
    );
    await expect(
      api.db.query(`insert into private.member_usernames (username_key, username) values ('mocha', 'mocha')`),
    ).rejects.toThrow(/member_usernames_hold_check/);
    // A name already stored isn't re-checked by later updates (only names new to the row are).
    await api.db.query(`update private.member_usernames set claimed_at = now() where username = 'latte'`);
  });
});

describe("private.member_username_key", () => {
  it("folds . and _, then i/1 → l, 0 → o, rn → m", async () => {
    const cases: [string, string][] = [
      ["latte", "latte"],
      ["1atte", "latte"],
      ["lat.te", "latte"],
      ["la_t.te", "latte"],
      ["iatte", "latte"],
      ["m0cha", "mocha"],
      ["rnia", "mla"],
      ["r.nia", "mla"],
      ["r_n", "m"],
      ["rrn", "rm"],
      ["burn1", "buml"],
    ];
    for (const [name, key] of cases) {
      const [row] = await api.db.query<{ key: string }>(`select private.member_username_key($1) as key`, [name]);
      expect(row.key, name).toBe(key);
      expect(usernameKey(name), name).toBe(key);
    }
  });

  it("agrees with lib/username.ts's usernameKey (the browser's) on every name the rules allow", async () => {
    // Random names over the allowed alphabet, weighted to the folded letters.
    const alphabet = "abcdeilmnorstu01_.";
    const names: string[] = [];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 400; i++) {
      const length = 3 + (next() % 18);
      names.push(Array.from({ length }, () => alphabet[next() % alphabet.length]).join(""));
    }
    const result = await api.db.query<{ name: string; key: string }>(
      `select n as name, private.member_username_key(n) as key from unnest($1::text[]) n`,
      [names],
    );
    expect(result.map((r) => r.key)).toEqual(names.map(usernameKey));
  });
});

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

describe("claiming a username", () => {
  it("sets it and answers the account summary; GET /me shows it; the same name again changes nothing", async () => {
    const res = await claimed(mia, "@Latte");
    expect(res.body).toEqual({ username: "latte", upcomingCount: 0 });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await me(mia)).body).toEqual({ username: "latte", upcomingCount: 0 });

    const before = await clock(mia);
    const again = await put(mia, "LATTE");
    expect(again.status).toBe(200);
    expect(again.body.username).toBe("latte");
    expect(await clock(mia)).toEqual(before);
  });

  it("needs sign-in (401) and a verified email (403)", async () => {
    expect((await put(undefined, "latte")).status).toBe(401);
    const unverified = await member(api, { emailVerified: false });
    expect((await put(unverified, "latte")).status).toBe(403);
    expect((await check(unverified, "latte")).status).toBe(403);
    expect((await check(undefined, "latte")).status).toBe(401);
    expect(await rows()).toEqual([]);
  });

  it("doesn't need a Who's Going profile", async () => {
    const noProfile = await member(api, { profile: false });
    expect((await put(noProfile, "latte")).status).toBe(200);
  });

  it("409 username_taken for someone's name and its lookalikes", async () => {
    await claimed(sam, "latte");
    for (const lookalike of ["latte", "1atte", "lat.te", "la_tte", "iatte", "LATTE"]) {
      const res = await put(mia, lookalike);
      expect(res.status, lookalike).toBe(409);
      expect(res.body).toMatchObject({ code: "username_taken", fieldErrors: { username: expect.any(String) } });
    }
    expect((await me(mia)).body.username).toBeUndefined();
  });

  it("a held name gets exactly the same 409 as a live one", async () => {
    await claimed(sam, "latte");
    const live = await put(mia, "latte");
    await backdate(sam, "31 days");
    await claimed(sam, "mocha");
    const held = await put(mia, "latte");
    expect(held.status).toBe(409);
    expect(held.body).toEqual(live.body);
  });

  it("a member who has been suspended can't claim (403), and can still clear", async () => {
    await claimed(mia, "latte");
    await suspend(api, mia);
    expect((await put(mia, "mocha")).status).toBe(403);
    expect((await check(mia, "mocha")).status).toBe(403);
    expect((await clear(mia)).status).toBe(204);
    expect(await rows()).toEqual([{ username: "latte", user_id: null, held: true }]);
  });
});

describe("how often a username can change", () => {
  it("any number of changes within 24 hours of the first claim (the typo window)", async () => {
    await claimed(mia, "lattte");
    await claimed(mia, "latte");
    const third = await claimed(mia, "lat.te"); // the same key, spelt differently: changed in place
    expect(third.body).toEqual({ username: "lat.te", upcomingCount: 0 });
    await backdate(mia, "23 hours", "1 minute");
    await claimed(mia, "mocha");
    // Every released name is held, the typos included.
    expect(await rows()).toEqual([
      { username: "lat.te", user_id: null, held: true },
      { username: "lattte", user_id: null, held: true },
      { username: "mocha", user_id: mia.userId, held: false },
    ]);
  });

  it("past the typo window, 429 username_change_too_soon until 30 days after the latest claim, with Retry-After and changeableAt", async () => {
    await claimed(mia, "latte");
    await backdate(mia, "3 days", "2 days");
    const res = await put(mia, "mocha");
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("username_change_too_soon");
    const changeableAt = new Date(res.body.changeableAt).getTime();
    expect(Math.abs(changeableAt - (Date.now() + 28 * DAY_MS))).toBeLessThan(60_000);
    expect(Math.abs(Number(res.headers.get("retry-after")) - 28 * 86_400)).toBeLessThan(60);
    // GET /me says the same.
    expect((await me(mia)).body).toEqual({ username: "latte", usernameChangeableAt: res.body.changeableAt, upcomingCount: 0 });
    // A new spelling of the same key is a change too.
    expect((await put(mia, "lat.te")).status).toBe(429);
    // The same name isn't a change.
    expect((await put(mia, "latte")).status).toBe(200);
    expect((await me(mia)).body.username).toBe("latte");
  });

  it("within the typo window GET /me sends no changeable time; after a 30-day change it does", async () => {
    await claimed(mia, "latte");
    expect((await me(mia)).body.usernameChangeableAt).toBeUndefined();
    await backdate(mia, "31 days");
    expect((await me(mia)).body.usernameChangeableAt).toBeUndefined();
    const res = await claimed(mia, "mocha");
    expect(Math.abs(new Date(res.body.usernameChangeableAt).getTime() - (Date.now() + 30 * DAY_MS))).toBeLessThan(60_000);
    expect((await put(mia, "chai")).status).toBe(429);
  });

  it("after 30 days: the old name is held from everyone, the previous owner included, until the hold runs out", async () => {
    await claimed(mia, "latte");
    await backdate(mia, "31 days");
    await claimed(mia, "mocha");
    expect(await rows()).toEqual([
      { username: "latte", user_id: null, held: true },
      { username: "mocha", user_id: mia.userId, held: false },
    ]);
    const [{ days }] = await api.db.query<{ days: number }>(
      `select extract(epoch from held_until - now()) / 86400 as days from private.member_usernames where username = 'latte'`,
    );
    expect(Number(days)).toBeCloseTo(30, 1);

    expect((await put(sam, "latte")).status).toBe(409);
    expect((await put(sam, "1atte")).status).toBe(409);
    await backdate(mia, "31 days");
    expect((await put(mia, "latte")).status).toBe(409);
    expect((await check(sam, "latte")).body).toEqual({ username: "latte", available: false });

    await expireHolds();
    expect((await check(sam, "lat.te")).body).toEqual({ username: "lat.te", available: true });
    const res = await claimed(sam, "lat.te");
    expect(res.body.username).toBe("lat.te");
    expect(await rows()).toEqual([
      { username: "lat.te", user_id: sam.userId, held: false },
      { username: "mocha", user_id: mia.userId, held: false },
    ]);
  });

  it("two members swapping names: both 409, nothing changes", async () => {
    await claimed(mia, "latte");
    await claimed(sam, "mocha");
    await backdate(mia, "31 days");
    await backdate(sam, "31 days");
    expect((await put(mia, "mocha")).status).toBe(409);
    expect((await put(sam, "latte")).status).toBe(409);
    expect(await rows()).toEqual([
      { username: "latte", user_id: mia.userId, held: false },
      { username: "mocha", user_id: sam.userId, held: false },
    ]);
  });
});

describe("DELETE /api/me/username", () => {
  it("clears it, holds the name, and leaves the clock: no fresh start", async () => {
    await claimed(mia, "latte");
    await backdate(mia, "2 days");
    const before = await clock(mia);
    const res = await clear(mia);
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await clock(mia)).toEqual(before);
    expect(await rows()).toEqual([{ username: "latte", user_id: null, held: true }]);
    const summary = (await me(mia)).body;
    expect(summary.username).toBeUndefined();
    expect(summary.usernameChangeableAt).toEqual(expect.any(String));
    expect((await put(mia, "mocha")).status).toBe(429);
  });

  it("within the typo window a cleared member can claim another; their old name is held", async () => {
    await claimed(mia, "latte");
    await clear(mia);
    expect((await put(mia, "latte")).status).toBe(409);
    await claimed(mia, "mocha");
  });

  it("is idempotent (204 with nothing set), needs sign-in (401), not a verified email", async () => {
    expect((await clear(mia)).status).toBe(204);
    expect((await clear(mia)).status).toBe(204);
    expect((await clear(undefined)).status).toBe(401);
    const unverified = await member(api, { emailVerified: false });
    await api.db.query(
      `insert into private.member_usernames (username_key, username, user_id) values ('mocha', 'mocha', $1)`,
      [unverified.userId],
    );
    expect((await clear(unverified)).status).toBe(204);
    expect(await rows()).toEqual([{ username: "mocha", user_id: null, held: true }]);
  });

  it("only ever clears the caller's own", async () => {
    await claimed(sam, "latte");
    await clear(mia);
    expect(await rows()).toEqual([{ username: "latte", user_id: sam.userId, held: false }]);
  });
});

describe("the account and the profile", () => {
  it("deleting the Who's Going profile leaves the username", async () => {
    await claimed(mia, "latte");
    expect((await api.call(deleteMyProfile, { token: mia.token, method: "DELETE" })).status).toBe(204);
    expect((await me(mia)).body.username).toBe("latte");
  });

  it("deleting the account turns the name into a 30-day hold and deletes the clock", async () => {
    await claimed(mia, "latte");
    await api.db.query(`delete from auth.users where id = $1`, [mia.userId]);
    expect(await rows()).toEqual([{ username: "latte", user_id: null, held: true }]);
    const [{ days }] = await api.db.query<{ days: number }>(
      `select extract(epoch from held_until - now()) / 86400 as days from private.member_usernames`,
    );
    expect(Number(days)).toBeCloseTo(30, 1);
    expect(await clock(mia)).toBeUndefined();
    expect((await put(sam, "latte")).status).toBe(409);
  });

  it("an account deleted meanwhile: the claim says so (the API's 401) and writes nothing", async () => {
    await api.db.query(`delete from auth.users where id = $1`, [mia.userId]);
    const [claim] = await api.db.query<{ result: string }>(`select * from private.claim_member_username($1, 'latte')`, [
      mia.userId,
    ]);
    expect(claim.result).toBe("user_unavailable");
    expect(await rows()).toEqual([]);
    expect(await clock(mia)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

describe("POST /api/me/username/check", () => {
  it("available for a free name; not for a live or held one (the same answer); yours for the caller's own", async () => {
    const free = await check(mia, "@Latte");
    expect(free.status).toBe(200);
    expect(free.body).toEqual({ username: "latte", available: true });
    expect(free.headers.get("cache-control")).toBe("private, no-store");

    await claimed(sam, "latte");
    const live = await check(mia, "1atte");
    await backdate(sam, "31 days");
    await claimed(sam, "mocha");
    const held = await check(mia, "1atte");
    expect(live.body).toEqual({ username: "1atte", available: false });
    expect(held.body).toEqual(live.body);
    // Held from its previous owner too.
    expect((await check(sam, "latte")).body).toEqual({ username: "latte", available: false });

    expect((await check(sam, "mocha")).body).toEqual({ username: "mocha", available: true, yours: true });
    expect((await check(sam, "m0cha")).body).toEqual({ username: "m0cha", available: true, yours: true });
  });

  it(`shares one allowance with PUT (${USERNAME_LOOKUP_RATE_LIMITS[0].hits} per ${USERNAME_LOOKUP_RATE_LIMITS[0].window}), taken before the lookup`, async () => {
    const [short] = USERNAME_LOOKUP_RATE_LIMITS;
    for (let i = 0; i < short.hits; i++) {
      // A few saves (they have their own, smaller allowance too), the rest checks.
      const res = i % 5 === 0 ? await put(mia, `name_${i}`) : await check(mia, `name_${i}`);
      expect(res.status, `request ${i}`).toBe(200);
    }
    const checkRefused = await check(mia, "latte");
    expect(checkRefused.status).toBe(429);
    expect(checkRefused.headers.get("retry-after")).toBe("600");
    expect((await put(mia, "latte")).status).toBe(429);
    // Another member's allowance is their own.
    expect((await check(sam, "latte")).status).toBe(200);
  });

  it(`and a daily one (${USERNAME_LOOKUP_RATE_LIMITS[1].hits} per ${USERNAME_LOOKUP_RATE_LIMITS[1].window})`, async () => {
    const [, daily] = USERNAME_LOOKUP_RATE_LIMITS;
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, $2, now(), $3)`,
      [mia.userId, daily.bucket, daily.hits],
    );
    const res = await check(mia, "latte");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("86400");
    expect((await put(mia, "latte")).status).toBe(429);
    expect(await rows()).toEqual([]);
  });

  it("refusals of the name itself (400) take no allowance", async () => {
    for (let i = 0; i < 40; i++) expect((await check(mia, "ab")).status).toBe(400);
    expect((await check(mia, "latte")).status).toBe(200);
  });
});

describe("PUT's own allowance", () => {
  it(`${USERNAME_CHANGE_RATE_LIMIT.hits} saves per ${USERNAME_CHANGE_RATE_LIMIT.window}, taken before the claim; checks go on`, async () => {
    for (let i = 0; i < USERNAME_CHANGE_RATE_LIMIT.hits; i++) {
      expect((await put(mia, `typo_${i}`)).status, `save ${i}`).toBe(200);
    }
    const refused = await put(mia, "latte");
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBeUndefined();
    expect(refused.headers.get("retry-after")).toBe("86400");
    expect((await me(mia)).body.username).toBe("typo_9");
    expect((await check(mia, "latte")).status).toBe(200);
    // So one account holds at most this many names from its typo window.
    expect((await rows()).filter((r) => r.held)).toHaveLength(USERNAME_CHANGE_RATE_LIMIT.hits - 1);
  });
});

describe("profile reports keep the username", () => {
  it("a profile report copies the member's username; a quick change afterwards doesn't touch the copy", async () => {
    const target = await member(api, { displayName: "Troll" });
    await api.db.query(`update public.profiles set profile_visible = true where user_id = $1`, [target.userId]);
    await claimed(target, "rude_name");
    const [{ public_id: profileId }] = await api.db.query<{ public_id: string }>(
      `select public_id from public.profiles where user_id = $1`,
      [target.userId],
    );
    const filed = await api.call(createReport, { token: mia.token, body: { profileId, reason: "inappropriate" } });
    expect(filed.status).toBe(201);
    await claimed(target, "nice_name"); // within the typo window

    const list = await api.call(adminListReports, { token: admin.token });
    expect(list.body.items[0]).toMatchObject({ targetType: "profile", reportedUsername: "rude_name" });
    expect((await api.call(adminGetMemberProfile, { token: admin.token, params: { profileId } })).body.username).toBe("nice_name");
  });

  it("no username: no copy", async () => {
    await api.db.query(`update public.profiles set profile_visible = true where user_id = $1`, [sam.userId]);
    const [{ public_id: profileId }] = await api.db.query<{ public_id: string }>(
      `select public_id from public.profiles where user_id = $1`,
      [sam.userId],
    );
    expect((await api.call(createReport, { token: mia.token, body: { profileId, reason: "inappropriate" } })).status).toBe(201);
    const list = await api.call(adminListReports, { token: admin.token });
    expect(list.body.items[0].reportedUsername).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Who sees it
// ---------------------------------------------------------------------------

describe("where a username shows: exactly where the profileId does", () => {
  async function profileIdOf(m: { userId: string }) {
    const [row] = await api.db.query<{ public_id: string }>(`select public_id from public.profiles where user_id = $1`, [m.userId]);
    return row.public_id;
  }
  const visible = (m: { userId: string }, on = true) =>
    api.db.query(`update public.profiles set profile_visible = $2 where user_id = $1`, [m.userId, on]);
  const list = async (viewer: { token: string }) => {
    const res = await api.call(listGoingAttendees, { token: viewer.token, params: { eventId: event.eventId } });
    expect(res.status).toBe(200);
    return Object.fromEntries(res.body.items.map((a: { displayName: string }) => [a.displayName, a])) as Record<
      string,
      Record<string, unknown>
    >;
  };

  it("on a visible member's profile and Who's Going entry; never for a hidden one", async () => {
    const shown = await goingMember(api, event, { displayName: "Shown" });
    const hidden = await goingMember(api, event, { displayName: "Hidden" });
    const viewer = await goingMember(api, event, { displayName: "Viewer" });
    const unnamed = await goingMember(api, event, { displayName: "Unnamed" });
    await visible(shown);
    await visible(unnamed);
    await claimed(shown, "shown_one");
    await claimed(hidden, "hidden_one");
    await claimed(viewer, "viewer_one");

    const byName = await list(viewer);
    expect(byName.Shown).toMatchObject({ profileId: await profileIdOf(shown), username: "shown_one" });
    expect(byName.Hidden).toEqual({ attendeeId: hidden.attendeeId, displayName: "Hidden", isYou: false, hasAvatar: false });
    expect(byName.Unnamed.username).toBeUndefined();
    expect(byName.Unnamed.profileId).toEqual(expect.any(String));
    // The caller's own entry follows the same rule (their profile is hidden).
    expect(byName.Viewer.username).toBeUndefined();

    const profile = await api.call(getMemberProfile, { token: viewer.token, params: { profileId: await profileIdOf(shown) } });
    expect(profile.status).toBe(200);
    expect(profile.body.username).toBe("shown_one");
    // A hidden profile is a 404, so its username can't be read by profile either.
    const hiddenProfile = await api.call(getMemberProfile, { token: viewer.token, params: { profileId: await profileIdOf(hidden) } });
    expect(hiddenProfile.status).toBe(404);
    expect(JSON.stringify([byName, hiddenProfile.body])).not.toContain("hidden_one");

    // Hiding the profile again hides the username at once.
    await visible(shown, false);
    expect((await list(viewer)).Shown.username).toBeUndefined();
  });

  it("never across a block (either way) or a suspension", async () => {
    const shown = await goingMember(api, event, { displayName: "Shown" });
    const viewer = await goingMember(api, event, { displayName: "Viewer" });
    await visible(shown);
    await claimed(shown, "shown_one");
    const shownProfile = await profileIdOf(shown);
    const view = () => api.call(getMemberProfile, { token: viewer.token, params: { profileId: shownProfile } });
    expect((await view()).body.username).toBe("shown_one");

    for (const [blocker, blocked] of [
      [viewer, shown],
      [shown, viewer],
    ]) {
      await api.db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [blocker.userId, blocked.userId]);
      expect((await view()).status).toBe(404);
      expect((await list(viewer)).Shown).toBeUndefined();
      await api.db.query(`delete from public.user_blocks`);
    }

    await suspend(api, shown);
    expect((await view()).status).toBe(404);
    expect((await list(viewer)).Shown).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

describe("private.purge_social_data", () => {
  it("deletes only holds that have run out, and clock rows that never completed a claim", async () => {
    const ann = await member(api);
    const bo = await member(api);
    const cy = await member(api);
    await claimed(mia, "latte"); // live, clock 40 days old: kept (they still have a name)
    await claimed(sam, "mocha");
    await clear(sam); // held, not expired: kept; clock recent: kept
    await claimed(ann, "chai");
    await clear(ann); // held, then expired: deleted; clock old, but kept (it holds their first claim)
    await claimed(bo, "flat_white");
    await clear(bo); // clock 20 days old without a name: kept (still limits them)
    await put(cy, "latte"); // 409: an empty clock row, deleted
    await api.db.query(`update private.member_usernames set held_until = now() - interval '1 second' where username = 'chai'`);
    await backdate(mia, "40 days");
    await backdate(ann, "40 days", "31 days");
    await backdate(bo, "20 days");
    expect(await clock(cy)).toEqual({ first: null, last: null });

    const [purged] = await api.db.query<Record<string, number>>(`select * from private.purge_social_data()`);
    expect(Object.keys(purged)).toHaveLength(10);

    expect(await rows()).toEqual([
      { username: "flat_white", user_id: null, held: true },
      { username: "latte", user_id: mia.userId, held: false },
      { username: "mocha", user_id: null, held: true },
    ]);
    expect(await clock(mia)).toBeDefined();
    expect(await clock(sam)).toBeDefined();
    expect(await clock(bo)).toBeDefined();
    expect(await clock(ann)).toBeDefined();
    expect(await clock(cy)).toBeUndefined();
  });

  it("never reopens the typo window: a member's first claim is remembered for the account's life", async () => {
    await claimed(mia, "latte");
    await clear(mia);
    await backdate(mia, "60 days", "40 days");
    await api.db.query(`select private.purge_social_data()`);
    // 30 days since the latest claim: one change allowed...
    await claimed(mia, "mocha");
    // ...and then no burst of typo-window changes after it.
    const again = await put(mia, "chai");
    expect(again.status).toBe(429);
    expect(again.body.code).toBe("username_change_too_soon");
  });
});

// ---------------------------------------------------------------------------
// Concurrency: two sessions at once needs a real server (PGlite is one
// connection). Run with TEST_DATABASE_URL (CLAUDE.md, "Quality gates").
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrency (real Postgres only)", () => {
  function connections(n: number) {
    return Array.from({ length: n }, () => postgres(serverUrl as string, { max: 1, onnotice: () => {} }));
  }
  const claim = (conn: postgres.Sql, userId: string, name: string) =>
    conn.unsafe(`select result from private.claim_member_username($1, $2)`, [userId, name]).then(([r]) => r.result as string);

  it("many members claiming one name (and its lookalikes) at once: exactly one wins", async () => {
    const members = await Promise.all(Array.from({ length: 6 }, () => member(api)));
    const conns = connections(members.length);
    try {
      for (let round = 0; round < 3; round++) {
        await api.db.query(`delete from private.member_usernames`);
        const names = ["latte", "1atte", "lat.te", "iatte", "la_tte", "latte"];
        const results = await Promise.all(members.map((m, i) => claim(conns[i], m.userId, names[i])));
        expect(results.filter((r) => r === "claimed")).toHaveLength(1);
        expect(results.filter((r) => r === "taken")).toHaveLength(members.length - 1);
        expect(await rows()).toHaveLength(1);
      }
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });

  it("a release racing a claim of the released name: the hold wins, nothing is lost", async () => {
    const conns = connections(2);
    try {
      for (let round = 0; round < 5; round++) {
        await api.db.query(`delete from private.member_usernames; delete from private.member_username_changes`);
        await claimed(mia, "latte");
        await backdate(mia, "31 days");
        const [change, grab] = await Promise.all([claim(conns[0], mia.userId, "mocha"), claim(conns[1], sam.userId, "latte")]);
        expect(change).toBe("claimed");
        expect(grab).toBe("taken");
        expect(await rows()).toEqual([
          { username: "latte", user_id: null, held: true },
          { username: "mocha", user_id: mia.userId, held: false },
        ]);
      }
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });

  it("one member's two saves at once run one after the other (one claims, the other is too soon)", async () => {
    const conns = connections(2);
    try {
      for (let round = 0; round < 5; round++) {
        await api.db.query(`delete from private.member_usernames; delete from private.member_username_changes`);
        await claimed(mia, "latte");
        await backdate(mia, "31 days");
        const results = await Promise.all([claim(conns[0], mia.userId, "mocha"), claim(conns[1], mia.userId, "chai")]);
        expect(results.sort()).toEqual(["claimed", "too_soon"]);
        const live = (await rows()).filter((r) => r.user_id === mia.userId);
        expect(live).toHaveLength(1);
      }
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });

  it("two members swapping names at once: both taken, no deadlock", async () => {
    const conns = connections(2);
    try {
      for (let round = 0; round < 5; round++) {
        await api.db.query(`delete from private.member_usernames; delete from private.member_username_changes`);
        await claimed(mia, "latte");
        await claimed(sam, "mocha");
        await backdate(mia, "31 days");
        await backdate(sam, "31 days");
        const results = await Promise.all([claim(conns[0], mia.userId, "mocha"), claim(conns[1], sam.userId, "latte")]);
        expect(results).toEqual(["taken", "taken"]);
        expect(await rows()).toEqual([
          { username: "latte", user_id: mia.userId, held: false },
          { username: "mocha", user_id: sam.userId, held: false },
        ]);
      }
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });

  /** Resolves once `conn`'s backend is waiting on a lock. */
  async function blocked(conn: postgres.Sql) {
    const [{ pid }] = await conn.unsafe("select pg_backend_pid() as pid");
    return async () => {
      for (let i = 0; ; i++) {
        const [row] = await api.db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (row?.wait_event_type === "Lock") return;
        if (i > 400) throw new Error("never blocked");
        await new Promise((r) => setTimeout(r, 25));
      }
    };
  }

  it("the daily purge racing a claim of an expired hold: no deadlock (clock rows before name rows, as claims lock)", async () => {
    const [claimer, purger] = connections(2);
    const purgerBlocked = await blocked(purger);
    try {
      // A member whose first claim failed (an empty clock row, which the purge deletes) and an expired hold.
      await api.db.query(`insert into private.member_username_changes (user_id) values ($1)`, [mia.userId]);
      await api.db.query(
        `insert into private.member_usernames (username_key, username, user_id, held_until)
         values ('latte', 'latte', null, now() - interval '1 second')`,
      );
      // The claim has its clock row locked (its first step)...
      await claimer.unsafe("begin");
      await claimer.unsafe(`select 1 from private.member_username_changes where user_id = $1 for update`, [mia.userId]);
      // ...when the purge reaches the clock rows: it waits for the claim.
      // postgres.js sends a query when it's awaited or then'd: .then() starts it now.
      const purge = purger.unsafe(`select * from private.purge_social_data()`).then((r) => r);
      await purgerBlocked();
      // The claim goes on to lock the hold, which the purge must not be holding.
      const [claim] = await claimer.unsafe(`select result from private.claim_member_username($1, 'latte')`, [mia.userId]);
      await claimer.unsafe("commit");
      await purge;
      expect(claim.result).toBe("claimed");
      expect(await rows()).toEqual([{ username: "latte", user_id: mia.userId, held: false }]);
      expect((await clock(mia))?.first).toBeInstanceOf(Date);
    } finally {
      await claimer.unsafe("rollback").catch(() => {});
      await Promise.all([claimer.end(), purger.end()]);
    }
  });

  it("an admin removal racing the account's deletion: no deadlock (the account is locked before the profile)", async () => {
    const [remover, deleter, photoHolder] = connections(3);
    const removerBlocked = await blocked(remover);
    const deleterBlocked = await blocked(deleter);
    try {
      const target = await member(api);
      await claimed(target, "rude_name");
      const tiny = Buffer.from([1, 2, 3]);
      await api.db.query(`insert into private.profile_avatars (user_id, image, thumb) values ($1, $2, $2)`, [target.userId, tiny]);
      const [{ public_id: profileId }] = await api.db.query<{ public_id: string }>(
        `select public_id from public.profiles where user_id = $1`,
        [target.userId],
      );
      // Hold the photo so the removal stops part-way, with its first locks taken.
      await photoHolder.unsafe("begin");
      await photoHolder.unsafe(`select 1 from private.profile_avatars where user_id = $1 for update`, [target.userId]);
      const removal = remover.unsafe(
        `select result, removed from private.admin_remove_profile_content($1, $2, array['avatar', 'username'], 'Report')`,
        [admin.userId, profileId],
      ).then((r) => r);
      await removerBlocked();
      const deletion = deleter.unsafe(`delete from auth.users where id = $1`, [target.userId]).then((r) => r);
      await deleterBlocked();
      await photoHolder.unsafe("commit");
      const [[removed]] = await Promise.all([removal, deletion]);
      expect(removed.result).toBe("removed");
      expect(removed.removed).toEqual(["avatar", "username"]);
      expect(await rows()).toEqual([{ username: "rude_name", user_id: null, held: true }]);
    } finally {
      await photoHolder.unsafe("rollback").catch(() => {});
      await Promise.all([remover.end(), deleter.end(), photoHolder.end()]);
    }
  });

  it("an account deleted while it claims: no deadlock, and no live name left behind", async () => {
    const conns = connections(2);
    try {
      const doomed = await member(api);
      const [result] = await Promise.all([
        claim(conns[0], doomed.userId, "latte"),
        conns[1].unsafe(`delete from auth.users where id = $1`, [doomed.userId]),
      ]);
      expect(["claimed", "user_unavailable"]).toContain(result);
      expect((await rows()).filter((r) => r.user_id !== null)).toEqual([]);
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });
});
