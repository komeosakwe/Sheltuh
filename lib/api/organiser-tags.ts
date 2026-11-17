import { mixesScripts, skeleton } from "@/lib/lookalikes";
import type { EventCategory } from "@/lib/types";

/**
 * An organiser's profile categories (docs/architecture.md, "Organiser
 * profiles", "Categories"): up to MAX_PROFILE_TAGS chips on their public
 * profile, chosen from ORGANISER_TAGS, of which up to MAX_CUSTOM_TAGS may be
 * their own words. Not the reviewed event categories (`organisers.categories`,
 * fixed at approval): those only fill in the chips until the organiser chooses
 * (tagsForEventCategories).
 *
 * Shared by the API, which decides (lib/server/handlers/organiser-tags.ts),
 * and the dashboard form, which checks as the organiser types with the same
 * rules. The database re-checks the counts, the list and a structural
 * deny-list of characters
 * (supabase/migrations/20261128000100_organiser_tags.sql); the slugs here
 * must match its organisers_profile_tags_check.
 */

/** The list, in the order it's shown (and stored). */
export const ORGANISER_TAGS = [
  { value: "live-music", label: "Live music" },
  { value: "dj-club-nights", label: "DJ & club nights" },
  { value: "festivals", label: "Festivals" },
  { value: "art", label: "Art" },
  { value: "exhibitions", label: "Exhibitions" },
  { value: "theatre", label: "Theatre" },
  { value: "comedy", label: "Comedy" },
  { value: "dance", label: "Dance" },
  { value: "film", label: "Film" },
  { value: "fashion", label: "Fashion" },
  { value: "photography", label: "Photography" },
  { value: "design", label: "Design" },
  { value: "poetry-spoken-word", label: "Poetry & spoken word" },
  { value: "workshops", label: "Workshops" },
  { value: "pop-ups-markets", label: "Pop-ups & markets" },
  { value: "food-drink", label: "Food & drink" },
  { value: "wellness", label: "Wellness" },
  { value: "community", label: "Community" },
] as const;

export type OrganiserTag = (typeof ORGANISER_TAGS)[number]["value"];

/** Most chips in all (list items and own words together). */
export const MAX_PROFILE_TAGS = 5;
/** Most of those that are the organiser's own words. */
export const MAX_CUSTOM_TAGS = 2;
/** An own word's length, in characters (code points, like Postgres char_length). */
export const CUSTOM_TAG_MIN_LENGTH = 2;
export const CUSTOM_TAG_MAX_LENGTH = 24;
/** Most digits in an own word (so it can't carry a phone number). */
export const CUSTOM_TAG_MAX_DIGITS = 4;

const TAG_ORDER = new Map<string, number>(ORGANISER_TAGS.map((t, i) => [t.value, i]));
const TAG_LABELS = new Map<string, string>(ORGANISER_TAGS.map((t) => [t.value, t.label]));

export function isOrganiserTag(value: unknown): value is OrganiserTag {
  return typeof value === "string" && TAG_ORDER.has(value);
}

/** The label of a list item ("Live music"); a value that isn't one (only possible past the type) as it is. */
export function organiserTagLabel(tag: OrganiserTag): string {
  return TAG_LABELS.get(tag) ?? tag;
}

/** A list item's place in the list; a value that isn't one (only possible past the type) after them all. */
function tagPosition(tag: OrganiserTag): number {
  return TAG_ORDER.get(tag) ?? ORGANISER_TAGS.length;
}

/** List items without duplicates, in list order. */
export function inTagOrder(tags: readonly OrganiserTag[]): OrganiserTag[] {
  return [...new Set(tags)].sort((a, b) => tagPosition(a) - tagPosition(b));
}

/** Each reviewed event category's list item. */
const FROM_EVENT_CATEGORY: Record<EventCategory, OrganiserTag> = {
  "live-music": "live-music",
  art: "art",
  workshop: "workshops",
  "pop-up": "pop-ups-markets",
  theatre: "theatre",
};

/**
 * The chips an organiser who hasn't chosen any shows: their reviewed event
 * categories as list items, in list order. Unknown values are skipped.
 */
