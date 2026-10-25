"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, isApiConfigured, type GetToken } from "@/lib/api/client";
import { getMyOrganiser } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { useAuth } from "./AuthContext";

interface OrganiserResult {
  /** null = signed in but no application on file yet. */
  organiser: OrganiserRecord | null;
  error: string | null;
}

/** A result, and the account it was fetched for. */
interface Fetched extends OrganiserResult {
  account: string;
}

async function fetchOrganiser(getToken: GetToken): Promise<OrganiserResult> {
  try {
    const organiser = await getMyOrganiser(getToken);
    return { organiser, error: null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { organiser: null, error: null };
    }
    return { organiser: null, error: err instanceof Error ? err.message : "Couldn't load your organiser status." };
  }
}

const API_NOT_CONFIGURED = "The live API is not configured in this environment.";

/**
 * Loads (and lets callers refetch) the signed-in user's own organiser
 * application. A result belongs to the account it was fetched for: after a
 * sign-out and a sign-in (the same account or another) it's `loading` until
 * that account's own has arrived, never showing the last one's. A token
 * refresh fetches nothing. `refetch` keeps the current result while it runs
 * (`refreshing`), so a page never swaps what it shows (a form being filled
 * in, above all) for a loader.
 */
export function useOrganiser() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const account = auth.status === "signed-in" ? (auth.userId ?? auth.email ?? "") : null;
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Explicit re-fetch for use after a user action (submit, resubmit, try
  // again) — never called directly from an effect body.
  const refetch = useCallback(async () => {
    if (!isApiConfigured || account === null) return;
    setRefreshing(true);
    const result = await fetchOrganiser(getToken);
    setFetched({ ...result, account });
    setRefreshing(false);
  }, [account, getToken]);

  // Each account's own, once it's signed in.
  useEffect(() => {
    if (!isApiConfigured || account === null) return;
    let cancelled = false;
    fetchOrganiser(getToken).then((result) => {
      if (!cancelled) setFetched({ ...result, account });
    });
    return () => {
      cancelled = true;
    };
  }, [account, getToken]);

  let state: OrganiserResult & { loading: boolean };
  if (!isApiConfigured) state = { loading: false, organiser: null, error: API_NOT_CONFIGURED };
  else if (auth.status === "loading") state = { loading: true, organiser: null, error: null };
  else if (account === null) state = { loading: false, organiser: null, error: null };
  else if (!fetched || fetched.account !== account) state = { loading: true, organiser: null, error: null };
  else state = { loading: false, organiser: fetched.organiser, error: fetched.error };

  return { ...state, refreshing, refetch, authStatus: auth.status };
}
