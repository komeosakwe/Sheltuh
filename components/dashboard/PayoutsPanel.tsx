"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { connectStripeOnboarding, refreshStripeConnectStatus } from "@/lib/api/organisers";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { LoadingState } from "@/components/ui/ProgressLoader";
import StatusBadge from "@/components/ui/StatusBadge";

export default function PayoutsPanel() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
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

  if (loading) return <LoadingState text="Loading…" />;
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!organiser || organiser.status !== "approved") {
    return <p className="text-sm text-muted">Payouts open once your application is approved.</p>;
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
    <div className="flex flex-col gap-3 border-t border-foreground pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-xl text-foreground">Stripe account</h2>
        <StatusBadge tone={enabled ? "approved" : "pending"}>{enabled ? "Connected" : "Not set up"}</StatusBadge>
      </div>

      {syncing && <p className="text-sm text-muted">Checking your Stripe status&hellip;</p>}

      <p className="text-sm text-muted">
        {enabled
          ? "Payouts are on."
          : "Needed before you sell paid tickets."}
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
        className="btn btn-solid w-fit"
      >
        {connecting ? "Redirecting to Stripe…" : enabled ? "Update payout details" : "Connect with Stripe"}
      </button>
    </div>
  );
}
