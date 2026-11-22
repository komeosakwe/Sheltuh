import { containsEmailAddress, containsWebAddress } from "@/lib/contact-detail";

/**
 * "Before you go": the organiser's short rows for people going to their event,
 * a label and a value each ("Entry": "7:30 pm – 10:30 pm", "Age": "18+ · Photo
 * ID required"), shown on the event page and for the ticket email, the
 * reminder, the free-ticket confirmation and the buyer's ticket page
 * (docs/architecture.md, "Before you go"). Shared by the API
 * (lib/server/event-input.ts parseBeforeYouGo, the source of truth) and the
 * editor, so the limits and the cleaning can't drift. The database holds the
 * same limits (events_before_you_go_check, private.before_you_go_ok).
 */

/** One row: a short label (shown uppercase, stored as typed) and its value. Plain text, one line each. */
export interface BeforeYouGoItem {
  label: string;
  value: string;
}

/** The section's heading wherever the rows are shown. */
export const BEFORE_YOU_GO_TITLE = "Before you go";
/** Most rows, after blank ones are dropped. */
export const BEFORE_YOU_GO_MAX_ITEMS = 5;
/** Most characters in a label (code points after NFC, as the database's char_length counts them), once cleaned. */
export const BEFORE_YOU_GO_LABEL_MAX_LENGTH = 20;
/** Most characters in a value (code points after NFC), once cleaned. */
export const BEFORE_YOU_GO_VALUE_MAX_LENGTH = 80;
/** The labels the editor offers (the owner's reference); any label is accepted. */
export const BEFORE_YOU_GO_SUGGESTED_LABELS = ["Entry", "Age", "Extras"] as const;

/**
 * Longer raw lists than this are refused before any row is looked at, and a
 * part's raw text longer than 4 × its limit (UTF-16 units) before any
 * cleaning or pattern runs on it: every check stays cheap however much is sent.
 */
export const BEFORE_YOU_GO_MAX_RAW_ITEMS = BEFORE_YOU_GO_MAX_ITEMS * 4;
const RAW_FACTOR = 4;

export const BEFORE_YOU_GO_TOO_MANY = `Keep it to ${BEFORE_YOU_GO_MAX_ITEMS} rows or fewer.`;

/** A row's part, as the messages name it. */
export type BeforeYouGoPart = "label" | "value";

const MAX_LENGTH: Record<BeforeYouGoPart, number> = {
  label: BEFORE_YOU_GO_LABEL_MAX_LENGTH,
  value: BEFORE_YOU_GO_VALUE_MAX_LENGTH,
};

// The messages. Rows are numbered from 1, in the order given (blank rows included, so "Row 2" is the second on screen).
export const beforeYouGoHalfFilled = (row: number) => `Row ${row} needs a label and a value.`;
export const beforeYouGoTooLong = (row: number, part: BeforeYouGoPart) =>
  `Row ${row}'s ${part} must be ${MAX_LENGTH[part]} characters or fewer.`;
export const beforeYouGoNoLinks = (row: number, part: BeforeYouGoPart) =>
  `Row ${row}'s ${part} can't include links or web addresses.`;
export const beforeYouGoNoEmails = (row: number, part: BeforeYouGoPart) =>
  `Row ${row}'s ${part} can't include email addresses.`;
export const beforeYouGoHidden = (row: number, part: BeforeYouGoPart) =>
  `Row ${row}'s ${part} can't contain control, invisible or text-direction characters.`;
export const beforeYouGoStackedMarks = (row: number, part: BeforeYouGoPart) =>
  `Row ${row}'s ${part} can't stack accents or other marks on one character.`;

// Checked on the raw text, before cleaning. Every control character (C0 and
// C1, U+0085 included) but tab, CR and LF, which are whitespace here and
// collapse to a space; every invisible "format" character (\p{Cf}: zero-width
// spaces, bidi overrides, isolates and marks, soft hyphens, BOM, word joiner)
// but the zero-width (non-)joiners emoji and several scripts need; and the
// line/paragraph separators (U+2028, U+2029). The database refuses the
// controls and separators too (private.before_you_go_text_ok).
const DISALLOWED = /(?![\n\r\t])\p{Cc}|(?![\u200C\u200D])\p{Cf}|[\u2028\u2029]/u;
// Emoji tag sequences (the flags of England, Scotland and Wales): the one legitimate use of tag characters.
const EMOJI_TAG_SEQUENCE = /\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,8}\u{E007F}/gu;
// Something visible: a letter, number, punctuation mark or symbol (emoji are symbols).
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * One label or value as the API stores it: Unicode NFC, every run of
 * whitespace (line breaks and tabs included) collapsed to one space, trimmed.
 * Linear in the length of `text`.
 */
