"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, isApiConfigured, type GetToken } from "@/lib/api/client";
import { getMyProfile } from "@/lib/api/profiles";
import type { ProfileRecord } from "@/lib/api/types";
import { accountKey } from "./account";
import { createAccountStore } from "./account-store";
import { useAuth } from "./AuthContext";

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

/** The signed-in account's profile, shared by every useProfile on the page (lib/auth/account-store.ts). */
const profileStore = createAccountStore<SettledProfile>();

async function loadProfile(getToken: GetToken): Promise<SettledProfile> {
  try {
    return { status: "ready", profile: await fetchMyProfile(getToken) };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Couldn't load your profile." };
  }
}

const noSnapshot = () => null;

/**
 * Loads the signed-in user's Who's Going profile, one copy for the whole page
 * (lib/auth/account-store.ts): the header's avatar menu, the account area and the page share one
 * request, and a page that mounts later (another account tab) shows it at once while it's checked
 * again quietly. Only fetches in live mode while signed in; otherwise it stays "loading" and callers
 * render their own signed-out / demo state instead. A change saved through one (setProfile, on
 * /account) reaches every other at once; the person's own Sign out forgets it.
 */
export function useProfile() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const account = isApiConfigured ? accountKey(auth) : null;
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
    account === null || retrying === account || !settled || settled.account !== account ? { status: "loading" } : settled.value;

  /** Replaces the loaded profile after a save (or null after a delete), here and in every other useProfile. */
  const setProfile = useCallback(
    (profile: ProfileRecord | null) => {
      if (account === null) return;
      profileStore.update((current) => (current.account === account ? { status: "ready", profile } : null));
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
