import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_CUSTOM_TAGS, MAX_PROFILE_TAGS, ORGANISER_TAGS, parseCustomTag, type OrganiserTag } from "@/lib/api/organiser-tags";
import {
  adminListOrganisers,
  adminRejectOrganiser,
  adminRemoveOrganiserTags,
  adminSuspendOrganiser,
} from "@/lib/server/handlers/admin";
import { putMyOrganiserTags } from "@/lib/server/handlers/organiser-tags";
import { applyAsOrganiser, getMyOrganiser } from "@/lib/server/handlers/organisers";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { ALL_ACCEPTED_CUSTOM_TAGS } from "../fixtures/organiser-custom-tags";
import { TestApi } from "./helpers/api";
import { application, approvedOrganiser, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// Organiser profile categories: docs/architecture.md, "Organiser profiles";
// supabase/migrations/20261128000100_organiser_tags.sql; the rules in
// lib/api/organiser-tags.ts (unit tests: tests/organiser-tags.test.ts).

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string; email: string };

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

const put = (token: string | undefined, body: unknown, on = api) =>
  on.call(putMyOrganiserTags, { token, body, method: "PUT" });

const profile = (organiserId = organiser.organiserId) =>
  api.call(getPublicOrganiserProfile, { params: { organiserId } });

async function stored(organiserId = organiser.organiserId) {
  const [row] = await api.db.query<{ profile_tags: string[] | null; custom_tags: string[] }>(
    `select profile_tags, custom_tags from public.organisers where id = $1`,
    [organiserId],
  );
  return row;
}

async function logEntries(organiserId = organiser.organiserId) {
  return api.db.query<{ changed_fields: Record<string, { old: string | null; new: string | null }>; actor_id: string; reason: string | null }>(
    `select changed_fields, actor_id, reason from private.organiser_profile_edits where organiser_id = $1 order by id`,
    [organiserId],
  );
}

async function suspend(organiserId = organiser.organiserId) {
  const res = await api.call(adminSuspendOrganiser, {
    token: admin.token,
    params: { organiserId },
    body: { reason: "Impersonating another venue." },
  });
  expect(res.status).toBe(200);
}

