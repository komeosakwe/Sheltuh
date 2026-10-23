import type { Metadata } from "next";
import { Suspense } from "react";
import CheckoutConfirmation from "@/components/CheckoutConfirmation";

export const metadata: Metadata = { title: "Order confirmed — Sheltüh" };

export default function CheckoutSuccessPage() {
  return (
    // The site's page edges (max-w-6xl, px-5 / sm:px-8), with a left-aligned max-w-2xl column.
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <div className="flex max-w-2xl flex-col">
        <Suspense fallback={<p className="py-10 text-sm text-muted">Loading&hellip;</p>}>
          <CheckoutConfirmation />
        </Suspense>
      </div>
    </div>
  );
}
