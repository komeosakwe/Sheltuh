import { apiFetch } from "./client";
import type { OrderRecord } from "./types";

export interface CheckoutLineItemInput {
  ticketTypeId: string;
  quantity: number;
}

/** Public — guest checkout, no Cognito token. Returns the URL to redirect the browser to. */
export async function createCheckoutSession(
  organiserId: string,
  eventId: string,
  lineItems: CheckoutLineItemInput[],
) {
  return apiFetch<{ url: string }>(`/events/${organiserId}/${eventId}/checkout`, {
    method: "POST",
    body: { lineItems },
  });
}

/**
 * Public — looked up by the Stripe Checkout Session id (or the free-order
 * equivalent) from the confirmation page's own URL, not by any account.
 * A still-pending order (webhook hasn't landed yet) comes back with only
 * `status` set — no tickets, no totals — never partial financial detail.
 */
export async function getOrderBySession(sessionId: string) {
  return apiFetch<OrderRecord | { status: "pending" }>(`/orders/by-session/${encodeURIComponent(sessionId)}`);
}
