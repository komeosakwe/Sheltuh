"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { adminGetSummary } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminSummary } from "@/lib/api/types";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { useVisibleInterval } from "@/lib/use-visible-interval";

/** How often an admin's counts are checked while the page is visible. */
export const ADMIN_SUMMARY_POLL_MS = 60_000;

export interface AdminSummaryContextValue {
  /** The latest counts, or null: not an admin, demo, or not loaded yet. Kept through a failed refresh. */
  summary: AdminSummary | null;
  /** The last check failed (the counts shown, if any, may be out of date). */
  failed: boolean;
  /** The API said this account isn't an admin (403): no counts will come, and checking has stopped. */
  denied: boolean;
  /** Checks again now: after an admin action changes a count. */
  refresh: () => void;
}

/** Exported for tests, which provide a fixed value (tests/test-utils/fakeAdminSummary.tsx). */
export const AdminSummaryContext = createContext<AdminSummaryContextValue | undefined>(undefined);

type Result = { key: string; summary: AdminSummary | null; failed: boolean; denied: boolean };

/**
 * One admin summary poll for the whole app, shared by the main nav's Admin
 * badge, the admin sub-nav and the admin hub. It sits in the root layout
 * (the main nav is there), but only ever fetches for a signed-in admin with
 * accounts configured: never in the demo, never for members. Every 60s while
 * the page is visible, like the unread count. A 403 (no longer an admin)
 * stops it and sets `denied`; any other failure, a 401 (signed out
 * elsewhere, or a token being refreshed) included, keeps the last counts,
 * sets `failed` and tries again next time. Only the latest check may set the
 * counts: a slower, older one finishing last is ignored.
 */
export function AdminSummaryProvider({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  const isAdmin = Boolean(auth?.configured) && auth?.status === "signed-in" && auth.isAdmin;
  const getToken = auth?.getAccessToken;
  // Tagged with the account, so signing in as someone else starts afresh.
  const key = isAdmin ? (auth?.email ?? "") : "";
  const [result, setResult] = useState<Result | null>(null);
  const current = result?.key === key ? result : null;
  const denied = current?.denied ?? false;
  /** Numbers each check; only the newest one's answer is kept. */
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!isAdmin || !getToken) return;
    const request = ++latest.current;
    try {
      const summary = await adminGetSummary(getToken);
      if (request !== latest.current) return;
      setResult({ key, summary, failed: false, denied: false });
    } catch (err) {
      if (request !== latest.current) return;
      const deniedNow = err instanceof ApiError && err.status === 403;
      setResult((prev) => ({
        key,
        summary: deniedNow ? null : prev?.key === key ? prev.summary : null,
        failed: !deniedNow,
        denied: deniedNow,
      }));
    }
  }, [isAdmin, getToken, key]);

  useVisibleInterval(load, ADMIN_SUMMARY_POLL_MS, { enabled: isAdmin && !denied, immediate: true });

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const value = useMemo<AdminSummaryContextValue>(
    () => ({
      summary: isAdmin ? (current?.summary ?? null) : null,
      failed: isAdmin ? (current?.failed ?? false) : false,
      denied: isAdmin ? denied : false,
      refresh,
    }),
    [isAdmin, current, denied, refresh],
  );
  return <AdminSummaryContext.Provider value={value}>{children}</AdminSummaryContext.Provider>;
}

/** The admin counts, if there's an AdminSummaryProvider above (there isn't in isolated tests). */
export function useAdminSummary(): AdminSummaryContextValue | undefined {
  return useContext(AdminSummaryContext);
}
