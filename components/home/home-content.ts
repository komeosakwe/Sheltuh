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

/** The line under the h1 (the proposal's, word for word). */
export const HOME_LEDE = "Curated creative events. See who’s going.";

/*
 * Promotional photos (owner, 23 Oct 2026: "avoid reusing the same DJ and market photos across
 * the hero, event listings and organiser section"). public/events/ has six licensed photos (see
 * its README), each also a sample event's image; street-market (no upcoming sample event uses it)
 * is the For organisers banner. Events always keep their own image.
 */

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
