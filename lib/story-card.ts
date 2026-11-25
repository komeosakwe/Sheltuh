import { eventZone, zoneSuffix } from "./format";
import { bareSuburb } from "./place";
import { cardText, cardVersion } from "./share-card";
import { daysUntilStart, soonLabel, type SoonFields, type SoonLabel } from "./soon";
import { ticketStubDate, ticketStubTime } from "./ticket-times";
import { localToUtcIso, wallClockParts } from "./time-zones";
import type { SheltuhEvent } from "./types";

/**
 * The "I’m going." story card (docs/design/story-card.md): the pure rules, browser-safe, so the
 * renderer (lib/server/story-card-render.tsx), the route and the share UI agree. Nothing here
 * reads an image or a clock of its own: `now` is always passed in.
 *
 * Naming: "share card" already means the 1200 × 630 link preview (lib/share-card.ts), so this is
 * the "story card" throughout, whether it's the story or the square post.
 */

export const STORY_CARD_FORMATS = ["story", "square"] as const;
export type StoryCardFormat = (typeof STORY_CARD_FORMATS)[number];

/** Instagram's story (9:16) and a feed post (1:1). */
export const STORY_CARD_SIZES: Readonly<Record<StoryCardFormat, { width: number; height: number }>> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

/** Bump with any change to how a card looks, so every cached card is made again (part of storyCardVersion). */
export const STORY_CARD_RENDERER_VERSION = "1";

export function isStoryCardFormat(value: unknown): value is StoryCardFormat {
  return typeof value === "string" && (STORY_CARD_FORMATS as readonly string[]).includes(value);
}

/** The card's address: a page-level path (not /api, which the demo can't call) with no image extension (public/sw.js would cache it). */
export function storyCardPath(slug: string, format: StoryCardFormat): string {
  return `/events/${encodeURIComponent(slug)}/story-card?format=${format}`;
}

/** The file name a saved or shared card gets: "sheltuh-neon-static-story.jpg". */
export function storyCardFileName(slug: string, format: StoryCardFormat): string {
  return `sheltuh-${slug}-${format}.jpg`;
}

// ---------------------------------------------------------------- The tag

export type StoryCardTag = SoonLabel | `In ${number} days`;

/**
 * The card's tag, in the event's own zone by calendar date (safe across daylight saving):
 * soonLabel's "On now", "Tonight" (5:00 pm or later today), "Today" (before 5:00 pm) and
 * "Tomorrow", then "In N days" for N ≥ 2. Null once the event has ended, or for a time that
 * can't be read: no card. The owner's round-4 wording said "Tonight" for any same-day start;
 * the card follows the site's soon tag so the two never disagree (design D3).
 */
export function storyCardTag(event: SoonFields, now: Date): StoryCardTag | null {
  const soon = soonLabel(event, now);
  if (soon) return soon;
  const start = Date.parse(event.startsAt);
  const end = event.endsAt ? Date.parse(event.endsAt) : start;
  if (!Number.isFinite(end) || end <= now.getTime()) return null;
  const days = daysUntilStart(event, now);
  return days !== null && days >= 2 ? `In ${days} days` : null;
}

/** Whether a card can be made for the event at `now` (it hasn't ended, and its times can be read). */
export function storyCardAvailable(event: SoonFields, now: Date): boolean {
  return storyCardTag(event, now) !== null;
}

/** The longest a shared copy of a card may be kept, in seconds. */
export const STORY_CARD_MAX_FRESH_SECONDS = 3600;

/**
 * How long the card made at `now` stays right, in whole seconds: until the tag can next change
 * (the next midnight in the event's zone, the start, the end), and at most an hour so a takedown
 * or an admin's edit shows within that. Never below 1.
 */
export function storyCardFreshSeconds(event: SoonFields, now: Date): number {
  const nowMs = now.getTime();
  const limits = [STORY_CARD_MAX_FRESH_SECONDS * 1000];
  const zone = eventZone(event.timeZone);
  if (Number.isFinite(nowMs)) {
    const today = wallClockParts(now, zone).date;
    const [year, month, day] = today.split("-").map(Number);
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    limits.push(Date.parse(localToUtcIso(tomorrow, "00:00", zone)) - nowMs);
  }
  for (const iso of [event.startsAt, event.endsAt]) {
    const at = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(at) && at > nowMs) limits.push(at - nowMs);
  }
  return Math.max(1, Math.ceil(Math.min(...limits) / 1000));
}

/**
 * The clock the demo's cards read. The sample events have fixed dates (lib/sample-events.ts),
 * mostly past, so a demo card is drawn as if it were 3 days before the start ("In 3 days") rather
 * than refused. The real clock when that's earlier, or when the start can't be read.
 */
