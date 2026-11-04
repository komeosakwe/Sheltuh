import { formatEventDateShort, formatEventTime, zoneSuffix } from "./format";
import { eventPlaceName } from "./place";
import { plainExcerpt, type EventShareFields } from "./share-metadata";

/**
 * The text on the branded link-preview cards (app/events/[slug]/opengraph-image.tsx,
 * app/organisers/[organiserId]/opengraph-image.tsx): pure helpers, so they
 * are testable without rendering. The drawing is in lib/server/share-card-render.tsx.
 */

/** The card's size: the 1.91:1 every preview (Open Graph, Twitter/X large card) crops to. */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

/** Title characters kept before the card's own three-line clamp, so a pasted essay can't reach the renderer. */
export const CARD_TITLE_MAX = 120;

/** The card text for a title or name: whitespace collapsed, cut at a word with an ellipsis. */
export function cardText(text: string, max: number = CARD_TITLE_MAX): string {
  return plainExcerpt(text, max);
}

/**
 * The title's font size in px, stepping down as it gets longer so that a long
 * title still fits in three lines and a short one stays large and quiet.
 */
export function cardTitleSize(title: string): number {
  const length = [...title].length;
  if (length <= 24) return 92;
  if (length <= 48) return 76;
  if (length <= 80) return 62;
  return 52;
}

/**
 * "Sat 6 Mar · 8:00 pm · The Tote, Collingwood, VIC": the date and time in the
 * event's own zone (naming the zone outside Melbourne's: "8:00 pm Perth
 * time"), then the venue and the place as the page shows it. Parts that are
 * empty are left out.
 */
export function eventCardDetail(event: Pick<EventShareFields, "startsAt" | "timeZone" | "state" | "venueName" | "suburb">): string {
  const when = `${formatEventDateShort(event.startsAt, event.timeZone)} · ${formatEventTime(event.startsAt, event.timeZone)}${zoneSuffix(event.timeZone, event.state)}`;
  const place = [event.venueName.trim(), eventPlaceName(event)].filter(Boolean).join(", ");
  return [when, place].filter(Boolean).join(" · ");
}

/**
 * A short, stable version string for a card from what it shows (FNV-1a, base
 * 36), used as the image's `id` so its URL changes when the title, the
 * details or the photo do, and a preview cache fetches the new card.
 */
export function cardVersion(...parts: (string | undefined)[]): string {
  let hash = 0x811c9dc5;
  for (const char of parts.map((part) => part ?? "").join("\u0000")) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The id of the plain brand card: an unknown or unpublished slug, or one that couldn't be read. */
export const BRAND_CARD_ID = "brand";

const DOTTED: Record<string, string> = { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü" };

/**
 * The brand's two dots over every plain vowel ("Neon Static" → "Nëön Stätïc"),
 * as the site draws headings with Instrument Sans Dots (app/fonts/instrument-sans-dots).
 * For a card's pixels only: the image's alt text and every page keep the plain spelling.
 */
export function dottedText(text: string): string {
  return text.replace(/[aeiouAEIOU]/g, (vowel) => DOTTED[vowel]);
}
