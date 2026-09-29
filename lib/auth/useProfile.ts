"use client";

import { useCallback, useEffect, useState } from "react";
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

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchMyProfile(getToken).then(
      (profile) => {
        if (!cancelled) setResult({ key, state: { status: "ready", profile } });
      },
      (err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Couldn't load your profile.";
        setResult({ key, state: { status: "error", message } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, key, getToken]);

  const state: ProfileState = result?.key === key ? result.state : { status: "loading" };

  /** Replaces the loaded profile after a save (or null after a delete). */
  const setProfile = useCallback(
    (profile: ProfileRecord | null) => setResult({ key, state: { status: "ready", profile } }),
    [key],
  );
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, setProfile, reload };
}
