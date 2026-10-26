"use client";

import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth/AuthContext";
import { withNext } from "@/lib/safe-next-path";

/**
 * /signed-in: the end of a sign-in started from another tab's "Sign in in a
 * new tab". The other tab has already noticed; this one only says to go
 * back. Should someone arrive here signed out, it says so instead.
 */
export default function SignedInNotice() {
  const auth = useAuth();

  if (auth.configured && auth.status === "signed-out") {
    return (
      <>
        <PageHeader flush eyebrow="Account" title="You’re not signed in" />
        <p className="text-base leading-6 text-muted">Sign in, then go back to your other tab to finish.</p>
        <div>
          <ButtonLink variant="solid" size="lg" href={withNext("/login", "/signed-in")} className="w-full sm:w-auto">
            Sign in
          </ButtonLink>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader flush eyebrow="Account" title="You’re signed in" />
      <p className="text-base leading-6 text-muted">Go back to your other tab to finish. You can close this one.</p>
    </>
  );
}
