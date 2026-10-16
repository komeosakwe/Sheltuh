import type { Metadata } from "next";
import Link from "next/link";
import PublicProfilePanel from "@/components/dashboard/PublicProfilePanel";

export const metadata: Metadata = { title: "Public profile — Sheltüh" };

export default function DashboardProfilePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard"
          className="eyebrow inline-flex min-h-11 w-fit items-center underline underline-offset-4"
        >
          &larr; Your events
        </Link>
        <h1 className="display-lg">Public profile</h1>
      </div>
      <PublicProfilePanel />
    </div>
  );
}
