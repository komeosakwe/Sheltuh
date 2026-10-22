import type { Metadata } from "next";
import LiveOrganiserProfile from "@/components/organisers/LiveOrganiserProfile";
import OrganiserProfileView from "@/components/organisers/OrganiserProfileView";
import OrganiserUnavailable from "@/components/organisers/OrganiserUnavailable";
import { isApiConfigured } from "@/lib/api/client";
import { ORGANISER_PAGE_TITLE, ORGANISER_UNAVAILABLE_TITLE, organiserPageTitle } from "@/lib/organiser-profile";
import { getSampleOrganiser } from "@/lib/sample-organisers";

// Live: the profile is fetched client-side from this app's own API (as on the
// event page), so the server doesn't know the organiser's name for the title:
// LiveOrganiserProfile sets "{name} — Sheltüh" once it's loaded. Demo: the
// sample organiser's name, or the same "not available" title live mode sets.
export async function generateMetadata({ params }: PageProps<"/organisers/[organiserId]">): Promise<Metadata> {
  if (isApiConfigured) return { title: ORGANISER_PAGE_TITLE };
  const { organiserId } = await params;
  const sample = getSampleOrganiser(organiserId);
  return { title: sample ? organiserPageTitle(sample.profile.displayName) : ORGANISER_UNAVAILABLE_TITLE };
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
