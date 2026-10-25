import type { Metadata } from "next";
import InviteFlow from "@/components/invites/InviteFlow";

// The emailed link carries its token in the fragment. next.config.ts also sends
// noindex and no-referrer for this path, as for the other emailed-link pages.
export const metadata: Metadata = {
  title: "Your invite — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function InvitePage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-md flex-col gap-8">
        <InviteFlow />
      </div>
    </div>
  );
}
