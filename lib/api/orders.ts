import { apiFetch } from "./client";
import type { OrderRecord } from "./types";

export interface CheckoutLineItemInput {
  ticketTypeId: string;
  quantity: number;
}

/** Public — guest checkout, no account needed. Returns the URL to redirect the browser to. */
/**
 * `buyerEmail` is required when the order is free (it's the only way the
 * tickets reach the buyer); for paid orders Stripe collects it instead.
 */
export async function createCheckoutSession(eventId: string, lineItems: CheckoutLineItemInput[], buyerEmail?: string) {
  return apiFetch<{ url: string }>(`/events/${eventId}/checkout`, {
    method: "POST",
    body: { lineItems, ...(buyerEmail ? { buyerEmail } : {}) },
  });
}

/**
 * Public — looked up by the unguessable order id in the confirmation page's
 * own URL (its `session_id` query parameter), not by any account.
 * A still-pending order (webhook hasn't landed yet) comes back with only
 * `status` set — no tickets, no totals — never partial financial detail.
 */
export async function getOrderBySession(sessionId: string) {
  return apiFetch<OrderRecord | { status: "pending" }>(`/orders/by-session/${encodeURIComponent(sessionId)}`);
}
