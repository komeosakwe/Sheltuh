"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { isApiConfigured } from "@/lib/api/client";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { loadHomeEvents, loadHomeFollowing, loadHomeRecent, loadHomeTrending } from "@/lib/home-events";
import { selectHomeSections, type HomeSections } from "@/lib/home-sections";
import { readStoredNearState, subscribeStoredNear } from "@/lib/near-storage";

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

/** What the loads returned, kept so the sections can be split again when the saved suburb changes. */
interface HomeLoaded {
  events: Awaited<ReturnType<typeof loadHomeEvents>>;
  trending: Awaited<ReturnType<typeof loadHomeTrending>>;
  following: Awaited<ReturnType<typeof loadHomeFollowing>>;
  recent: Awaited<ReturnType<typeof loadHomeRecent>>;
  now: Date;
}

type LoadState = Exclude<HomeEventsState, { status: "ready" }> | { status: "ready"; loaded: HomeLoaded };

const serverNull = () => null;

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
 *
 * With a saved "near" suburb, each section lists its state's events first
 * (owner decision D5): the state saved with the suburb (lib/near-storage.ts
 * readStoredNearState), read in the browser and never sent. The suburb table
 * is never loaded here, so nothing waits on it; a suburb saved without a
 * state it can be read from leaves the order Australia-wide. A place chosen
 * in the search bar's location menu (or Nearby) re-orders the sections at
 * once, without loading again (subscribeStoredNear, as useMapLocate does).
 */
export function HomeEventsProvider({ children }: { children: ReactNode }) {
  const mode = isApiConfigured ? "live" : "demo";
  const auth = useOptionalAuth();
  const authStatus = mode === "live" ? (auth?.status ?? "signed-out") : "signed-out";
  const getToken = authStatus === "signed-in" ? auth?.getAccessToken : undefined;
  // null while the session is still being read: nothing is split until it's known.
  const viewer = authStatus === "loading" ? null : authStatus === "signed-in" ? `member:${auth?.email ?? ""}` : "anonymous";
  const [attempt, setAttempt] = useState(0);
  const [load, setState] = useState<LoadState>({ status: "loading" });
  const preferredState = useSyncExternalStore(subscribeStoredNear, readStoredNearState, serverNull);
  const state = useMemo<HomeEventsState>(() => {
    if (load.status !== "ready") return load;
    const { events, trending, following, recent, now } = load.loaded;
    return { status: "ready", sections: selectHomeSections(events, trending, now, following, preferredState, recent), now };
  }, [load, preferredState]);

  useEffect(() => {
    if (viewer === null) return;
    let cancelled = false;
    const now = new Date();
    Promise.all([
      loadHomeEvents(now),
      loadHomeTrending(now).catch(() => []),
      getToken ? loadHomeFollowing(getToken, now).catch(() => []) : Promise.resolve([]),
      // A failure only hides "Recently on".
      loadHomeRecent(now).catch(() => []),
    ]).then(
      ([events, trending, following, recent]) => {
        if (!cancelled) setState({ status: "ready", loaded: { events, trending, following, recent, now } });
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

/** The same, or null outside a HomeEventsProvider (a section that can show without the events). */
export function useOptionalHomeEvents(): HomeEventsValue | null {
  return useContext(HomeEventsContext);
}
