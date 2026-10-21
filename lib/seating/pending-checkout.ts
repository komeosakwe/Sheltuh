/**
 * The checkout this tab has just sent to Stripe, so coming Back from Stripe
 * (the browser's Back button, not Stripe's own cancel link) can release its
 * hold straight away rather than leaving the seats held for the full
 * SEAT_HOLD.holdMinutes. Kept in sessionStorage: this tab only, gone when the
 * tab closes. The order id is the order's credential (lib/api/types.ts
 * CheckoutResult): it's never logged or sent anywhere but the cancel call.
 */
import { SEAT_HOLD } from "@/lib/api/types";

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
 * The pending checkout, removed as it's read (so it's released once). Null
 * when there's none, it's unreadable, or its hold has lapsed by itself.
 */
export function takePendingCheckout(now = Date.now()): PendingCheckout | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(KEY);
    store.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
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
