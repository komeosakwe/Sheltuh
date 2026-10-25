import type { Metadata } from "next";
import SignedInNotice from "@/components/auth/SignedInNotice";

export const metadata: Metadata = {
  title: "Signed in — Sheltüh",
  robots: { index: false, follow: false },
};

/**
 * Where "Sign in in a new tab" (components/auth/InlineReauth.tsx) lands once
 * the sign-in is done: the draft is in the other tab. Not under /auth, which
 * a sign-in's `next` may never be (lib/auth/oauth.ts oauthReturnPath).
 */
export default function SignedInPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="flex max-w-md flex-col gap-8">
        <SignedInNotice />
      </div>
    </div>
  );
}
