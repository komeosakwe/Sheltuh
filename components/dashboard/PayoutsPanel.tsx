"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { connectStripeOnboarding, refreshStripeConnectStatus } from "@/lib/api/organisers";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";

export default function PayoutsPanel() {
  const auth = useAuth();
  const getToken = auth.getValidIdToken;
  const { loading, organiser, error, refetch } = useOrganiser();
  const searchParams = useSearchParams();
  const returnedFromStripe = searchParams.get("connected") === "1" || searchParams.get("refresh") === "1";
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const hasSynced = useRef(false);

  // Landing back here from Stripe's hosted onboarding — sync the real
  // account status once rather than trusting the URL flag on its own.
  useEffect(() => {
    if (!returnedFromStripe || hasSynced.current || auth.status !== "signed-in") return;
    hasSynced.current = true;
    let cancelled = false;
    setSyncing(true);
    refreshStripeConnectStatus(getToken)
      .then(() => {
        if (!cancelled) refetch();
      })
      .catch(() => {
        // Best-effort — the organiser can still see their real status
        // below once GET /organisers/me itself reflects it later.
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [returnedFromStripe, auth.status, getToken, refetch]);

  if (loading) return <p className="text-sm text-muted">Loading&hellip;</p>;
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!organiser || organiser.status !== "approved") {
    return <p className="text-sm text-muted">Payouts are set up once your organiser application is approved.</p>;
  }

  const enabled = Boolean(organiser.payoutsEnabled);

  async function handleConnect() {
    setActionError(null);
    setConnecting(true);
    try {
      const result = await connectStripeOnboarding(getToken);
      window.location.href = result.url;
      // Deliberately no setConnecting(false) — the page is navigating away.
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't start Stripe onboarding.");
      setConnecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-xl text-foreground">Payouts</h2>
        <span
          className={`rounded px-2 py-1 text-xs font-medium uppercase tracking-wide ${
            enabled ? "bg-accent/15 text-accent" : "bg-background text-muted"
          }`}
        >
          {enabled ? "Connected" : "Not set up"}
        </span>
      </div>

      {syncing && <p className="text-sm text-muted">Checking your Stripe status&hellip;</p>}

      <p className="text-sm text-muted">
        {enabled
          ? "Stripe is set up to pay out ticket sales for your events."
          : "Connect a Stripe account before selling paid tickets. Free events don't need this."}
      </p>

      {actionError && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}

      <button
        type="button"
        onClick={handleConnect}
        disabled={connecting}
        className="w-fit rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {connecting ? "Redirecting to Stripe…" : enabled ? "Update payout details" : "Connect with Stripe"}
      </button>
    </div>
  );
}
