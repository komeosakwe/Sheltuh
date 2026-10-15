"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ApiError, type GetToken } from "@/lib/api/client";
import { addFavourite, listFavouriteIds, removeFavourite } from "@/lib/api/favourites";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { parseSavedIds, readSavedIds, SAVED_STORAGE_KEY, writeSavedIds } from "@/lib/saved-storage";
import FavouritesNotice, { noticeMessage, type FavouritesNoticeState } from "./FavouritesNotice";
import {
  FavouritesStore,
  type FavouritesBackend,
  type FavouritesSettled,
  type FavouritesSnapshot,
  type FavouritesStatus,
  type SaveTarget,
} from "./favourites-store";

/** A success bar closes itself after this long; errors stay until dismissed or replaced. */
export const NOTICE_TIMEOUT_MS = 6000;

export interface FavouritesContextValue {
  /** `demo`: accounts aren't configured, so the list lives in this browser only. */
  mode: "demo" | "live";
  /** Live and not signed in: hearts link to sign in instead. */
  signedOut: boolean;
  /** Auth is still settling, or the ids are loading. */
  status: FavouritesStatus | "auth-loading";
  isSaved: (id: string) => boolean;
  /** Effective saved ids, newest save first. */
  ids: readonly string[];
  count: number;
  /** A heart tap: flips the event optimistically and sends it. */
  toggle: (event: SaveTarget) => void;
  /** Finishes a save started before signing in (`?save=1`), with the "Saved" bar and Undo. */
  saveFromReturn: (event: SaveTarget) => void;
  /** Removes without the bar (the /saved past rows show their own error). Rejects if it failed. */
  remove: (event: SaveTarget) => Promise<void>;
}

const FavouritesContext = createContext<FavouritesContextValue | undefined>(undefined);

const EMPTY: FavouritesSnapshot = { status: "idle", ids: [], saved: new Set(), count: 0 };
const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

function liveBackend(getToken: GetToken): FavouritesBackend {
  return {
    put: async (id) => {
      await addFavourite(id, getToken);
    },
    del: async (id) => {
      try {
        await removeFavourite(id, getToken);
      } catch (err) {
        // No favourite and the event isn't published: it's already not saved.
        if (err instanceof ApiError && err.status === 404) return;
        throw err;
      }
    },
  };
}

const demoBackend: FavouritesBackend = {
  // A failed write keeps the list in memory for this visit, with no error.
  put: async (_id, nextIds) => {
    writeSavedIds(nextIds);
  },
  del: async (_id, nextIds) => {
    writeSavedIds(nextIds);
  },
};

function noticeFor(settled: Extract<FavouritesSettled, { kind: "failed" }>): FavouritesNoticeState {
  const { error, event, intent } = settled;
  if (error instanceof SessionExpiredError || (error instanceof ApiError && error.status === 401)) {
    return { kind: "session" };
  }
  if (intent && error instanceof ApiError && error.status === 409) return { kind: "cap" };
  if (error instanceof ApiError && error.status === 404) return { kind: "failed", event, intent, reason: "gone" };
  return { kind: "failed", event, intent, reason: "network" };
}

type Pending = { resolve: () => void; reject: (err: unknown) => void };

/**
 * Every heart on the page reads from here (docs/design/favourites-analytics.md
 * §5.1). Live: one GET of the saved ids once signed in; nothing when signed
 * out. Demo (accounts not configured): this browser's localStorage, read
 * after mount (so the server render is unsaved) and kept in step across tabs.
 * Also renders the feedback bar and the one polite live region for hearts.
 */
