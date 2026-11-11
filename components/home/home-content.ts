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
 * The home h1, as the proposal draws it: FIND YOÜR / NEXT THING. (two
 * lines at every width; the display style sets the capitals). The Ü is the
 * brand's, for display headlines only (the rules' "Ü in headlines only"), so
 * the h1 shows these lines through BrandU, hidden from screen readers, and
 * reads `HOME_TITLE` instead.
 */
export const HOME_TITLE_LINES: readonly [string, string] = ["Find yoür", "next thing."];

/** The h1's text and accessible name: "Find your next thing.". */
export const HOME_TITLE = "Find your next thing.";

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
 * "What else?" (owner, 23 Oct 2026: kept from the original home): three
 * promises the product keeps (organisers checked by a person, all-inclusive prices, no fee
 * on free tickets), each with the photo that shows beside the list while
 * it's the highlighted one. Sample-event photos for now (owner, 26 Oct 2026:
 * "reuse the event photos for now"), until promo photos of their own arrive.
 */
export const HOME_WHAT_ELSE: readonly (HomeArt & { title: string })[] = [
  {
    title: "Every organiser checked by a person",
    imageUrl: "/events/vintage-market-stall.jpg",
    poster: { pattern: "rings", background: "#000000", primary: "#fffae7", secondary: "#ff4800" },
  },
  {
    title: "Only the good stuff",
    imageUrl: "/events/dj-crate-digging.jpg",
    poster: { pattern: "halftone", background: "#ff4800", primary: "#000000", secondary: "#000000" },
  },
  {
    title: "See who’s going",
    imageUrl: "/events/gallery-opening.jpg",
    poster: { pattern: "waves", background: "#fffae7", primary: "#000000", secondary: "#ff4800" },
  },
];

/** "After dark" (the guide card): there's no guide content yet, so this points at the map. */
export const HOME_GUIDE: HomeArt & {
  eyebrow: string;
  title: string;
  cta: { label: string; href: string };
} = {
  eyebrow: "Map guide",
  title: "Australia after dark, mapped",
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
 * (components/home/CommunitySection.tsx): five illustrative Unsplash photos of people seen from behind
 * (public/home/people/, see public/home/README.md), shown in demo and live
 * alike as overlapping circles. They're illustration, never attendees: the
 * card shows no photo caption (owner, 31 Oct 2026).
 */
export const COMMUNITY_SAMPLE_FACES: readonly string[] = [1, 2, 3, 4, 5].map((n) => `/home/people/person-${n}.webp`);
