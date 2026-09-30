/** Mirrors the API's limit (lib/server/profile-input.ts), counted in code points. */
export const DISPLAY_NAME_MAX = 40;

// The cheap subset of the API's rules (lib/server/profile-input.ts), so the
// common mistakes are caught before a round trip. The API applies the rest
// (links, handles, stacked marks, mixed scripts, reserved names) and its
// field error is always shown.
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// Renders as nothing, except the emoji presentation selectors (U+FE0E/FE0F),
// plus the blank Braille pattern, which looks like a space.
const INVISIBLE = /(?![︎️])\p{Default_Ignorable_Code_Point}|⠀/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

/** The name as the API stores it: NFC, runs of spaces collapsed, trimmed. */
export function normaliseDisplayName(value: string): string {
  return value.normalize("NFC").replace(/\p{Zs}+/gu, " ").trim();
}

/** Length as the API counts it: code points, after normalising. */
export function displayNameLength(value: string): number {
  return Array.from(normaliseDisplayName(value)).length;
}

/** Client-side check before saving a display name; the API's own field error wins. */
export function validateDisplayName(value: string): string | null {
  if (INVISIBLE_OR_CONTROL.test(value) || INVISIBLE.test(value)) {
    return "Display names can't contain invisible or control characters.";
  }
  const length = displayNameLength(value);
  if (length === 0) return "Enter a display name.";
  if (length > DISPLAY_NAME_MAX) return `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.`;
  if (!LETTER_OR_NUMBER.test(value)) return "Display names need at least one letter or number.";
  return null;
}

/**
 * Ends a sentence that finishes with a display name, without doubling up the
 * name's own punctuation: "Show up as Mia." but "Show up as Mia T." (not "T..").
 */
export function endSentence(displayName: string): string {
  return /[.!?…]$/u.test(displayName) ? displayName : `${displayName}.`;
}