export function FavouritesProvider({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  const pathname = usePathname() ?? "/";
  const mode: "demo" | "live" = auth?.configured ? "live" : "demo";
  const authStatus = mode === "demo" ? "signed-out" : (auth?.status ?? "signed-out");
  const getToken = auth?.getAccessToken;
  const account = mode === "demo" ? "demo" : authStatus === "signed-in" ? `in:${auth?.email ?? ""}` : authStatus;

  const [notice, setNotice] = useState<{ notice: FavouritesNoticeState; path: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pendingRemovals = useRef(new Map<string, Pending>());
  const pendingReturns = useRef(new Set<string>());

  const announce = useCallback((text: string) => {
    // Cleared first, then set on the next frame, so the same words twice are read twice.
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(text));
  }, []);

  const show = useCallback(
    (next: FavouritesNoticeState) => {
      setNotice({ notice: next, path: pathname });
      announce(noticeMessage(next));
    },
    [announce, pathname],
  );

  const store = useMemo(() => {
    if (mode === "live" && account.startsWith("in:") && getToken) return new FavouritesStore(liveBackend(getToken));
    if (mode === "demo") return new FavouritesStore(demoBackend);
    return null;
  }, [mode, account, getToken]);

  // The latest handler, told by the store when a request settles.
  useEffect(() => {
    store?.setOnSettled((settled) => {
      const pending = pendingRemovals.current.get(settled.event.id);
      if (pending) {
        pendingRemovals.current.delete(settled.event.id);
        if (settled.kind === "failed") pending.reject(settled.error);
        else pending.resolve();
        return;
      }
      if (settled.kind === "saved" && pendingReturns.current.delete(settled.event.id)) {
        show({ kind: "returned", event: settled.event });
        return;
      }
      if (settled.kind === "failed") {
        pendingReturns.current.delete(settled.event.id);
        show(noticeFor(settled));
      }
    });
  });

  useEffect(() => {
    if (!store) return;
    store.setActive(true);
    if (mode === "demo") {
      store.replace(readSavedIds() ?? []);
      const onStorage = (event: StorageEvent) => {
        if (event.key === SAVED_STORAGE_KEY) store.replace(parseSavedIds(event.newValue));
      };
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener("storage", onStorage);
        store.setActive(false);
      };
    }
    if (getToken) void store.load(async () => (await listFavouriteIds(getToken)).eventIds);
    return () => store.setActive(false);
  }, [store, mode, getToken]);

  const snapshot = useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    store ? store.getSnapshot : emptySnapshot,
    emptySnapshot,
  );

  // A success bar closes itself; errors wait to be dismissed or replaced.
  useEffect(() => {
    if (!notice || notice.notice.kind !== "returned") return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggle = useCallback(
    (event: SaveTarget) => {
      if (!store) return;
      if (snapshot.status === "error") {
        show({ kind: "load-error" });
        return;
      }
      const want = !store.isSaved(event.id);
      const result = store.request(event, want);
      if (result === "cap") {
        show({ kind: "cap" });
        return;
      }
      if (result !== "sent") return;
      // The next heart action replaces whatever the bar was saying.
      setNotice(null);
      announce(want ? `Saved ${event.title}.` : `Removed ${event.title} from saved.`);
    },
    [store, snapshot.status, show, announce],
  );

  const saveFromReturn = useCallback(
    (event: SaveTarget) => {
      if (!store) return;
      if (store.isSaved(event.id)) {
        show({ kind: "returned", event });
        return;
      }
      pendingReturns.current.add(event.id);
      const result = store.request(event, true);
      if (result === "cap") {
        pendingReturns.current.delete(event.id);
        show({ kind: "cap" });
      } else if (result !== "sent") {
        pendingReturns.current.delete(event.id);
      }
    },
    [store, show],
  );

  const remove = useCallback(
    (event: SaveTarget) =>
      new Promise<void>((resolve, reject) => {
        if (!store || store.request(event, false) !== "sent") {
          reject(new Error("Saved events aren't ready."));
          return;
        }
        pendingRemovals.current.set(event.id, { resolve, reject });
      }),
    [store],
  );

  const retry = useCallback(() => {
    if (!notice || !store) return;
    const current = notice.notice;
    setNotice(null);
    if (current.kind === "failed") {
      const result = store.request(current.event, current.intent);
      if (result === "cap") show({ kind: "cap" });
    } else if (current.kind === "load-error" && getToken) {
      void store.load(async () => (await listFavouriteIds(getToken)).eventIds);
    }
  }, [notice, store, getToken, show]);

  const undo = useCallback(() => {
    if (!notice || notice.notice.kind !== "returned" || !store) return;
    const { event } = notice.notice;
    setNotice(null);
    if (store.request(event, false) === "sent") announce(`Removed ${event.title} from saved.`);
  }, [notice, store, announce]);

  const status: FavouritesContextValue["status"] =
    mode === "live" && authStatus === "loading" ? "auth-loading" : snapshot.status;

  const value = useMemo<FavouritesContextValue>(
    () => ({
      mode,
      signedOut: mode === "live" && authStatus === "signed-out",
      status,
      isSaved: (id: string) => snapshot.saved.has(id),
      ids: snapshot.ids,
      count: snapshot.count,
      toggle,
      saveFromReturn,
      remove,
    }),
    [mode, authStatus, status, snapshot, toggle, saveFromReturn, remove],
  );

  const shown = notice && notice.path === pathname ? notice.notice : null;

  return (
    <FavouritesContext.Provider value={value}>
      {children}
      {shown && (
        <FavouritesNotice
          notice={shown}
          returnTo={pathname}
          onDismiss={() => setNotice(null)}
          onUndo={undo}
          onRetry={retry}
        />
      )}
      <p role="status" className="sr-only" data-favourites-status="">
        {announcement}
      </p>
    </FavouritesContext.Provider>
  );
}

/** The favourites context, if there's a provider above (there isn't in isolated tests). */
export function useFavourites(): FavouritesContextValue | undefined {
  return useContext(FavouritesContext);
}
