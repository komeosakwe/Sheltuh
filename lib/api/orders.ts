import { keepCheckoutAccess } from "@/lib/order-access";
import { runCheckoutAttempt } from "./checkout-attempt";
import { apiFetch, type GetToken } from "./client";
import {
  ORDER_ACCESS_HEADER,
  type CheckoutResult,
  type ConfirmFreeOrderResult,
  type CustomerOrderLookup,
  type OrderEmailChangeResult,
  type OrderPaymentLookup,
} from "./types";

/** The wallets a ticket can be added to (CustomerOrder.wallet). */
export type WalletProvider = "google" | "apple";

export interface CheckoutLineItemInput {
  ticketTypeId: string;
  quantity: number;
}

/**
 * Public — guest checkout, no account needed. Resolves to `{url}` (go there:
 * our payment page, /checkout/pay?order=…, for a paid order; the
 * confirmation page for a free one issued straight away) or, for a free
 * order that needs confirming by email, `{status: "confirmation_sent"}`
 * (show "check your inbox").
 *
 * `buyerEmail`: where the tickets are sent, checked by the server (its
 * format, a typo list, then whether its domain takes email: 400
 * `fieldErrors.buyerEmail` with `code` `email_typo` / `email_no_mail` and
 * any `suggestion` in `err.body`). Required when the order is free; the
 * panels send it for paid orders too, and Stripe's form is prefilled with it
 * (the API still accepts a paid order without one for one release).
 *
 * `buyerName`: the name shared with the organiser (lib/buyer-details.ts),
 * asked for on every checkout (the API still accepts none for one release).
 * Part of the basket, so a changed name starts a new attempt.
 *
 * `trackingCode` is the event's tracking-link code the buyer arrived with
 * (lib/tracking-ref.ts), for attribution only: the server ignores anything
 * that isn't one of the event's codes, and it never changes the price.
 *
 * `supportCents`: Support Sheltüh (lib/support.ts), sent only when above 0:
 * a whole number of cents from SUPPORT_MIN_CENTS to SUPPORT_MAX_CENTS, and
 * only with a paid ticket in the order (400 `fieldErrors.supportCents`
 * otherwise). It's part of the basket, so a changed amount starts a new
 * attempt.
 *
 * `getToken`: pass it for a free order when signed in. Booking with the
 * account's own (verified) email then issues the tickets straight away; any
 * other email still gets a confirmation link. A token that can't be had is
 * simply left off (the order goes the guest way).
 *
 * A paid checkout's `orderAccess` (the order access token) is kept on this
 * device as it answers (lib/order-access.ts): the confirmation page sends it
 * back (getOrderBySession, changeOrderEmail).
 *
 * Sent with an `Idempotency-Key` (lib/api/checkout-attempt.ts): calling
 * this again with the same basket while it's in flight shares the one
 * request, and after an error reuses the key, so a paid checkout never makes
 * a second order or Stripe session; a success or a changed basket starts a
 * new attempt. Network failures, 503s and an in-progress 409 are retried
 * with the same key before the promise rejects.
 *
 * ApiError: 400 (fieldErrors `buyerName` / `buyerEmail` / `lineItems` / `supportCents`, e.g. over 4 free
 * tickets in any order, paid or free), 404 event not on sale, 409 sold out or this email already has its
 * free tickets for the event, 429 too many free bookings today (members)
 * or too many paid checkouts from this connection (body
 * `code: "client_rate_limited"`; nothing was created), 503 free bookings
 * busy (the link is emailed after the answer, so a failed send isn't
 * reported here), or card payments aren't available (paid orders; nothing
 * was created). Paid checkouts also have the CheckoutErrorCode codes
 * (`checkoutErrorCode(err)`): e.g. 429 `client_rate_limited`, 409
 * `checkout_expired` or `checkout_other_client` (press again: a new attempt).
 */
