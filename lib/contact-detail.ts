/**
 * Finds web addresses and email addresses in free text, for the places that
 * must not carry them (an organiser's message to ticket holders). Shared by
 * the API (lib/server/handlers/holder-messages.ts) and the compose form
 * (lib/holder-message-rules.ts), so the two can never drift: there is one
 * definition and no client copy.
 *
 * Unlike the profile-field filter (lib/server/profile-input.ts, a closed list
 * of common TLDs), this one is open: any "label.label…alpha{2,}" is a domain
 * (x.ru, x.top, x.ai, is.gd, goo.gl), as is any IPv4 address. What it must
 * not catch: times and prices ("7.30pm", "8.00", "A$12.50", "Level 2.5"),
 * and abbreviations ("e.g.", "i.e.", "St. Kilda", "Mr. Lee", "a.m.", "p.m."):
 * those have a digit or a single letter after the dot, or a space.
 *
 * Text is folded first (fullwidth forms, zero-width and other invisible
 * characters, ideographic full stops) and the usual disguises undone:
 * "name[.]com", "name (dot) com", "name [at] host", "name dot com".
 * Everything here is linear in the input (bounded repetitions only); callers
 * pass text already capped at the field's length.
 */

// Invisible characters (zero-width joiners, variation selectors, tags, ...),
// removed before looking so "exa‍mple.com" is still found.
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

// A bracketed "dot" or "at": [dot] (dot) {dot} <dot> [.] (.) … with spaces
// inside and around. Bounded runs of spaces keep every scan linear.
const BRACKETED_DOT = /\s{0,8}[[({<]\s{0,8}(?:\.|dot)\s{0,8}[\])}>]\s{0,8}/giu;
const BRACKETED_AT = /\s{0,8}[[({<]\s{0,8}at\s{0,8}[\])}>]\s{0,8}/giu;

// TLDs that make a *spoken or spaced* dot ("name dot com", "name . com") a
// domain. Only these, because "dot" and a lone " . " are ordinary in prose
// ("a polka dot dress", "so . Anyway"); an attached ".ru" is checked openly.
const SPOKEN_TLDS =
  "com|net|org|edu|gov|au|uk|nz|us|ca|de|fr|jp|cn|ru|io|co|ai|cc|me|tv|ly|gg|gd|gl|top|xyz|click|link|app|dev|page|site|online|shop|store|club|live|info|biz|icu|vip|work|buzz|fun";
const NOT_ALNUM_AFTER = String.raw`(?![\p{L}\p{N}])`;
const SPOKEN_DOT = new RegExp(String.raw`\s{1,8}dot\s{1,8}(?=(?:${SPOKEN_TLDS})${NOT_ALNUM_AFTER})`, "giu");
const SPACED_DOT = new RegExp(String.raw`\s{1,8}\.\s{0,8}(?=(?:${SPOKEN_TLDS})${NOT_ALNUM_AFTER})`, "giu");
// "name .ru": a space before the dot and none after it.
const SPACE_BEFORE_DOT = /\s{1,8}\.(?=\p{L}{2})/gu;

const SCHEME = /\b[a-z][a-z0-9+.-]*:\/\/|\b(?:mailto|javascript|data):/iu;
const WWW = /\bwww\s{0,8}\.|\bwww\s{1,8}dot\s/iu;
// Runs of labels joined by dots: "x.ru", "7.30pm", "203.0.113.5", "e.g".
const DOTTED_RUN = /[\p{L}\p{M}\p{N}_-]+(?:\.[\p{L}\p{M}\p{N}_-]+)+/gu;
const ALPHA_TLD = /^\p{L}{2,}$/u;
const PUNYCODE_TLD = /^xn--[a-z0-9-]{2,}$/iu;
const OCTET = /^\d{1,3}$/;
// An address: something address-like, an "@", then the host's first character.
// A handle ("@name", "(@name)") has no local part and is fine.
const EMAIL = /[\p{L}\p{M}\p{N}_.+%-]@[\p{L}\p{N}]/u;

/** Folded, with the disguises for "." and "@" undone. */
function unmask(value: string): string {
  return foldForLinks(value)
    .replace(BRACKETED_AT, "@")
    .replace(BRACKETED_DOT, ".")
    .replace(SPOKEN_DOT, ".")
    .replace(SPACED_DOT, ".")
    .replace(SPACE_BEFORE_DOT, ".");
}

function isIpv4(labels: string[]): boolean {
  for (let start = 0; start + 4 <= labels.length; start++) {
    const window = labels.slice(start, start + 4);
    if (window.every((label) => OCTET.test(label) && Number(label) <= 255)) return true;
  }
  return false;
}

/**
 * Contains a web address: a URL scheme, "www.", any domain-like
 * "label(.label)*.tld" (a TLD is two or more letters, or a punycode "xn--"
 * one) or an IPv4 address, including the disguises above.
 */
export function containsWebAddress(value: string): boolean {
  const text = unmask(value);
  if (SCHEME.test(text) || WWW.test(text)) return true;
  for (const run of text.matchAll(DOTTED_RUN)) {
    const labels = run[0].split(".");
    const tld = labels[labels.length - 1];
    if (ALPHA_TLD.test(tld) || PUNYCODE_TLD.test(tld)) return true;
    if (isIpv4(labels)) return true;
  }
  return false;
}

/** Contains an email address: "a@b", or "a [at] b" and its variants. A handle like "@name" is fine. */
export function containsEmailAddress(value: string): boolean {
  return EMAIL.test(unmask(value));
}