/** The error a direct write raises, or null if it went through. */
async function writeError(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await api.db.query(sql, params);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

// ---------------------------------------------------------------------------
// PUT /organisers/me/tags
// ---------------------------------------------------------------------------

describe("PUT /organisers/me/tags", () => {
  it("saves the chips, list items in list order without repeats, and answers with the organiser record", async () => {
    const res = await put(organiser.token, {
      profileTags: ["community", "live-music", "art", "live-music"],
      customTags: ["  Drum   &   bass ", "Rock \u2019n\u2019 roll"],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toMatchObject({
      organiserId: organiser.organiserId,
      profileTags: ["live-music", "art", "community"],
      customTags: ["Drum & bass", "Rock \u2019n\u2019 roll"],
    });
    expect(res.body.reviewedBy).toBeUndefined();
    expect(await stored()).toEqual({
      profile_tags: ["live-music", "art", "community"],
      custom_tags: ["Drum & bass", "Rock \u2019n\u2019 roll"],
    });
    // The reviewed event categories are untouched.
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body.categories).toEqual(application.categories);
  });

  it("accepts every one of the list's items", async () => {
    expect(ORGANISER_TAGS).toHaveLength(18);
    for (let i = 0; i < ORGANISER_TAGS.length; i += MAX_PROFILE_TAGS) {
      const batch = ORGANISER_TAGS.slice(i, i + MAX_PROFILE_TAGS).map((t) => t.value);
      const res = await put(organiser.token, { profileTags: batch, customTags: [] });
      expect([batch, res.status]).toEqual([batch, 200]);
      expect((await stored()).profile_tags).toEqual(batch);
    }
  });

  it("accepts own words in any script, with accents, digits (up to 4) and & ' \u2019 -", async () => {
    for (const words of [
      ["Café culture", "Ngā toi"],
      ["日本のジャズ", "Late-night"],
      ["Class of 2024", "Kunst & Kultur"],
      ["\u014Ctautahi", "Ünderground"],
    ]) {
      const res = await put(organiser.token, { profileTags: ["art"], customTags: words });
      expect([words, res.status]).toEqual([words, 200]);
      expect((await stored()).custom_tags).toEqual(words.map((w) => w.normalize("NFC")));
    }
  });

  it("an organiser can choose no chips at all, or only their own words", async () => {
    expect((await put(organiser.token, { profileTags: [], customTags: [] })).status).toBe(200);
    expect(await stored()).toEqual({ profile_tags: [], custom_tags: [] });
    expect((await put(organiser.token, { profileTags: [], customTags: ["Jazz", "Soul"] })).status).toBe(200);
    expect(await stored()).toEqual({ profile_tags: [], custom_tags: ["Jazz", "Soul"] });
  });

  it("refuses an unknown or malformed list item, too many items, and missing lists (400)", async () => {
    for (const [body, fields] of [
      [{ profileTags: ["live-music", "jazz"], customTags: [] }, ["profileTags"]],
      [{ profileTags: ["Live music"], customTags: [] }, ["profileTags"]],
      [{ profileTags: [1], customTags: [] }, ["profileTags"]],
      [{ profileTags: "art", customTags: [] }, ["profileTags"]],
      [{ profileTags: ORGANISER_TAGS.slice(0, MAX_PROFILE_TAGS + 1).map((t) => t.value), customTags: [] }, ["profileTags"]],
      [{ profileTags: Array(19).fill("art"), customTags: [] }, ["profileTags"]],
      [{ customTags: [] }, ["profileTags"]],
      [{ profileTags: [] }, ["customTags"]],
      [{}, ["customTags", "profileTags"]],
      [{ profileTags: [], customTags: "Jazz" }, ["customTags"]],
      [{ profileTags: [], customTags: ["Jazz", "Soul", "Funk"] }, ["customTags"]],
      // 4 + 2 is over 5 in all.
      [{ profileTags: ["art", "film", "dance", "design"], customTags: ["Jazz", "Soul"] }, ["customTags"]],
    ] as const) {
      const res = await put(organiser.token, body);
      expect([body, res.status]).toEqual([body, 400]);
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual(fields);
    }
    // Repeats count once: these are 5.
    const ok = await put(organiser.token, { profileTags: ["art", "art", "film", "dance", "design"], customTags: ["Jazz"] });
    expect(ok.status).toBe(200);
    expect(await stored()).toEqual({ profile_tags: ["art", "dance", "film", "design"], custom_tags: ["Jazz"] });
  });

  it("refuses own words that break the rules, each on its own key, and writes nothing", async () => {
    const refused = [
      // Claim words, any case, accent, width or spacing.
      "Official",
      "OFFICIAL venue",
      "Öfficial",
      "\uFF4F\uFF46\uFF46\uFF49\uFF43\uFF49\uFF41\uFF4C",
      "o f f i c i a l",
      "Verified",
      "Sold out",
      "Soldout",
      "sold-out",
      "Sheltüh partner",
      "Shel tuh",
      "Editor's pick",
      "Top rated",
      // Links, handles and markup.
      "example.com",
      "example\u3002com",
      "example\uFF0Ecom",
      "https stuff:",
      "a/b",
      "@static",
      "#jazz",
      "<b>Jazz</b>",
      // Emoji, keycaps and VS16, symbols.
      "Jazz \u{1F3B7}",
      "1\uFE0F\u20E3 club",
      "Jazz\u2764\uFE0F",
      "Love \u2665",
      // Invisible characters.
      "Ja\u200Bzz",
      "Jazz\u200D",
      "\u202EJazz",
      "Ja\u00ADzz",
      "\u3164\u3164",
      // Lengths, digits, letters, marks.
      "J",
      "x".repeat(25),
      "12345 club",
      "0412 345 678",
      "2024",
      "-&-",
      // NFC makes "e" and the first accent one letter: three marks still stacked on it.
      "e\u0301\u0301\u0301\u0301",
      "\u0301Jazz",
      // A list label, in any case or spacing.
      "Live music",
      "live-MUSIC",
      "Poetry & spoken word",
      // Not a string.
      42,
    ];
    for (const word of refused) {
      const res = await put(organiser.token, { profileTags: ["art"], customTags: ["Jazz", word] });
      expect([word, res.status]).toEqual([word, 400]);
      expect([word, Object.keys(res.body.fieldErrors)]).toEqual([word, ["customTags.1"]]);
    }
    // Repeats, ignoring case and accents.
    for (const pair of [
      ["Jazz", "jazz"],
      ["Café", "cafe"],
      ["Drum & bass", "DRUM & BASS"],
    ]) {
      const res = await put(organiser.token, { profileTags: [], customTags: pair });
      expect([pair, Object.keys(res.body.fieldErrors ?? {})]).toEqual([pair, ["customTags.1"]]);
    }
    expect(await stored()).toEqual({ profile_tags: null, custom_tags: [] });
    expect(await logEntries()).toEqual([]);
  });

  it("logs each change (old and new), and an unchanged save writes nothing", async () => {
    await api.db.query(`update public.organisers set updated_at = now() - interval '1 day' where id = $1`, [
      organiser.organiserId,
    ]);
    const before = (await api.call(getMyOrganiser, { token: organiser.token })).body.updatedAt;

    expect((await put(organiser.token, { profileTags: ["film", "art"], customTags: [] })).status).toBe(200);
    const after = (await api.call(getMyOrganiser, { token: organiser.token })).body.updatedAt;
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));

    // The same again: nothing written (updatedAt and the log unchanged).
    const same = await put(organiser.token, { profileTags: ["art", "film"], customTags: [] });
    expect(same.status).toBe(200);
    expect(same.body.updatedAt).toBe(after);

    expect((await put(organiser.token, { profileTags: ["art", "film"], customTags: ["Jazz"] })).status).toBe(200);
    expect((await put(organiser.token, { profileTags: [], customTags: [] })).status).toBe(200);

    expect(await logEntries()).toEqual([
      { changed_fields: { profile_tags: { old: null, new: "art, film" } }, actor_id: organiser.userId, reason: null },
      { changed_fields: { custom_tags: { old: null, new: "Jazz" } }, actor_id: organiser.userId, reason: null },
      {
        changed_fields: { profile_tags: { old: "art, film", new: "" }, custom_tags: { old: "Jazz", new: null } },
        actor_id: organiser.userId,
        reason: null,
      },
    ]);

    // The admin queue shows them as profileTags / customTags changes by the organiser.
    const queue = await api.call(adminListOrganisers, { token: admin.token, query: { status: "approved" } });
    const record = queue.body.items.find((o: { organiserId: string }) => o.organiserId === organiser.organiserId);
    expect(record.recentEdits.map((e: { changes: unknown }) => e.changes)).toEqual([
      { profileTags: { old: "art, film", new: "" }, customTags: { old: "Jazz", new: null } },
      { customTags: { old: null, new: "Jazz" } },
      { profileTags: { old: null, new: "art, film" } },
    ]);
    expect(record).toMatchObject({ profileTags: [], customTags: [] });
  });

  it("needs a token (401) and an approved organiser (403, before the body is read)", async () => {
    expect((await put(undefined, { profileTags: [], customTags: [] })).status).toBe(401);
    const nobody = await api.signUp();
    const pendingUser = await api.signUp();
    await api.call(applyAsOrganiser, { token: pendingUser.token, body: application });
    const rejectedUser = await api.signUp();
    const rejected = await api.call(applyAsOrganiser, { token: rejectedUser.token, body: application });
    await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId: rejected.body.organiserId },
      body: { reason: "No" },
    });
    for (const token of [nobody.token, pendingUser.token, rejectedUser.token]) {
      // An invalid body: the 403 comes first.
      expect((await put(token, { profileTags: "nope" })).status).toBe(403);
    }
    await suspend();
    expect((await put(organiser.token, { profileTags: ["art"], customTags: [] })).status).toBe(403);
    expect(await stored()).toEqual({ profile_tags: null, custom_tags: [] });
  });

  it("only ever changes the caller's own organiser", async () => {
    const other = await approvedOrganiser(api, admin, { displayName: "Other Org" });
    expect((await put(organiser.token, { profileTags: ["art"], customTags: ["Jazz"] })).status).toBe(200);
    expect(await stored(other.organiserId)).toEqual({ profile_tags: null, custom_tags: [] });
  });

  it("an organiser taken down during the save gets a 409, and nothing is written", async () => {
    const racing = new TestApi({
      query: async (text, params) => {
        if (text.includes("private.set_organiser_tags")) {
          await api.db.query(`select * from private.suspend_organiser($1, $2, 'Taken down')`, [
            organiser.organiserId,
            admin.userId,
          ]);
        }
        return api.db.query(text, params);
      },
    });
    const token = racing.tokenFor({ userId: organiser.userId, email: organiser.email, emailVerified: true, isAdmin: false });
    const res = await put(token, { profileTags: ["art"], customTags: ["Jazz"] }, racing);
    expect(res.status).toBe(409);
    expect(await stored()).toEqual({ profile_tags: null, custom_tags: [] });
    expect((await logEntries()).some((e) => "profile_tags" in e.changed_fields)).toBe(false);
  });

  it("a database refusal the API didn't foresee is a 400 on the field, not a 500, and nothing is written", async () => {
    // What the API would send if its rules and the database's ever disagreed: the
    // trigger (organisers_custom_tags_valid) and both check constraints.
    const cases: [string, (params: unknown[]) => unknown[], string][] = [
      ["trigger", ([owner, profileTags]) => [owner, profileTags, ["Ja\u200Bzz"]], "customTags"],
      ["organisers_custom_tags_check", ([owner]) => [owner, [], ["Jazz", "Soul", "Funk"]], "customTags"],
      ["organisers_profile_tags_check", ([owner, , customTags]) => [owner, ["jazz"], customTags], "profileTags"],
    ];
    for (const [name, rewrite, field] of cases) {
      const disagreeing = new TestApi({
        query: (text, params = []) =>
          api.db.query(text, text.includes("private.set_organiser_tags") ? rewrite(params) : params),
      });
      const token = disagreeing.tokenFor({ userId: organiser.userId, email: organiser.email, emailVerified: true, isAdmin: false });
      const res = await put(token, { profileTags: ["art"], customTags: ["Jazz"] }, disagreeing);
      expect([name, res.status, Object.keys(res.body.fieldErrors ?? {})]).toEqual([name, 400, [field]]);
    }
    expect(await stored()).toEqual({ profile_tags: null, custom_tags: [] });
    expect(await logEntries()).toEqual([]);
  });

  it("set_organiser_tags: not_found, not_approved, and refuses null lists", async () => {
    const call = (owner: string, profileTags: string[] | null, customTags: string[] | null) =>
      api.db.query<{ result: string }>(`select private.set_organiser_tags($1, $2::text[], $3::text[]) as result`, [
        owner,
        profileTags,
        customTags,
      ]);
    expect((await call(crypto.randomUUID(), [], []))[0].result).toBe("not_found");
    expect(await writeError(`select private.set_organiser_tags($1, null, '{}')`, [organiser.userId])).toMatch(/required/);
    expect(await writeError(`select private.set_organiser_tags($1, '{}', null)`, [organiser.userId])).toMatch(/required/);
    await suspend();
    expect((await call(organiser.userId, ["art"], []))[0].result).toBe("not_approved");
    expect(await stored()).toEqual({ profile_tags: null, custom_tags: [] });
  });
});

