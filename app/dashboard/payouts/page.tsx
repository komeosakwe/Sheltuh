import type { Metadata } from "next";
import { Suspense } from "react";
import PayoutsPanel from "@/components/dashboard/PayoutsPanel";

export const metadata: Metadata = { title: "Payouts — Sheltüh" };

export default function PayoutsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="font-heading text-4xl text-foreground sm:text-5xl">Payouts</h1>
      <Suspense fallback={<p className="text-sm text-muted">Loading&hellip;</p>}>
        <PayoutsPanel />
      </Suspense>
    </div>
  );
}
