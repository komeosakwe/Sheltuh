"use client";

import Link from "next/link";
import PublicProfileForm from "@/components/dashboard/PublicProfileForm";
import { ButtonLink } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";

/** The dashboard's public profile editor: available once the organiser is approved. */
export default function PublicProfilePanel() {
  const auth = useAuth();
  const { loading, organiser, error, refetch } = useOrganiser();

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (auth.status === "loading" || loading) {
    return (
      <p role="status" className="text-sm text-muted">
        Loading&hellip;
      </p>
    );
  }

  if (auth.status === "signed-out") {
    return (
      <div className="bg-surface p-4">
        <p className="mb-3 text-foreground">Sign in to edit your organiser profile.</p>
        <Link href="/login" className="btn btn-solid">
          Sign in
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
        <button type="button" onClick={() => refetch()} className="btn btn-outline">
          Try again
        </button>
      </div>
    );
  }

  if (!organiser || organiser.status !== "approved") {
    return (
      <div className="bg-surface p-4">
        <p className="mb-3 text-foreground">
          Your public profile goes live once your organiser application is approved.
        </p>
        <Link href="/organisers/apply" className="btn btn-solid">
          {organiser ? "View application" : "Apply as an organiser"}
        </Link>
      </div>
    );
  }

  const profileHref = `/organisers/${encodeURIComponent(organiser.organiserId)}`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-start gap-4 border-t border-foreground pt-5">
        <p className="text-sm text-muted">
          Changes here go live straight away, without a new review. To change your organiser name, contact
          email or categories, contact us.
        </p>
        <ButtonLink href={profileHref} variant="outline" size="lg">
          View public profile
        </ButtonLink>
      </div>
      <PublicProfileForm organiser={organiser} getToken={auth.getAccessToken} />
    </div>
  );
}
