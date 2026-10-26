import type { Metadata } from "next";
import { Suspense } from "react";
import CheckoutConfirmation from "@/components/CheckoutConfirmation";

// Neutral: the page can also say a payment wasn't completed, or an order wasn't found.
// CheckoutConfirmation sets the title for each answer once it has one.
export const metadata: Metadata = { title: "Your order — Sheltüh" };

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
