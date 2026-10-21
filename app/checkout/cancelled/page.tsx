import type { Metadata } from "next";
import { Suspense } from "react";
import CheckoutCancelled from "@/components/seating/CheckoutCancelled";
import { DotsLoader } from "@/components/brand/DotsMark";

// next.config.ts sends noindex and no-referrer for every /checkout page (the order id is a credential).
export const metadata: Metadata = {
  title: "Checkout cancelled — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Stripe's cancel_url for a seated checkout (docs/design/seating.md §5.12): releases the held seats. */
export default function CheckoutCancelledPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <div className="flex max-w-2xl flex-col">
        <Suspense
          fallback={
            <div className="py-10 sm:py-14">
              <DotsLoader announce label="Releasing your seats" />
            </div>
          }
        >
          <CheckoutCancelled />
        </Suspense>
      </div>
    </div>
  );
}
