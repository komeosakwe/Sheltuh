"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { getUnreadCount } from "@/lib/api/messages";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { useVisibleInterval } from "@/lib/use-visible-interval";

/** How often the nav badge checks for unread conversations. */
export const UNREAD_POLL_MS = 60_000;

interface UnreadContextValue {
  /**
   * Conversations with something unread, or null when there's nothing to
   * show: not loaded yet, signed out, demo, or not a verified member (403).
   */
  count: number | null;
  /** Checks again now (after reading a conversation, say). */
  refresh: () => void;
}

const UnreadContext = createContext<UnreadContextValue | undefined>(undefined);

type Result = { key: string; count: number | null; denied: boolean };

/**
 * One unread-count poll for the whole app, shared by the desktop nav and the
 * phone menu. Signed-in members only, live mode only, every 60s while the
 * page is visible. A 403 (email not verified) stops it: there's no badge for
 * someone who can't use messages yet. Other failures keep the last count and
 * try again at the next interval (a background badge has nowhere useful to
 * show an error; the messages pages show their own).
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  const signedIn = isApiConfigured && Boolean(auth?.configured) && auth?.status === "signed-in";
  const getToken = auth?.getAccessToken;
  // Tagged with the account, so signing in as someone else starts afresh.
  const key = signedIn ? (auth?.email ?? "") : "";
  const [result, setResult] = useState<Result | null>(null);
  const current = result?.key === key ? result : null;
  const denied = current?.denied ?? false;

  const load = useCallback(async () => {
    if (!signedIn || !getToken) return;
    try {
      const { count } = await getUnreadCount(getToken);
      setResult({ key, count, denied: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setResult({ key, count: null, denied: true });
    }
  }, [signedIn, getToken, key]);

  useVisibleInterval(load, UNREAD_POLL_MS, { enabled: signedIn && !denied, immediate: true });

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const value = useMemo<UnreadContextValue>(
    () => ({ count: signedIn ? (current?.count ?? null) : null, refresh }),
    [signedIn, current, refresh],
  );
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

/** The unread count, if there's an UnreadProvider above (there isn't in isolated tests). */
export function useUnread(): UnreadContextValue | undefined {
  return useContext(UnreadContext);
}
