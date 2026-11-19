import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLAIM_WORDS,
  CUSTOM_TAG_MAX_LENGTH,
  customTagKey,
  inTagOrder,
  isOrganiserTag,
  isTagLabel,
  ORGANISER_TAGS,
  organiserTagLabel,
  parseCustomTag,
  tagsForEventCategories,
  type OrganiserTag,
} from "@/lib/api/organiser-tags";
import { EVENT_CATEGORIES } from "@/lib/types";
import { ACCEPTED_CUSTOM_TAGS } from "./fixtures/organiser-custom-tags";

const ok = (value: string) => ({ ok: true, value });
const refused = (raw: unknown) => {
  const result = parseCustomTag(raw);
  return result.ok ? `accepted as ${JSON.stringify(result.value)}` : "refused";
};

describe("ORGANISER_TAGS", () => {
  it("has the 18 slugs the database's check allows, in the same order", () => {
    const sql = readFileSync(
      path.resolve(import.meta.dirname, "../supabase/migrations/20261128000100_organiser_tags.sql"),
      "utf8",
    );
    const list = /profile_tags <@ array\[([^\]]+)\]/.exec(sql)![1];
    const slugs = [...list.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(ORGANISER_TAGS.map((t) => t.value)).toEqual(slugs);
    expect(slugs).toHaveLength(18);
  });

  it("isOrganiserTag, labels and list order", () => {
    expect(ORGANISER_TAGS.every((t) => isOrganiserTag(t.value))).toBe(true);
    for (const value of ["Live music", "jazz", "", 1, null, "toString", "__proto__"]) expect(isOrganiserTag(value)).toBe(false);
    expect(organiserTagLabel("poetry-spoken-word")).toBe("Poetry & spoken word");
    expect(inTagOrder(["community", "art", "live-music", "art"])).toEqual(["live-music", "art", "community"]);
  });

  it("a value that isn't a list item (data from before a change to the list, say) doesn't throw", () => {
    // Past the type, as a stored slug the list no longer has would be.
    const stale = "jazz" as OrganiserTag;
    expect(organiserTagLabel(stale)).toBe("jazz");
    expect(inTagOrder([stale, "community", "art"])).toEqual(["art", "community", stale]);
  });
});

describe("tagsForEventCategories", () => {
  it("maps each reviewed event category to a list item, in list order", () => {
    expect(tagsForEventCategories(EVENT_CATEGORIES.map((c) => c.value))).toEqual([
      "live-music",
      "art",
      "theatre",
      "workshops",
      "pop-ups-markets",
    ]);
    expect(tagsForEventCategories(["pop-up"])).toEqual(["pop-ups-markets"]);
    expect(tagsForEventCategories(["workshop", "workshop"])).toEqual(["workshops"]);
    expect(tagsForEventCategories([])).toEqual([]);
  });

  it("skips anything that isn't a category", () => {
    expect(tagsForEventCategories(["art", "jazz", "constructor", "__proto__"])).toEqual(["art"]);
  });
});

