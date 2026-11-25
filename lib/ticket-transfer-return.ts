import { LINK_TOKEN_PATTERN } from "@/lib/link-token";

/*
 * What a tab keeps for itself across a sign-in round trip when sending or
 * accepting a ticket (docs/architecture.md, "Ticket transfers"). Only this
 * tab's sessionStorage: never a cookie, a query string or localStorage, and
 * never in a sign-in `next` (OAuth puts `next` in Supabase's redirect URL,
 * so it would reach Supabase Auth's logs). Storage that's blocked is simply
 * skipped: the page then asks again (the order's link, or the offer email).
 */

/** The ticket page's order id while its buyer signs in to send a ticket (/checkout/success has no session_id on the way back). */
const RETURN_ORDER_KEY = "sheltuh:return-order";
/** The accept link's token while its recipient signs in or creates an account. */
const OFFER_TOKEN_KEY = "sheltuh:ticket-offer";

/** An order id as the API issues them (lib/server/order-reference.ts ORDER_ID_PATTERN). */
const ORDER_ID = /^ord_[0-9a-f]{32}$/;

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return session()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  const store = session();
  if (!store) return;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // Storage full or blocked: nothing is kept.
  }
}

/** Keeps the ticket page's order id for the trip through sign-in. */
export function rememberReturnOrder(orderId: string): void {
  if (ORDER_ID.test(orderId)) write(RETURN_ORDER_KEY, orderId);
}

/** The order id kept by rememberReturnOrder, once: it's forgotten as it's read. Null when there's none (or it isn't one). */
export function takeReturnOrder(): string | null {
  const kept = read(RETURN_ORDER_KEY);
  write(RETURN_ORDER_KEY, null);
  return kept && ORDER_ID.test(kept) ? kept : null;
}

/** Keeps an accept link's token in this tab (while its recipient signs in). */
export function keepOfferToken(token: string): void {
  if (LINK_TOKEN_PATTERN.test(token)) write(OFFER_TOKEN_KEY, token);
}

/** The accept link's token this tab kept, if it's well formed. */
export function keptOfferToken(): string | null {
  const kept = read(OFFER_TOKEN_KEY);
  return kept && LINK_TOKEN_PATTERN.test(kept) ? kept : null;
}

/** Forgets the accept link's token: it's been used, or the server says it can't be. */
export function forgetOfferToken(): void {
  write(OFFER_TOKEN_KEY, null);
}

/** The `?send=` of a ticket page link (from Sign in to send, or the declined / expired offer emails): a ticket number, else null. */
export function sendParam(raw: string | null): number | null {
  if (!raw || !/^[1-9][0-9]{0,3}$/.test(raw)) return null;
  return Number(raw);
}
