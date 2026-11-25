"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, isApiConfigured, type GetToken } from "@/lib/api/client";
import { getMyProfile } from "@/lib/api/profiles";
import type { ProfileRecord } from "@/lib/api/types";
import { accountKey } from "./account";
import { createAccountStore } from "./account-store";
import { isTransientFailure } from "./transient-failure";
import { AccountMismatchError, useAuth } from "./AuthContext";
import { useAccountToken } from "./useAccountToken";

/** The caller's Who's Going profile, or null if they haven't created one (the API's 404). */
export async function fetchMyProfile(getToken: GetToken): Promise<ProfileRecord | null> {
  try {
    return await getMyProfile(getToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export type ProfileState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: ProfileRecord | null };

type SettledProfile = Exclude<ProfileState, { status: "loading" }>;

/** What's kept: the state readers show, and whether its error is a passing one (isTransientFailure). */
interface StoredProfile {
  shown: SettledProfile;
  transient: boolean;
}

/** The signed-in account's profile, shared by every useProfile on the page (lib/auth/account-store.ts). */
const profileStore = createAccountStore<StoredProfile>({ isFailure: (profile) => profile.transient });

async function loadProfile(getToken: GetToken): Promise<StoredProfile> {
  try {
    return { shown: { status: "ready", profile: await fetchMyProfile(getToken) }, transient: false };
  } catch (err) {
    // The session is someone else's by now: no answer for this account (lib/auth/account-store.ts).
    if (err instanceof AccountMismatchError) throw err;
    return {
      shown: { status: "error", message: err instanceof Error ? err.message : "Couldn't load your profile." },
      transient: isTransientFailure(err),
    };
  }
}

const noSnapshot = () => null;

/**
 * Loads the signed-in user's Who's Going profile, one copy for the whole page
 * (lib/auth/account-store.ts): the header's avatar menu, the account area and the page share one
 * request, and a page that mounts later (another account tab) shows it at once while it's checked
 * again quietly. Only fetches in live mode while signed in; otherwise it stays "loading" and callers
 * render their own signed-out / demo state instead. A change saved through one (setProfile, on
 * /account) reaches every other at once; the person's own Sign out forgets it. A quiet check that
 * fails for a passing reason (offline, a 5xx, a 429) keeps the profile it was checking, so a form open
 * on it stays; any other answer (a 401 for an account that's gone) replaces it, and a first load that
 * fails shows its error. Every request is made as the account its answer is kept for
 * (useAccountToken): one made as someone else's session is refused and keeps nothing.
 */
export function useProfile() {
  const auth = useAuth();
  const account = isApiConfigured ? accountKey(auth) : null;
  const getToken = useAccountToken(auth);
  const settled = useSyncExternalStore(profileStore.subscribe, profileStore.snapshot, noSnapshot);
  /** The account whose Try again is under way: "loading" until it answers. */
  const [retrying, setRetrying] = useState<string | null>(null);
  const retries = useRef(0);
  const signedOutByUser = auth.status === "signed-out" && auth.signedOutBy === "user";

  // At once if it's known, and checked again quietly; a sign-in seen by this reader always asks again.
  const lastAccount = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const signedIn = lastAccount.current === null;
    lastAccount.current = account;
    if (account === null) return;
    void profileStore.load(account, () => loadProfile(getToken), { recheck: signedIn });
  }, [account, getToken]);

  useEffect(() => {
    if (signedOutByUser) profileStore.clear();
  }, [signedOutByUser]);

  const state: ProfileState =
    account === null || retrying === account || !settled || settled.account !== account ? { status: "loading" } : settled.value.shown;

  /** Replaces the loaded profile after a save (or null after a delete), here and in every other useProfile. */
  const setProfile = useCallback(
    (profile: ProfileRecord | null) => {
      if (account === null) return;
      profileStore.update((current) => (current.account === account ? { shown: { status: "ready", profile }, transient: false } : null));
    },
    [account],
  );
  const reload = useCallback(() => {
    if (account === null) return;
    const retry = ++retries.current;
    setRetrying(account);
    void profileStore.load(account, () => loadProfile(getToken), { force: true }).then(() => {
      if (retries.current === retry) setRetrying(null);
    });
  }, [account, getToken]);

  return { state, setProfile, reload };
}
