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
  frameClassName,
  pageTitle,
}: {
  returnTo: string;
  demo: ReactNode;
  children: (getToken: GetToken) => ReactNode;
  /** Wraps the gate's own states (demo, loading, signed out) for a page that doesn't lay them out itself. */
  frameClassName?: string;
  /** For a page with no h1 of its own: its h1 in the gate's states ("sr-only" while loading). */
  pageTitle?: string;
}) {
  const auth = useOptionalAuth();
  const frame = (node: ReactNode) => (frameClassName ? <div className={frameClassName}>{node}</div> : <>{node}</>);
  if (!isApiConfigured || !auth?.configured) return frame(demo);
  if (auth.status === "loading") {
    return frame(
      <>
        {pageTitle && <h1 className="sr-only">{pageTitle}</h1>}
        <p className="text-sm text-muted">Loading…</p>
      </>,
    );
  }
  if (auth.status === "signed-out") {
    return frame(
      <EmptyState
        title="Sign in to see your messages"
        headingLevel={pageTitle ? 1 : undefined}
        action={
          <ButtonLink size="lg" href={withNext("/login", returnTo)} className="w-full sm:w-auto">
            Sign in
          </ButtonLink>
        }
      >
        Members going to the same event can message each other, starting from the event&rsquo;s Who&rsquo;s
        Going list.
      </EmptyState>,
    );
  }
  return <>{children(auth.getAccessToken)}</>;
}
