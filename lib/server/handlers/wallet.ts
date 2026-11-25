import { ticketNameWithGroup } from "@/lib/ticket-groups";
import { orderKey } from "../client-key";
import type { Deps } from "../deps";
import { HttpError, PRIVATE_NO_STORE, tooManyRequests, windowSeconds } from "../http";
import { ORDER_ID_PATTERN, orderReference } from "../order-reference";
import type { Handler } from "../route";
import type { CustomerOrder } from "../types";
import { buildApplePass } from "../wallet/apple";
import { appleEventStrip } from "../wallet/event-image";
import { buildGoogleSaveJwt, googleSaveUrl } from "../wallet/google";
import { passTimeZone, walletQrPayload, type WalletTicket } from "../wallet/pass-content";
import { rateLimitSecret, takeClientLimit } from "../client-limits";
import { lookupCustomerOrder, ORDER_NOT_FOUND, walletEligible } from "./orders";

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
 *   knows how many tickets it has), and so is a ticket its buyer sent to
 *   someone who accepted it (docs/architecture.md, "Ticket transfers": the
 *   sender never gets a pass, or any code, for it again);
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
    throw tooManyRequests(WALLET_BUSY, windowSeconds(WALLET_RATE_LIMITS.perClient.window));
  }
  const lookup = await lookupCustomerOrder(deps.db, sessionId);
  if (!walletEligible(lookup)) throw new HttpError(404, ORDER_NOT_FOUND);
  if (secret) {
    const [limit] = await deps.db.query<{ allowed: boolean }>(
      `select private.take_client_rate_limit($1, $2, $3, $4::interval) as allowed`,
      [orderKey(sessionId, secret), WALLET_RATE_LIMITS.perOrder.bucket, WALLET_RATE_LIMITS.perOrder.hits, WALLET_RATE_LIMITS.perOrder.window],
    );
    if (!limit.allowed) throw tooManyRequests(WALLET_ORDER_BUSY, windowSeconds(WALLET_RATE_LIMITS.perOrder.window));
  }
  const order: CustomerOrder = lookup;
  // By its number (stable whatever is sent on): a ticket sent to someone isn't in `tickets` (it's a 404).
  const ticket = order.tickets.find((t, index) => (t.ticketNumber ?? index + 1) === n);
  if (!ticket || !order.eventStartsAt) throw new HttpError(404, TICKET_NOT_FOUND);
  // The ticket's own row (by the order and the code the lookup returned), for its serial; the event's current
  // title and street address, again only while it's published.
  // The photo's version and focus point too (by primary key, not its bytes): the passes' image band.
  const [event] = await deps.db.query<{
    event_id: string;
    title: string;
    venue_address: string | null;
    serial: string;
    image_version: string | null;
    focus_x: number | null;
    focus_y: number | null;
  }>(
    `select e.id as event_id, e.title, e.venue_address, replace(t.wallet_serial::text, '-', '') as serial,
            floor(extract(epoch from i.updated_at))::bigint::text as image_version, i.focus_x, i.focus_y
       from public.orders o
       join public.events e on e.id = o.event_id and e.status = 'published'
       join public.tickets t on t.order_id = o.id and t.code = $2
       left join public.event_images i on i.event_id = e.id
      where o.id = $1
        -- Never a pass for a ticket sent to someone (belt and braces with the lookup).
        and not exists (select 1 from private.ticket_transfers x where x.ticket_code = t.code and x.status = 'accepted')`,
    [sessionId, ticket.ticketCode],
  );
  if (!event) throw new HttpError(404, ORDER_NOT_FOUND);
  return {
    eventId: event.event_id,
    eventTitle: event.title,
    startsAt: order.eventStartsAt,
    ...(order.eventEndsAt ? { endsAt: order.eventEndsAt } : {}),
    timeZone: passTimeZone(order),
    ...(order.venueName ? { venueName: order.venueName } : {}),
    ...(event.venue_address?.trim() ? { venueAddress: event.venue_address.trim() } : {}),
    ...(order.suburb ? { suburb: order.suburb } : {}),
    // The path EVENT_COLUMNS gives the photo (lib/server/records.ts), built here from its version.
    ...(event.image_version !== null ? { imageUrl: `/api/events/${event.event_id}/image?v=${event.image_version}` } : {}),
    ...(event.image_version !== null && event.focus_x !== null && event.focus_y !== null
      ? { imageFocus: { x: Number(event.focus_x), y: Number(event.focus_y) } }
      : {}),
    // A group ticket's person: "Group of 4 (2 of 4)", on the pass as in the email.
    ticketTypeName: ticketNameWithGroup(ticket.ticketTypeName, ticket.group),
    ticketNumber: n,
    // The order's tickets, sent ones included (they keep their numbers).
    ticketCount: order.tickets.length + (order.transferredTickets?.length ?? 0),
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
  // The event photo's strip, or the stand-in: never a failed pass for the picture.
  const pass = buildApplePass(config, ticket, new Date(), await appleEventStrip(deps.db, ticket));
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
