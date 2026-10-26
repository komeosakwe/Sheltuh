import { orderKey } from "../client-key";
import type { Deps } from "../deps";
import { HttpError, PRIVATE_NO_STORE } from "../http";
import { ORDER_ID_PATTERN, orderReference } from "../order-reference";
import type { Handler } from "../route";
import type { CustomerOrder } from "../types";
import { buildApplePass } from "../wallet/apple";
import { buildGoogleSaveJwt, googleSaveUrl } from "../wallet/google";
import { passTimeZone, walletQrPayload, type WalletTicket } from "../wallet/pass-content";
import { lookupCustomerOrder, ORDER_NOT_FOUND, rateLimitSecret, takeClientLimit, walletEligible } from "./orders";

/**
 * GET /api/orders/by-session/[sessionId]/wallet/google?ticket={n} and
 * …/wallet/apple?ticket={n} — public, by the same capability as the ticket
 * page (/checkout/success?session_id=…): the unguessable order id, looked up
 * by the page's own lookup (lookupCustomerOrder), so a pass is only ever a
 * ticket the page shows. `n` is the ticket's number on the page and in the
 * email (1-based, ticket type then code), never its code, so the code isn't
 * in these routes' URLs. It is in the URL the Google route redirects to: the
 * JWT in Google's save link carries the object, barcode and all (readable,
 * not encrypted). That URL goes from our 302 to the browser and Google only
 * (`Referrer-Policy: no-referrer`). Inserting objects with Google's REST API
 * and sending a "skinny" JWT of ids only would remove it (not built: needs
 * an OAuth token exchange).
 *
 * In order, every answer `private, no-store`:
 * - an id that isn't shaped like one: 404, no query;
 * - the wallet isn't configured (Deps.googleWallet / appleWallet): 404,
 *   no query (the order response says `wallet.{google,apple}: false`, so the
 *   page shows no button);
 * - `ticket` missing or not a whole number from 1: 400 (fieldErrors.ticket);
 * - one hit on the client's allowance (WALLET_RATE_LIMITS.perClient, every
 *   well-formed request, unknown orders too); over it, 429;
 * - unknown, not paid (pending, failed, refunded, refund pending), or the
 *   event no longer published (unpublished, rejected, removed: the page's
 *   "no longer listed"): 404 "Order not found.", the same for each; no
 *   ticket `n`: 404 "Ticket not found." (the holder of the order id already
 *   knows how many tickets it has);
 * - one hit on the order's allowance (WALLET_RATE_LIMITS.perOrder), only for
 *   an order that's found; over it, 429;
 * - Google: 302 to Google's save page, https://pay.google.com/gp/v/save/{jwt}
 *   (`Referrer-Policy: no-referrer`, so Google never gets this URL, with its
 *   order id, as a Referer). Apple: 200, the .pkpass, as an attachment.
 * Free orders work the same: a member's is paid at once, a guest's once
 * its emailed link is confirmed (until then it's pending: 404).
 * Writes nothing but the rate-limit counters; logs nothing about the order.
 */

/**
 * The wallet routes' anonymous limit: fixed windows on
 * private.take_client_rate_limit (a new bucket name, no migration), keyed and
 * salted as the payment page's (lib/server/client-key.ts), failing open,
 * logged, without a client IP or STRIPE_WEBHOOK_SECRET. 30 a minute: a buyer
 * adds each of up to 10 tickets to one wallet, or a few to each; 30 leaves
 * room for several buyers on one address and bounds how fast one client can
 * try order ids or make the server sign passes.
 */
export const WALLET_RATE_LIMITS = {
  perClient: { bucket: "wallet_pass", hits: 30, window: "1 minute" },
  /**
   * Per order, however many clients ask (keyed on an HMAC of the order id,
   * never the id, as the payment page's paymentPerOrder): 60 a minute, taken
   * once the order is found. Bounds the passes signed for one order id
   * spread across many addresses; a buyer adding all of a 10-ticket order to
   * both wallets twice stays well under it.
   */
  perOrder: { bucket: "wallet_pass:order", hits: 60, window: "1 minute" },
} as const;

const WALLET_BUSY = "You've added a lot of passes in the last minute. Wait a minute, then try again.";
const WALLET_ORDER_BUSY = "This order's passes have been asked for a lot in the last minute. Wait a minute, then try again.";
const TICKET_NOT_FOUND = "Ticket not found.";
/** Up to 4 digits: an order never has 10,000 tickets. */
const TICKET_NUMBER_PATTERN = /^[1-9]\d{0,3}$/;

type Provider = "google" | "apple";

const PROVIDER_OFF: Record<Provider, string> = {
  google: "Google Wallet passes aren't available.",
  apple: "Apple Wallet passes aren't available.",
};

