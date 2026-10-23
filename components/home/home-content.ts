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

/** The hero's one short sentence under the h1 (mobile-redesign.md, Refinement 22 Oct 2026). */
export const HOME_INTRO = "Music, art, workshops and pop-ups. See who’s going.";

/** Photo shown in the hero box (public/events/vintage-market-stall.jpg). */
export const HOME_HERO: HomeArt = {
  imageUrl: "/events/vintage-market-stall.jpg",
  poster: { pattern: "burst", background: "#000000", primary: "#ff4800", secondary: "#fffae7" },
};

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

export const HOME_CREATORS: HomeArt = {
  imageUrl: "/events/record-shop-dj.jpg",
  poster: { pattern: "curtain", background: "#000000", primary: "#ff4800", secondary: "#000000" },
};

/**
 * Photos for the four circles in Find your people's "A look inside" card
 * (components/home/CommunitySection.tsx), shown in the demo only, beside
 * "Sample attendees". Drop licensed portraits in public/home/ (square, at
 * least 160px; see its README) and list up to four paths here, e.g.
 * `"/home/face-1.jpg"`. Empty (as now), the circles show the sample
 * attendees' initials. Live mode never shows them: there the circles are
 * plain shapes, since the home page names and shows no real members.
 */
export const COMMUNITY_SAMPLE_FACES: readonly string[] = [];
