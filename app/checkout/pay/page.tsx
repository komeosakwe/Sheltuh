import type { Metadata } from "next";
import { Suspense } from "react";
import CheckoutPayment, { CheckoutPaymentLoading } from "@/components/checkout/CheckoutPayment";

// next.config.ts also sends noindex and no-referrer for every /checkout page (the order id is a credential).
export const metadata: Metadata = {
  title: "Checkout — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** The payment step (docs/design/checkout-pay.md): the order's summary beside Stripe's embedded form. */
export default function CheckoutPayPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      {/* useSearchParams needs a Suspense boundary on a prerendered page. */}
      <Suspense fallback={<CheckoutPaymentLoading />}>
        <CheckoutPayment />
      </Suspense>
    </div>
  );
}