// ---------------------------------------------------------------------------
// The database's own checks
// ---------------------------------------------------------------------------

describe("public.organisers: the tag columns' constraints and trigger", () => {
  const set = (profileTags: string[] | null, customTags: string[]) =>
    writeError(`update public.organisers set profile_tags = $2::text[], custom_tags = $3::text[] where id = $1`, [
      organiser.organiserId,
      profileTags,
      customTags,
    ]);

  it("accepts what the API writes", async () => {
    expect(await set(["live-music", "art"], ["Drum & bass", "Café"])).toBeNull();
    expect(await set([], [])).toBeNull();
    expect(await set(null, [])).toBeNull();
  });

  it("refuses an unknown slug, a repeat, more than 5, and own words without a choice or past the counts", async () => {
    const cases: [string[] | null, string[], RegExp][] = [
      [["live-music", "jazz"], [], /organisers_profile_tags_check/],
      [["Live music"], [], /organisers_profile_tags_check/],
      // Also over 5 in all, so either check may report it.
      [["art", "film", "dance", "design", "comedy", "community"], [], /organisers_(profile|custom)_tags_check/],
      [["art", "art"], [], /repeated/],
      [null, ["Jazz"], /organisers_custom_tags_check/],
      [[], ["Jazz", "Soul", "Funk"], /organisers_custom_tags_check/],
      [["art", "film", "dance", "design"], ["Jazz", "Soul"], /organisers_custom_tags_check/],
      [[], ["Jazz", "jazz"], /repeated/],
    ];
    for (const [profileTags, customTags, error] of cases) {
      expect([profileTags, customTags, await set(profileTags, customTags)]).toEqual([
        profileTags,
        customTags,
        expect.stringMatching(error),
      ]);
    }
    // The trigger runs first and counts the null out, so it may be the one to refuse it.
    expect(await writeError(`update public.organisers set profile_tags = array[null]::text[] where id = $1`, [
      organiser.organiserId,
    ])).toMatch(/organisers_profile_tags_check|repeated/);
    expect(await writeError(`update public.organisers set profile_tags = '{{art},{film}}' where id = $1`, [
      organiser.organiserId,
    ])).toMatch(/organisers_profile_tags_check/);
  });

  it("the trigger refuses own words with link, handle or markup characters, hidden characters, emoji or bad lengths", async () => {
    for (const word of [
      "a.b",
      "a/b",
      "a:b",
      "a\\b",
      "@static",
      "#jazz",
      "<b>",
      "a\uFF0Eb",
      "a\u3002b",
      "Ja\u200Bzz",
      "Ja\u200Dzz",
      "\u202EJazz",
      "Ja\u00ADzz",
      "Ja\tzz",
      "\u3164\u3164",
      "Jazz \u{1F3B7}",
      "1\uFE0F\u20E3",
      "Jazz\u2764",
      "J",
      "x".repeat(25),
      " Jazz",
      "Jazz ",
      "Jazz  club",
    ]) {
      expect([word, await set([], [word])]).toEqual([word, expect.stringMatching(/accepted/)]);
    }
    expect(await stored()).toEqual({ profile_tags: null, custom_tags: [] });
  });

  it("checks only new words, so a rule tightened later never blocks an unrelated update", async () => {
    expect(await set(["art"], ["Jazz", "Soul"])).toBeNull();
    // A stricter rule from a later migration: no "Jazz".
    await api.db.query(`alter function private.organiser_custom_tag_ok(text) rename to organiser_custom_tag_ok_saved`);
    await api.db.query(
      `create function private.organiser_custom_tag_ok(p_tag text) returns boolean language sql immutable set search_path = ''
         as $$ select private.organiser_custom_tag_ok_saved(p_tag) and p_tag <> 'Jazz' $$`,
    );
    try {
      // A takedown, list-item changes and keeping "Jazz" while changing the other word all go through.
      expect(await set(["art", "film"], ["Jazz", "Soul"])).toBeNull();
      expect(await set(["art", "film"], ["Jazz", "Funk"])).toBeNull();
      await suspend();
      // A new "Jazz" doesn't.
      expect(await set(["art"], ["Funk"])).toBeNull();
      expect(await set(["art"], ["Funk", "Jazz"])).toMatch(/accepted/);
    } finally {
      await api.db.query(`drop function private.organiser_custom_tag_ok(text)`);
      await api.db.query(`alter function private.organiser_custom_tag_ok_saved(text) rename to organiser_custom_tag_ok`);
    }
  });
});

