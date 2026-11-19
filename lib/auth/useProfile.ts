"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isApiConfigured, type GetToken } from "@/lib/api/client";
import { getMyProfile } from "@/lib/api/profiles";
import type { ProfileRecord } from "@/lib/api/types";
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

/**
 * Every mounted useProfile, so a change saved through one (the /account page) reaches the others
 * (the header's avatar menu and phone drawer, which stay mounted in the root layout) without a
 * reload: setProfile publishes to all of them, each keeping it only for the same account.
 */
const sharedSetters = new Set<(email: string | undefined, profile: ProfileRecord | null) => void>();

/**
 * Loads the signed-in user's Who's Going profile. Only fetches in live mode
 * while signed in; otherwise it stays "loading" and callers render their own
 * signed-out / demo state instead.
 */
export function useProfile() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const enabled = isApiConfigured && auth.status === "signed-in";
  const [attempt, setAttempt] = useState(0);
  // Each result is tagged with the request it answers, so a new account or a
  // retry reads as "loading" straight away without resetting state in an effect.
  const key = `${auth.email ?? ""}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: ProfileState } | null>(null);
  const email = auth.email;
  // Counts changes published through setProfile. A load drops its answer if one landed while it was
  // in flight (the answer may predate the change); a load started afterwards, e.g. after signing out
  // and back in, settles as normal.
  const published = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const startedAt = published.current;
    const settle = (state: ProfileState) => {
      if (published.current === startedAt) setResult({ key, state });
    };
    fetchMyProfile(getToken).then(
      (profile) => {
        if (!cancelled) settle({ status: "ready", profile });
      },
      (err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Couldn't load your profile.";
        settle({ status: "error", message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, key, getToken]);

  const state: ProfileState = result?.key === key ? result.state : { status: "loading" };

  useEffect(() => {
    function receive(from: string | undefined, profile: ProfileRecord | null) {
      if (from !== email) return;
      published.current += 1;
      setResult({ key, state: { status: "ready", profile } });
    }
    sharedSetters.add(receive);
    return () => {
      sharedSetters.delete(receive);
    };
  }, [email, key]);

  /** Replaces the loaded profile after a save (or null after a delete), here and in every other useProfile. */
  const setProfile = useCallback(
    (profile: ProfileRecord | null) => {
      for (const receive of sharedSetters) receive(email, profile);
    },
    [email],
  );
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, setProfile, reload };
}
