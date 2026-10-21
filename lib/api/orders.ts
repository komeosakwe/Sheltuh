import { apiFetch, type GetToken } from "./client";
import type { CheckoutResult, ConfirmFreeOrderResult, CustomerOrderLookup } from "./types";

export interface CheckoutLineItemInput {
  ticketTypeId: string;
  quantity: number;
}

/**
 * Public — guest checkout, no account needed. Resolves to `{url}` (go there:
 * Stripe for a paid order, the confirmation page for a free one issued
 * straight away) or, for a free order that needs confirming by email,
 * `{status: "confirmation_sent"}` (show "check your inbox").
 *
 * `buyerEmail` is required when the order is free (it's the only way the
 * tickets reach the buyer). For paid orders it's optional: Stripe collects
 * the email, prefilled with this one when it's given.
 *
 * `trackingCode` is the event's tracking-link code the buyer arrived with
 * (lib/tracking-ref.ts), for attribution only: the server ignores anything
 * that isn't one of the event's codes, and it never changes the price.
 *
 * `getToken`: pass it for a free order when signed in. Booking with the
 * account's own (verified) email then issues the tickets straight away; any
 * other email still gets a confirmation link. A token that can't be had is
 * simply left off (the order goes the guest way).
 *
 * ApiError: 400 (fieldErrors `buyerEmail` / `lineItems`, e.g. over 4 free
 * tickets in any order, paid or free), 404 event not on sale, 409 sold out or this email already has its
 * free tickets for the event, 429 too many free bookings today (members),
 * 503 free bookings busy (the link is emailed after the answer, so a failed
 * send isn't reported here).
 */
export async function createCheckoutSession(
  eventId: string,
  lineItems: CheckoutLineItemInput[],
  buyerEmail?: string,
  trackingCode?: string,
  getToken?: GetToken,
) {
  let token: string | undefined;
  if (getToken) {
    try {
      token = await getToken();
    } catch {
      token = undefined;
    }
  }
  return apiFetch<CheckoutResult>(`/events/${eventId}/checkout`, {
    method: "POST",
    body: { lineItems, ...(buyerEmail ? { buyerEmail } : {}), ...(trackingCode ? { trackingCode } : {}) },
    token,
  });
}

/**
 * Public — confirms a guest's free order with the token from the emailed
 * link (its `#token=` fragment). Resolves to the confirmation page's URL,
 * also when it was already confirmed (within the link's 24 hours). ApiError
 * 400 malformed link, 404 unknown, 410 expired (confirmed or not: the message
 * says which), 409 sold out, this email already has its free tickets for the
 * event, or a ticket type is no longer free.
 */
export async function confirmFreeOrder(token: string) {
  return apiFetch<ConfirmFreeOrderResult>(`/orders/confirm`, { method: "POST", body: { token } });
}

/**
 * Public — looked up by the unguessable order id in the confirmation page's
 * own URL (its `session_id` query parameter), not by any account. Only what
 * that page shows (CustomerOrder: a masked email, no ids or fee split).
 * A still-pending order (webhook hasn't landed yet) comes back with only
 * `status` set — no tickets, no totals. ApiError 404 for an unknown or
 * malformed id.
 */
export async function getOrderBySession(sessionId: string) {
  return apiFetch<CustomerOrderLookup>(`/orders/by-session/${encodeURIComponent(sessionId)}`);
}