describe("parseCustomTag", () => {
  it("cleans: NFC, any run of spaces (non-breaking, ideographic, tabs) as one, trimmed", () => {
    expect(parseCustomTag("  Drum  　 &\tbass ")).toEqual(ok("Drum & bass"));
    expect(parseCustomTag("Café")).toEqual(ok("Café"));
  });

  it("accepts letters of any script, digits (up to 4) and & ' ’ -", () => {
    for (const word of ACCEPTED_CUSTOM_TAGS.scripts) {
      expect([word, parseCustomTag(word)]).toEqual([word, ok(word.normalize("NFC"))]);
    }
  });

  it(`takes 2 to ${CUSTOM_TAG_MAX_LENGTH} characters, counted as code points`, () => {
    expect(parseCustomTag("Ab")).toEqual(ok("Ab"));
    expect(parseCustomTag("a".repeat(CUSTOM_TAG_MAX_LENGTH))).toEqual(ok("a".repeat(CUSTOM_TAG_MAX_LENGTH)));
    expect(parseCustomTag("\u{20000}\u{20001}")).toEqual(ok("\u{20000}\u{20001}"));
    for (const word of ["A", "a".repeat(CUSTOM_TAG_MAX_LENGTH + 1), " ".repeat(200) + "Jazz", "", "   "]) {
      expect([word.length, refused(word)]).toEqual([word.length, "refused"]);
    }
  });

  it("needs a letter, and at most 4 digits", () => {
    expect(parseCustomTag("1234 club")).toEqual(ok("1234 club"));
    for (const word of ["12345 club", "0412 345 678", "2024", "-&-", "' '"]) expect([word, refused(word)]).toEqual([word, "refused"]);
    // Other kinds of number aren't digits or letters.
    for (const word of ["Club ①", "Club ²", "Club Ⅷ"]) expect([word, refused(word)]).toEqual([word, "refused"]);
  });

  it("refuses links, handles and markup, in any width", () => {
    for (const word of ["example.com", "example。com", "example．com", "example｡com", "a/b", "a\\b", "a:b", "@jazz", "＠jazz", "#jazz", "＃jazz", "<b>", "a_b", "a+b", "a,b", "(jazz)", "\"jazz\""]) {
      expect([word, refused(word)]).toEqual([word, "refused"]);
    }
  });

  it("refuses emoji, keycaps, variation selectors and symbols", () => {
    for (const word of ["Jazz \u{1F3B7}", "1️⃣ club", "1⃣ club", "Jazz❤️", "Jazz❤", "A️", "A︎", "Love ♥", "\u{1F1E6}\u{1F1FA} club", "Jazz ©", "Jazz™", "Jazz\u{E0100}"]) {
      expect([word, refused(word)]).toEqual([word, "refused"]);
    }
  });

  it("refuses invisible, control and direction characters, and everything else that renders as nothing", () => {
    for (const cp of [
      0x00, 0x07, 0x7f, 0x85, 0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x202e, 0x2060, 0x2066, 0xfeff, 0x2028, 0x2029, 0xe0041,
      // Hangul fillers (letters), the combining grapheme joiner, Khmer inherent vowels and Mongolian variation selectors (marks).
      0x115f, 0x1160, 0x3164, 0xffa0, 0x034f, 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d, 0x180f,
    ]) {
      const word = `Ja${String.fromCodePoint(cp)}zz`;
      expect([cp.toString(16), refused(word)]).toEqual([cp.toString(16), "refused"]);
    }
  });

  it("refuses the combining marks for symbols, even on a letter", () => {
    for (const cp of [0x20d0, 0x20d7, 0x20e1, 0x20e5, 0x20f0, 0x20ff]) {
      const word = `Ja${String.fromCodePoint(cp)}zz`;
      expect([cp.toString(16), refused(word)]).toEqual([cp.toString(16), "refused"]);
    }
  });

  it("allows up to two combining marks, only on a letter", () => {
    // Vietnamese: a letter with a breve and a tone mark (not precomposed with both).
    expect(parseCustomTag("Việt")).toEqual(ok("Việt"));
    expect(parseCustomTag("q́̀ab")).toEqual(ok("q́̀ab"));
    for (const word of ["q́̀̂ab", "́Jazz", "Jazz ́x", "12́ club", "Jazz-́"]) {
      expect([word, refused(word)]).toEqual([word, "refused"]);
    }
  });

  it("refuses every claim word: any case, accents, compatibility forms, spaced or hyphenated", () => {
    for (const claim of CLAIM_WORDS) {
      const spaced = claim.split("").join(" ");
      const variants = [
        claim,
        claim.toUpperCase(),
        `The ${claim} one`,
        spaced,
        claim.split("").join("-"),
        // Fullwidth letters fold to ASCII.
        [...claim].map((c) => String.fromCodePoint(c.codePointAt(0)! + 0xfee0)).join(""),
        // An accent on the first vowel.
        claim.replace(/[aeiou]/, (v) => `${v}́`),
      ];
      for (const word of variants) {
        if (Array.from(word.normalize("NFC")).length > CUSTOM_TAG_MAX_LENGTH) continue;
        expect([claim, word, refused(word)]).toEqual([claim, word, "refused"]);
      }
    }
    for (const word of ["Sold out", "Sold-out", "Staff pick", "Editor's pick", "Editor’s choice", "Top rated", "Sheltüh", "SHELTÜH crew", "Öfficial", "Official venue"]) {
      expect([word, refused(word)]).toEqual([word, "refused"]);
    }
  });

  it("refuses claim words spelt with lookalikes: I or 1 for l, 0 for o, rn for m, Cyrillic or Greek letters", () => {
    for (const word of [
      "OfficiaI",
      "SoId out",
      "SheItuh",
      "0fficial",
      "Verif1ed",
      "Appr0ved",
      "Adrnin",
      "Sponsоred", // Cyrillic о
      "ΟFFΙCΙΑL", // Greek Ο, Ι and Α
      "Тrending", // Cyrillic Т
    ]) {
      expect([word, refused(word)]).toEqual([word, "refused"]);
    }
  });

  it("refuses claim words run together with a change of case, and Sheltuh anywhere", () => {
    for (const word of ["OfficialVenue", "VenueOfficial", "SoldOut", "StaffPick", "TeamSheltuh", "SheltuhPick", "Sheltühcrew", "My sheltuh"]) {
      expect([word, refused(word)]).toEqual([word, "refused"]);
    }
  });

  it("refuses a word mixing Latin, Cyrillic or Greek letters", () => {
    for (const word of ["Jаzz" /* Cyrillic а */, "Rοck" /* Greek ο */]) {
      expect([word, parseCustomTag(word)]).toEqual([word, { ok: false, error: "Don't mix Latin, Cyrillic or Greek letters in one word." }]);
    }
    // One script per word is fine, and so are different scripts in different words.
    for (const word of ACCEPTED_CUSTOM_TAGS.oneScriptPerWord) expect([word, parseCustomTag(word).ok]).toEqual([word, true]);
  });

  it("whole words only: a claim inside a longer word is fine", () => {
    for (const word of ACCEPTED_CUSTOM_TAGS.wholeWordsOnly) {
      expect([word, parseCustomTag(word).ok]).toEqual([word, true]);
    }
  });

  it("the lookalike comparison leaves ordinary words alone", () => {
    for (const word of ACCEPTED_CUSTOM_TAGS.ordinary) {
      expect([word, parseCustomTag(word).ok]).toEqual([word, true]);
    }
  });

  it("accepts every word in the shared list (the API–database parity test checks the same words)", () => {
    for (const [group, words] of Object.entries(ACCEPTED_CUSTOM_TAGS)) {
      for (const word of words) expect([group, word, parseCustomTag(word).ok]).toEqual([group, word, true]);
    }
  });

  it("refuses anything that isn't a string", () => {
    for (const value of [42, null, undefined, ["Jazz"], { value: "Jazz" }]) expect(parseCustomTag(value).ok).toBe(false);
  });
});

describe("customTagKey and isTagLabel", () => {
  it("compare ignoring case, accents, spacing and punctuation", () => {
    expect(customTagKey("Café Culture")).toBe(customTagKey("cafe-culture"));
    expect(customTagKey("Rock ’n’ roll")).toBe(customTagKey("ROCK 'N' ROLL"));
    expect(customTagKey("Jazz")).not.toBe(customTagKey("Jazzy"));
  });

  it("every list label is recognised, in any case or spacing", () => {
    for (const { label } of ORGANISER_TAGS) {
      expect(isTagLabel(label)).toBe(true);
      expect(isTagLabel(label.toUpperCase())).toBe(true);
    }
    expect(isTagLabel("live-music")).toBe(true);
    expect(isTagLabel("Live jazz")).toBe(false);
  });
});
