"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Section";
import type { GetToken } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { withNext } from "@/lib/safe-next-path";

/**
 * The dashboard's copy for someone without an approved organiser application.
 * `need`: what they're trying to do ("check people in at the door"); default "see analytics".
 */
export function NotApprovedOrganiser({
  status,
  need = "see analytics",
}: {
  status?: "pending" | "rejected";
  need?: string;
}) {
  return (
    <div className="bg-surface p-4">
      <p className="mb-3 text-foreground">
        {status === "pending"
          ? "Your organiser application is still pending review."
          : status === "rejected"
            ? "Your organiser application wasn't approved."
            : `You need an approved organiser application before you can ${need}.`}
      </p>
      <Link href="/organisers/apply" className="btn btn-solid">
        {status ? "View application" : "Apply as an organiser"}
      </Link>
    </div>
  );
}

/**
 * Everything before the reports (§5.19 states): demo mode, auth and
 * organiser loading, signed out, and not an approved organiser. Renders
 * `children` with a token getter once the viewer is an approved organiser.
 */
export default function AnalyticsGate({
  returnTo,
  children,
}: {
  /** Where sign-in comes back to. */
  returnTo: string;
  children: (getToken: GetToken) => ReactNode;
}) {
  const auth = useAuth();
  const { loading, organiser, error } = useOrganiser();

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }
  if (auth.status === "loading" || (auth.status === "signed-in" && loading)) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (auth.status === "signed-out") {
    return (
      <EmptyState
        title="Sign in to see your analytics"
        action={
          <ButtonLink size="lg" href={withNext("/login", returnTo)}>
            Sign in
          </ButtonLink>
        }
      />
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!organiser || organiser.status !== "approved") {
    return <NotApprovedOrganiser status={organiser?.status === "approved" ? undefined : organiser?.status} />;
  }
  return <>{children(auth.getAccessToken)}</>;
}