export function demoCardNow(event: Pick<SoonFields, "startsAt">, realNow: Date): Date {
  const start = Date.parse(event.startsAt);
  if (!Number.isFinite(start)) return realNow;
  return new Date(Math.min(realNow.getTime(), start - 3 * 24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------- Text

/** Title characters kept (cardText cuts at a word, with an ellipsis). */
export const STORY_CARD_TITLE_MAX = 80;

/**
 * Pictographic emoji and the characters that join or style them (ZWJ, VS16, the keycap, tag
 * characters). ©, ® and ™ are "pictographic" to Unicode but are ordinary text in our font, so they
 * stay.
 */
const EMOJI = /(?![©®™])[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{200D}\u{FE0F}\u{20E3}\u{E0020}-\u{E007F}]/gu;

/** The text without emoji, with the spaces they leave collapsed (possibly empty). */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI, " ").replace(/\s+/g, " ").trim();
}

/**
 * The code points every weight of the card's font draws (app/fonts/og/InstrumentSans-*.ttf, read
 * from their cmap; tests/server/story-card-render.test.ts checks this against the files). Anything
 * else would make next/og fetch a fallback face from Google Fonts, or an emoji from a CDN, while
 * the card renders: with no timeout, and with failures cached. So nothing else reaches it.
 */
const FONT_COVERAGE: readonly (readonly [number, number])[] = [
  [0x0020, 0x007e], [0x00a0, 0x00a3], [0x00a5, 0x00a5], [0x00a7, 0x00ab], [0x00ae, 0x00b0], [0x00b4, 0x00b4],
  [0x00b6, 0x00b8], [0x00ba, 0x00bb], [0x00bf, 0x0107], [0x010a, 0x0113], [0x0116, 0x011b], [0x011e, 0x0123],
  [0x0126, 0x0127], [0x012a, 0x012b], [0x012e, 0x0133], [0x0136, 0x0137], [0x0139, 0x013e], [0x0141, 0x0148],
  [0x014a, 0x014d], [0x0150, 0x015b], [0x015e, 0x0161], [0x0164, 0x0165], [0x016a, 0x017e], [0x01cd, 0x01ce],
  [0x0218, 0x021b], [0x0237, 0x0237], [0x02c6, 0x02c7], [0x02d8, 0x02dd], [0x0300, 0x0304], [0x0306, 0x0308],
  [0x030a, 0x030c], [0x0312, 0x0312], [0x0326, 0x0328], [0x1e80, 0x1e85], [0x1e9e, 0x1e9e], [0x1ef2, 0x1ef3],
  [0x2013, 0x2014], [0x2018, 0x201a], [0x201c, 0x201e], [0x2022, 0x2022], [0x2026, 0x2026], [0x2030, 0x2030],
  [0x2039, 0x203a], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2190, 0x2199], [0x2212, 0x2212],
];

/** Whether the card's font draws a code point. */
export function inStoryCardFont(codePoint: number): boolean {
  return FONT_COVERAGE.some(([from, to]) => codePoint >= from && codePoint <= to);
}

/** Whether the font draws every character of a piece of text, and of its capitals (the title is set uppercase). */
const drawable = (text: string) => [...text, ...text.toUpperCase()].every((char) => inStoryCardFont(char.codePointAt(0) ?? 0));

const segmenter = () => new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * The text as the card's font can draw it, so rendering never reaches the network: each character
 * the font has is kept; one it lacks loses its accents if the bare letter is there ("Ĉ" → "C",
 * "ŧ" stays out); anything else (emoji, other scripts, symbols) is dropped, a space becoming a
 * plain space. The spaces left are collapsed. Possibly empty.
 */
