"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, isApiConfigured, type GetToken } from "@/lib/api/client";
import { getMyOrganiser } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { accountKey } from "./account";
import { createAccountStore } from "./account-store";
import { isTransientFailure } from "./transient-failure";
import { useAccountToken } from "./useAccountToken";
import { AccountMismatchError, useAuth } from "./AuthContext";

interface OrganiserResult {
  /** null = signed in but no application on file yet. */
  organiser: OrganiserRecord | null;
  error: string | null;
  /** The error is a passing one (isTransientFailure): a quiet check that gets it keeps the record it has. */
  transient: boolean;
}

async function fetchOrganiser(getToken: GetToken): Promise<OrganiserResult> {
  try {
    const organiser = await getMyOrganiser(getToken);
    return { organiser, error: null, transient: false };
  } catch (err) {
    // The session is someone else's by now: no answer for this account (lib/auth/account-store.ts).
    if (err instanceof AccountMismatchError) throw err;
    if (err instanceof ApiError && err.status === 404) {
      return { organiser: null, error: null, transient: false };
    }
    return {
      organiser: null,
      error: err instanceof Error ? err.message : "Couldn't load your organiser status.",
      transient: isTransientFailure(err),
    };
  }
}

/** The signed-in account's organiser record, shared by every useOrganiser on the page (lib/auth/account-store.ts). */
const organiserStore = createAccountStore<OrganiserResult>({ isFailure: (result) => result.transient });

/**
 * Tells every useOrganiser on the page that the signed-in organiser's own record changed (a saved
 * profile, a new or removed logo), so the parts that read it (the dashboard's sidebar and rail, the
 * header's account menu) show the saved version without a reload. Only for the same organiser: any
 * other record waits for the account's own fetch. An answer already on its way is dropped (it may
 * predate the change).
 */
export function announceOrganiserChange(organiser: OrganiserRecord) {
  organiserStore.update(({ value }) =>
    value.organiser && value.organiser.organiserId === organiser.organiserId ? { organiser, error: null, transient: false } : null,
  );
}

const API_NOT_CONFIGURED = "The live API is not configured in this environment.";

const noSnapshot = () => null;

/**
 * Loads (and lets callers refetch) the signed-in user's own organiser application, one copy for the
 * whole page (lib/auth/account-store.ts): every reader shares one request, and a reader that mounts
 * later (a dashboard tab switch) gets the record at once, while it's checked again quietly. A result
 * belongs to the account it was fetched for, and is only ever shown for that account: when a
 * different account signs in, it's `loading` until that account's own has arrived, never showing the
 * last one's. Each sign-in checks again; the same account signing back in after its session expired
 * keeps its own last result meanwhile, so it isn't `loading`, but the person's own Sign out forgets
 * it. A token refresh fetches nothing. `refetch` (after a user action: a submit, a join, Try again)
 * always asks the API, and every reader gets the answer; it keeps the current result while it runs
 * (`refreshing`), so a page never swaps what it shows (a form being filled in, above all) for a loader.
 * A quiet check that fails for a passing reason (offline, a 5xx, a 429) keeps the record it was
 * checking rather than show the error; any other answer (a 401 for an account that's gone) replaces
 * it, and a first load that fails shows its error. Every request is made as the account its answer is kept
 * for (useAccountToken): one made as someone else's session is refused and keeps nothing.
 */
export function useOrganiser() {
  const auth = useAuth();
  const account = accountKey(auth);
  const getToken = useAccountToken(auth);
  const settled = useSyncExternalStore(organiserStore.subscribe, organiserStore.snapshot, noSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const signedOutByUser = auth.status === "signed-out" && auth.signedOutBy === "user";

  // Explicit re-fetch for use after a user action (submit, resubmit, try
  // again) — never called directly from an effect body.
  const refetch = useCallback(async () => {
    if (!isApiConfigured || account === null) return;
    setRefreshing(true);
    await organiserStore.load(account, () => fetchOrganiser(getToken), { force: true });
    setRefreshing(false);
  }, [account, getToken]);

  // The account's own, once it's signed in: at once if it's known, and checked again quietly. A sign-in
  // seen by this reader (signed out, then in) always asks again.
  const lastAccount = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const signedIn = lastAccount.current === null;
    lastAccount.current = account;
    if (!isApiConfigured || account === null) return;
    void organiserStore.load(account, () => fetchOrganiser(getToken), { recheck: signedIn });
  }, [account, getToken]);

  // Their own Sign out: nothing of theirs is kept for whoever uses this browser next.
  useEffect(() => {
    if (signedOutByUser) organiserStore.clear();
  }, [signedOutByUser]);

  let state: Omit<OrganiserResult, "transient"> & { loading: boolean };
  if (!isApiConfigured) state = { loading: false, organiser: null, error: API_NOT_CONFIGURED };
  else if (auth.status === "loading") state = { loading: true, organiser: null, error: null };
  else if (account === null) state = { loading: false, organiser: null, error: null };
  else if (!settled || settled.account !== account) state = { loading: true, organiser: null, error: null };
  else state = { loading: false, organiser: settled.value.organiser, error: settled.value.error };

  return { ...state, refreshing, refetch, authStatus: auth.status };
}
