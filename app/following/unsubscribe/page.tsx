import type { Metadata } from "next";
import FollowUnsubscribe from "@/components/following/FollowUnsubscribe";

// The emailed link carries its token in the fragment. next.config.ts also sends
// noindex and no-referrer for this path, as for /checkout.
export const metadata: Metadata = {
  title: "Stop new-event emails — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function FollowUnsubscribePage() {
  return (
    // The site's page edges, with a left-aligned max-w-2xl column.
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <div className="flex max-w-2xl flex-col">
        <FollowUnsubscribe />
      </div>
    </div>
  );
}
