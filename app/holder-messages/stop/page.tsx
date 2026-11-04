import type { Metadata } from "next";
import StopHolderMessages from "@/components/holder-messages/StopHolderMessages";

// The emailed link carries its token in the fragment. next.config.ts also sends
// noindex and no-referrer for this path, as for /following/unsubscribe.
export const metadata: Metadata = {
  title: "Stop messages — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function StopHolderMessagesPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <div className="flex max-w-2xl flex-col">
        <StopHolderMessages />
      </div>
    </div>
  );
}
