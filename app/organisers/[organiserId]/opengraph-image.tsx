import { brandCard, organiserCard } from "@/lib/server/share-card-render";
import {
  BRAND_CARD_IMAGE,
  organiserCardId,
  readOrganiserCardLogo,
  readOrganiserForCard,
} from "@/lib/server/share-card-data";

/**
 * The link-preview card of /organisers/[organiserId] (also its twitter-image):
 * the organiser's name, with their logo if they have one, on Signal Orange
 * (lib/server/share-card-render.tsx). Approved organisers only (the profile's
 * own visibility rule): anything else, or an error, is the plain brand card.
 * The id changes with the name and logo, as the event card's does
 * (app/events/[slug]/opengraph-image.tsx).
 */
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Params {
  organiserId?: string;
}

export async function generateImageMetadata({ params }: { params?: Params }) {
  const organiser = params?.organiserId ? await readOrganiserForCard(params.organiserId) : null;
  if (!organiser) return [BRAND_CARD_IMAGE];
  return [{ id: organiserCardId(organiser), alt: organiser.displayName, size, contentType }];
}

export default async function Image({ params, id }: { params: Promise<Params>; id: Promise<string | number> }) {
  try {
    const { organiserId } = await params;
    const organiser = organiserId ? await readOrganiserForCard(organiserId) : null;
    if (organiser && String(await id) === organiserCardId(organiser)) {
      return organiserCard({ displayName: organiser.displayName, logo: await readOrganiserCardLogo(organiser) });
    }
  } catch {
    // Falls through to the brand card.
  }
  return brandCard();
}
