import type { Metadata } from "next";
import DemoNotice from "@/components/DemoNotice";
import LiveMemberProfile from "@/components/members/LiveMemberProfile";
import MemberPageShell from "@/components/members/MemberPageShell";
import MemberProfileView from "@/components/members/MemberProfileView";
import { ButtonLink } from "@/components/ui/Button";
import { isApiConfigured } from "@/lib/api/client";
import { getSampleMemberProfile } from "@/lib/sample-member-profiles";

// Members only, and personal: never indexed. The member's name isn't put in
// the tab title (it would sit in browser history and shared screenshots).
export const metadata: Metadata = {
  title: "Member profile — Sheltüh",
  robots: { index: false, follow: false },
};

export default async function MemberProfilePage({ params }: PageProps<"/members/[profileId]">) {
  const { profileId } = await params;

  // Demo mode: the sample members (lib/sample-members.ts), whose names link
  // here from the sample Who's Going lists. Nothing calls the API.
  if (!isApiConfigured) {
    const sample = getSampleMemberProfile(profileId);
    if (sample) {
      return (
        <MemberPageShell>
          <MemberProfileView profile={sample.profile} events={sample.events} />
        </MemberPageShell>
      );
    }
    return (
      <div className="mx-auto flex max-w-6xl *:max-w-2xl flex-col items-start gap-6 px-5 py-20 sm:px-8">
        <h1 className="display-lg">This profile isn&rsquo;t available</h1>
        <DemoNotice>This demo only has a few sample member profiles.</DemoNotice>
        <ButtonLink href="/events" size="lg">
          Browse all events
        </ButtonLink>
      </div>
    );
  }

  // key: moving to another member starts from a fresh loading state.
  return <LiveMemberProfile key={profileId} profileId={profileId} />;
}
