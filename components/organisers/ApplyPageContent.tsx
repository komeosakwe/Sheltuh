"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import ApplicationForm from "@/components/organisers/ApplicationForm";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import type { OrganiserRecord } from "@/lib/api/types";

function StatusCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-4 text-foreground">{children}</div>
  );
}

export default function ApplyPageContent() {
  const auth = useAuth();
  const { loading, organiser, error, refetch } = useOrganiser();
  const [justSubmitted, setJustSubmitted] = useState<OrganiserRecord | null>(null);

  if (!auth.configured) {
    return (
      <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (auth.status === "loading" || loading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (auth.status === "signed-out") {
    return (
      <StatusCard>
        <p className="mb-3">Sign in or create an account to apply as an organiser.</p>
        <div className="flex gap-3">
          <Link href="/login" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
            Sign in
          </Link>
          <Link href="/signup" className="rounded border border-surface-border px-4 py-2 text-sm font-medium">
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
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded border border-surface-border px-4 py-2 text-sm font-medium"
        >
          Try again
        </button>
      </StatusCard>
    );
  }

  const current = justSubmitted ?? organiser;

  if (!current) {
    return (
      <div className="flex flex-col gap-6">
        <p className="text-sm text-muted">
          Tell us about your organisation. An admin reviews every application before you can
          submit events.
        </p>
        <ApplicationForm mode="apply" getToken={auth.getValidIdToken} onSuccess={setJustSubmitted} />
      </div>
    );
  }

  if (current.status === "pending") {
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

  if (current.status === "approved") {
    return (
      <StatusCard>
        <p className="font-heading text-2xl text-foreground">You&rsquo;re an approved organiser</p>
        <p className="mt-2 mb-3 text-sm text-muted">You can now create and submit events.</p>
        <Link href="/dashboard" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
          Go to your dashboard
        </Link>
      </StatusCard>
    );
  }

  // rejected
  return (
    <div className="flex flex-col gap-6">
      <StatusCard>
        <p className="font-heading text-2xl text-foreground">Application not approved</p>
        {current.rejectionReason && (
          <p className="mt-2 text-sm text-muted">Reviewer note: {current.rejectionReason}</p>
        )}
        <p className="mt-2 text-sm text-muted">Update the details below and resubmit.</p>
      </StatusCard>
      <ApplicationForm mode="resubmit" getToken={auth.getValidIdToken} initial={current} onSuccess={setJustSubmitted} />
    </div>
  );
}
