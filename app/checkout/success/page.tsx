import type { Metadata } from "next";
import { Suspense } from "react";
import CheckoutConfirmation from "@/components/CheckoutConfirmation";
import DemoTicket from "@/components/tickets/DemoTicket";
import { isApiConfigured } from "@/lib/api/client";

// Neutral: the page can also say a payment wasn't completed, or an order wasn't found.
// CheckoutConfirmation sets the title for each answer once it has one.
export const metadata: Metadata = { title: "Your order — Sheltüh" };

export default function CheckoutSuccessPage() {
  return (
    // Latte's My ticket frames: a white panel on the muted page (16 / 24 padding on phones, where it's full-bleed;
    // radius 16 from 768), holding the ticket and its details (360 + 48 + the rest, 960 at most).
    <div className="bg-surface md:px-6 md:pt-6 md:pb-8 xl:px-16 xl:pt-8 xl:pb-16">
      <div className="mx-auto max-w-328 bg-card px-4 py-6 md:rounded-card md:p-6 lg:pt-14 lg:pr-10 lg:pb-10 lg:pl-12">
        <div className="max-w-240">
          {isApiConfigured ? (
            <Suspense fallback={<p className="py-10 text-sm text-muted">Loading&hellip;</p>}>
              <CheckoutConfirmation />
            </Suspense>
          ) : (
            // The demo has no orders: a sample ticket instead.
            <DemoTicket />
          )}
        </div>
      </div>
    </div>
  );
}
