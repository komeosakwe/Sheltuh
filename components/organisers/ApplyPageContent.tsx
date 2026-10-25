"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import ApplicationForm from "@/components/organisers/ApplicationForm";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import type { GetToken } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { useKeptWhileSignedOut } from "@/lib/auth/useKeptWhileSignedOut";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { withNext } from "@/lib/safe-next-path";

function StatusCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-foreground bg-card p-4 text-foreground">{children}</div>
  );
}

/** Signing in or up from here comes back here (any way of signing in: email, Apple or Google). */
const APPLY_PATH = "/organisers/apply";

/** Which form the page shows: a first application, or a resubmission of a rejected one. */
type FormView = { mode: "apply" } | { mode: "resubmit"; record: OrganiserRecord };

function formViewFor(current: OrganiserRecord | null): FormView | null {
  if (!current) return { mode: "apply" };
  if (current.status === "rejected") return { mode: "resubmit", record: current };
  return null;
}

export default function ApplyPageContent() {
  const auth = useAuth();
  const { loading, organiser, error, refetch, refreshing } = useOrganiser();
  const [justSubmitted, setJustSubmitted] = useState<OrganiserRecord | null>(null);

  const current = justSubmitted ?? organiser;
  // Signed in, with this account's application (or none) loaded.
  const settled = auth.status === "signed-in" && !loading && !error;
  // The record the form was last shown for: kept while the session has run
  // out (or another account's is loading), so the form stays mounted with
  // what's typed and its own recovery can sign in again in place.
  const kept = useKeptWhileSignedOut(current, settled);
  const keptForm = !settled && kept !== undefined ? formViewFor(kept) : null;

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (keptForm) return <FormSection view={keptForm} getToken={auth.getAccessToken} onSuccess={setJustSubmitted} />;

  if (auth.status === "loading" || loading) {
    return <LoadingState text="Loading…" />;
  }

  if (auth.status === "signed-out") {
    return (
      <StatusCard>
        <p className="mb-3">Sign in or create an account to apply as an organiser.</p>
        <div className="flex gap-3">
          <Link href={withNext("/login", APPLY_PATH)} className="btn btn-solid">
            Sign in
          </Link>
          <Link href={withNext("/signup", APPLY_PATH)} className="btn btn-outline">
            Sign up
          </Link>
        </div>
      </StatusCard>
    );
  }

  if (error) {
    return (
      <StatusCard>
        <p role="alert" className="mb-3 text-danger">
          {error}
        </p>
        <Button variant="outline" busy={refreshing} onClick={() => void refetch()}>
          {refreshing ? "Trying again…" : "Try again"}
        </Button>
      </StatusCard>
    );
  }

  const form = formViewFor(current);
  if (form) return <FormSection view={form} getToken={auth.getAccessToken} onSuccess={setJustSubmitted} />;

  if (current?.status === "pending") {
    return (
      <StatusCard>
        <p className="font-heading text-2xl text-foreground">Application pending</p>
        <p className="mt-2 text-sm text-muted">
          Thanks — your organiser application is waiting on admin review. We&rsquo;ll let you know
          once it&rsquo;s been decided.
        </p>
      </StatusCard>
    );
  }

  return (
    <StatusCard>
      <p className="font-heading text-2xl text-foreground">You&rsquo;re an approved organiser</p>
      <p className="mt-2 mb-3 text-sm text-muted">You can now create and submit events.</p>
      <Link href="/dashboard" className="btn btn-solid">
        Go to your dashboard
      </Link>
    </StatusCard>
  );
}

/**
 * The application form and what's said above it. One component for both the
 * kept and the settled view, at the same place in the tree, so going from one
 * to the other never remounts the form (which would lose what's typed).
 */
function FormSection({
  view,
  getToken,
  onSuccess,
}: {
  view: FormView;
  getToken: GetToken;
  onSuccess: (record: OrganiserRecord) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {view.mode === "apply" ? (
        <p className="text-sm text-muted">
          Tell us about your organisation. An admin reviews every application before you can
          submit events.
        </p>
      ) : (
        <StatusCard>
          <p className="font-heading text-2xl text-foreground">Application not approved</p>
          {view.record.rejectionReason && (
            <p className="mt-2 text-sm text-muted">Reviewer note: {view.record.rejectionReason}</p>
          )}
          <p className="mt-2 text-sm text-muted">Update the details below and resubmit.</p>
        </StatusCard>
      )}
      <ApplicationForm
        key={view.mode}
        mode={view.mode}
        getToken={getToken}
        initial={view.mode === "resubmit" ? view.record : undefined}
        onSuccess={onSuccess}
      />
    </div>
  );
}
