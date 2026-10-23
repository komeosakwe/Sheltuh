import type { Metadata, ResolvingMetadata } from "next";
import LiveOrganiserProfile from "@/components/organisers/LiveOrganiserProfile";
import OrganiserProfileView from "@/components/organisers/OrganiserProfileView";
import OrganiserUnavailable from "@/components/organisers/OrganiserUnavailable";
import { isApiConfigured } from "@/lib/api/client";
import { getSampleOrganiser } from "@/lib/sample-organisers";
import { liveOrganiserMetadata } from "@/lib/server/share-metadata";
import { inheritedShareImages, ORGANISER_NOT_FOUND_METADATA, organiserMetadata, siteOrigin } from "@/lib/share-metadata";

// Live: the profile itself is fetched client-side from this app's own API (as
// on the event page), but the metadata is read server-side
// (lib/server/share-metadata.ts, an approved organiser only), so a shared link
// has the organiser's name, bio and canonical URL. Anything else is the same
// noindex "not available"; a database error the plain "Organiser" title.
// Demo: the sample organiser's, the same way.
export async function generateMetadata(
  { params }: PageProps<"/organisers/[organiserId]">,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { organiserId } = await params;
  const fallback = await inheritedShareImages(parent);
  if (isApiConfigured) return liveOrganiserMetadata(organiserId, fallback);
  const sample = getSampleOrganiser(organiserId);
  return sample
    ? organiserMetadata({ ...sample.profile, organiserId }, siteOrigin(), fallback)
    : ORGANISER_NOT_FOUND_METADATA;
}

export default async function OrganiserProfilePage({ params }: PageProps<"/organisers/[organiserId]">) {
  const { organiserId } = await params;

  // Demo mode: the organisers of the sample events (lib/sample-organisers.ts).
  if (!isApiConfigured) {
    const sample = getSampleOrganiser(organiserId);
    if (!sample) return <OrganiserUnavailable demo />;
    return <OrganiserProfileView profile={sample.profile} upcoming={sample.upcoming} past={sample.past} />;
  }

  // key: moving to another organiser starts from a fresh loading state.
  return <LiveOrganiserProfile key={organiserId} organiserId={organiserId} />;
}