export function tagsForEventCategories(categories: readonly string[]): OrganiserTag[] {
  const tags = categories.flatMap((c) => (Object.hasOwn(FROM_EVENT_CATEGORY, c) ? [FROM_EVENT_CATEGORY[c as EventCategory]] : []));
  return inTagOrder(tags).slice(0, MAX_PROFILE_TAGS);
}

/**
 * Words that claim a status only Sheltüh (or nobody) can give, refused in an
 * organiser's own words: endorsement, verification, partnership, ranking or
 * availability ("Official", "Verified", "Sold out", "Sheltüh partner").
 * Compared on the lookalike skeleton (skeleton(), lib/lookalikes.ts: case,
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
 * `value` folded for comparison: compatibility forms decomposed (NFKD),
 * marks dropped, lower case, the curly apostrophe as a straight one.
 */
function fold(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\u2019/g, "'");
}

/** `value`'s letters and digits only, folded: how two own words, or an own word and a label, are compared. */
export function customTagKey(value: string): string {
  return fold(value).replace(/[^\p{L}\p{N}]/gu, "");
}

const LABEL_KEYS = new Set(ORGANISER_TAGS.map((t) => customTagKey(t.label)));

/**
 * Contains a claim word: a run of whole words that, joined, is one of
 * CLAIM_WORDS on the skeleton. A lower-case letter followed by a capital
 * starts a new word ("OfficialVenue", and "OfficiaI" with a capital I).
 * Contains "sheltuh" anywhere, spaces and punctuation ignored.
 */
function makesAClaim(value: string): boolean {
  if (skeleton(value.replace(/[^\p{L}\p{N}]/gu, "")).includes(RESERVED_SUBSTRING)) return true;
  const words = value
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  // Own words are at most CUSTOM_TAG_MAX_LENGTH characters, so this is at most a few hundred short strings.
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let j = i; j < words.length; j++) {
      joined += words[j];
      if (CLAIM_SKELETONS.has(skeleton(joined))) return true;
    }
  }
  return false;
}

