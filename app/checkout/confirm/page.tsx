import type { Metadata } from "next";
import FreeOrderConfirm from "@/components/FreeOrderConfirm";

// next.config.ts also sends noindex and no-referrer for every /checkout page.
export const metadata: Metadata = {
  title: "Confirm your free tickets — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ConfirmFreeTicketsPage() {
  return (
    // The site's page edges, with a left-aligned max-w-2xl column.
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <div className="flex max-w-2xl flex-col">
        <FreeOrderConfirm />
      </div>
    </div>
  );
}
