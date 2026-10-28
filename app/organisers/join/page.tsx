import type { Metadata } from "next";
import OrganiserJoinFlow from "@/components/organisers/OrganiserJoinFlow";

// An organiser link carries its token in the fragment. next.config.ts also
// sends noindex and no-referrer for this path, as for the emailed-link pages.
export const metadata: Metadata = {
  title: "Sell tickets on Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function OrganiserJoinPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-md flex-col gap-8">
        <OrganiserJoinFlow />
      </div>
    </div>
  );
}
