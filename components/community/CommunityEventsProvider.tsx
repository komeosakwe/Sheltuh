"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isApiConfigured } from "@/lib/api/client";
import { loadCommunityEvents, type CommunityFeed } from "@/lib/community";

export type CommunityEventsState =
  | { status: "loading" }
  /** `retrying`: Try again is loading; the error stays on screen (and its button keeps focus) until it settles. */
  | { status: "error"; retrying: boolean }
  | { status: "ready"; feed: CommunityFeed; now: Date };

export interface CommunityEventsValue {
  mode: "demo" | "live";
  state: CommunityEventsState;
  retry: () => void;
}

const CommunityEventsContext = createContext<CommunityEventsValue | null>(null);

/**
 * Loads /community's upcoming events once (lib/community.ts), for Local discovery and Scenes by
 * city. A failure is shown where the events would be, with Try again; nothing else on the page
 * depends on it.
 */
export function CommunityEventsProvider({ children }: { children: ReactNode }) {
  const mode = isApiConfigured ? "live" : "demo";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CommunityEventsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    loadCommunityEvents(now).then(
      (feed) => {
        if (!cancelled) setState({ status: "ready", feed, now });
      },
      () => {
        if (!cancelled) setState({ status: "error", retrying: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState((prev) => (prev.status === "error" ? { status: "error", retrying: true } : { status: "loading" }));
    setAttempt((n) => n + 1);
  }, []);

  return <CommunityEventsContext.Provider value={{ mode, state, retry }}>{children}</CommunityEventsContext.Provider>;
}

export function useCommunityEvents(): CommunityEventsValue {
  const value = useContext(CommunityEventsContext);
  if (!value) throw new Error("useCommunityEvents must be used inside CommunityEventsProvider");
  return value;
}
