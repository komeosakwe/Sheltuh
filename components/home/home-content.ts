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
 * sample event uses it) is the For organisers card, the one promo photo
 * phones see; gallery-opening (the upcoming art events' photo, none of which
 * is on the home's rails at present) leads the desktop hero collage. The
 * other promo slots show their brand poster art until the owner supplies
 * photos of their own (public/home/README.md lists what's needed). Events
 * always keep their own image.
 */

/** The desktop hero collage's lead photo (public/events/gallery-opening.jpg). */
export const HOME_HERO: HomeArt = {
  imageUrl: "/events/gallery-opening.jpg",
  poster: { pattern: "burst", background: "#000000", primary: "#ff4800", secondary: "#fffae7" },
};

/**
 * The collage's two smaller tiles, beside and under the lead (restored at the
 * owner's request, 23 Oct 2026). Poster art for now: their photos were
 * record-shop-dj (an event's) and gallery-opening (now the lead).
 */
export const HOME_HERO_TILES: readonly [HomeArt, HomeArt] = [
  {
    poster: { pattern: "halftone", background: "#fffae7", primary: "#000000", secondary: "#000000" },
  },
  {
    poster: { pattern: "waves", background: "#ff4800", primary: "#000000", secondary: "#fffae7" },
  },
];

/**
 * "What else?" (owner, 23 Oct 2026: kept from the original home): three
 * promises the product keeps (manual curation, all-inclusive prices, no fee
 * on free tickets), each with the photo that shows beside the list while
 * it's the highlighted one. Poster art for now (owner, 23 Oct 2026): its
 * photos were also the hero's and the listings' (gallery-opening,
 * street-market, jazz-drummer).
 */
export const HOME_WHAT_ELSE: readonly (HomeArt & { title: string; note: string })[] = [
  {
    title: "Every event reviewed by a person",
    note: "Curated, not scraped.",
    poster: { pattern: "rings", background: "#000000", primary: "#fffae7", secondary: "#ff4800" },
  },
  {
    title: "The price you see is the price you pay",
    note: "Booking fees shown up front.",
    poster: { pattern: "halftone", background: "#ff4800", primary: "#000000", secondary: "#000000" },
  },
  {
    title: "Free events stay free",
    note: "No fee on free tickets.",
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
  title: "Melbourne after dark, mapped",
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
