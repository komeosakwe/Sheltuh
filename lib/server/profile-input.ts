import { foldForLinks } from "@/lib/contact-detail";
import { mixesScripts, skeleton } from "@/lib/lookalikes";
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
// Emails and @handles are contact details, which a display name shouldn't carry.
const AT_SIGN = /[@＠]/u;
// Names only Sheltüh itself may appear as. Compared on a confusable skeleton (skeleton(), lib/lookalikes.ts).
const RESERVED_SUBSTRINGS = ["sheltuh"];
const RESERVED_WORDS = ["admin", "administrator", "support", "moderator"];

const RESERVED_SUBSTRING_SKELETONS = RESERVED_SUBSTRINGS.map(skeleton);
const RESERVED_WORD_SKELETONS = new Set(RESERVED_WORDS.map(skeleton));

const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });

/** Contains a control character or one that renders as nothing (the checks parseDisplayName and parseBuyerName share). */
export function hasInvisibleOrControl(value: string): boolean {
  return INVISIBLE_OR_CONTROL.test(value) || INVISIBLE.test(value);
}

/** Contains at least one letter or digit in any script. */
export function hasLetterOrNumber(value: string): boolean {
  return LETTER_OR_NUMBER.test(value);
}

/** Contains "@" (or its fullwidth form): an email address or a handle, which a name shouldn't carry. */
export function containsAtSign(value: string): boolean {
  return AT_SIGN.test(value);
}

/** Some user-perceived character carries more than MAX_MARKS_PER_GRAPHEME combining marks. */
export function tooManyMarks(name: string): boolean {
  for (const { segment } of graphemes.segment(name)) {
    if ((segment.match(/\p{M}/gu)?.length ?? 0) > MAX_MARKS_PER_GRAPHEME) return true;
  }
  return false;
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
 * Checks an organiser's display name (already trimmed and length-checked by
 * requireString): no control or invisible characters, and none of the names
 * only Sheltüh may use ("Sheltüh Support", "Admin"), compared on a confusable
 * skeleton like a member's. The rest of a member's rules (no links or @, 40
 * characters, no mixed scripts) don't apply: organisers are reviewed, and
 * names like "Static Collective Pty Ltd" are longer. The name appears in the
 * emails Sheltüh sends for the organiser, which is why it is held to this.
 * `reserved: false` skips the reserved-name rule only: an admin creating the
 * platform's own organiser ("Sheltüh Presents") is the one who may use it.
 */
export function checkOrganiserDisplayName(
  value: unknown,
  field: string,
  errors: Record<string, string>,
  { reserved = true }: { reserved?: boolean } = {},
): void {
  if (typeof value !== "string" || errors[field]) return;
  if (INVISIBLE_OR_CONTROL.test(value) || INVISIBLE.test(value)) {
    errors[field] = "Names can't contain invisible or control characters.";
  } else if (reserved && isReserved(value)) {
    errors[field] = "That name is reserved. Choose another.";
  }
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