export function cleanBeforeYouGoText(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** Blank once cleaned: nothing visible (only spaces, joiners or lone marks). */
function isBlank(cleaned: string): boolean {
  return !VISIBLE.test(cleaned);
}

/**
 * The rows as the API stores them: each label and value cleaned
 * (cleanBeforeYouGoText), rows with both blank dropped, in order; null when
 * none is left (no rows is stored as null). Doesn't check anything:
 * validateBeforeYouGo does.
 */
export function normaliseBeforeYouGo(items: readonly BeforeYouGoItem[] | null | undefined): BeforeYouGoItem[] | null {
  if (!items) return null;
  const kept = items
    .map((item) => ({ label: cleanBeforeYouGoText(item.label), value: cleanBeforeYouGoText(item.value) }))
    .filter((item) => !(isBlank(item.label) && isBlank(item.value)));
  return kept.length > 0 ? kept : null;
}

/** A row's errors, by part. */
export interface BeforeYouGoRowError {
  label?: string;
  value?: string;
}

/** What validateBeforeYouGo finds. */
export interface BeforeYouGoErrors {
  /** One entry per row given, at the same index: null for a row that's fine (a blank one included: it's dropped). */
  rows: (BeforeYouGoRowError | null)[];
  /** The list's own error: more than BEFORE_YOU_GO_MAX_ITEMS rows once blank ones are dropped. */
  list: string | null;
  /** The first error, the list's before any row's: what the API's fieldErrors.beforeYouGo says. */
  message: string;
}

/** Extra checks only the API runs (lib/server/event-input.ts passes its stacked-marks check). */
export interface BeforeYouGoCheckOptions {
  tooManyMarks?: (text: string) => boolean;
}

/** One part as checked: its cleaned text (null when refused before cleaning) and its error. */
function checkPart(
  raw: string,
  row: number,
  part: BeforeYouGoPart,
  options: BeforeYouGoCheckOptions,
): { blank: boolean; error: string | null } {
  // Before any cleaning or pattern runs on it.
  if (raw.length > MAX_LENGTH[part] * RAW_FACTOR) return { blank: false, error: beforeYouGoTooLong(row, part) };
  // Refused even in a part that would otherwise be blank ("\u200B").
  if (DISALLOWED.test(raw.replace(EMOJI_TAG_SEQUENCE, ""))) return { blank: false, error: beforeYouGoHidden(row, part) };
  const text = cleanBeforeYouGoText(raw);
  if (isBlank(text)) return { blank: true, error: null };
  // Code points after NFC, as char_length counts the stored text (NFC can lengthen it: U+0958 is two).
  if (Array.from(text).length > MAX_LENGTH[part]) return { blank: false, error: beforeYouGoTooLong(row, part) };
  if (options.tooManyMarks?.(text)) return { blank: false, error: beforeYouGoStackedMarks(row, part) };
  // lib/contact-detail.ts folds the text itself (NFKC: fullwidth letters and dots, ideographic full stops,
  // invisible characters) and undoes the usual disguises ("[.]", " dot ", "(at)"); only for checking.
  if (containsWebAddress(text)) return { blank: false, error: beforeYouGoNoLinks(row, part) };
  if (containsEmailAddress(text)) return { blank: false, error: beforeYouGoNoEmails(row, part) };
  return { blank: false, error: null };
}

/**
 * Checks the rows as typed: each label and value (1 to
 * BEFORE_YOU_GO_LABEL_MAX_LENGTH / BEFORE_YOU_GO_VALUE_MAX_LENGTH characters
 * once cleaned; no control, invisible or text-direction characters; no links,
 * web or email addresses), a row with only one of the two refused
 * (beforeYouGoHalfFilled), at most BEFORE_YOU_GO_MAX_ITEMS rows that aren't
 * blank. Null when the API will take them (no rows included: that clears
 * them). The API checks everything again (stacked marks too) and its field
 * error is always shown.
 */
export function validateBeforeYouGo(
  items: readonly BeforeYouGoItem[],
  options: BeforeYouGoCheckOptions = {},
): BeforeYouGoErrors | null {
  if (items.length > BEFORE_YOU_GO_MAX_RAW_ITEMS) {
    return { rows: items.map(() => null), list: BEFORE_YOU_GO_TOO_MANY, message: BEFORE_YOU_GO_TOO_MANY };
  }
  let filled = 0;
  let first: string | null = null;
  const rows = items.map((item, index): BeforeYouGoRowError | null => {
    const row = index + 1;
    const label = checkPart(item.label, row, "label", options);
    const value = checkPart(item.value, row, "value", options);
    if (label.blank && value.blank) return null;
    filled++;
    const errors: BeforeYouGoRowError = {};
    if (label.error) errors.label = label.error;
    if (value.error) errors.value = value.error;
    if (label.blank) errors.label = beforeYouGoHalfFilled(row);
    if (value.blank) errors.value = beforeYouGoHalfFilled(row);
    const rowFirst = errors.label ?? errors.value;
    if (!rowFirst) return null;
    first ??= rowFirst;
    return errors;
  });
  const list = filled > BEFORE_YOU_GO_MAX_ITEMS ? BEFORE_YOU_GO_TOO_MANY : null;
  const message = list ?? first;
  return message ? { rows, list, message } : null;
}
