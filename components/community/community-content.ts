/**
 * /community's words (redesign PR 3): the proposal's, word for word, except where docs §7 and the
 * manager's decisions say otherwise (only the steps that exist; no follows, scenes or counts).
 */

/** The h1 as drawn (FIND YOÜR / PEOPLE.), shown through BrandU, and the sentence it's read as. */
export const COMMUNITY_TITLE_LINES: readonly [string, string] = ["Find yoür", "people."];
export const COMMUNITY_TITLE = "Find your people.";

export const COMMUNITY_LEDE = "The people and creative scenes behind the events — across music, art, fashion and culture.";

/** A panel's line under its title (the proposal: Instrument SemiBold, muted, about 20px). */
export const PANEL_LINE = "mt-2 text-xl leading-7 font-semibold text-muted";

export const LOCAL_DISCOVERY = {
  title: "Local discovery",
  body: "Find scenes near you through Nearby and your local feed.",
} as const;

/** The owner's newer "Your visibility, your choice" card (13 Nov 2026). */
export const WHO_SEES_YOU = {
  title: "Your visibility, your choice",
  body: "Who’s going is opt-in for each event.",
  points: [
    { icon: "people", text: "Choose when to appear" },
    { icon: "eye", text: "Browse without joining the list" },
    { icon: "message", text: "Message eligible attendees when available" },
  ],
  link: { label: "How Who’s going works", href: "/privacy#whos-going" },
} as const;

export const SCENES_TITLE = "Scenes by city";

/** The join banner (owner's newer version, 13 Nov 2026): eyebrow, title, line, and the two things it offers today. */
export const JOIN_EYEBROW = "Community";
export const JOIN_TITLE = "Find your people.";
export const JOIN_LEDE = "Discover creative events and choose how you connect.";
export const JOIN_FEATURES: readonly { icon: "people" | "visibility"; title: string; body: string }[] = [
  { icon: "people", title: "See who’s going", body: "See attendees who choose to appear." },
  { icon: "visibility", title: "Your visibility, your choice", body: "Choose whether you appear on each event’s attendee list." },
];

/**
 * The hero's collage: licensed photos only (public/events/README.md, public/home/README.md:
 * Unsplash, no identifiable faces), never the proposal's people photos, each used once (the audit
 * flagged repeats): all eleven, in two staggered rows. Decorative.
 */
export const COMMUNITY_COLLAGE: readonly (readonly { src: string; width: number; height: number }[])[] = [
  [
    { src: "/events/street-market.jpg", width: 1440, height: 1440 },
    { src: "/home/people/person-1.webp", width: 320, height: 320 },
    { src: "/events/gallery-opening.jpg", width: 724, height: 522 },
    { src: "/home/people/person-2.webp", width: 320, height: 320 },
    { src: "/events/dj-crate-digging.jpg", width: 1920, height: 1281 },
    { src: "/home/people/person-3.webp", width: 320, height: 320 },
  ],
  [
    { src: "/events/vintage-market-stall.jpg", width: 760, height: 507 },
    { src: "/home/people/person-4.webp", width: 320, height: 320 },
    { src: "/events/record-shop-dj.jpg", width: 1080, height: 720 },
    { src: "/home/people/person-5.webp", width: 320, height: 320 },
    { src: "/events/jazz-drummer.webp", width: 768, height: 512 },
  ],
];

/** Scenes by city's photo: the Queen Victoria Summer Night Market's roof and the CBD (no people). */
export const SCENES_PHOTO = { src: "/events/street-market.jpg", width: 1440, height: 1440 } as const;