/** The `?ticket=` number, or a 400. */
function ticketNumber(req: Request): number {
  const raw = new URL(req.url).searchParams.get("ticket");
  if (raw === null || !TICKET_NUMBER_PATTERN.test(raw)) {
    throw new HttpError(400, "Choose a ticket.", { ticket: "Give the ticket's number, from 1." });
  }
  return Number(raw);
}

/**
 * The checks above from the ticket number on (the rate limits, the page's
 * lookup and rules), then the ticket's pass content: its wallet serial, and
 * the event's id, current title and street address (the page's response
 * leaves the address out; the email shows it), read again only while the
 * event is still published.
 */
async function walletTicket(req: Request, sessionId: string, provider: Provider, deps: Deps): Promise<WalletTicket> {
  const n = ticketNumber(req);
  const secret = rateLimitSecret(deps, "the wallet pass rate limit was skipped");
  if (!(await takeClientLimit(req, deps, secret, WALLET_RATE_LIMITS.perClient, `Wallet pass (${provider})`))) {
    throw new HttpError(429, WALLET_BUSY);
  }
  const lookup = await lookupCustomerOrder(deps.db, sessionId);
  if (!walletEligible(lookup)) throw new HttpError(404, ORDER_NOT_FOUND);
  if (secret) {
    const [limit] = await deps.db.query<{ allowed: boolean }>(
      `select private.take_client_rate_limit($1, $2, $3, $4::interval) as allowed`,
      [orderKey(sessionId, secret), WALLET_RATE_LIMITS.perOrder.bucket, WALLET_RATE_LIMITS.perOrder.hits, WALLET_RATE_LIMITS.perOrder.window],
    );
    if (!limit.allowed) throw new HttpError(429, WALLET_ORDER_BUSY);
  }
  const order: CustomerOrder = lookup;
  const ticket = order.tickets[n - 1];
  if (!ticket || !order.eventStartsAt) throw new HttpError(404, TICKET_NOT_FOUND);
  // The ticket's own row (by the order and the code the lookup returned), for its serial; the event's current
  // title and street address, again only while it's published.
  const [event] = await deps.db.query<{ event_id: string; title: string; venue_address: string | null; serial: string }>(
    `select e.id as event_id, e.title, e.venue_address, replace(t.wallet_serial::text, '-', '') as serial
       from public.orders o
       join public.events e on e.id = o.event_id and e.status = 'published'
       join public.tickets t on t.order_id = o.id and t.code = $2
      where o.id = $1`,
    [sessionId, ticket.ticketCode],
  );
  if (!event) throw new HttpError(404, ORDER_NOT_FOUND);
  return {
    eventId: event.event_id,
    eventTitle: event.title,
    startsAt: order.eventStartsAt,
    ...(order.eventEndsAt ? { endsAt: order.eventEndsAt } : {}),
    timeZone: passTimeZone(),
    ...(order.venueName ? { venueName: order.venueName } : {}),
    ...(event.venue_address?.trim() ? { venueAddress: event.venue_address.trim() } : {}),
    ...(order.suburb ? { suburb: order.suburb } : {}),
    ticketTypeName: ticket.ticketTypeName,
    ticketNumber: n,
    ticketCount: order.tickets.length,
    ...(ticket.seat ? { seat: ticket.seat } : {}),
    code: ticket.ticketCode,
    qrPayload: walletQrPayload(ticket.ticketCode),
    orderReference: orderReference(sessionId),
    serial: event.serial,
  };
}

/** GET …/wallet/google?ticket={n}: 302 to Google's "Save to Google Wallet" page for that ticket. */
export const getGoogleWalletPass: Handler<{ sessionId: string }> = async (req, { sessionId }, deps) => {
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  const config = deps.googleWallet();
  if (!config) throw new HttpError(404, PROVIDER_OFF.google);
  const ticket = await walletTicket(req, sessionId, "google", deps);
  const location = googleSaveUrl(buildGoogleSaveJwt(config, ticket, deps.siteUrl()));
  return new Response(null, {
    status: 302,
    headers: { ...PRIVATE_NO_STORE, location, "referrer-policy": "no-referrer" },
  });
};

/** GET …/wallet/apple?ticket={n}: the ticket's .pkpass. */
export const getAppleWalletPass: Handler<{ sessionId: string }> = async (req, { sessionId }, deps) => {
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  const config = await deps.appleWallet();
  if (!config) throw new HttpError(404, PROVIDER_OFF.apple);
  const ticket = await walletTicket(req, sessionId, "apple", deps);
  const pass = buildApplePass(config, ticket);
  return new Response(new Uint8Array(pass), {
    status: 200,
    headers: {
      ...PRIVATE_NO_STORE,
      "content-type": "application/vnd.apple.pkpass",
      // The ticket's number, never its code or the order id.
      "content-disposition": `attachment; filename="sheltuh-ticket-${ticket.ticketNumber}.pkpass"`,
      "content-length": String(pass.length),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
};
