import type { Metadata } from "next";
import { Suspense } from "react";
import PayoutsPanel from "@/components/dashboard/PayoutsPanel";

export const metadata: Metadata = { title: "Payouts — Sheltüh" };

export default function PayoutsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20">
      <h1 className="display-lg">Payouts</h1>
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <PayoutsPanel />
      </Suspense>
    </div>
  );
}
