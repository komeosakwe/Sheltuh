import type { SheltuhEvent } from "./types";

/**
 * Photos in `public/events/` that sample events may use. Categories without a
 * photo yet (workshop, theatre) keep the generated poster art, and a sample picks
 * from its category's pool deterministically from its slug so the server and
 * browser render the same thing. Pointing events at files that don't exist
 * would fire a wasted 404 per event, so only list files that are really there.
 * Add more photos here as you get them (only use images you have the rights to).
 */
const PHOTOS_BY_CATEGORY: Partial<Record<SheltuhEvent["category"], readonly string[]>> = {
  "live-music": [
    "/events/jazz-drummer.webp",
    "/events/record-shop-dj.jpg",
    "/events/dj-crate-digging.jpg",
  ],
  art: ["/events/gallery-opening.jpg"],
  "pop-up": ["/events/vintage-market-stall.jpg", "/events/street-market.jpg"],
};

/** Stable, tiny hash so the same slug always maps to the same photo. */
function pick(slug: string): number {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Explicit choices first. */
const PHOTO_BY_SLUG: Record<string, string> = {
  "neon-static": "/events/record-shop-dj.jpg",
  "fitzroy-poetry-and-noise": "/events/jazz-drummer.webp",
  "southbank-sketch-salon": "/events/gallery-opening.jpg",
  "laneway-projections-after-dark": "/events/vintage-market-stall.jpg",
  "brunswick-zine-fair": "/events/street-market.jpg",
};

export function withSamplePhoto(event: SheltuhEvent): SheltuhEvent {
  const pool = PHOTOS_BY_CATEGORY[event.category];
  const imageUrl = PHOTO_BY_SLUG[event.slug] ?? (pool ? pool[pick(event.slug) % pool.length] : undefined);
  return imageUrl ? { ...event, imageUrl } : event;
}
