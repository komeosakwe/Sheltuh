"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import ApplicationForm from "@/components/organisers/ApplicationForm";
import { buttonClass, Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import type { OrganiserRecord } from "@/lib/api/types";
import { accountKey } from "@/lib/auth/account";
import { useAuth } from "@/lib/auth/AuthContext";
import { useKeptWhileSignedOut } from "@/lib/auth/useKeptWhileSignedOut";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { withNext } from "@/lib/safe-next-path";
import { START_TITLE_ID } from "./organisers-content";

/**
 * The Start organising panel's h2 (the panel, on OrganisersPage, is labelled by it): what this
 * state is, so every state has one.
 */
function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <h2 id={START_TITLE_ID} className="heading-h1 text-balance">
      {children}
    </h2>
  );
}

/** The panel's heading and what's under it, for the states with a body. */
function PanelState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PanelTitle>{title}</PanelTitle>
      {children}
    </div>
  );
}

/** The panel's heading before an application (and in the demo, or while loading). */
const APPLY_TITLE = "Become an organiser";
/** The mock's line under the heading (the owner's estimate). */
const TAKES_FIVE_MINUTES = "Takes about five minutes.";

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
      <PanelState title={APPLY_TITLE}>
        <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
          Accounts aren&rsquo;t configured in this environment yet.
        </p>
      </PanelState>
    );
  }

  if (keptForm && kept) return <FormSection view={keptForm} account={kept.account} onSuccess={onSuccess} />;

  if (auth.status === "loading" || loading) {
    return (
      <PanelState title={APPLY_TITLE}>
        <LoadingState text="Loading…" />
      </PanelState>
    );
  }

  if (auth.status === "signed-out") {
    return (
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
        <div className="flex min-w-0 flex-col gap-4">
          <PanelTitle>Sign in to apply as an organiser.</PanelTitle>
          <p className="body-m text-muted">{TAKES_FIVE_MINUTES}</p>
        </div>
        {/* Stacked on phones: two side by side don't fit "Create an account" at 320px. */}
        <div className="flex shrink-0 flex-col gap-4 sm:flex-row">
          <Link href={withNext("/login", APPLY_PATH)} className={buttonClass("solid", "md", "w-full sm:w-auto")}>
            Sign in
          </Link>
          <Link href={withNext("/signup", APPLY_PATH)} className={buttonClass("outline", "md", "w-full sm:w-auto")}>
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <PanelState title={APPLY_TITLE}>
        <p role="alert" className="text-danger">
          {error}
        </p>
        <Button variant="outline" busy={refreshing} onClick={() => void refetch()} className="self-start">
          {refreshing ? "Trying again…" : "Try again"}
        </Button>
      </PanelState>
    );
  }

  const form = formViewFor(current);
  if (form) return <FormSection view={form} account={account ?? ""} onSuccess={onSuccess} />;

  if (current?.status === "pending") {
    return (
      <PanelState title="Application pending">
        <p className="body-m text-muted">
          Waiting on admin review. We&rsquo;ll let you know once it&rsquo;s decided.
        </p>
      </PanelState>
    );
  }

  // Shown only for the moment before the redirect above (or if it's blocked).
  return (
    <PanelState title={<>You&rsquo;re an approved organiser</>}>
      <p role="status" className="body-m text-muted">
        Taking you to your dashboard…
      </p>
      <Link href="/dashboard" className={buttonClass("solid", "md", "self-start")}>
        Go to your dashboard
      </Link>
    </PanelState>
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
    <div className="flex flex-col gap-8">
      {view.mode === "apply" ? (
        <PanelState title={APPLY_TITLE}>
          <p className="body-m text-muted">{TAKES_FIVE_MINUTES}</p>
        </PanelState>
      ) : (
        <PanelState title="Application not approved">
          {view.record.rejectionReason && (
            <p className="body-m text-muted">Reviewer note: {view.record.rejectionReason}</p>
          )}
        </PanelState>
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