// ---------------------------------------------------------------------------
// The API's rules and the database's agree
// ---------------------------------------------------------------------------

describe("parseCustomTag and private.organiser_custom_tag_ok agree", () => {
  /** The words private.organiser_custom_tag_ok refuses, out of `words`, in one query. */
  async function refusedByDb(words: readonly string[]): Promise<string[]> {
    const rows = await api.db.query<{ w: string }>(
      `select w from unnest($1::text[]) with ordinality as t(w, i) where not private.organiser_custom_tag_ok(w) order by i`,
      [words],
    );
    return rows.map((r) => r.w);
  }

  /** `Ja<c>zz` and `<c><c>` for every code point in the ranges (no NUL or surrogates, which text can't hold). */
  function sweep(ranges: [number, number][]): string[] {
    const words: string[] = [];
    for (const [from, to] of ranges) {
      for (let cp = from; cp <= to; cp++) {
        if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) continue;
        const c = String.fromCodePoint(cp);
        words.push(`Ja${c}zz`, `${c}${c}`);
      }
    }
    return words;
  }

  /** Every code point the database's character deny-lists name, read from the migration (written there as \\uXXXX, \\UXXXXXXXX or the character itself). */
  function dbDeniedCodePoints(): number[] {
    const sql = readFileSync(
      path.resolve(import.meta.dirname, "../../supabase/migrations/20261128000100_organiser_tags.sql"),
      "utf8",
    );
    const fn = sql.slice(sql.indexOf("create function private.organiser_custom_tag_ok"), sql.indexOf("alter table public.organisers"));
    const classes = [...fn.matchAll(/p_tag !~ '\[([^\]]+)\]'/g)].map((m) => m[1]);
    expect(classes).toHaveLength(3);
    const points: number[] = [];
    for (const cls of classes) {
      const atoms = [...cls.matchAll(/\\u([0-9A-F]{4})|\\U([0-9A-F]{8})|(-)|(.)/gu)].map((m) =>
        m[3] ? "-" : m[1] || m[2] ? parseInt(m[1] ?? m[2], 16) : m[4].codePointAt(0)!,
      );
      for (let i = 0; i < atoms.length; i++) {
        const from = atoms[i] as number;
        if (atoms[i + 1] === "-") {
          for (let cp = from; cp <= (atoms[i + 2] as number); cp++) points.push(cp);
          i += 2;
        } else {
          points.push(from);
        }
      }
    }
    // And the backslash, checked on its own (strpos with chr(92)).
    return [...points, 0x5c];
  }

  it("every own word the unit tests accept, as the API cleans it, passes the database's check", async () => {
    const cleaned = ALL_ACCEPTED_CUSTOM_TAGS.map((w) => {
      const parsed = parseCustomTag(w);
      if (!parsed.ok) throw new Error(`${JSON.stringify(w)}: ${parsed.error}`);
      return parsed.value;
    });
    expect(await refusedByDb(cleaned)).toEqual([]);
  });

  it("every character the API accepts in a word, the database accepts (the BMP, the SMP, the SIP and the tags block)", async () => {
    const accepted = sweep([
      [0x0001, 0x2ffff],
      [0xe0000, 0xe01ff],
    ]).flatMap((w) => {
      const parsed = parseCustomTag(w);
      return parsed.ok ? [parsed.value] : [];
    });
    expect(accepted.length).toBeGreaterThan(100_000);
    const refused = await refusedByDb(accepted);
    expect(refused.map((w) => [...w].map((c) => c.codePointAt(0)!.toString(16)).join(" "))).toEqual([]);
  });

  it("every character the database's deny-lists name, the API refuses (but the spaces it cleans away)", async () => {
    const points = dbDeniedCodePoints();
    expect(points.length).toBeGreaterThan(4000);
    // Tab, line feed and carriage return: the API folds them into a space first, as the database never sees them.
    const words = points.filter((cp) => ![0x09, 0x0a, 0x0d].includes(cp)).map((cp) => `Ja${String.fromCodePoint(cp)}zz`);
    expect(await refusedByDb(words)).toEqual(words);
    expect(words.filter((w) => parseCustomTag(w).ok)).toEqual([]);
  });

  it("the database refuses every assigned character that renders as nothing (Default_Ignorable_Code_Point), as the API does", async () => {
    const ignorable: string[] = [];
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      if (/\p{Default_Ignorable_Code_Point}/u.test(c) && !/\p{Cn}/u.test(c)) ignorable.push(c);
    }
    for (const cp of [0x034f, 0x115f, 0x17b4, 0x17b5, 0x180b, 0x180e, 0x180f, 0x3164, 0xfe0f, 0xe0100]) {
      expect(ignorable).toContain(String.fromCodePoint(cp));
    }
    const words = ignorable.map((c) => `Ja${c}zz`);
    expect(await refusedByDb(words)).toEqual(words);
    expect(words.filter((w) => parseCustomTag(w).ok)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Admin removal
// ---------------------------------------------------------------------------

describe("POST /admin/organisers/{id}/remove-tags", () => {
  const removeTags = (token: string | undefined, organiserId: string, body: unknown) =>
    api.call(adminRemoveOrganiserTags, { token, params: { organiserId }, body });

  it("clears the own words (the list items stay), logged as the Sheltüh team's edit; nothing to clear is a no-op", async () => {
    await put(organiser.token, { profileTags: ["art", "film"], customTags: ["Jazz", "Soul"] });

    const res = await removeTags(admin.token, organiser.organiserId, { reason: "Misleading" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toMatchObject({ profileTags: ["art", "film"], customTags: [] });
    expect(res.body.recentEdits[0]).toEqual({
      kind: "profile_edit",
      at: expect.any(String),
      changes: { customTags: { old: "Jazz, Soul", new: null } },
      reason: "Misleading",
      byStaff: true,
    });
    expect(await stored()).toEqual({ profile_tags: ["art", "film"], custom_tags: [] });
    expect((await profile()).body).toMatchObject({ profileTags: ["art", "film"], customTags: [] });

    const again = await removeTags(admin.token, organiser.organiserId, { reason: "Again" });
    expect(again.status).toBe(200);
    expect(again.body.recentEdits).toHaveLength(2);
  });

  it("works whatever the organiser's status", async () => {
    await put(organiser.token, { profileTags: [], customTags: ["Jazz"] });
    await suspend();
    expect((await removeTags(admin.token, organiser.organiserId, { reason: "Gone" })).status).toBe(200);
    expect((await stored()).custom_tags).toEqual([]);
  });

  it("is admin only (401, 403), needs a reason (400) and a known organiser (404)", async () => {
    await put(organiser.token, { profileTags: [], customTags: ["Jazz"] });
    expect((await removeTags(undefined, organiser.organiserId, { reason: "x" })).status).toBe(401);
    expect((await removeTags(organiser.token, organiser.organiserId, { reason: "x" })).status).toBe(403);
    for (const body of [{}, { reason: "" }, { reason: "x".repeat(501) }, { reason: "bad\u0000" }]) {
      const res = await removeTags(admin.token, organiser.organiserId, body);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["reason"]);
    }
    expect((await removeTags(admin.token, crypto.randomUUID(), { reason: "x" })).status).toBe(404);
    expect((await removeTags(admin.token, "not-a-uuid", { reason: "x" })).status).toBe(404);
    expect((await stored()).custom_tags).toEqual(["Jazz"]);
  });
});

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

describe("the chips in the API's payloads", () => {
  it("before choosing: null on the owner's record; the public profile shows the reviewed event categories, mapped", async () => {
    const mixed = await approvedOrganiser(api, admin, {
      displayName: "Mixed Org",
      categories: ["theatre", "workshop", "pop-up", "live-music", "art"],
    });
    const own = await api.call(getMyOrganiser, { token: mixed.token });
    expect(own.body).toMatchObject({ profileTags: null, customTags: [] });
    const res = await profile(mixed.organiserId);
    expect(res.body.categories).toEqual(["theatre", "workshop", "pop-up", "live-music", "art"]);
    expect(res.body.profileTags).toEqual<OrganiserTag[]>(["live-music", "art", "theatre", "workshops", "pop-ups-markets"]);
    expect(res.body.customTags).toEqual([]);
  });

  it("after choosing: the choice, an empty one included", async () => {
    await put(organiser.token, { profileTags: ["comedy"], customTags: ["Late shows"] });
    expect((await profile()).body).toMatchObject({ profileTags: ["comedy"], customTags: ["Late shows"] });
    await put(organiser.token, { profileTags: [], customTags: [] });
    expect((await profile()).body).toMatchObject({ profileTags: [], customTags: [] });
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body).toMatchObject({
      profileTags: [],
      customTags: [],
    });
  });

  it("the limits the API states match the database's", () => {
    expect([MAX_PROFILE_TAGS, MAX_CUSTOM_TAGS]).toEqual([5, 2]);
  });
});