export function fitToStoryCardFont(text: string): string {
  let out = "";
  for (const { segment } of segmenter().segment(text.normalize("NFC"))) {
    if (/^\s+$/u.test(segment)) out += " ";
    else if (drawable(segment)) out += segment;
    else {
      const bare = segment.normalize("NFD").replace(/\p{M}/gu, "");
      if (bare && drawable(bare)) out += bare;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Text for the card: emoji removed, then fitted to the font. */
const cardSafe = (text: string) => fitToStoryCardFont(stripEmoji(text));

/** The title of an event whose title has nothing the card can draw (all emoji, or another script). */
export const STORY_CARD_FALLBACK_TITLE = "Event";

export interface StoryCardText {
  /** As written (the card uppercases it in the drawing): emoji removed, fitted to the font, at most 80 characters. */
  title: string;
  /** "Sat 14 Nov". */
  date: string;
  /** "5–9 pm", "8 pm Perth time". */
  time: string;
  /** "Interconnect Studio, Coburg North", or "" for neither. */
  place: string;
}

export type StoryCardEventFields = Pick<SheltuhEvent, "title" | "startsAt" | "endsAt" | "timeZone" | "state" | "venueName" | "suburb">;

/**
 * The card's words, every one drawable by the card's font (fitToStoryCardFont). Line 1 is the
 * ticket's date and time in the event's zone, with the zone named outside Melbourne's clock
 * ("8 pm Perth time"; never "Sydney time", as on the event pages). Line 2 is the venue and the bare
 * suburb, empty parts left out. A title with nothing drawable becomes the venue's name, or "Event".
 * Never a price.
 */
export function storyCardText(event: StoryCardEventFields): StoryCardText {
  const venue = cardSafe(event.venueName);
  const title = cardSafe(event.title) || venue || STORY_CARD_FALLBACK_TITLE;
  return {
    title: cardText(title, STORY_CARD_TITLE_MAX),
    date: fitToStoryCardFont(ticketStubDate(event.startsAt, event.timeZone)),
    time: fitToStoryCardFont(
      `${ticketStubTime(event.startsAt, event.endsAt, event.timeZone)}${zoneSuffix(event.timeZone, event.state, event.startsAt)}`,
    ),
    place: [venue, cardSafe(bareSuburb(event.suburb, event.state))].filter(Boolean).join(", "),
  };
}

/** Characters as a reader counts them (an accented letter or a flag is one). */
function graphemes(text: string): number {
  return [...segmenter().segment(text)].length;
}

/** Title size steps by length (design §4.2): the largest size a title of that many characters gets. */
const TITLE_STEPS: Readonly<Record<StoryCardFormat, readonly (readonly [maxChars: number, size: number])[]>> = {
  story: [
    [30, 128],
    [45, 112],
    [60, 96],
    [Infinity, 80],
  ],
  square: [
    [30, 104],
    [45, 92],
    [60, 80],
    [Infinity, 68],
  ],
};

/**
 * Every size a title may take, largest first: the steps, then two smaller ones for long titles of
 * long words, which the steps alone would leave to the line clamp (cut mid-word, with uneven gaps).
 */
const TITLE_SIZES: Readonly<Record<StoryCardFormat, readonly number[]>> = {
  story: [128, 112, 96, 80, 72, 64],
  square: [104, 92, 80, 68, 60, 56, 52, 48],
};

/** The title's width: the card less its side margins. */
const TITLE_WIDTH: Readonly<Record<StoryCardFormat, number>> = { story: 920, square: 960 };

/** The most lines a title takes before it ends in an ellipsis (the clamp: the safety net). */
export const STORY_CARD_TITLE_LINES: Readonly<Record<StoryCardFormat, number>> = { story: 4, square: 3 };

/**
 * Instrument Sans Bold's advance widths (per 1000 units of the size) for U+0020–U+007E, from the
 * font's hmtx (tests/server/story-card-render.test.ts checks them against the file). Kerning is
 * left out, which makes an estimate slightly wide: on the safe side.
 */
export const STORY_CARD_BOLD_ADVANCE = [
  190, 306, 482, 732, 652, 786, 774, 268, 456, 456, 441, 551, 285, 486, 285, 445, 682, 385, 563, 582, 622, 585, 623, 575, 606,
  624, 285, 285, 551, 551, 551, 587, 874, 736, 649, 750, 756, 626, 590, 763, 720, 254, 413, 722, 590, 894, 720, 798, 672, 815,
  668, 652, 672, 700, 736, 1086, 716, 712, 635, 456, 445, 456, 551, 486, 354, 571, 628, 562, 628, 574, 378, 628, 619, 270, 270,
  569, 270, 950, 619, 604, 628, 628, 398, 504, 421, 611, 543, 816, 605, 543, 522, 456, 230, 456, 551,
] as const;
/** A character outside the table (an accented capital takes its base letter's width; the rest, a wide letter's). */
const WIDE_ADVANCE = 800;
/** The title's tracking, in em. */
const TITLE_TRACKING = -0.04;
/** Room kept at the end of each line for what the estimate can't see (rasterising, rounding). */
const WRAP_SAFETY = 0.99;

function advance(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return STORY_CARD_BOLD_ADVANCE[code - 0x20];
  const base = char.normalize("NFD").codePointAt(0) ?? 0;
  return base >= 0x20 && base <= 0x7e ? STORY_CARD_BOLD_ADVANCE[base - 0x20] : WIDE_ADVANCE;
}

/** A run of text's width at `size` px, uppercase, with the title's tracking. */
function runWidth(text: string, size: number): number {
  let units = 0;
  let chars = 0;
  for (const char of text) {
    units += advance(char);
    chars += 1;
  }
  return (units / 1000) * size + chars * TITLE_TRACKING * size;
}

/**
 * About how many lines a title wraps to at `size` px in `width` px: uppercase, broken at spaces,
 * a word wider than the line broken inside it (as the card's `wordBreak: break-word`).
 */
export function estimateTitleLines(title: string, size: number, width: number): number {
  const room = width * WRAP_SAFETY;
  const space = runWidth(" ", size);
  let lines = 1;
  let used = 0;
  for (const word of title.toUpperCase().split(" ").filter(Boolean)) {
    const w = runWidth(word, size);
    if (used > 0 && used + space + w <= room) {
      used += space + w;
      continue;
    }
    if (used > 0) lines += 1;
    if (w > room) {
      lines += Math.ceil(w / room) - 1;
      used = w % room;
    } else {
      used = w;
    }
  }
  return lines;
}

/**
 * The title's font size in px: the step for its length (128 story or 104 square up to 30
 * characters, then 112/92, 96/80, 80/68), or smaller (down to 64/48) when its words wouldn't wrap
 * into the line clamp at that size, so a long title ends on a word, not cut by the clamp.
 */
export function storyCardTitleSize(title: string, format: StoryCardFormat): number {
  const length = graphemes(title);
  let largest = TITLE_SIZES[format][0];
  for (const [max, size] of TITLE_STEPS[format]) {
    if (length <= max) {
      largest = size;
      break;
    }
  }
  const sizes = TITLE_SIZES[format].filter((size) => size <= largest);
  for (const size of sizes) {
    if (estimateTitleLines(title, size, TITLE_WIDTH[format]) <= STORY_CARD_TITLE_LINES[format]) return size;
  }
  return sizes[sizes.length - 1];
}

// ---------------------------------------------------------------- Imagery rules

/** A photo that would have to be enlarged more than this to cover the card is drawn whole over a blurred copy of itself. */
export const BACKDROP_UPSCALE = 1.6;

/**
 * Whether a photo of w × h (after EXIF rotation) is drawn in backdrop mode: when covering the
 * card would enlarge it more than 1.6 times (strictly). False for a size that isn't one.
 */
export function backdropMode(width: number, height: number, format: StoryCardFormat): boolean {
  if (!(width >= 1) || !(height >= 1)) return false;
  const card = STORY_CARD_SIZES[format];
  return Math.max(card.width / width, card.height / height) > BACKDROP_UPSCALE;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface StoryCardTone {
  /** The fade and the background: the photo's hue, saturation at most 0.32, lightness 0.13. */
  tone: Rgb;
  /** Quiet text on the tone: the same hue, saturation at most 0.20, lightness 0.78. */
  light: Rgb;
}

/** The tone when a photo's colour can't be sampled (#151515, #cfcfcf). */
export const FALLBACK_TONE: StoryCardTone = { tone: { r: 21, g: 21, b: 21 }, light: { r: 207, g: 207, b: 207 } };

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const channel = (v: number) => Math.round((v + m) * 255);
  return { r: channel(r1), g: channel(g1), b: channel(b1) };
}

/**
 * The card's tones from the mean sRGB colour (0–255, gamma-encoded, as sampled) of the bottom
 * third of the photo's crop (design §3.2): keep the hue, cap the saturation, fix the lightness.
 * Fixing the lightness at 0.13 keeps white text on the tone at 14:1 or more for every hue.
 */
export function toneFromMean(r: number, g: number, b: number): StoryCardTone {
  if (![r, g, b].every(Number.isFinite)) return FALLBACK_TONE;
  const [rn, gn, bn] = [r, g, b].map((v) => Math.min(255, Math.max(0, v)) / 255);
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    h *= 60;
  }
  return { tone: hslToRgb(h, Math.min(s, 0.32), 0.13), light: hslToRgb(h, Math.min(s, 0.2), 0.78) };
}

/** "rgb(33, 33, 33)", or "rgba(33, 33, 33, 0.72)" with an alpha. */
export function rgbCss({ r, g, b }: Rgb, alpha?: number): string {
  return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------- Version

export interface StoryCardVersionInput {
  format: StoryCardFormat;
  text: StoryCardText;
  tag: StoryCardTag;
  /** The photo's own version (its `?v=`), or null for none. */
  imageVersion: string | null;
  focus: { x: number; y: number } | null;
}

/**
 * A short, stable version for a card from everything it shows (the ETag): the renderer, the
 * format, the words, the tag and the photo with its focus. Not the event's updated_at, which
 * changes for things the card doesn't show.
 */
export function storyCardVersion({ format, text, tag, imageVersion, focus }: StoryCardVersionInput): string {
  return cardVersion(
    STORY_CARD_RENDERER_VERSION,
    format,
    text.title,
    `${text.date} · ${text.time}`,
    text.place,
    tag,
    imageVersion ?? "",
    focus ? `${focus.x},${focus.y}` : "",
  );
}
