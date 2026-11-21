/**
 * Lookalike-insensitive comparison, shared by the API's display-name rules
 * (lib/server/profile-input.ts), an organiser's own words
 * (lib/api/organiser-tags.ts, which the dashboard form runs too) and
 * usernames (lib/username.ts): plain string functions, safe in the browser.
 */

/**
 * Cyrillic and Greek letters that look like Latin ones, mapped to the Latin
 * letter they imitate. Upper and lower case are listed separately because
 * they can imitate different letters (Greek "Η" looks like H, "η" like n).
 * A small hand-picked subset of Unicode's confusables (UTS #39), covering
 * what's needed to spell the reserved names and claim words.
 */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  А: "a", а: "a", В: "b", в: "b", Ь: "b", ь: "b", С: "c", с: "c", ԁ: "d", Е: "e", е: "e",
  Һ: "h", һ: "h", Н: "h", н: "h", І: "i", і: "i", Ј: "j", ј: "j", К: "k", к: "k",
  Ӏ: "l", ӏ: "l", М: "m", м: "m", О: "o", о: "o", Р: "p", р: "p", Ԛ: "q", ԛ: "q", Ѕ: "s", ѕ: "s",
  Т: "t", т: "t", г: "r", п: "n", Ѵ: "v", ѵ: "v", Ԝ: "w", ԝ: "w", Х: "x", х: "x", У: "y", у: "y", Ү: "y", ү: "y",
  // Greek
  Α: "a", α: "a", Β: "b", β: "b", Ε: "e", ε: "e", Ζ: "z", Η: "h", η: "n", Ι: "i", ι: "i", Κ: "k", κ: "k",
  Μ: "m", Ν: "n", ν: "v", Ο: "o", ο: "o", Ρ: "p", ρ: "p", Τ: "t", τ: "t", Υ: "y", υ: "u", Χ: "x", χ: "x",
  γ: "y",
};
const CONFUSABLE_CHARS = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "gu");

/**
 * A lookalike-insensitive form for comparing against reserved names:
 * compatibility-folded (fullwidth → ASCII), accents stripped (so "Sheltüh" →
 * "sheltuh"), Cyrillic/Greek lookalikes mapped to Latin, lower-cased, and the
 * classic Latin lookalikes merged: i/l/1/| → l, 0 → o, "rn" → "m".
 */
export function skeleton(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(CONFUSABLE_CHARS, (c) => CONFUSABLES[c])
    .toLowerCase()
    .replace(/[il1|ı]/gu, "l")
    .replace(/0/gu, "o")
    .replace(/rn/gu, "m");
}

const SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];

/** A single word mixing Latin, Cyrillic and Greek letters: the classic homoglyph disguise ("Аda" with a Cyrillic А). */
export function mixesScripts(value: string): boolean {
  return value
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .some((word) => SCRIPTS.filter((script) => script.test(word)).length > 1);
}

/**
 * Words that claim a status only Sheltüh (or nobody) can give, refused in an
 * organiser's own words (lib/api/organiser-tags.ts) and in usernames
 * (lib/username.ts): endorsement, verification, partnership, ranking or
 * availability ("Official", "Verified", "Sold out", "Sheltüh partner").
 * Compared on the lookalike skeleton (skeleton(), above: case,
 * accents, fullwidth and other compatibility forms, Cyrillic and Greek
 * lookalikes, i/l/1 → l, 0 → o, rn → m: "ÖFFICIAL", "ｏｆｆｉｃｉａｌ",
 * "OfficiaI", "Appr0ved"), as whole words, and squashed across the spaces or
 * punctuation between words ("soldout", "sold-out", "o f f i c i a l") and
 * the change of case inside one ("OfficialVenue"). "sheltuh" is refused
 * anywhere at all ("TeamSheltuh", "SheltuhPick"), as in display names. Each
 * entry is written as it's matched: lower case, ASCII, no spaces.
 */
export const CLAIM_WORDS: readonly string[] = [
  "official",
  "officially",
  "verified",
  "certified",
  "accredited",
  "endorsed",
  "approved",
  "authorised",
  "authorized",
  "sponsored",
  "promoted",
  "featured",
  "partner",
  "partners",
  "partnered",
  "sheltuh",
  "admin",
  "moderator",
  "trending",
  "soldout",
  "staffpick",
  "staffpicks",
  "editorspick",
  "editorschoice",
  "toprated",
];

const CLAIM_SKELETONS = new Set(CLAIM_WORDS.map(skeleton));
/** Refused anywhere in an own word, not only as a whole word. */
const RESERVED_SUBSTRING = skeleton("sheltuh");

/**
 * Contains a claim word: a run of whole words that, joined, is one of
 * CLAIM_WORDS on the skeleton. A lower-case letter followed by a capital
 * starts a new word ("OfficialVenue", and "OfficiaI" with a capital I).
 * Contains "sheltuh" anywhere, spaces and punctuation ignored.
 */
export function makesAClaim(value: string): boolean {
  if (skeleton(value.replace(/[^\p{L}\p{N}]/gu, "")).includes(RESERVED_SUBSTRING)) return true;
  const words = value
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  // Callers cap the length first (an own word 24 characters, a username 20), so this is at most a few hundred short strings.
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let j = i; j < words.length; j++) {
      joined += words[j];
      if (CLAIM_SKELETONS.has(skeleton(joined))) return true;
    }
  }
  return false;
}
