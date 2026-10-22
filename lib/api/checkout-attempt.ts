/**
 * Checkout attempts on the client (docs/architecture.md, "Checkout
 * idempotency"). Every checkout request carries an `Idempotency-Key`: one
 * random UUID per attempt, kept while the basket stays the same, so a double
 * click, a retry after a lost response, or a press again after an error gets
 * the same order and Stripe session back instead of a second one.
 *
 * - One attempt per event (the scope). A different basket (lines, seats,
 *   email, tracking code) is a new attempt with a new key; so is the same
 *   basket after the old key is 30 minutes old.
 * - A request already in flight for the attempt is shared: a double click
 *   gets the same promise, and only one request is sent.
 * - Retries with the same key: a network failure or 503 once; a 409
 *   `checkout_in_progress` up to 3 times, after its Retry-After (at most 5
 *   seconds).
 * - The key is dropped (the next press starts afresh) after a success, and
 *   after any 4xx except an in-progress 409 (the basket was refused, or the
 *   attempt ended). A 5xx or network failure keeps it, so the next press
 *   reuses the order the server may have kept.
 *
 * Browser memory only: a reload starts a new attempt, as before keys existed.
 */
import { ApiError } from "./client";
import type { CheckoutErrorCode } from "./types";

/** A key older than this isn't reused, even for the same basket. */
export const CHECKOUT_KEY_TTL_MS = 30 * 60_000;
const IN_PROGRESS_RETRIES = 3;
const MAX_WAIT_MS = 5_000;

interface Attempt {
  key: string;
  basket: string;
  startedAt: number;
  inflight?: Promise<unknown>;
}

const attempts = new Map<string, Attempt>();

/** JSON with object keys sorted, so the same basket always reads the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The error's checkout code (CheckoutErrorCode, or a seat code), if it has one. */
export function checkoutErrorCode(err: unknown): CheckoutErrorCode | string | undefined {
  if (!(err instanceof ApiError) || !err.body) return undefined;
  const code = (err.body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetries<T>(key: string, send: (key: string) => Promise<T>): Promise<T> {
  let transientRetried = false;
  let inProgressRetries = 0;
  for (;;) {
    try {
      return await send(key);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.status === 409 && checkoutErrorCode(err) === "checkout_in_progress" && inProgressRetries < IN_PROGRESS_RETRIES) {
        inProgressRetries += 1;
        const seconds = Number((err.body as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
        await sleep(Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000, MAX_WAIT_MS));
        continue;
      }
      if ((err.status === 0 || err.status === 503) && !transientRetried) {
        transientRetried = true;
        await sleep(1000);
        continue;
      }
      throw err;
    }
  }
}

/** Whether a failed attempt's key is done with (see the top of this file). */
function dropsKey(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 409 && checkoutErrorCode(err) === "checkout_in_progress") return false;
  return err.status >= 400 && err.status < 500;
}

/**
 * Runs `send` for this scope's (an event id's) current attempt at `basket`,
 * with its Idempotency-Key; see the top of this file. Resolves or rejects as
 * `send` does (after any retries).
 */
export function runCheckoutAttempt<T>(scope: string, basket: unknown, send: (key: string) => Promise<T>): Promise<T> {
  const signature = canonical(basket);
  let attempt = attempts.get(scope);
  if (!attempt || attempt.basket !== signature || (!attempt.inflight && Date.now() - attempt.startedAt > CHECKOUT_KEY_TTL_MS)) {
    attempt = { key: crypto.randomUUID(), basket: signature, startedAt: Date.now() };
    attempts.set(scope, attempt);
  }
  if (attempt.inflight) return attempt.inflight as Promise<T>;

  const current = attempt;
  const done = () => {
    if (attempts.get(scope) === current) attempts.delete(scope);
  };
  const promise = sendWithRetries(current.key, send).then(
    (result) => {
      done();
      return result;
    },
    (err: unknown) => {
      current.inflight = undefined;
      if (dropsKey(err)) done();
      throw err;
    },
  );
  current.inflight = promise;
  return promise;
}

/** The key the next request for this scope would send, if an attempt is open (for tests and diagnostics). */
export function currentCheckoutKey(scope: string): string | undefined {
  return attempts.get(scope)?.key;
}

/** Forgets the attempt for `scope` (or every attempt): the next request starts afresh. */
export function resetCheckoutAttempt(scope?: string) {
  if (scope === undefined) attempts.clear();
  else attempts.delete(scope);
}
