import { fail } from "./validation";

/** Mirrors the profiles.display_name check constraint (counted in code points, like char_length). */
export const MAX_DISPLAY_NAME_LENGTH = 40;

/**
 * Combining marks allowed on one user-perceived character. Real names need a
 * few (Devanagari conjuncts such as "स्त्री" carry 3, Thai vowel + tone 2,
 * keycap emoji 2); "Zalgo" text stacks dozens to spill over neighbouring UI.
 */
export const MAX_MARKS_PER_GRAPHEME = 4;

// Control and invisible "format" characters (zero-width spaces and joiners,
// bidi overrides, BOM, soft hyphen...), plus line/paragraph separators. They
// let a name impersonate another or render deceptively.
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// Everything Unicode says renders as nothing (Hangul fillers, the combining
// grapheme joiner, variation selectors, ...), plus the blank Braille pattern,
// which renders as a space but isn't one. Text/emoji presentation selectors
// (U+FE0E/U+FE0F) are allowed: they're part of ordinary emoji like "❤️".
const INVISIBLE = /(?![︎️])\p{Default_Ignorable_Code_Point}|⠀/u;
// A name has to have something readable in it: at least one letter or digit.
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
// Links: a scheme, "www.", or a domain-like "name.tld" with a common TLD,
// including the obfuscations "name . com" (a space *before* the dot),
// "name[.]com", "name (dot) com" and "name dot com". A dot followed by a
// space but not preceded by one ("Mr. Me", "Fine. Me too") isn't a domain.
// Run on foldForLinks() output. Linear: every repetition that could backtrack
// starts after a letter or digit, so each whitespace run is scanned from one
// starting point.
const DOT = String.raw`(?:\.|\s+\.\s*|\s*(?:\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\}|<\s*(?:\.|dot)\s*>)\s*|\s+dot\s+)`;
const TLD = "(?:com|net|org|au|io|co|app|xyz|me|info|biz|link|ly|gg|tv|to|site|online|shop|store|dev|page|club|live)";
const LINK = new RegExp(String.raw`(\b[a-z][a-z0-9+.-]*:\/\/|\bwww(?:\s*\.|\s+dot\s)|[\p{L}\p{N}-]${DOT}${TLD}\b)`, "iu");
// Invisible characters (zero-width joiners, variation selectors, tags, ...),
// removed before looking for links so "exa‍mple.com" is still a link.
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
// Full stops that NFKC doesn't turn into "." (ideographic, halfwidth, vertical).
const OTHER_FULL_STOPS = /[。｡︒]/gu;

/**
 * The form links are looked for in: compatibility-folded (fullwidth
 * "ｅｘａｍｐｌｅ．ｃｏｍ" → "example.com"), invisible characters removed,
 * other full stops turned into ".". Only ever used for checking, never stored.
 */
export function foldForLinks(value: string): string {
  return value.normalize("NFKC").replace(DEFAULT_IGNORABLE, "").replace(OTHER_FULL_STOPS, ".");
}
// Emails and @handles are contact details, which a display name shouldn't carry.
const AT_SIGN = /[@＠]/u;
// Names only Sheltüh itself may appear as. Compared on a confusable skeleton (see skeleton()).
const RESERVED_SUBSTRINGS = ["sheltuh"];
const RESERVED_WORDS = ["admin", "administrator", "support", "moderator"];

/**
 * Cyrillic and Greek letters that look like Latin ones, mapped to the Latin
 * letter they imitate. Upper and lower case are listed separately because
 * they can imitate different letters (Greek "Η" looks like H, "η" like n).
 * A small hand-picked subset of Unicode's confusables (UTS #39), covering
 * what's needed to spell the reserved names.
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

const RESERVED_SUBSTRING_SKELETONS = RESERVED_SUBSTRINGS.map(skeleton);
const RESERVED_WORD_SKELETONS = new Set(RESERVED_WORDS.map(skeleton));

const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });

/** Some user-perceived character carries more than MAX_MARKS_PER_GRAPHEME combining marks. */
export function tooManyMarks(name: string): boolean {
  for (const { segment } of graphemes.segment(name)) {
    if ((segment.match(/\p{M}/gu)?.length ?? 0) > MAX_MARKS_PER_GRAPHEME) return true;
  }
  return false;
}

const SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];

/** A single word mixing Latin, Cyrillic and Greek letters: the classic homoglyph disguise ("Аda" with a Cyrillic А). */
function mixesScripts(name: string): boolean {
  return name
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .some((word) => SCRIPTS.filter((script) => script.test(word)).length > 1);
}

/** Contains a link: a URL scheme, "www.", or a domain-like "name.tld" (including obfuscations, see LINK), after foldForLinks. */
export function containsLink(value: string): boolean {
  return LINK.test(foldForLinks(value));
}

function isReserved(name: string): boolean {
  const skel = skeleton(name);
  const compact = skel.replace(/[^\p{L}\p{N}]/gu, "");
  const words = skel.split(/[^\p{L}\p{N}]+/u);
  return (
    RESERVED_SUBSTRING_SKELETONS.some((r) => compact.includes(r)) || words.some((w) => RESERVED_WORD_SKELETONS.has(w))
  );
}

/**
 * Returns the cleaned display name, or records an error. Cleaning: Unicode
 * NFC, runs of spaces collapsed to one, trimmed.
 */
export function parseDisplayName(value: unknown, field: string, errors: Record<string, string>): string {
  if (typeof value !== "string") {
    errors[field] = "Enter a display name.";
    return "";
  }
  if (INVISIBLE_OR_CONTROL.test(value) || INVISIBLE.test(value)) {
    errors[field] = "Display names can't contain invisible or control characters.";
    return "";
  }
  const name = value.normalize("NFC").replace(/\p{Zs}+/gu, " ").trim();
  const length = Array.from(name).length;
  if (length === 0) {
    errors[field] = "Enter a display name.";
    return "";
  }
  if (length > MAX_DISPLAY_NAME_LENGTH) {
    errors[field] = `Must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`;
    return "";
  }
  if (!LETTER_OR_NUMBER.test(name)) {
    errors[field] = "Display names need at least one letter or number.";
    return "";
  }
  if (tooManyMarks(name)) {
    errors[field] = "Display names can't stack accents or other marks on one character.";
    return "";
  }
  if (AT_SIGN.test(name) || containsLink(name)) {
    errors[field] = "Display names can't include links, email addresses or @handles.";
    return "";
  }
  if (mixesScripts(name)) {
    errors[field] = "Display names can't mix Latin, Cyrillic or Greek letters in one word.";
    return "";
  }
  if (isReserved(name)) {
    errors[field] = "That name is reserved. Choose another.";
    return "";
  }
  return name;
}

/** PUT /api/profiles/me body. */
export function parseProfileInput(body: Record<string, unknown>): { displayName: string; adultConfirmed: boolean } {
  const errors: Record<string, string> = {};
  const displayName = parseDisplayName(body.displayName, "displayName", errors);
  const adultConfirmed = body.adultConfirmed;
  if (adultConfirmed !== undefined && adultConfirmed !== null && typeof adultConfirmed !== "boolean") {
    errors.adultConfirmed = "Must be true or false.";
  }
  if (Object.keys(errors).length > 0) fail(errors);
  return { displayName, adultConfirmed: adultConfirmed === true };
}
