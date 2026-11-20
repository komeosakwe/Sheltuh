import { describe, expect, it } from "vitest";
import { CLAIM_WORDS as CLAIM_WORDS_FROM_TAGS } from "@/lib/api/organiser-tags";
import { CLAIM_WORDS, makesAClaim } from "@/lib/lookalikes";
import {
  brandKey,
  normaliseUsername,
  parseUsername,
  RESERVED_USERNAMES,
  suggestUsername,
  USERNAME_MAX_LENGTH,
  usernameKey,
} from "@/lib/username";

// lib/username.ts: the username rules the API and the settings form share
// (docs/architecture.md, "Usernames"). The API's own tests (web-address
// names, uniqueness, the database's floor) are tests/server/usernames.test.ts.

describe("normaliseUsername", () => {
  it.each([
    ["@Latte", "latte"],
    ["  latte  ", "latte"],
    ["＠ＬＡＴＴＥ", "latte"],
    ["@@latte", "@latte"],
    ["Mia_T", "mia_t"],
  ])("%j → %j", (raw, normalised) => {
    expect(normaliseUsername(raw)).toBe(normalised);
  });
});

describe("parseUsername", () => {
  it.each([
    ["latte", "latte"],
    ["@Mia.T", "mia.t"],
    ["_x_", "_x_"],
    ["a1b2c3d4", "a1b2c3d4"],
    ["badminton", "badminton"],
    ["x".repeat(USERNAME_MAX_LENGTH), "x".repeat(USERNAME_MAX_LENGTH)],
  ])("accepts %j as %j", (raw, value) => {
    expect(parseUsername(raw)).toEqual({ ok: true, value });
  });

  it.each([
    [null, "Enter a username."],
    ["", "Enter a username."],
    ["ab", "Use at least 3 characters."],
    ["x".repeat(21), "Use 20 characters or fewer."],
    ["mia tan", "Use only letters a–z, numbers, _ and ."],
    ["zoë", "Use only letters a–z, numbers, _ and ."],
    ["mia-t", "Use only letters a–z, numbers, _ and ."],
    [".mia", "Start and end with a letter, number or _."],
    ["mia.", "Start and end with a letter, number or _."],
    ["mi..a", "Don't put two dots in a row."],
    ["1234", "Include at least one letter."],
    ["_._", "Include at least one letter."],
    ["mia12345", "Use 4 numbers or fewer."],
    ["sheltuh", "Usernames can't include Sheltüh."],
    ["i.love.she1tuh", "Usernames can't include Sheltüh."],
    ["verified.mia", "That username makes a claim we can't check. Try another."],
    ["mia_0fficial", "That username makes a claim we can't check. Try another."],
    ["staff_pick", "That username makes a claim we can't check. Try another."],
    ["settings", "That username is reserved. Try another."],
    ["supp0rt", "That username is reserved. Try another."],
    ["he1p", "That username is reserved. Try another."],
    ["members_2", "That username is reserved. Try another."],
    ["s.u.p.p.o.r.t", "That username is reserved. Try another."],
  ])("refuses %j: %s", (raw, error) => {
    expect(parseUsername(raw)).toEqual({ ok: false, error });
  });

  it.each([
    "adminsupport",
    "support.team",
    "moderatorkate",
    "officialtickets",
    "verifiedmia",
    "2admin",
    "verified1",
    "staffpick1",
    "katesupport",
    "mia_staff",
    "securitysam",
    "helpdesk_au",
    "featuredartist",
    "m0derat0r_kate",
    "5ecurity",
    "v3rifiedmia",
  ])("refuses %j: a claim or staff word run together at either end (digits read as letters)", (raw) => {
    expect(parseUsername(raw).ok).toBe(false);
  });

  it.each(["mia_v3rified_au", "the_4dmin_x", "x.5ponsored.y", "kate.m0d3rator.au", "go_4pproved_now", "mia_appr0v3d_au"])(
    "refuses %j: a claim word inside the name with digits for letters",
    (raw) => {
      expect(parseUsername(raw)).toEqual({ ok: false, error: "That username makes a claim we can't check. Try another." });
      // As the same name spelt with letters is.
      expect(parseUsername(raw.replace(/[5347]/g, (d) => ({ "5": "s", "3": "e", "4": "a", "7": "t" })[d] ?? d)).ok).toBe(false);
    },
  );

  it.each(["sheltueh", "5heltuh", "shel7uh", "sh3ltuh_fan", "i_love_sheltueh"])("refuses %j: a Sheltüh lookalike", (raw) => {
    expect(parseUsername(raw)).toEqual({ ok: false, error: "Usernames can't include Sheltüh." });
  });

  it.each(["badminton", "kadmina_x", "the_supporter_club", "m4ya", "j3ss", "studio7"])(
    "still accepts %j (a staff word inside a word, or a digit that isn't a brand)",
    (raw) => {
      expect(parseUsername(raw).ok, raw).toBe(true);
    },
  );

  it("brandKey reads 5/3/4/7 as s/e/a/t on top of usernameKey; uniqueness doesn't", () => {
    expect(brandKey("5h3l7uh")).toBe("sheltuh");
    expect(usernameKey("m4ya")).not.toBe(usernameKey("maya"));
  });

  it("refuses every reserved name and every claim word", () => {
    for (const name of [...RESERVED_USERNAMES, ...CLAIM_WORDS]) {
      if (name.length < 3) continue;
      expect(parseUsername(name).ok, name).toBe(false);
    }
  });

  it("reserves every single-word top-level page", () => {
    for (const page of ["about", "account", "admin", "checkout", "events", "help", "login", "members", "messages", "saved", "signup", "terms"]) {
      expect(RESERVED_USERNAMES, page).toContain(page);
    }
  });
});

