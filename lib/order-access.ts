import { orderFingerprint } from "@/lib/order-fingerprint";
import type { CheckoutResult, OrderEmailChange, OrderEmailChangeBlock } from "@/lib/api/types";

/**
 * The order access tokens this browser was given by its paid checkouts
 * (CheckoutResult.orderAccess; docs/architecture.md, "Buyer email checks").
 * A token is what tells the paying browser from anyone else holding the
 * order's link: with it, the confirmation page shows the full email and
 * offers the one change of it.
 *
 * localStorage, under `sheltuh:order-access:v1`: `{f, t, at}` per order,
 * where `f` is a short fingerprint of the order id (never the id itself),
 * `t` the token and `at` when it was kept (ms). The newest 20, for up to
 * 180 days. Storage that can't be read or written is ignored: the page then
 * shows what any other device sees, and the buyer contacts support.
 */
const STORAGE_KEY = "sheltuh:order-access:v1";
export const ORDER_ACCESS_LIMIT = 20;
export const ORDER_ACCESS_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
/** The server's token: 64 hex characters. Anything else is never kept or sent. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

interface Entry {
  f: string;
  t: string;
  at: number;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.f === "string" &&
    typeof entry.t === "string" &&
    TOKEN_PATTERN.test(entry.t) &&
    typeof entry.at === "number" &&
    Number.isFinite(entry.at)
  );
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The kept entries still in date, oldest first. */
function readEntries(store: Storage, now: number): Entry[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).filter((entry) => entry.at <= now && now - entry.at <= ORDER_ACCESS_MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeEntries(store: Storage, entries: Entry[]): void {
  try {
    if (entries.length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Full or blocked: this order's page falls back to what any device sees.
  }
}

/** Keeps `token` for `orderId` on this device (replacing any older one for it). A token of the wrong shape is ignored. */
export function rememberOrderAccess(orderId: string, token: string, now: number = Date.now()): void {
  if (!orderId || !TOKEN_PATTERN.test(token)) return;
  const store = storage();
  if (!store) return;
  const f = orderFingerprint(orderId);
  const entries = readEntries(store, now).filter((entry) => entry.f !== f);
  writeEntries(store, [...entries, { f, t: token, at: now }].slice(-ORDER_ACCESS_LIMIT));
}

/**
 * The token this device was given for `orderId`, if it still has one in
 * date. Read only: an expired entry is skipped here, not removed (the next
 * rememberOrderAccess or forgetOrderAccess writes the list without it).
 */
export function orderAccessFor(orderId: string, now: number = Date.now()): string | undefined {
  const store = storage();
  if (!store || !orderId) return undefined;
  const entries = readEntries(store, now);
  const f = orderFingerprint(orderId);
  // Newest first: the latest checkout's token wins (a fingerprint collision is the older order's loss).
  const found = [...entries].reverse().find((entry) => entry.f === f);
  return found?.t;
}

/**
 * Forgets this device's token for `orderId` (and any expired ones), once the
 * server has said it can never be used to change the email again
 * (`event_ended`, `ticket_scanned` or `changed_by_support`): it isn't kept
 * for months on a device that may not stay the buyer's.
 */
export function forgetOrderAccess(orderId: string, now: number = Date.now()): void {
  const store = storage();
  if (!store || !orderId) return;
  const f = orderFingerprint(orderId);
  const entries = readEntries(store, now);
  const kept = entries.filter((entry) => entry.f !== f);
  // Nothing to forget and nothing expired: leave storage as it is.
  if (kept.length === entries.length && store.getItem(STORAGE_KEY) === JSON.stringify(entries)) return;
  writeEntries(store, kept);
}

/** The server's reasons after which a token is never any use again. */
const FINAL_EMAIL_CHANGE_BLOCKS: readonly OrderEmailChangeBlock[] = ["event_ended", "ticket_scanned", "changed_by_support"];

/**
 * forgetOrderAccess once `change` (CustomerOrder.emailChange, or a 409's
 * code as one) is final: the event ended, a ticket was scanned, or support
 * changed the email. Anything else (allowed, the buyer's own change used, an
 * unpaid order) leaves the token.
 */
export function forgetOrderAccessIfFinal(orderId: string, change: OrderEmailChange | undefined): void {
  if (change && !change.allowed && FINAL_EMAIL_CHANGE_BLOCKS.includes(change.reason)) forgetOrderAccess(orderId);
}

/**
 * Keeps a paid checkout's token (CheckoutResult.orderAccess, with its
 * `orderId`) as the checkout answers, before the browser leaves for the
 * payment page. Anything else (a free order, an answer without a token) is
 * left alone. Returns `result`.
 */
export function keepCheckoutAccess<T extends CheckoutResult>(result: T, now: number = Date.now()): T {
  // An answer without a JSON body comes back undefined (apiFetch): nothing to keep.
  if (typeof result === "object" && result !== null && "url" in result && result.orderId && result.orderAccess) {
    rememberOrderAccess(result.orderId, result.orderAccess, now);
  }
  return result;
}