export async function createCheckoutSession(
  eventId: string,
  lineItems: CheckoutLineItemInput[],
  buyerEmail?: string,
  trackingCode?: string,
  getToken?: GetToken,
  supportCents?: number,
  buyerName?: string,
) {
  const body = {
    lineItems,
    ...(buyerEmail ? { buyerEmail } : {}),
    ...(buyerName ? { buyerName } : {}),
    ...(trackingCode ? { trackingCode } : {}),
    ...(supportCents && supportCents > 0 ? { supportCents } : {}),
  };
  const result = await runCheckoutAttempt(eventId, body, async (key) => {
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
      body,
      token,
      headers: { "idempotency-key": key },
    });
  });
  // A paid checkout's order access token stays on this device (lib/order-access.ts), for the confirmation page.
  return keepCheckoutAccess(result);
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
 *
 * `orderAccess`: the order's token from the checkout's answer
 * (CheckoutResult.orderAccess), when this browser has it. It goes in the
 * `x-order-access` header (never the URL), and the answer then also carries
 * the full `email` and `emailChange`. Without it (any other device, or the
 * ticket email's link), the masked email only, and none once the email has
 * been changed.
 *
 * `getToken`: pass it when signed in. Signed in with a verified account
 * whose email is the order's, the answer says this request may send the
 * order's tickets (CustomerOrder.transfers) and who they went to. A token
 * that can't be had is left off (the order reads as any other visitor's).
 */
export async function getOrderBySession(sessionId: string, orderAccess?: string, getToken?: GetToken) {
  let token: string | undefined;
  if (getToken) {
    try {
      token = await getToken();
    } catch {
      token = undefined;
    }
  }
  return apiFetch<CustomerOrderLookup>(`/orders/by-session/${encodeURIComponent(sessionId)}`, {
    ...(orderAccess ? { headers: { [ORDER_ACCESS_HEADER]: orderAccess } } : {}),
    ...(token ? { token } : {}),
  });
}

/**
 * Public, for the paying browser only — the buyer's one change of a paid
 * order's email (OrderEmailChangeResult), with the order's token
 * (`orderAccess`, sent as the `x-order-access` header, never in the URL).
 * `getToken`: pass it when signed in, so the order can be moved to the
 * account's own confirmed address (a token that can't be had is left off).
 * ApiError: 404 unknown order or wrong token; 400 `fieldErrors.email`, or
 * `code` `email_typo` / `email_no_mail` with an optional `suggestion` (read
 * from `err.body`); 409 OrderEmailChangeErrorCode; 429 `rate_limited`.
 */
export async function changeOrderEmail(sessionId: string, email: string, orderAccess: string, getToken?: GetToken) {
  let token: string | undefined;
  if (getToken) {
    try {
      token = await getToken();
    } catch {
      token = undefined;
    }
  }
  return apiFetch<OrderEmailChangeResult>(`/orders/by-session/${encodeURIComponent(sessionId)}/email`, {
    method: "POST",
    body: { email },
    token,
    headers: { [ORDER_ACCESS_HEADER]: orderAccess },
  });
}

/**
 * Public — the payment page's (/checkout/pay?order={orderId}) view of a card
 * checkout, by the same unguessable order id: Stripe's client secret and a
 * server-priced summary while it's `open`, else where to go
 * (OrderPaymentLookup). Read-only. ApiError 404 unknown, malformed or not a
 * card checkout; 409 still being set up (try again in a moment); 429 asked
 * too often in the last minute (try again in a minute).
 */
export async function getOrderPayment(orderId: string) {
  return apiFetch<OrderPaymentLookup>(`/orders/by-session/${encodeURIComponent(orderId)}/payment`);
}

/**
 * Where "Add to Google Wallet" / "Add to Apple Wallet" goes for one ticket of
 * the order: a plain link (a full navigation, not a fetch). Google's answers
 * with a redirect to Google's save page; Apple's is the .pkpass, which Safari
 * offers to add to Wallet. The order id is the same capability as the ticket
 * page's own URL; `ticketNumber` is the ticket's number on the page (1-based,
 * in the API's order), never its code. Only offer it when
 * `CustomerOrder.wallet[provider]` is true.
 */
export function walletPassUrl(sessionId: string, provider: WalletProvider, ticketNumber: number): string {
  return `/api/orders/by-session/${encodeURIComponent(sessionId)}/wallet/${provider}?ticket=${ticketNumber}`;
}
