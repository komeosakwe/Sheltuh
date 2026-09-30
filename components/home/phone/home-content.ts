import type { EventPoster } from "@/lib/types";

/**
 * Static art and copy for the phone home. Each image slot shows its poster
 * art until an `imageUrl` is set (put the file in public/home/, see its README);
 * the slot's ratio is fixed, so adding a photo changes no layout.
 */
export interface HomeArt {
  poster: EventPoster;
  imageUrl?: string;
}

/** Photo shown in the hero box (public/home/hero.jpg). */
export const HOME_HERO: HomeArt = {
  imageUrl: "/home/hero.jpg",
  poster: { pattern: "burst", background: "#0b0b0b", primary: "#ff4fb0", secondary: "#f3f0e8" },
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
  poster: { pattern: "grid", background: "#0b0b0b", primary: "#f3f0e8", secondary: "#ff4fb0" },
};

export const HOME_CREATORS: HomeArt = {
  poster: { pattern: "curtain", background: "#0b0b0b", primary: "#2b3cff", secondary: "#ff4fb0" },
};
