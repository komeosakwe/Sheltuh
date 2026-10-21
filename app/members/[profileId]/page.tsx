import type { Metadata } from "next";
import DemoNotice from "@/components/DemoNotice";
import LiveMemberProfile from "@/components/members/LiveMemberProfile";
import { ButtonLink } from "@/components/ui/Button";
import { isApiConfigured } from "@/lib/api/client";

// Members only, and personal: never indexed. The member's name isn't put in
// the tab title (it would sit in browser history and shared screenshots).
export const metadata: Metadata = {
  title: "Member profile — Sheltüh",
  robots: { index: false, follow: false },
};

export default async function MemberProfilePage({ params }: PageProps<"/members/[profileId]">) {
  const { profileId } = await params;

  // Demo mode has no accounts, so no members to show.
  if (!isApiConfigured) {
    return (
      <div className="mx-auto flex max-w-6xl *:max-w-2xl flex-col items-start gap-6 px-5 py-20 sm:px-8">
        <h1 className="display-lg">This profile isn&rsquo;t available</h1>
        <DemoNotice>Member profiles come from the live service, which isn&rsquo;t connected here.</DemoNotice>
        <ButtonLink href="/events" size="lg">
          Browse all events
        </ButtonLink>
      </div>
    );
  }

  // key: moving to another member starts from a fresh loading state.
  return <LiveMemberProfile key={profileId} profileId={profileId} />;
}