// Characters nobody types on purpose in a word: control characters, every
// invisible "format" character (zero-width spaces and joiners, bidi controls,
// soft hyphen, BOM, tags), the line and paragraph separators, and everything
// else Unicode says renders as nothing (Default_Ignorable_Code_Point: the
// Hangul fillers, the combining grapheme joiner, the Khmer inherent vowels,
// the Mongolian variation selectors...), as display names
// (lib/server/profile-input.ts). The variation selectors, which are also
// default-ignorable, are left to EMOJI below, for its message.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|(?![\uFE00-\uFE0F\u{E0100}-\u{E01EF}])\p{Default_Ignorable_Code_Point}/u;
// Emoji and the pieces emoji sequences are built from: pictographs, the
// variation selectors (VS16 turns a letter or digit into an emoji), and the
// enclosing marks (the keycap U+20E3 turns "1" into an emoji).
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\p{Me}]/u;
// What a link or a handle needs (any width: fullwidth and ideographic forms too).
const LINK_LIKE = /[.:/\\\u3002\uFF0E\uFF61\uFF0F\uFF1A\uFF3C\u2024\uFE52]/u;
const HANDLE_LIKE = /[@#\uFF20\uFF03\uFE6B\uFE5F]/u;
/** Everything an own word may be made of. Marks are checked separately (they must follow a letter, and not be SYMBOL_MARKS). */
const ALLOWED = /^[\p{L}\p{M}\p{Nd} &'\u2019-]+$/u;
/** Combining marks for symbols (arrows, circles, the keycap): they go on symbols, not letters. */
const SYMBOL_MARKS = /[\u20D0-\u20FF]/u;
/** Whitespace folded to a single space: spaces of any width, tabs and line breaks. */
const SPACES = /[\p{Zs}\t\n\r]+/gu;
/** The most combining marks in a row (one letter with an accent and a tone mark, say). */
const MAX_MARKS_IN_A_ROW = 2;

export type CustomTagResult = { ok: true; value: string } | { ok: false; error: string };

/** True if a combining mark starts the word, follows something other than a letter, or more than MAX_MARKS_IN_A_ROW stack up. */
function misplacedMarks(value: string): boolean {
  let run = 0;
  let afterLetter = false;
  for (const char of value) {
    if (/\p{M}/u.test(char)) {
      run += 1;
      if (!afterLetter || run > MAX_MARKS_IN_A_ROW) return true;
    } else {
      run = 0;
      afterLetter = /\p{L}/u.test(char);
    }
  }
  return false;
}

/** An own word as it's read and stored: NFC, spaces of any kind folded to one, trimmed. */
export function cleanCustomTag(raw: string): string {
  return raw.normalize("NFC").replace(SPACES, " ").trim();
}

/**
 * One own word, as the organiser typed it: cleaned (cleanCustomTag) and
 * checked. Allowed: letters (any script), digits
 * (at most CUSTOM_TAG_MAX_DIGITS), single spaces and & ' ’ -, with combining
 * marks only on a letter; CUSTOM_TAG_MIN_LENGTH to CUSTOM_TAG_MAX_LENGTH
 * characters, at least one a letter; no word mixing Latin, Cyrillic and
 * Greek letters; no claim words (CLAIM_WORDS). Refused
 * with a message to show next to the field otherwise. Whether it repeats
 * another own word or a list label is the caller's check (customTagKey).
 */
export function parseCustomTag(raw: unknown): CustomTagResult {
  if (typeof raw !== "string") return { ok: false, error: "Type a word or two." };
  // Before any regex runs on it.
  if (raw.length > CUSTOM_TAG_MAX_LENGTH * 4) return { ok: false, error: `Use ${CUSTOM_TAG_MAX_LENGTH} characters or fewer.` };
  const value = cleanCustomTag(raw);
  if (!value) return { ok: false, error: "Type a word or two." };
  if (INVISIBLE.test(value)) return { ok: false, error: "Remove the hidden characters." };
  if (EMOJI.test(value)) return { ok: false, error: "Emoji can't be used here." };
  if (LINK_LIKE.test(value)) return { ok: false, error: "Links can't be used here." };
  if (HANDLE_LIKE.test(value)) return { ok: false, error: "@ and # can't be used here." };
  if (!ALLOWED.test(value) || SYMBOL_MARKS.test(value) || misplacedMarks(value)) {
    return { ok: false, error: "Use letters, numbers, spaces, & ' and - only." };
  }
  const length = Array.from(value).length;
  if (length < CUSTOM_TAG_MIN_LENGTH) return { ok: false, error: `Use at least ${CUSTOM_TAG_MIN_LENGTH} characters.` };
  if (length > CUSTOM_TAG_MAX_LENGTH) return { ok: false, error: `Use ${CUSTOM_TAG_MAX_LENGTH} characters or fewer.` };
  if (!/\p{L}/u.test(value)) return { ok: false, error: "Include at least one letter." };
  if ((value.match(/\p{Nd}/gu)?.length ?? 0) > CUSTOM_TAG_MAX_DIGITS) {
    return { ok: false, error: `Use ${CUSTOM_TAG_MAX_DIGITS} digits or fewer.` };
  }
  if (mixesScripts(value)) return { ok: false, error: "Don't mix Latin, Cyrillic or Greek letters in one word." };
  if (makesAClaim(value)) return { ok: false, error: "That word makes a claim we can't check. Try another." };
  return { ok: true, value };
}

/**
 * The API's words for the checks across the whole set (parseOrganiserTags in
 * lib/server/handlers/organiser-tags.ts), here so the dashboard form says
 * exactly the same as it checks while the organiser types.
 */
export const TAG_SET_ERRORS = {
  /** An own word repeating an earlier one (compared by customTagKey). */
  duplicate: "You've already added this one.",
  /** An own word that's one of the list's labels (isTagLabel). */
  isLabel: "That's in the list: choose it there instead.",
  /** More than MAX_PROFILE_TAGS chips in all. */
  tooMany: `Choose up to ${MAX_PROFILE_TAGS} in all, your own words included.`,
} as const;

/** Whether an own word (already parsed) is one of the list's labels ("Live music"): choose that from the list instead. */
export function isTagLabel(value: string): boolean {
  return LABEL_KEYS.has(customTagKey(value));
}
