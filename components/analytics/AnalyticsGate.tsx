"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Section";
import type { GetToken } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { withNext } from "@/lib/safe-next-path";
import { LoadingState } from "@/components/ui/ProgressLoader";

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
    <div className="rounded-card border border-foreground bg-card p-4">
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
 * Every state is the page's whole content, so each has the page's h1:
 * `title` ("Analytics"), or the sign-in prompt itself.
 */
export default function AnalyticsGate({
  title,
  returnTo,
  children,
}: {
  /** The page's h1 while the gate is showing (the report has its own). */
  title: string;
  /** Where sign-in comes back to. */
  returnTo: string;
  children: (getToken: GetToken) => ReactNode;
}) {
  const auth = useAuth();
  const { loading, organiser, error } = useOrganiser();
  const heading = <h1 className="display-md mb-8">{title}</h1>;

  if (!auth.configured) {
    return (
      <>
        {heading}
        <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
          Accounts aren&rsquo;t configured in this environment yet.
        </p>
      </>
    );
  }
  if (auth.status === "loading" || (auth.status === "signed-in" && loading)) {
    return (
      <>
        {heading}
        <LoadingState text="Loading your account…" />
      </>
    );
  }
  if (auth.status === "signed-out") {
    return (
      <EmptyState
        headingLevel={1}
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
      <>
        {heading}
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      </>
    );
  }
  if (!organiser || organiser.status !== "approved") {
    return (
      <>
        {heading}
        <NotApprovedOrganiser status={organiser?.status === "approved" ? undefined : organiser?.status} />
      </>
    );
  }
  return <>{children(auth.getAccessToken)}</>;
}
