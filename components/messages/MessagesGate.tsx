"use client";

import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Section";
import { isApiConfigured, type GetToken } from "@/lib/api/client";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { withNext } from "@/lib/safe-next-path";

/**
 * The shared front door of the messages pages. Demo mode (no API) renders
 * `demo` and never calls the API; while auth resolves it says so; signed out
 * it offers Sign in, coming back to `returnTo`. Otherwise it renders the
 * page with a token getter. Whether the member is verified is the API's call
 * (403), which each page explains.
 */
export default function MessagesGate({
  returnTo,
  demo,
  children,
}: {
  returnTo: string;
  demo: ReactNode;
  children: (getToken: GetToken) => ReactNode;
}) {
  const auth = useOptionalAuth();
  if (!isApiConfigured || !auth?.configured) return <>{demo}</>;
  if (auth.status === "loading") return <p className="text-sm text-muted">Loading…</p>;
  if (auth.status === "signed-out") {
    return (
      <EmptyState
        title="Sign in to see your messages"
        action={
          <ButtonLink size="lg" href={withNext("/login", returnTo)} className="w-full sm:w-auto">
            Sign in
          </ButtonLink>
        }
      >
        Members going to the same event can message each other, starting from the event&rsquo;s Who&rsquo;s
        Going list.
      </EmptyState>
    );
  }
  return <>{children(auth.getAccessToken)}</>;
}
