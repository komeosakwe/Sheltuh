/**
 * /community's words (redesign PR 3): the proposal's, word for word, except where docs §7 and the
 * manager's decisions say otherwise (only the steps that exist; no follows, scenes or counts).
 */

/** The h1 as drawn (FIND YOÜR / PEOPLE.), shown through BrandU, and the sentence it's read as. */
export const COMMUNITY_TITLE_LINES: readonly [string, string] = ["Find yoür", "people."];
export const COMMUNITY_TITLE = "Find your people.";

export const COMMUNITY_LEDE = "The people and creative scenes behind the events — across music, art, fashion and culture.";

export const LOCAL_DISCOVERY = {
  title: "Local discovery",
  body: "Find scenes near you through Nearby and your local feed.",
} as const;

export const WHO_SEES_YOU = {
  title: "You choose who sees you",
  body: "Who’s going is opt-in. Show up for your scene, or stay off the list.",
} as const;

export const SCENES_TITLE = "Scenes by city";

/** The join banner: its title and the two steps that exist today (the proposal's 02 and 03). */
export const JOIN_TITLE = "Your people are already here.";
export const JOIN_STEPS: readonly { title: string; body: string }[] = [
  { title: "See who’s going", body: "Know friends and familiar faces before you buy." },
  { title: "Show up — or don’t", body: "Choose per event if others can see you’re going." },
];

/**
 * The hero's collage: licensed photos only (public/events/README.md, public/home/README.md:
 * Unsplash, no identifiable faces). Never the proposal's people photos. Decorative.
 */
export const COMMUNITY_COLLAGE: readonly { src: string; width: number; height: number }[] = [
  { src: "/events/street-market.jpg", width: 1440, height: 1440 },
  { src: "/home/people/person-2.webp", width: 320, height: 320 },
  { src: "/events/gallery-opening.jpg", width: 724, height: 522 },
  { src: "/events/dj-crate-digging.jpg", width: 1920, height: 1281 },
  { src: "/home/people/person-3.webp", width: 320, height: 320 },
  { src: "/events/vintage-market-stall.jpg", width: 760, height: 507 },
  { src: "/home/people/person-4.webp", width: 320, height: 320 },
  { src: "/events/record-shop-dj.jpg", width: 1080, height: 720 },
];

/** Scenes by city's photo: the Queen Victoria Summer Night Market's roof and the CBD (no people). */
export const SCENES_PHOTO = { src: "/events/street-market.jpg", width: 1440, height: 1440 } as const;
