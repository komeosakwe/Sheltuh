"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import ApplicationForm from "@/components/organisers/ApplicationForm";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import type { OrganiserRecord } from "@/lib/api/types";
import { accountKey } from "@/lib/auth/account";
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

/** An application just submitted from the form, and the account it was submitted as. */
interface Submitted {
  record: OrganiserRecord;
  account: string;
}

export default function ApplyPageContent() {
  const auth = useAuth();
  const account = accountKey(auth);
  const { loading, organiser, error, refetch, refreshing } = useOrganiser();
  const [justSubmitted, setJustSubmitted] = useState<Submitted | null>(null);

  // What was just submitted is only ever this account's own (never shown to another that signs in).
  const current = justSubmitted && justSubmitted.account === account ? justSubmitted.record : organiser;
  // Signed in, with this account's application (or none) loaded, or failed to load.
  const settled = auth.status === "signed-in" && !loading;
  // The record the form was last shown for (false: an error was shown, no
  // form): kept while the session has run out (or another account's is
  // loading), so the form stays mounted with what's typed and its own
  // recovery can sign in again in place. Not after the person's own Sign out.
  const kept = useKeptWhileSignedOut<OrganiserRecord | null | false>(error ? false : current, settled);
  const keptForm = !settled && kept && kept.value !== false ? formViewFor(kept.value) : null;
  const onSuccess = (record: OrganiserRecord, as: string) => setJustSubmitted({ record, account: as });
  // Owner (26 Oct 2026): "if someone is already an organiser clicking for organiser should take them
  // to the dashboard". Every "For organisers" link lands here, so an approved organiser goes straight on.
  const router = useRouter();
  const approved = settled && !error && current?.status === "approved";
  useEffect(() => {
    if (approved) router.replace("/dashboard");
  }, [approved, router]);

  if (!auth.configured) {
    return (
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (keptForm && kept) return <FormSection view={keptForm} account={kept.account} onSuccess={onSuccess} />;

  if (auth.status === "loading" || loading) {
    return <LoadingState text="Loading…" />;
  }

  if (auth.status === "signed-out") {
    return (
      <StatusCard>
        <p className="mb-3">Sign in to apply as an organiser.</p>
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
  if (form) return <FormSection view={form} account={account ?? ""} onSuccess={onSuccess} />;

  if (current?.status === "pending") {
    return (
      <StatusCard>
        <p className="font-heading text-2xl text-foreground">Application pending</p>
        <p className="mt-2 text-sm text-muted">
          Waiting on admin review. We&rsquo;ll let you know once it&rsquo;s decided.
        </p>
      </StatusCard>
    );
  }

  // Shown only for the moment before the redirect above (or if it's blocked).
  return (
    <StatusCard>
      <p className="font-heading text-2xl text-foreground">You&rsquo;re an approved organiser</p>
      <p role="status" className="mt-2 mb-3 text-sm text-muted">
        Taking you to your dashboard…
      </p>
      <Link href="/dashboard" className="btn btn-solid">
        Go to your dashboard
      </Link>
    </StatusCard>
  );
}

/**
 * The application form and what's said above it. One component for both the
 * kept and the settled view, at the same place in the tree, so going from one
 * to the other never remounts the form (which would lose what's typed). Keyed
 * by `account` (the one it was shown for), so another account gets a new form.
 */
function FormSection({
  view,
  account,
  onSuccess,
}: {
  view: FormView;
  account: string;
  onSuccess: (record: OrganiserRecord, account: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {view.mode === "apply" ? null : (
        <StatusCard>
          <p className="font-heading text-2xl text-foreground">Application not approved</p>
          {view.record.rejectionReason && (
            <p className="mt-2 text-sm text-muted">Reviewer note: {view.record.rejectionReason}</p>
          )}
        </StatusCard>
      )}
      <ApplicationForm
        key={`${account}\n${view.mode}`}
        mode={view.mode}
        initial={view.mode === "resubmit" ? view.record : undefined}
        onSuccess={(record) => onSuccess(record, account)}
      />
    </div>
  );
}
