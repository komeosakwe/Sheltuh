import type { Metadata } from "next";
import OAuthCallback from "@/components/auth/OAuthCallback";

// The URL carries a one-time sign-in code. next.config.ts also sends
// noindex and no-referrer for every /auth page.
export const metadata: Metadata = {
  title: "Signing in — Sheltüh",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function OAuthCallbackPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-md flex-col">
        <OAuthCallback />
      </div>
    </div>
  );
}
