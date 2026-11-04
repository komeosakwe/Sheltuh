import { eventCardDetail } from "@/lib/share-card";
import { brandCard, eventCard } from "@/lib/server/share-card-render";
import {
  BRAND_CARD_IMAGE,
  eventCardId,
  readEventCardPhoto,
  readEventForCard,
} from "@/lib/server/share-card-data";

/**
 * The link-preview card of /events/[slug] (also its twitter-image): the
 * event's cover photo with its title, date and place, or Signal Orange without
 * a photo (lib/server/share-card-render.tsx). Only a published event is
 * drawn (the page's own visibility rule): anything else, a draft's slug
 * included, gets the plain brand card, never its title, and an error is the
 * brand card too, never a 500.
 *
 * `generateImageMetadata` gives the image an id that changes with the card's
 * content, so its URL (.../opengraph-image/{id}) is new whenever the title,
 * date, place or photo is, and a messaging app that cached the old preview
 * fetches the new one. Only the current id draws the event; any other (an
 * old one, or "brand") is the brand card, briefly cached. `dynamic` keeps
 * Next from prerendering it: what's published changes at runtime.
 */
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Params {
  slug?: string;
}

export async function generateImageMetadata({ params }: { params?: Params }) {
  const event = params?.slug ? await readEventForCard(params.slug) : null;
  if (!event) return [BRAND_CARD_IMAGE];
  return [{ id: eventCardId(event), alt: event.title, size, contentType }];
}

export default async function Image({ params, id }: { params: Promise<Params>; id: Promise<string | number> }) {
  try {
    const { slug } = await params;
    const event = slug ? await readEventForCard(slug) : null;
    if (slug && event && String(await id) === eventCardId(event)) {
      return eventCard({
        title: event.title,
        detail: eventCardDetail(event),
        photo: await readEventCardPhoto(slug, event),
      });
    }
  } catch {
    // Falls through to the brand card.
  }
  return brandCard();
}
