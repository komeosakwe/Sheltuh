"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface InboxSyncValue {
  /** Bumped each time something changed a conversation: the list reloads (keeping what it shows meanwhile). */
  version: number;
  /** Something in a conversation changed (read, sent, accepted, declined, blocked, unblocked, gone). */
  refresh: () => void;
}

const InboxSyncContext = createContext<InboxSyncValue | null>(null);

/**
 * Keeps the conversation list beside an open conversation in step with it (MessagesFrame): the list
 * stays mounted while you move between conversations, so the thread tells it when its unread dot,
 * preview, status or very presence has changed.
 */
export function InboxSyncProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  const value = useMemo(() => ({ version, refresh }), [version, refresh]);
  return <InboxSyncContext.Provider value={value}>{children}</InboxSyncContext.Provider>;
}

/** The list's reload counter (0 outside a MessagesFrame). */
export function useInboxVersion(): number {
  return useContext(InboxSyncContext)?.version ?? 0;
}

/** Tells the list beside the thread to reload (does nothing outside a MessagesFrame). */
export function useRefreshInbox(): () => void {
  const refresh = useContext(InboxSyncContext)?.refresh;
  return useCallback(() => refresh?.(), [refresh]);
}
