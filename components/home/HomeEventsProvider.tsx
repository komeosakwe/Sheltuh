"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isApiConfigured } from "@/lib/api/client";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { loadHomeEvents, loadHomeFollowing, loadHomeTrending } from "@/lib/home-events";
import { selectHomeSections, type HomeSections } from "@/lib/home-sections";

export type HomeEventsState =
  | { status: "loading" }
  /** `retrying`: Try again is loading; the error stays on screen (and its button keeps focus) until it settles. */
  | { status: "error"; retrying: boolean }
  | { status: "ready"; sections: HomeSections; now: Date };

export interface HomeEventsValue {
  mode: "demo" | "live";
  state: HomeEventsState;
  retry: () => void;
}

const HomeEventsContext = createContext<HomeEventsValue | null>(null);

/**
 * Loads the home page's events once and splits them into sections, for the
 * event sections below the hero (docs/design/home.md §5.9). A trending
 * failure only hides Trending; an events failure is the page's one error,
 * shown in the first section's place with Try again.
 *
 * Live and signed in, it also loads the followed organisers' events for "From
 * organisers you follow" (a failure only hides that rail). It waits for the
 * session to be known first, so sections are split once and events don't
 * jump between them; signing in or out splits them again.
 */
export function HomeEventsProvider({ children }: { children: ReactNode }) {
  const mode = isApiConfigured ? "live" : "demo";
  const auth = useOptionalAuth();
  const authStatus = mode === "live" ? (auth?.status ?? "signed-out") : "signed-out";
  const getToken = authStatus === "signed-in" ? auth?.getAccessToken : undefined;
  // null while the session is still being read: nothing is split until it's known.
  const viewer = authStatus === "loading" ? null : authStatus === "signed-in" ? `member:${auth?.email ?? ""}` : "anonymous";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HomeEventsState>({ status: "loading" });

  useEffect(() => {
    if (viewer === null) return;
    let cancelled = false;
    const now = new Date();
    Promise.all([
      loadHomeEvents(now),
      loadHomeTrending(now).catch(() => []),
      getToken ? loadHomeFollowing(getToken, now).catch(() => []) : Promise.resolve([]),
    ]).then(
      ([events, trending, following]) => {
        if (!cancelled) {
          setState({ status: "ready", sections: selectHomeSections(events, trending, now, following), now });
        }
      },
      () => {
        if (!cancelled) setState({ status: "error", retrying: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, viewer, getToken]);

  // The error box stays mounted while retrying: replacing it with the loading
  // box would unmount the focused Try again button and drop focus to the page.
  const retry = useCallback(() => {
    setState((prev) => (prev.status === "error" ? { status: "error", retrying: true } : { status: "loading" }));
    setAttempt((n) => n + 1);
  }, []);

  return <HomeEventsContext.Provider value={{ mode, state, retry }}>{children}</HomeEventsContext.Provider>;
}

export function useHomeEvents(): HomeEventsValue {
  const value = useContext(HomeEventsContext);
  if (!value) throw new Error("useHomeEvents must be used inside HomeEventsProvider");
  return value;
}
