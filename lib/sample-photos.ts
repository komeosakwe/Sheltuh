import type { SheltuhEvent } from "./types";

/**
 * Sample events that have a real photo in `public/events/<slug>.jpg`. Only
 * these get an `imageUrl`; the rest show the generated poster art. (Pointing
 * every sample at a file that doesn't exist made each page load fire a wasted
 * 404 per event.) Drop a photo into public/events/ and add its slug here.
 */
export const SAMPLE_PHOTO_SLUGS: ReadonlySet<string> = new Set<string>([]);

export function withSamplePhoto(event: SheltuhEvent): SheltuhEvent {
  return SAMPLE_PHOTO_SLUGS.has(event.slug) ? { ...event, imageUrl: `/events/${event.slug}.jpg` } : event;
}
