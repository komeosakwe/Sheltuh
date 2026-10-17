import type { Metadata } from "next";
import LiveOrganiserProfile from "@/components/organisers/LiveOrganiserProfile";
import OrganiserUnavailable from "@/components/organisers/OrganiserUnavailable";
import { isApiConfigured } from "@/lib/api/client";
import { ORGANISER_PAGE_TITLE } from "@/lib/organiser-profile";

// The profile is fetched client-side from this app's own API (as on the event
// page), so the server doesn't know the organiser's name for the title:
// LiveOrganiserProfile sets "{name} — Sheltüh" once it's loaded.
export const metadata: Metadata = { title: ORGANISER_PAGE_TITLE };

export default async function OrganiserProfilePage({ params }: PageProps<"/organisers/[organiserId]">) {
  const { organiserId } = await params;

  // Demo mode has sample events only: no organisers to show.
  if (!isApiConfigured) return <OrganiserUnavailable demo />;

  // key: moving to another organiser starts from a fresh loading state.
  return <LiveOrganiserProfile key={organiserId} organiserId={organiserId} />;
}
