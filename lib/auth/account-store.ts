/**
 * One shared copy of a record that belongs to the signed-in account (its organiser record, its Who's
 * Going profile), for every component on the page that reads it: the header, the account and
 * dashboard frames and the page itself. Before this, each of them fetched its own, so every page
 * change inside the dashboard or the account area waited on the network again (and showed its
 * loader) for a record the header already had.
 *
 * - One request at a time per account: a reader that mounts while one is in flight shares it.
 * - What's known is shown straight away when a reader mounts (a dashboard tab switch), then checked
 *   again quietly in the background, unless it was fetched a moment ago (FRESH_MS: the readers on a
 *   page mount together).
 * - A change saved elsewhere on the page (update) replaces it, and an answer that was already on its
 *   way when the change landed is dropped (it may predate the change). So is any answer overtaken by
 *   a newer request (a forced reload after a join or a submit).
 * - A quiet check that fails for a passing reason (`isFailure`: offline, a timeout, a 5xx, a 429;
 *   lib/auth/transient-failure.ts) keeps the answer it was checking, so a page never swaps what it
 *   shows (a form being filled in, above all) for an error that says nothing about the record. Any other
 *   answer lands, errors included: a profile that's gone, a changed status, a 401 or 403 (an account
 *   revoked or deleted, a session that's over), a 400. So does a passing failure when there's no
 *   answer to keep, or when the person asked (force).
 * - It's only ever one account's: another account's answer replaces it, and clear() (the person's
 *   own Sign out) forgets it. Readers check `account` before showing it. A request made as an
 *   account whose session isn't the browser's any more (loadWithToken: the token is checked first)
 *   is never made, so it can't overtake the signed-in account's; and a fetcher that rejects is no
 *   answer at all: nothing is kept or cleared.
 *
 * Plain module state, read with useSyncExternalStore; no React here, so test setup can reset every
 * store between tests (resetAccountStores) without loading anything else.
 */

// Type only (erased): the store loads nothing else at run time, test setup included.
import type { GetToken } from "@/lib/api/client";
import { AccountMismatchError } from "./session-token";

/** A settled answer, for the account it was fetched for. */
export interface Settled<T> {
  account: string;
  value: T;
  /** When it settled (Date.now()), for FRESH_MS. */
  at: number;
}

/** A settled answer this recent isn't fetched again when another reader mounts. */
export const FRESH_MS = 2000;

export interface AccountStore<T> {
  /** The settled answer, or null; stable between changes (useSyncExternalStore's getSnapshot). */
  snapshot: () => Settled<T> | null;
  subscribe: (listener: () => void) => () => void;
  /**
   * Loads `account`'s record: joins a request already in flight for it, or does nothing when its answer
   * settled within FRESH_MS. `recheck` (a sign-in): asks again however fresh the answer is, still joining
   * one in flight. `force` (after a user action): always a new request, which overtakes any in flight.
   * Errors are part of `T`; a `fetcher` that rejects anyway is no answer: nothing settles, and the next
   * load asks again. Resolves once the answer it started or joined has settled, or been dropped.
   */
  load: (account: string, fetcher: () => Promise<T>, options?: LoadOptions) => Promise<void>;
  /**
   * load, for a request made with `account`'s own token (`getToken`: AuthContext's getAccessTokenFor, via
   * useAccountToken). The token is asked for before anything here changes, and only when there's
   * something to ask (not to join a request in flight, or for a fresh answer): if the session is someone
   * else's by now (AccountMismatchError), no request is made and nothing is touched, so a reader still
   * showing the last account can't overtake the signed-in account's request. With no session at all the
   * request goes ahead with the failing getter, so `fetcher` reports it as before; unless clear() ran
   * meanwhile (that was the person's own Sign out). `fetcher` gets a getter for the token it got.
   */
  loadWithToken: (account: string, getToken: GetToken, fetcher: (getToken: GetToken) => Promise<T>, options?: LoadOptions) => Promise<void>;
  /** Replaces the settled answer with `next(current)` (null: unchanged); any answer still in flight is dropped. */
  update: (next: (current: Settled<T>) => T | null) => void;
  /** Forgets everything, and drops any answer still in flight. */
  clear: () => void;
}

export interface LoadOptions {
  force?: boolean;
  recheck?: boolean;
}

const stores = new Set<{ clear: () => void }>();

export interface AccountStoreOptions<T> {
  /** An answer that's a check failing for a passing reason (lib/auth/transient-failure.ts), not news about the record. */
  isFailure?: (value: T) => boolean;
}

export function createAccountStore<T>({ isFailure = () => false }: AccountStoreOptions<T> = {}): AccountStore<T> {
  let settled: Settled<T> | null = null;
  let inFlight: { account: string; id: number; done: Promise<void> } | null = null;
  /** Bumped by every request, update and clear: an answer only lands if nothing came after its request. */
  let generation = 0;
  /** Bumped by every clear (a Sign out): a token that was on its way when one ran starts nothing. */
  let clears = 0;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const store: AccountStore<T> = {
    snapshot: () => settled,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load(account, fetcher, { force = false, recheck = false } = {}) {
      if (inFlight && inFlight.account !== account) {
        // Another account's request, overtaken (the page has moved on, back to this account perhaps,
        // whose answer may still be fresh): its answer never lands.
        generation += 1;
        inFlight = null;
      }
      if (!force && inFlight?.account === account) return inFlight.done;
      if (!force && !recheck && settled?.account === account && Date.now() - settled.at < FRESH_MS) return Promise.resolve();
      const id = ++generation;
      const finished = () => {
        if (inFlight?.id === id) inFlight = null;
      };
      const done = fetcher().then(
        (value) => {
          finished();
          if (generation !== id) return;
          // A quiet check that failed for a passing reason keeps the answer it was checking.
          if (!force && isFailure(value) && settled?.account === account && !isFailure(settled.value)) return;
          settled = { account, value, at: Date.now() };
          emit();
        },
        // No answer: nothing kept or cleared.
        finished,
      );
      inFlight = { account, id, done };
      return done;
    },
    update(next) {
      if (!settled) return;
      const value = next(settled);
      if (value === null) return;
      generation += 1;
      inFlight = null;
      settled = { ...settled, value, at: Date.now() };
      emit();
    },
    async loadWithToken(account, getToken, fetcher, options = {}) {
      const { force = false, recheck = false } = options;
      if (!force && (inFlight === null || inFlight.account === account)) {
        // Nothing to ask for, as load would decide: no token needed.
        if (inFlight?.account === account) return inFlight.done;
        if (!recheck && settled?.account === account && Date.now() - settled.at < FRESH_MS) return;
      }
      const clearsBefore = clears;
      const token = await getToken().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      // Someone else's session: not this account's request to make. Or a Sign out while the token was on its way.
      if ((!token.ok && token.error instanceof AccountMismatchError) || clears !== clearsBefore) return;
      const tokenFor: GetToken = token.ok ? () => Promise.resolve(token.value) : () => Promise.reject(token.error);
      return store.load(account, () => fetcher(tokenFor), options);
    },
    clear() {
      clears += 1;
      generation += 1;
      inFlight = null;
      if (settled === null) return;
      settled = null;
      emit();
    },
  };
  stores.add(store);
  return store;
}

/** For tests: every store back to empty (tests/test-utils/setup.ts, after each test). */
export function resetAccountStores(): void {
  for (const store of stores) store.clear();
}
