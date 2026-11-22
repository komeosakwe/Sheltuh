import { containsEmailAddress, containsWebAddress } from "@/lib/contact-detail";
import { normaliseMessage, validateMessage } from "@/lib/message-text";

/**
 * "Before you go": the organiser's short plain-text note for people going to
 * their event ("Doors open 5:00 pm · last entry 8:00 pm."), shown in a box in
 * the ticket email, the reminder, the free-ticket confirmation and on the
 * buyer's ticket page (docs/architecture.md, "Before you go"). Shared by the
 * API (lib/server/event-input.ts parseBeforeYouGo, the source of truth) and
 * the editor, so the limits and the cleaning can't drift. The database holds
 * the same limits (events_before_you_go_check).
 */

/** The box's heading wherever the note is shown. */
export const BEFORE_YOU_GO_TITLE = "Before you go";
/** Most characters (code points, as the database's char_length counts them), after cleaning. */
export const BEFORE_YOU_GO_MAX_LENGTH = 500;
/** Most lines of text; a blank line between two lines doesn't count. */
export const BEFORE_YOU_GO_MAX_LINES = 5;

/** The field's name in error messages. */
const LABEL = "“Before you go”";

export const BEFORE_YOU_GO_TOO_MANY_LINES = `Keep it to ${BEFORE_YOU_GO_MAX_LINES} lines or fewer.`;
export const BEFORE_YOU_GO_NO_LINKS = `${LABEL} can't include links or web addresses.`;
export const BEFORE_YOU_GO_NO_EMAILS = `${LABEL} can't include email addresses.`;

/**
 * The text as the API stores it (lib/message-text.ts normaliseMessage: NFC,
 * \n line endings, no trailing spaces on a line, at most one blank line in a
 * row, trimmed), or null when that leaves nothing: a blank note is no note.
 */
export function normaliseBeforeYouGo(value: string): string | null {
  return normaliseMessage(value) || null;
}

/**
 * A stored note's lines of text, in order, without the blank lines between
 * them: what a display lists, and what BEFORE_YOU_GO_MAX_LINES counts (the
 * database counts the same way: the parts between runs of line breaks).
 */
export function beforeYouGoLines(text: string): string[] {
  return text.split(/\n+/).filter((line) => line.length > 0);
}

/**
 * The editor's check before a round trip: the error to show, or null when
 * the API will take it (blank included: it clears the note). The API checks
 * everything again (stacked marks too) and its field error is always shown.
 */
export function validateBeforeYouGo(value: string): string | null {
  const basic = validateMessage(value, { label: LABEL, optional: true, max: BEFORE_YOU_GO_MAX_LENGTH });
  if (basic) return basic;
  const text = normaliseBeforeYouGo(value);
  if (!text) return null;
  if (beforeYouGoLines(text).length > BEFORE_YOU_GO_MAX_LINES) return BEFORE_YOU_GO_TOO_MANY_LINES;
  if (containsWebAddress(text)) return BEFORE_YOU_GO_NO_LINKS;
  if (containsEmailAddress(text)) return BEFORE_YOU_GO_NO_EMAILS;
  return null;
}
