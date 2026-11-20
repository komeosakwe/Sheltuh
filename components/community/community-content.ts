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
 *
 * `blurDataURL`: each photo's own colours, shown blurred until it loads (Round 2: no grey boxes on
 * a slow connection). 8px on the longest side, WebP, made once with sharp, from the repo root:
 *   node -e 'require("sharp")("public"+process.argv[1]).resize(8,8,{fit:"inside"}).webp({quality:40})
 *     .toBuffer().then((b)=>console.log("data:image/webp;base64,"+b.toString("base64")))' /events/street-market.jpg
 * Re-run it for a photo whenever that photo changes.
 */
export const COMMUNITY_COLLAGE: readonly (readonly { src: string; width: number; height: number; blurDataURL: string }[])[] = [
  [
    {
      src: "/events/street-market.jpg",
      width: 1440,
      height: 1440,
      blurDataURL: "data:image/webp;base64,UklGRlAAAABXRUJQVlA4IEQAAADQAQCdASoIAAgAA4BaJZgCdAD0rDH/AAD+YMM02hGf+Ctqskz2LxrZx1eLrW+v0NuRG8PC8/AaR+N9jJpUbdkjlcAAAA==",
    },
    {
      src: "/home/people/person-1.webp",
      width: 320,
      height: 320,
      blurDataURL: "data:image/webp;base64,UklGRlYAAABXRUJQVlA4IEoAAADQAQCdASoIAAgAA4BaJQBOgCPQSA+NAADif3WWX7QQHnCPUc/gkjJdIWtOuM7y8kCfVomccRxre2M8zoSnI8aia4cuEcrtTnKAAA==",
    },
    {
      src: "/events/gallery-opening.jpg",
      width: 724,
      height: 522,
      blurDataURL: "data:image/webp;base64,UklGRkIAAABXRUJQVlA4IDYAAADQAQCdASoIAAYAA4BaJZQCdAEOu0QeAAD+rN96w/gipbyUaE+V4D+ByUJRaKxK9uNhkXoQAAA=",
    },
    {
      src: "/home/people/person-2.webp",
      width: 320,
      height: 320,
      blurDataURL: "data:image/webp;base64,UklGRk4AAABXRUJQVlA4IEIAAAAQAgCdASoIAAgAA4BaJZQC7AYr7vtwLS+AAP7YI66Xv8GAweBNwynNn19si3RBfYctzKhbUAQXYpV6WLKIeJzhwAA=",
    },
    {
      src: "/events/dj-crate-digging.jpg",
      width: 1920,
      height: 1281,
      blurDataURL: "data:image/webp;base64,UklGRkQAAABXRUJQVlA4IDgAAACwAQCdASoIAAUAA4BaJbACdAD0cgEQAP70nsbJjNBW6PDZ/PYkiV/vGuS+Ur1jVG9V/l81rBeAAA==",
    },
    {
      src: "/home/people/person-3.webp",
      width: 320,
      height: 320,
      blurDataURL: "data:image/webp;base64,UklGRkIAAABXRUJQVlA4IDYAAADwAQCdASoIAAgAA4BaJZwC7AD0uR3e6qAA9ru+xKxpgtJL4Uw/YFsr4nunaaZeLim2JkYeAAA=",
    },
  ],
  [
    {
      src: "/events/vintage-market-stall.jpg",
      width: 760,
      height: 507,
      blurDataURL: "data:image/webp;base64,UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoIAAUAA4BaJZwAApz9zgAA/niOp6Ic5plUQtejzAbtAhYEAAA=",
    },
    {
      src: "/home/people/person-4.webp",
      width: 320,
      height: 320,
      blurDataURL: "data:image/webp;base64,UklGRjQAAABXRUJQVlA4ICgAAACwAQCdASoIAAgAA4BaJZwAAueFQYQAAP7s87qdtxSyNEme0c1TAAAA",
    },
    {
      src: "/events/record-shop-dj.jpg",
      width: 1080,
      height: 720,
      blurDataURL: "data:image/webp;base64,UklGRkIAAABXRUJQVlA4IDYAAADQAQCdASoIAAUAA4BaJbACdAD0jPJKIAD+9aHw+WloOst9woWbRePJA85yZyCFI7XW2cXgAAA=",
    },
    {
      src: "/home/people/person-5.webp",
      width: 320,
      height: 320,
      blurDataURL: "data:image/webp;base64,UklGRlwAAABXRUJQVlA4IFAAAAAQAgCdASoIAAgAA4BaJbACdEf/gbojkRjQAPhi76Rrw4nvWK7NAl6GrDYyDVtMctxjA5ac/oPrSta0/k/N/8DBzoxNq/cGqPW/WK1nsAAAAA==",
    },
    {
      src: "/events/jazz-drummer.webp",
      width: 768,
      height: 512,
      blurDataURL: "data:image/webp;base64,UklGRjwAAABXRUJQVlA4IDAAAACwAQCdASoIAAUAA4BaJYwCdADx+HEAAP7vK19KXZy5QM0ObwXnUjXX/IWCPWWYAAA=",
    },
  ],
];

/** Scenes by city's photo: the Queen Victoria Summer Night Market's roof and the CBD (no people). */
export const SCENES_PHOTO = { src: "/events/street-market.jpg", width: 1440, height: 1440 } as const;
