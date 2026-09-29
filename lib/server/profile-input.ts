import { fail } from "./validation";

/** Mirrors the profiles.display_name check constraint (counted in code points, like char_length). */
export const MAX_DISPLAY_NAME_LENGTH = 40;

// Control and invisible "format" characters (zero-width spaces and joiners,
// bidi overrides, BOM, soft hyphen...), plus line/paragraph separators. They
// let a name impersonate another or render deceptively.
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// Links: a scheme, "www.", or a domain-like "name.tld" with a common TLD,
// including the "name[.]com" / "name (dot) com" obfuscations. A dot followed
// by a space ("Mr. Me") isn't a domain.
const LINK =
  /(\b[a-z][a-z0-9+.-]*:\/\/|\bwww\s*\.|[\p{L}\p{N}-](?:\.|\s*(?:\[\.\]|\(\.\)|\[dot\]|\(dot\))\s*)(?:com|net|org|au|io|co|app|xyz|me|info|biz|link|ly|gg|tv|to|site|online|shop|store|dev|page|club|live)\b)/iu;
// Emails and @handles are contact details, which a display name shouldn't carry.
const AT_SIGN = /[@＠]/u;
// Names only Sheltüh itself may appear as. Compared on a folded form (see fold()).
const RESERVED_SUBSTRINGS = ["sheltuh"];
const RESERVED_WORDS = new Set(["admin", "administrator", "support", "moderator"]);

/** Lower-cased, accents stripped (so "Sheltüh" → "sheltuh"). */
function fold(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
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
  if (INVISIBLE_OR_CONTROL.test(value)) {
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
  if (AT_SIGN.test(name) || LINK.test(name)) {
    errors[field] = "Display names can't include links, email addresses or @handles.";
    return "";
  }
  const folded = fold(name);
  const compact = folded.replace(/[^\p{L}\p{N}]/gu, "");
  const words = folded.split(/[^\p{L}\p{N}]+/u);
  if (RESERVED_SUBSTRINGS.some((r) => compact.includes(r)) || words.some((w) => RESERVED_WORDS.has(w))) {
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