describe("usernameKey", () => {
  it("folds what looks alike", () => {
    expect(new Set(["latte", "1atte", "lat.te", "la_tte", "iatte", "l.a.t.t.e"].map(usernameKey))).toEqual(new Set(["latte"]));
    expect(usernameKey("m0cha")).toBe(usernameKey("mocha"));
    expect(usernameKey("rnia")).toBe(usernameKey("mia"));
    expect(usernameKey("r_nia")).toBe(usernameKey("mia"));
    expect(usernameKey("latte")).not.toBe(usernameKey("lattes"));
  });
});

describe("suggestUsername (from the display name only)", () => {
  it.each([
    ["Mia T.", "mia_t"],
    ["Zoë", "zoe"],
    ["  José   Álvarez ", "jose_alvarez"],
    ["Ana-Lucía O'Neil", "ana_lucia_o_neil"],
    ["A very long display name indeed", "a_very_long_display"],
    ["DJ Sam 2", "dj_sam_2"],
  ])("%j → %j", (name, suggestion) => {
    expect(suggestUsername(name)).toBe(suggestion);
  });

  it.each([["🎉🎶"], ["李小龍"], ["Al"], ["Support"], ["Sheltüh fan"], ["Official"], ["12345"]])(
    "%j → null (nothing valid to offer)",
    (name) => {
      expect(suggestUsername(name)).toBeNull();
    },
  );

  it("every suggestion is a valid username", () => {
    for (const name of ["Mia T.", "Zoë", "Bo", "Ngozi Okafor-Smith", "x".repeat(40), "a.b"]) {
      const suggestion = suggestUsername(name);
      if (suggestion !== null) expect(parseUsername(suggestion)).toEqual({ ok: true, value: suggestion });
    }
  });
});

describe("shared claim words (moved from lib/api/organiser-tags.ts)", () => {
  it("organiser-tags still exports the same list", () => {
    expect(CLAIM_WORDS_FROM_TAGS).toBe(CLAIM_WORDS);
  });

  it("makesAClaim matches whole words and 'sheltuh' anywhere", () => {
    expect(makesAClaim("official_mia")).toBe(true);
    expect(makesAClaim("badminton")).toBe(false);
    expect(makesAClaim("mysheltuhpage")).toBe(true);
  });
});
