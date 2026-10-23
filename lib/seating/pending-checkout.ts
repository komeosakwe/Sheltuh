/**
 * The checkout this tab has just sent to Stripe, so coming Back from Stripe
 * (the browser's Back button, not Stripe's own cancel link) can release its
 * hold straight away rather than leaving the seats held for the full
 * SEAT_HOLD.holdMinutes. Kept in sessionStorage: this tab only, gone when the
 * tab closes. The order id is the order's credential (lib/api/types.ts
 * CheckoutResult): it's never logged or sent anywhere but the cancel call.
 * It stays stored until the release has an answer, so a transient failure is
 * retried at the next chance rather than leaving the seats held.
 */
import { ApiError } from "@/lib/api/client";
import { cancelPendingOrder } from "@/lib/api/seating";
import { SEAT_HOLD, type CancelOrderResult } from "@/lib/api/types";

const KEY = "sheltuh:pending-checkout";

export interface PendingCheckout {
  orderId: string;
  /** The event's slug, for the seat page it was started from. */
  slug: string;
  /** When it was sent to Stripe (ms since the epoch). */
  at: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Just before going to Stripe. Storage unavailable (private mode): the hold lapses on its own instead. */
export function rememberPendingCheckout(orderId: string, slug: string, now = Date.now()): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ orderId, slug, at: now } satisfies PendingCheckout));
  } catch {
    // Quota or private mode: nothing to release later, and the hold still lapses on its own.
  }
}

/**
 * The pending checkout, left in place: it's only forgotten once its release
 * has an answer, so a release that fails can be tried again. Null when
 * there's none, it's unreadable, or its hold has lapsed by itself (those two
 * are dropped).
 */
export function peekPendingCheckout(now = Date.now()): PendingCheckout | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const value = parse(raw, now);
  if (!value) {
    try {
      store.removeItem(KEY);
    } catch {
      // Storage unavailable: nothing more to do.
    }
  }
  return value;
}

function parse(raw: string, now: number): PendingCheckout | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { orderId, slug, at } = value as Record<string, unknown>;
    if (typeof orderId !== "string" || !/^ord_[0-9a-f]{32}$/.test(orderId)) return null;
    if (typeof slug !== "string" || typeof at !== "number") return null;
    if (now - at > SEAT_HOLD.holdMinutes * 60_000) return null;
    return { orderId, slug, at };
  } catch {
    return null;
  }
}

/** How releasing the stored checkout went. */
export type PendingRelease =
  /** Nothing stored (or it had lapsed, or was unknown to the server): nothing is held. */
  | { kind: "none" }
  /** An answer: `released`, or `paid` / `processing` (nothing to release). The entry is forgotten. */
  | { kind: "done"; status: CancelOrderResult["status"] }
  /** Couldn't reach an answer (network, 5xx, still being set up, rate limited). The entry is kept, with its original `at`, for a later try. */
  | { kind: "failed" };

/** Worth trying again later: no answer about the order itself. */
function isTransient(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status === 409 || err.status === 429 || err.status >= 500;
}

let inFlight: Promise<PendingRelease> | null = null;

/**
 * Releases the stored checkout's hold, if there is one. The entry is kept
 * until there's an answer, so a transient failure is retried at the next
 * chance (the next `pageshow`, a reload, or pressing Checkout again). Calls
 * made while one is in flight share it: the order is never cancelled twice
 * at once.
 */
export function releasePendingCheckout(now = Date.now()): Promise<PendingRelease> {
  if (inFlight) return inFlight;
  const pending = peekPendingCheckout(now);
  if (!pending) return Promise.resolve({ kind: "none" });
  const run = async (): Promise<PendingRelease> => {
    try {
      const result = await cancelPendingOrder(pending.orderId);
      forgetPendingCheckout(pending.orderId);
      return { kind: "done", status: result.status };
    } catch (err) {
      if (isTransient(err)) return { kind: "failed" };
      // A final answer (404: unknown order): nothing is held, nothing to retry.
      forgetPendingCheckout(pending.orderId);
      return { kind: "none" };
    }
  };
  // Cleared asynchronously, after the assignment, even if the call throws synchronously.
  const current = run().finally(() => {
    if (inFlight === current) inFlight = null;
  });
  inFlight = current;
  return current;
}

/** The order was paid (the success page) or released elsewhere (the cancelled page): nothing to do on Back. */
export function forgetPendingCheckout(orderId: string): void {
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(KEY);
    if (raw && raw.includes(JSON.stringify(orderId))) store.removeItem(KEY);
  } catch {
    // Storage unavailable: there's nothing stored either.
  }
}
