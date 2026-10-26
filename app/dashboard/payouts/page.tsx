import type { Metadata } from "next";
import { LoadingIndicator } from "@/components/ui/ProgressLoader";
import { PageHeader } from "@/components/ui/Section";
import { Suspense } from "react";
import PayoutsPanel from "@/components/dashboard/PayoutsPanel";

export const metadata: Metadata = { title: "Payouts — Sheltüh" };

export default function PayoutsPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-2xl flex-col gap-8">
        <PageHeader flush size="md" eyebrow="Organiser" title="Payouts" />
        <Suspense fallback={<LoadingIndicator />}>
          <PayoutsPanel />
        </Suspense>
      </div>
    </div>
  );
}
