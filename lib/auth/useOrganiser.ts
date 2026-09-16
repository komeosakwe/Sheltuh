"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { getMyOrganiser } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { useAuth } from "./AuthContext";

interface OrganiserQueryState {
  loading: boolean;
  /** null = signed in but no application on file yet. */
  organiser: OrganiserRecord | null;
  error: string | null;
}

async function fetchOrganiser(idToken: string): Promise<OrganiserQueryState> {
  try {
    const organiser = await getMyOrganiser(idToken);
    return { loading: false, organiser, error: null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { loading: false, organiser: null, error: null };
    }
    return { loading: false, organiser: null, error: err instanceof Error ? err.message : "Couldn't load your organiser status." };
  }
}

/** Loads (and lets callers refetch) the signed-in user's own organiser application. */
export function useOrganiser() {
  const auth = useAuth();
  const [state, setState] = useState<OrganiserQueryState>(() =>
    isApiConfigured
      ? { loading: true, organiser: null, error: null }
      : { loading: false, organiser: null, error: "The live API is not configured in this environment." },
  );

  // Explicit re-fetch for use after a user action (submit, resubmit) —
  // never called directly from an effect body.
  const refetch = useCallback(async () => {
    if (!isApiConfigured || auth.status !== "signed-in" || !auth.idToken) return;
    setState((s) => ({ ...s, loading: true }));
    setState(await fetchOrganiser(auth.idToken));
  }, [auth.status, auth.idToken]);

  useEffect(() => {
    if (!isApiConfigured || auth.status === "loading") return;
    let cancelled = false;

    if (auth.status !== "signed-in" || !auth.idToken) {
      queueMicrotask(() => {
        if (!cancelled) setState({ loading: false, organiser: null, error: null });
      });
      return () => {
        cancelled = true;
      };
    }

    fetchOrganiser(auth.idToken).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.idToken]);

  return { ...state, refetch, authStatus: auth.status };
}
