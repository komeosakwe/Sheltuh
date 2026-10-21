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
