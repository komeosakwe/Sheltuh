/** Mirrors the API's limit (lib/server/message-input.ts), counted in code points. */
export const MESSAGE_MAX = 1000;

// The cheap subset of the API's rules (lib/server/message-input.ts), checked
// before a round trip. The API applies the rest (links in a first message,
// stacked marks) and its field error is always shown: it's the source of truth.
//
// Control characters other than line breaks and tab; every invisible "format"
// character (zero-width spaces, bidi overrides, isolates and marks, soft
// hyphens, BOM, word joiner...) except the zero-width (non-)joiners emoji and
// several scripts need; and the line/paragraph separators.
const DISALLOWED = /(?![\n\r\t])\p{Cc}|(?![\u200C\u200D])\p{Cf}|[\u2028\u2029]/u;
// Emoji tag sequences (the flags of England, Scotland and Wales) are the one
// legitimate use of tag characters: removed before the check above.
const EMOJI_TAG_SEQUENCE = /\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,8}\u{E007F}/gu;
// Something visible: a letter, number, punctuation mark or symbol (emoji are symbols).
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Longer raw input than this (UTF-16 units, before any cleaning) is refused
 * before any regex or normalisation runs on it, as the API does
 * (MAX_RAW_MESSAGE_LENGTH). Keeps every keystroke cheap however much is pasted.
 */
export const RAW_INPUT_CAP = MESSAGE_MAX * 4;

/** Drops trailing spaces and tabs from one line. A loop, not a regex: linear on any input. */
function trimLineEnd(line: string): string {
  let end = line.length;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end--;
  return end === line.length ? line : line.slice(0, end);
}

/**
 * The text as the API stores it: NFC, \n line endings, no trailing spaces on
 * a line, at most one blank line in a row, trimmed. Linear time: no
 * backtracking patterns (a regex like /[ \t]+\n/ is quadratic on a long run
 * of spaces).
 */
export function normaliseMessage(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(trimLineEnd)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Length as the API counts it: code points, after normalising (raw code points past RAW_INPUT_CAP). */
export function messageLength(value: string): number {
  if (value.length > RAW_INPUT_CAP) return Array.from(value).length;
  return Array.from(normaliseMessage(value)).length;
}

const TOO_LONG = `Keep it to ${MESSAGE_MAX.toLocaleString("en-AU")} characters or fewer.`;

/**
 * Client-side check before sending. `label` names the field in the control
 * character error ("Messages", "Details", "Notes"). `optional` allows blank.
 */
export function validateMessage(
  value: string,
  { label = "Messages", optional = false }: { label?: string; optional?: boolean } = {},
): string | null {
  if (value.length > RAW_INPUT_CAP) return TOO_LONG;
  if (DISALLOWED.test(value.replace(EMOJI_TAG_SEQUENCE, ""))) {
    return `${label} can't contain control, invisible or text-direction characters.`;
  }
  const text = normaliseMessage(value);
  if (!text) return optional ? null : "Write a message.";
  if (!VISIBLE.test(text)) return optional ? "Add some text, or leave this blank." : "Write a message.";
  if (Array.from(text).length > MESSAGE_MAX) return TOO_LONG;
  return null;
}
