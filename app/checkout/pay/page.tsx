import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import CheckoutPayment, { CheckoutPaymentLoading } from "@/components/checkout/CheckoutPayment";

// next.config.ts also sends noindex and no-referrer for every /checkout page (the order id is a credential).
export const metadata: Metadata = {
  title: "Checkout — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The payment step (docs/design/checkout-pay.md): the order's summary beside Stripe's embedded form.
 * Rendered per request: proxy.ts gives this page a Content Security Policy with a fresh nonce, which
 * Next puts on its scripts while rendering (a prerendered page would have none).
 */
export default async function CheckoutPayPage() {
  await connection();
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      {/* CheckoutPayment reads the order from useSearchParams, inside a Suspense boundary. */}
      <Suspense fallback={<CheckoutPaymentLoading />}>
        <CheckoutPayment />
      </Suspense>
    </div>
  );
}
