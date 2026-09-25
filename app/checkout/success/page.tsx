import type { Metadata } from "next";
import { Suspense } from "react";
import CheckoutConfirmation from "@/components/CheckoutConfirmation";

export const metadata: Metadata = { title: "Order confirmed — Sheltüh" };

export default function CheckoutSuccessPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col px-4 sm:px-6">
      <Suspense fallback={<p className="py-16 text-center text-sm text-muted">Loading&hellip;</p>}>
        <CheckoutConfirmation />
      </Suspense>
    </div>
  );
}
