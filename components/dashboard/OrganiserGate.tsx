"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { PageHeader } from "@/components/ui/Section";
import type { OrganiserRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";

/**
 * An organiser dashboard page's way in: the page itself (`children`, given the approved organiser)
 * for a signed-in approved organiser; otherwise the page's title (`title`, an h1 under the
 * "Organiser" strap) and why there's nothing to manage yet, with the way forward: accounts not set
 * up here (demo mode), loading, signed out (Sign in), the organiser record failing to load, or no
 * approved application (Apply, or View application while it's pending or wasn't approved). These
 * are the states the events list has always had, so
 * every dashboard page says them the same way. Unframed: the frame is only for approved organisers
 * (OrganiserShell).
 */
export default function OrganiserGate({
  title,
  signInText,
  children,
}: {
  title: string;
  /** "Sign in to see your events." */
  signInText: string;
  children: (organiser: OrganiserRecord) => ReactNode;
}) {
  const auth = useAuth();
  const { loading, organiser, error } = useOrganiser();

  if (auth.configured && auth.status === "signed-in" && !loading && !error && organiser?.status === "approved") {
    return <>{children(organiser)}</>;
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader flush size="md" eyebrow="Organiser" title={title} />
      {body()}
    </div>
  );

  function body() {
    if (!auth.configured) {
      return (
        <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
          Accounts aren&rsquo;t configured in this environment yet.
        </p>
      );
    }
    if (auth.status === "loading" || loading) return <LoadingState text="Loading…" />;
    if (auth.status === "signed-out") {
      return (
        <div className="border-t border-foreground pt-5">
          <p className="mb-4 text-foreground">{signInText}</p>
          <Link href="/login" className="btn btn-solid">
            Sign in
          </Link>
        </div>
      );
    }
    if (error) {
      return (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      );
    }
    return (
      <div className="border-t border-foreground pt-5">
        <p className="mb-4 text-foreground">
          {organiser?.status === "pending"
            ? "Your organiser application is still pending review."
            : organiser?.status === "rejected"
              ? "Your organiser application wasn't approved."
              : "You need an approved organiser application before you can create events."}
        </p>
        <Link href="/organisers/apply" className="btn btn-solid">
          {organiser ? "View application" : "Apply as an organiser"}
        </Link>
      </div>
    );
  }
}
