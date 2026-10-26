import type { EventPoster } from "@/lib/types";

/**
 * Static art and copy for the home page. Each image slot shows its poster
 * art (in the brand colourways, docs/design/brand-direction-one.md §8.2)
 * until an `imageUrl` is set (put the file in public/home/, see its README);
 * the slot's ratio is fixed, so adding a photo changes no layout.
 */
export interface HomeArt {
  poster: EventPoster;
  imageUrl?: string;
}

/**
 * The home h1, one entry per line (two lines at every width): "Find your
 * next thing." (owner, 24 Oct 2026). The h1 is in the plain face and only
 * the letter after each `^` is drawn in the dotted face (Instrument Sans
 * Dots), so it reads FIND YOÜR NEXT THÏNG. (owner, 24 Oct 2026: "only two
 * letters with dots"; the Ü echoes SHELTÜH) while its text and accessible
 * name stay plainly "Find your next thing.". To dot other letters, move the
 * `^`s: this line is the only place the choice is made.
 */
export const HOME_TITLE_LINES: readonly [string, string] = ["Find yo^ur", "next th^ing."];

/** Marks the next letter of a `HOME_TITLE_LINES` line as drawn with the dots. */
const DOT_MARK = "^";

/** A run of a title line: plain text, or one letter drawn in the dotted face. */
export interface TitlePart {
  text: string;
  dotted: boolean;
}

/** Splits a `HOME_TITLE_LINES` line into plain runs and its dotted letters, in order. */
export function titleParts(line: string): TitlePart[] {
  const [head, ...marked] = line.split(DOT_MARK);
  const parts: TitlePart[] = head ? [{ text: head, dotted: false }] : [];
  for (const run of marked) {
    if (!run) continue;
    parts.push({ text: run.charAt(0), dotted: true });
    if (run.length > 1) parts.push({ text: run.slice(1), dotted: false });
  }
  return parts;
}

/**
 * "This weekend" with one dotted letter (owner, 24 Oct 2026: section titles are plain words, this
 * one keeps a single special character). Move the `^` to dot a different letter.
 */
export const WEEKEND_TITLE = "Th^is weekend";

/** A title line as plain text, without its dot marks. */
export const titleText = (line: string) => line.split(DOT_MARK).join("");

/** The h1's text and accessible name: "Find your next thing.". */
export const HOME_TITLE = HOME_TITLE_LINES.map(titleText).join(" ");

/**
 * The hero's one short sentence under the h1, at every width (owner, 23 Oct
 * 2026, layout polish: back on phones, in these words).
 */
export const HOME_INTRO = "Music, art and pop-ups. See who’s going.";

/*
 * Promotional photos (owner, 23 Oct 2026: "avoid reusing the same DJ and
 * market photos across the hero, event listings and organiser section").
 * public/events/ has six photos and each is also a sample event's own image
 * (lib/sample-photos.ts), so each promo photo is used once on the home, and
 * only photos the home's event rails don't show: street-market (no upcoming
 * sample event uses it) is the For organisers card; gallery-opening (the
 * upcoming art events' photo, none of which is on the home's rails at
 * present) leads the desktop hero collage and is the small tile beside the
 * headline below 1024px (owner, 24 Oct 2026: "little image should be
 * there"). The
 * other promo slots show their brand poster art until the owner supplies
 * photos of their own (public/home/README.md lists what's needed). Events
 * always keep their own image.
 */

/**
 * The desktop hero collage's lead photo (public/events/gallery-opening.jpg),
 * also the small tile beside the headline below 1024px (`HeroThumb`).
 */
export const HOME_HERO: HomeArt = {
  imageUrl: "/events/gallery-opening.jpg",
  poster: { pattern: "burst", background: "#000000", primary: "#ff4800", secondary: "#fffae7" },
};

/**
 * The collage's two smaller tiles, beside and under the lead (restored at the
 * owner's request, 23 Oct 2026). Sample-event photos for now (owner, 26 Oct
 * 2026: "reuse the event photos for now"), until promo photos of their own
 * arrive (public/home/README.md); the poster shows if a photo fails to load.
 */
export const HOME_HERO_TILES: readonly [HomeArt, HomeArt] = [
  {
    imageUrl: "/events/record-shop-dj.jpg",
    poster: { pattern: "halftone", background: "#fffae7", primary: "#000000", secondary: "#000000" },
  },
  {
    imageUrl: "/events/jazz-drummer.webp",
    poster: { pattern: "waves", background: "#ff4800", primary: "#000000", secondary: "#fffae7" },
  },
];

/**
 * "What else?" (owner, 23 Oct 2026: kept from the original home): three
 * promises the product keeps (manual curation, all-inclusive prices, no fee
 * on free tickets), each with the photo that shows beside the list while
 * it's the highlighted one. Sample-event photos for now (owner, 26 Oct 2026:
 * "reuse the event photos for now"), until promo photos of their own arrive.
 */
export const HOME_WHAT_ELSE: readonly (HomeArt & { title: string; note: string })[] = [
  {
    title: "Every event reviewed by a person",
    note: "Curated, not scraped.",
    imageUrl: "/events/vintage-market-stall.jpg",
    poster: { pattern: "rings", background: "#000000", primary: "#fffae7", secondary: "#ff4800" },
  },
  {
    title: "Only the good stuff",
    note: "Hand-picked music, art and pop-ups worth leaving the house for.",
    imageUrl: "/events/dj-crate-digging.jpg",
    poster: { pattern: "halftone", background: "#ff4800", primary: "#000000", secondary: "#000000" },
  },
  {
    title: "See who’s going",
    note: "Ticket holders can show they’re going. Make a free profile to see who.",
    imageUrl: "/events/gallery-opening.jpg",
    poster: { pattern: "waves", background: "#fffae7", primary: "#000000", secondary: "#ff4800" },
  },
];

/** "Only in the city": there's no guide content yet, so this points at the map. */
export const HOME_GUIDE: HomeArt & {
  eyebrow: string;
  title: string;
  body: string;
  cta: { label: string; href: string };
} = {
  eyebrow: "City guide",
  title: "Australia after dark, mapped",
  body: "Laneway galleries, warehouse stages and back-room workshops. See what’s on near you.",
  cta: { label: "Open the map", href: "/map" },
  imageUrl: "/events/street-market.jpg",
  poster: { pattern: "grid", background: "#fffae7", primary: "#000000", secondary: "#ff4800" },
};

/** For organisers: a street market (no upcoming sample event uses it; see above). */
export const HOME_CREATORS: HomeArt = {
  imageUrl: "/events/street-market.jpg",
  poster: { pattern: "curtain", background: "#000000", primary: "#ff4800", secondary: "#000000" },
};

/**
 * The portraits in Find your people's "A look inside" card
 * (components/home/CommunitySection.tsx): the owner's five illustrative photos
 * (public/home/people/, see public/home/README.md), shown in demo and live
 * alike as overlapping circles. They're illustration, never attendees: the
 * card's footnote always says "Illustrative photos".
 */
export const COMMUNITY_SAMPLE_FACES: readonly string[] = [1, 2, 3, 4, 5].map((n) => `/home/people/person-${n}.webp`);
