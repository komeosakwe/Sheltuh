import type { SheltuhEvent } from "./types";

/**
 * Photos in `public/events/` that sample events may use. Only live-music
 * events get one for now (the rest keep the generated poster art), and each
 * live-music sample picks one deterministically from its slug so the server
 * and browser render the same thing. Pointing events at files that don't exist
 * would fire a wasted 404 per event, so only list files that are really there.
 * Add more photos here as you get them (only use images you have the rights to).
 */
const LIVE_MUSIC_PHOTOS = ["/events/jazz-drummer.webp", "/events/horn-band.jpg"] as const;

/** Stable, tiny hash so the same slug always maps to the same photo. */
function pick(slug: string): number {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Explicit choices first; anything else live-music alternates. */
const PHOTO_BY_SLUG: Record<string, string> = {
  "neon-static": "/events/horn-band.jpg",
  "fitzroy-poetry-and-noise": "/events/jazz-drummer.webp",
};

export function withSamplePhoto(event: SheltuhEvent): SheltuhEvent {
  const imageUrl =
    PHOTO_BY_SLUG[event.slug] ??
    (event.category === "live-music" ? LIVE_MUSIC_PHOTOS[pick(event.slug) % LIVE_MUSIC_PHOTOS.length] : undefined);
  return imageUrl ? { ...event, imageUrl } : event;
}
