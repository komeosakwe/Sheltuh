"use client";

import Link from "next/link";
import OrganiserLogoField from "@/components/dashboard/OrganiserLogoField";
import PublicProfileForm from "@/components/dashboard/PublicProfileForm";
import { ButtonLink } from "@/components/ui/Button";
import type { GetToken } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import { accountKey } from "@/lib/auth/account";
import { useAuth } from "@/lib/auth/AuthContext";
import { useKeptWhileSignedOut } from "@/lib/auth/useKeptWhileSignedOut";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { withNext } from "@/lib/safe-next-path";

/** Where signing in from here comes back to. */
const RETURN_TO = "/dashboard/profile";

/**
 * The dashboard's public profile editor: available once the organiser is
 * approved (the logo too: the API refuses one before then). Never in the
 * demo, which has no accounts.
 */
export default function PublicProfilePanel() {
  const auth = useAuth();
  const { loading, organiser, error, refetch } = useOrganiser();
  // Signed in, with this account's organiser loaded, or failed to load.
  const settled = auth.status === "signed-in" && !loading;
  // The approved organiser the form was last shown for: kept while the session
  // has run out (or another account's is loading), so the form stays mounted
  // with the unsaved changes and its own recovery can sign in again in place.
  // Not after the person's own Sign out; keyed by account, so another account
  // never gets this one's form.
  const kept = useKeptWhileSignedOut(organiser?.status === "approved" && !error ? organiser : null, settled);
  const editing = !settled ? kept : undefined;

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (editing?.value) return <ProfileEditor key={editing.account} organiser={editing.value} getToken={auth.getAccessToken} />;

  if (auth.status === "loading" || loading) {
    return (
      <p role="status" className="text-sm text-muted">
        Loading&hellip;
      </p>
    );
  }

  if (auth.status === "signed-out") {
    return (
      <div className="rounded-card border border-foreground bg-card p-4">
        <p className="mb-3 text-foreground">Sign in to edit your organiser profile.</p>
        <Link href={withNext("/login", RETURN_TO)} className="btn btn-solid min-h-11">
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
        <button type="button" onClick={() => refetch()} className="btn btn-outline min-h-11">
          Try again
        </button>
      </div>
    );
  }

  if (!organiser || organiser.status !== "approved") {
    return (
      <div className="rounded-card border border-foreground bg-card p-4">
        <p className="mb-3 text-foreground">
          Your public profile goes live once your organiser application is approved.
        </p>
        <Link href="/organisers/apply" className="btn btn-solid min-h-11">
          {organiser ? "View application" : "Apply as an organiser"}
        </Link>
      </div>
    );
  }

  return <ProfileEditor key={accountKey(auth) ?? ""} organiser={organiser} getToken={auth.getAccessToken} />;
}

/** One component wherever it's shown from, so the form is never remounted (losing edits). */
function ProfileEditor({ organiser, getToken }: { organiser: OrganiserRecord; getToken: GetToken }) {
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
      <OrganiserLogoField organiser={organiser} getToken={getToken} />
      <PublicProfileForm organiser={organiser} />
    </div>
  );
}
