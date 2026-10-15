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
    <div className="mx-auto flex max-w-2xl flex-col px-4 sm:px-6">
      <FreeOrderConfirm />
    </div>
  );
}
