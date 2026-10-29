import type { Metadata } from "next";
import FollowingList from "@/components/following/FollowingList";
import { PageHeader } from "@/components/ui/Section";

// Personal: kept out of search indexes (next.config.ts also sends noindex and no-referrer for /following/*).
export const metadata: Metadata = { title: "Organisers you follow — Sheltüh", robots: { index: false, follow: false } };

export default function FollowingPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-8">
        <PageHeader
          flush
          size="md"
          eyebrow="Your account"
          title="Organisers you follow"
        />
        <FollowingList />
      </div>
    </div>
  );
}
