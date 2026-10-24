import type Stripe from "stripe";
import { calculateBookingFeeCents, calculateOrderSummary } from "@/lib/fees";
import { PG_CHECK_VIOLATION, pgConstraint, pgErrorCode, type Db } from "../db";
import type { Deps } from "../deps";
import { sendTicketEmailSoon, sendWaitlistEmailsSoon } from "../email-outbox";
import { formatSeatLine } from "@/lib/seating/format";
import { MAX_SEATS_PER_ORDER } from "@/lib/seating/template";
import { REMAINING_SHOWN_AT_MOST } from "@/lib/api/public-events";
import { SEAT_HOLD } from "@/lib/api/types";
import { clientIp, clientKey } from "../client-key";
import { createdPrivate, HttpError, ok, okPrivate, readJson } from "../http";
import { parseCheckoutLineItems } from "../order-input";
import { parseCheckoutSeats } from "../seat-map-input";
import { ORDER_ID_PATTERN, orderReference } from "../order-reference";
import { CUSTOMER_ORDER_SELECT, ORDER_SELECT, toCustomerOrder, toOrder } from "../records";
import type { Handler } from "../route";
import { parseTrackingCode } from "../tracking-codes";
import type {
  CancelOrderResult,
  CheckoutResult,
  CustomerOrderLookup,
  EventRecord,
  OrderLineItem,
  OrderPaymentLine,
  OrderPaymentLookup,
  OrderRecord,
  OrderStatus,
  SeatErrorDetails,
  TicketSeat,
} from "../types";
import { fail, requireEmail } from "../validation";
import { EVENT_ENDED, findEventById, refuseEndedEvent } from "./event-queries";
import { assertFreeTicketsPerOrder, createFreeOrder, withTicketCodes } from "./free-orders";
import { findOrganiserById } from "./organiser-guard";

/**
 * The platform's cut is the booking fee whoever nominally pays it: a
 * buyer-pays ticket adds it to the buyer's total, an organiser-absorbed one
 * comes out of the organiser's proceeds instead.
 */
export function orderTotals(lineItems: OrderLineItem[]) {
  let subtotalCents = 0;
  let buyerFeeCents = 0;
  let applicationFeeCents = 0;
  for (const line of lineItems) {
    const summary = calculateOrderSummary(line.unitPriceCents, line.quantity, line.feePolicy);
    subtotalCents += summary.subtotalCents;
    buyerFeeCents += summary.buyerFeeCents;
    applicationFeeCents += calculateBookingFeeCents(line.unitPriceCents) * line.quantity;
  }
  return { subtotalCents, buyerFeeCents, totalCents: subtotalCents + buyerFeeCents, applicationFeeCents };
}

async function findOrder(db: Db, orderId: string): Promise<OrderRecord | undefined> {
  const [row] = await db.query(`${ORDER_SELECT} where o.id = $1`, [orderId]);
  return row ? toOrder(row) : undefined;
}

/** Friendly early rejection. The binding check is private.fulfil_order, at payment time. */
async function assertAvailable(db: Db, eventId: string, lineItems: OrderLineItem[]) {
  const rows = await db.query<{ id: string; remaining: number }>(
    `select id, quantity_available - quantity_sold as remaining from public.ticket_types where event_id = $1`,
    [eventId],
  );
  const left = new Map(rows.map((r) => [r.id, r.remaining]));
  for (const line of lineItems) {
    const remaining = left.get(line.ticketTypeId) ?? 0;
    if (line.quantity > remaining) {
      // An exact count only when public payloads show one too (REMAINING_SHOWN_AT_MOST): a large stock, and
      // through it sales, is never given away by asking for more than there is.
      throw new HttpError(
        409,
        remaining <= 0
          ? `"${line.ticketTypeName}" is sold out.`
          : remaining <= REMAINING_SHOWN_AT_MOST
            ? `Only ${remaining} of "${line.ticketTypeName}" left.`
            : `There aren't that many "${line.ticketTypeName}" tickets left. Choose fewer.`,
      );
    }
  }
}

async function fulfilOrder(
  db: Db,
  order: OrderRecord,
  payment: { buyerEmail?: string | null; paymentIntentId?: string | null } = {},
): Promise<OrderStatus | null> {
  return withTicketCodes(order.lineItems, async (tickets) => {
    const [row] = await db.query<{ status: OrderStatus | null }>(
      `select private.fulfil_order($1, $2, $3, $4::text::jsonb)::text as status`,
      [order.orderId, payment.buyerEmail ?? null, payment.paymentIntentId ?? null, JSON.stringify(tickets)],
    );
    return row.status;
  });
}

/**
 * Records a refund's current state on its order. Only a refund Stripe says
 * has succeeded marks the order `refunded`; a pending one is tracked until a
 * refund.updated webhook settles it, and a failed or cancelled one leaves the
 * order `oversold_refund_required` so it shows up for manual action.
 */
async function recordRefund(db: Db, orderId: string, refund: Pick<Stripe.Refund, "id" | "status">) {
  await db.query(
    `update public.orders
     set stripe_refund_id = $2,
         status = case when $3 = 'succeeded' then 'refunded'::public.order_status else status end
     where id = $1 and status = 'oversold_refund_required'`,
    [orderId, refund.id, refund.status],
  );
  if (refund.status === "failed" || refund.status === "canceled") {
    console.error(`Refund ${refund.id} for order ${orderReference(orderId)} ${refund.status} — refund it manually.`);
  }
}

/**
 * Refunds a paid order that couldn't be fulfilled (sold out, or the event
 * was unpublished, before payment confirmed) — including Sheltüh's fee and
 * the organiser's transfer. Stripe's idempotency key makes a retry (e.g.
 * Stripe redelivering the webhook after an earlier attempt failed) refund at
 * most once. Throws on failure so the webhook returns 500 and Stripe tries
 * again later.
 */
async function refundOversoldOrder(deps: Deps, orderId: string, paymentIntentId: string | undefined) {
  if (!paymentIntentId) {
    console.error(
      `Order ${orderReference(orderId)} couldn't be fulfilled and has no payment intent on record — refund it manually.`,
    );
    return;
  }
  const refund = await deps.stripe().refunds.create(
    {
      payment_intent: paymentIntentId,
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: { orderId, reason: "could_not_fulfil_after_payment" },
    },
    { idempotencyKey: `oversold-refund-${orderId}` },
  );
  await recordRefund(deps.db, orderId, refund);
}

/**
 * A payment for an order that had already failed: its checkout errored or was
 * cancelled, or its session expired, before Stripe reported the payment
 * (e.g. a delayed payment method, or a session Stripe created although the
 * call to create it failed). There's nothing to fulfil it with (a seated
 * order's seats were released), so it's refunded in full, Sheltüh's fee and
 * the organiser's transfer included, as for an oversold order. Stripe's
 * idempotency key (per order) and the refund id recorded on the order make a
 * redelivery refund at most once. The order stays `failed`. Logged by the
 * order's short reference only. Throws on a Stripe error so the webhook
 * returns 500 and Stripe redelivers.
 */
async function refundPaymentForFailedOrder(deps: Deps, orderId: string, paymentIntentId: string | undefined) {
  const reference = orderReference(orderId);
  if (!paymentIntentId) {
    console.error(`Order ${reference} was paid after it failed, with no payment intent on record — refund it manually.`);
    return;
  }
  const [row] = await deps.db.query<{ stripe_refund_id: string | null }>(
    `select stripe_refund_id from public.orders where id = $1`,
    [orderId],
  );
  if (row?.stripe_refund_id) return;
  console.warn(`Order ${reference} was paid after it failed: refunding the payment.`);
  const refund = await deps.stripe().refunds.create(
    {
      payment_intent: paymentIntentId,
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: { orderId, reason: "paid_after_order_failed" },
    },
    { idempotencyKey: `failed-order-refund-${orderId}` },
  );
  // Recorded so a redelivery doesn't ask again, and charge.refunded finds the order (it changes only paid ones).
  await deps.db.query(
    `update public.orders
        set stripe_refund_id = $2, stripe_payment_intent_id = coalesce(stripe_payment_intent_id, $3)
      where id = $1 and status = 'failed'`,
    [orderId, refund.id, paymentIntentId],
  );
  if (refund.status === "failed" || refund.status === "canceled") {
    console.error(`Refund ${refund.id} for order ${reference} ${refund.status} — refund it manually.`);
  }
}

/**
 * refund.updated / refund.failed for a refund we didn't create (no
 * metadata.orderId): usually one made in the Stripe dashboard. Its success is
 * recorded through charge.refunded; this only makes the rest visible, above
 * all a dashboard refund that failed after its order was already voided (the
 * buyer got nothing back, and the order stays `refunded`). Logged by Stripe's
 * event id and, when the payment intent is one of ours, the order's short
 * reference: never the order id, the buyer or the payment intent. Changes
 * nothing and never throws for a payment that isn't ours.
 */
async function logUnmatchedRefund(db: Db, eventId: string, refund: Stripe.Refund) {
  const paymentIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  let reference: string | undefined;
  if (paymentIntentId) {
    const [row] = await db.query<{ id: string }>(
      `select id from public.orders where stripe_payment_intent_id = $1 limit 1`,
      [paymentIntentId],
    );
    if (row) reference = orderReference(row.id);
  }
  const subject = reference ? `a refund of order ${reference}` : "a refund of a payment with no order on record";
  const status = typeof refund.status === "string" ? refund.status.replace(/[^a-z_]/g, "") : "unknown";
  if (status === "failed" || status === "canceled" || status === "requires_action") {
    // Needs a person, like a failed automatic refund.
    console.error(`Stripe ${eventId}: ${subject} (made outside Sheltüh) has status ${status}. Check it in the Stripe dashboard.`);
  } else {
    console.info(`Stripe ${eventId}: ${subject} (made outside Sheltüh) has status ${status}; charge.refunded records it.`);
  }
}

type PaymentRefundResult = "refunded" | "partial" | "unchanged" | "not_found";

/** Postgres `integer`: an amount beyond it can't be a real charge's. */
const MAX_INT4 = 2_147_483_647;

/**
 * charge.refunded: a refund of one of our payments, whoever made it (usually
 * the Stripe dashboard). charge.amount_refunded is cumulative and
 * charge.refunded is true once it covers the whole charge. A full refund of a
 * paid order voids it (`refunded`, tickets void, inventory released); a
 * partial one is only recorded and logged for manual follow-up
 * (private.record_payment_refund). Never throws for a payment that isn't
 * ours: Stripe would retry it for days. Returns the result (undefined when
 * the charge was unusable).
 */
async function recordPaymentRefund(db: Db, eventId: string, charge: Stripe.Charge): Promise<PaymentRefundResult | undefined> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  const amount = charge.amount_refunded;
  if (
    !paymentIntentId ||
    typeof charge.refunded !== "boolean" ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > MAX_INT4
  ) {
    console.warn(`Stripe ${eventId}: charge.refunded without a usable payment intent or amount; ignored.`);
    return undefined;
  }
  const [row] = await db.query<{ result: PaymentRefundResult; order_id: string | null }>(
    `select result, order_id from private.record_payment_refund($1, $2, $3)`,
    [paymentIntentId, amount, charge.refunded],
  );
  // Logs name the order by its short reference only: never its id (the confirmation page's credential) or the buyer.
  const reference = row.order_id ? orderReference(row.order_id) : undefined;
  if (row.result === "refunded") {
    console.info(`Order ${reference} was refunded in full in Stripe: marked refunded, tickets void, inventory released.`);
  } else if (row.result === "partial") {
    // Needs a person, like a failed automatic refund (console.error, as recordRefund does).
    console.error(`Order ${reference} was partly refunded in Stripe; it stays paid and its tickets stay valid. Review it manually.`);
  } else if (row.result === "not_found") {
    // Not ours, or (rarely) a refund delivered before its payment was fulfilled: see docs/architecture.md.
    console.warn(`Stripe ${eventId}: charge.refunded for a payment with no order on record; ignored.`);
  }
  return row.result;
}

/** A buyer email is required for free orders (nothing else delivers the tickets) and optional otherwise. */
function parseBuyerEmail(body: Record<string, unknown>, required: true): string;
function parseBuyerEmail(body: Record<string, unknown>, required: false): string | null;
function parseBuyerEmail(body: Record<string, unknown>, required: boolean): string | null {
  if (!required && (body.buyerEmail === undefined || body.buyerEmail === null || body.buyerEmail === "")) return null;
  const errors: Record<string, string> = {};
  const email = requireEmail(body.buyerEmail, "buyerEmail", errors);
  if (Object.keys(errors).length > 0) fail(errors);
  return email;
}

/** A platform-managed organiser's event has no paid Sheltüh tickets (only free ones, or external ticketing). */
export const PLATFORM_PAID_CHECKOUT_REFUSED = "Paid tickets for this event aren't sold on Sheltüh.";

/** Tickets for an external event are sold on another site: no Sheltüh checkout. */
export const EXTERNAL_CHECKOUT_REFUSED = "Tickets for this event are sold on another site, not on Sheltüh.";

/**
 * A database trigger refused a new order: orders_sheltuh_only because the
 * event became external since it was read (an admin's change racing the
 * checkout), or orders_not_ended because the event has ended (the end passed,
 * or its time was changed, since it was read). The same 409s as the early
 * checks. Anything else is rethrown.
 */
async function refuseIfClosed<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (pgErrorCode(err) === PG_CHECK_VIOLATION) {
      const constraint = pgConstraint(err);
      if (constraint === "orders_sheltuh_only") throw new HttpError(409, EXTERNAL_CHECKOUT_REFUSED);
      if (constraint === "orders_not_ended") throw new HttpError(409, EVENT_ENDED);
    }
    throw err;
  }
}

/** 503 for a paid checkout on a deploy whose Stripe publishable key is missing or doesn't match the secret key. */
const CARD_PAYMENTS_OFF = "Card payments aren't available right now.";

/**
 * Card payments need Stripe.js on the payment page, with a publishable key of
 * the secret key's mode. Checked before an order, a hold or a hold attempt is
 * written, so a misconfigured deploy leaves nothing behind (deps logs why,
 * without either key).
 */
function refuseWithoutCardPayments(deps: Deps) {
  if (!deps.stripePublishableKey()) throw new HttpError(503, CARD_PAYMENTS_OFF);
}

/** Our payment page for a card checkout (CheckoutResult.url): relative, same origin. */
function paymentPageUrl(orderId: string): string {
  return `/checkout/pay?order=${orderId}`;
}

/**
 * Where Stripe's embedded form sends the buyer once it's done (and back from
 * a redirect-based payment method): the confirmation page, which reads the
 * order (no `{CHECKOUT_SESSION_ID}`: the order id is the only id it needs).
 */
function checkoutReturnUrl(deps: Deps, orderId: string): string {
  return `${deps.siteUrl()}/checkout/success?session_id=${orderId}`;
}

/**
 * POST /api/events/[eventId]/checkout — public guest checkout. A paid order
 * becomes an embedded Stripe Checkout Session (ui_mode embedded_page) paying
 * out to the organiser's Connect account, fulfilled by the webhook: 201
 * `{url, orderId}` (private, no-store), `url` being our payment page
 * (/checkout/pay?order={orderId}, which reads the session's client secret
 * from GET /orders/by-session/{orderId}/payment). The order id also lets the
 * page cancel it (POST /orders/by-session/{orderId}/cancel) if the buyer goes
 * Back. 503 when card payments aren't configured (refuseWithoutCardPayments),
 * before anything is written. A wholly free order
 * never touches Stripe (./free-orders.ts): 201 with the confirmation page's
 * URL for a member's own verified email, otherwise 202, the confirmation
 * link being emailed straight after the response. Any order, paid or free, holds at most 4 free
 * tickets (400, fieldErrors.lineItems). An event that has ended takes no new
 * order or seat hold, paid or free (409 "This event has ended."; the
 * database refuses the order too: orders_not_ended).
 */
export const createCheckout: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { db } = deps;
  const event = await findEventById(db, eventId);
  if (!event || event.status !== "published") throw new HttpError(404, "This event isn't available for booking.");
  // External ticketing: no Sheltüh checkout, free or paid (the database refuses the order too).
  if (event.ticketingMode === "external") throw new HttpError(409, EXTERNAL_CHECKOUT_REFUSED);
  // Ended: no new orders or holds (seated included). A payment for an earlier order is still fulfilled (stripeWebhook).
  refuseEndedEvent(event);

  const body = await readJson(req);
  // Reserved seating: seats chosen on the map (and any general admission lines with them).
  if (body.seats !== undefined && body.seats !== null) return createSeatedCheckout(req, deps, event, body);
  const lineItems = parseCheckoutLineItems(body, event.ticketTypes);
  refuseSeatedLines(event, lineItems);
  const totals = orderTotals(lineItems);
  const isFree = totals.totalCents === 0;
  // Free: tickets straight away for a member's own verified email, an emailed confirmation link for anyone else.
  if (isFree) {
    const buyerEmail = parseBuyerEmail(body, true);
    await assertFreeTicketsPerOrder(deps, lineItems);
    await assertAvailable(db, eventId, lineItems);
    return refuseIfClosed(() =>
      createFreeOrder(req, deps, { event, lineItems, buyerEmail, trackingCode: parseTrackingCode(body.trackingCode) }),
    );
  }

  const buyerEmail = parseBuyerEmail(body, false);
  // Free lines in a paid order: the same per-order cap. The Stripe payment identifies the buyer, so there's
  // no emailed confirmation or per-person allowance (those count wholly free orders only).
  await assertFreeTicketsPerOrder(deps, lineItems);
  await assertAvailable(db, eventId, lineItems);
  // Attribution only (never affects price or status): kept if it's one of the event's tracking codes, else null.
  const trackingCode = parseTrackingCode(body.trackingCode);
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;

  const insertOrder = () =>
    db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
         buyer_fee_cents, total_cents, application_fee_cents, buyer_email, tracking_code)
       values ($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9, $10,
         (select l.code from public.event_tracking_links l where l.event_id = $2 and l.code = $11))`,
      [
        orderId,
        eventId,
        event.organiserId,
        event.title,
        JSON.stringify(lineItems),
        totals.subtotalCents,
        totals.buyerFeeCents,
        totals.totalCents,
        totals.applicationFeeCents,
        buyerEmail,
        trackingCode,
      ],
    );

  const organiser = await findOrganiserById(db, event.organiserId);
  // A platform-managed organiser (no owner account) sells no paid Sheltüh
  // tickets: the database refuses its paid ticket types and orders too.
  if (organiser && !organiser.ownerUserId) throw new HttpError(409, PLATFORM_PAID_CHECKOUT_REFUSED);
  if (!organiser?.stripeAccountId || !organiser.payoutsEnabled) {
    throw new HttpError(409, "This organiser hasn't finished setting up payouts yet — ticket sales aren't open.");
  }

  refuseWithoutCardPayments(deps);
  // The order exists before Stripe does, so no payment can ever arrive
  // without an order to attach it to.
  await refuseIfClosed(insertOrder);
  let session: Stripe.Checkout.Session;
  try {
    session = await deps.stripe().checkout.sessions.create({
      mode: "payment",
      client_reference_id: orderId,
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      line_items: lineItems.flatMap((line) => {
        const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
          {
            price_data: {
              currency: "aud",
              product_data: { name: `${line.ticketTypeName} — ${event.title}` },
              unit_amount: line.unitPriceCents,
            },
            quantity: line.quantity,
          },
        ];
        if (line.feePolicy === "buyer-pays" && line.unitPriceCents > 0) {
          items.push({
            price_data: {
              currency: "aud",
              product_data: { name: "Booking fee" },
              unit_amount: calculateBookingFeeCents(line.unitPriceCents),
            },
            quantity: line.quantity,
          });
        }
        return items;
      }),
      payment_intent_data: {
        application_fee_amount: totals.applicationFeeCents,
        transfer_data: { destination: organiser.stripeAccountId },
      },
      // Stripe's form on our own page (/checkout/pay); no cancel_url in this mode (Back is ours).
      ui_mode: "embedded_page",
      return_url: checkoutReturnUrl(deps, orderId),
      metadata: { orderId, eventId },
    });
  } catch (err) {
    await db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    throw err;
  }
  if (!session.client_secret) {
    // Nobody could mount (so pay) it: the order fails now, not when the session expires in 24 hours.
    await db.query(`update public.orders set status = 'failed' where id = $1 and status = 'pending'`, [orderId]);
    throw new Error("Stripe did not return an embedded Checkout Session's client secret.");
  }

  await db.query(`update public.orders set stripe_checkout_session_id = $2 where id = $1`, [orderId, session.id]);
  // The order id goes back only to the client that made the order (it's in the payment page's URL and Stripe's
  // return URL anyway), so the page can cancel it if the buyer goes Back: never cached. The client secret
  // isn't sent here: the payment page reads it (GET …/payment), so it survives a reload and is never stored.
  const result: CheckoutResult = { url: paymentPageUrl(orderId), orderId };
  return createdPrivate(result);
};

const ORDER_NOT_FOUND = "Order not found.";

/**
 * GET /api/orders/by-session/[sessionId] — public. The unguessable order id
 * from the confirmation page's URL is the credential (guest checkout has no
 * account), so the response is only what that page shows (CustomerOrder),
 * never cached anywhere. A pending order reveals nothing but its status.
 */
export const getOrderBySession: Handler<{ sessionId: string }> = async (_req, { sessionId }, { db }) => {
  // Anything that isn't shaped like an order id can't be one: no query needed.
  // A refunded order's tickets are void: CUSTOMER_ORDER_SELECT returns codes for paid orders only.
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  const [row] = await db.query(`${CUSTOMER_ORDER_SELECT} where o.id = $1`, [sessionId]);
  if (!row) throw new HttpError(404, ORDER_NOT_FOUND);
  const lookup: CustomerOrderLookup = row.status === "pending" ? { status: "pending" } : toCustomerOrder(row);
  return okPrivate(lookup);
};

/**
 * POST /api/stripe/webhook — Stripe calls this directly; the signature is
 * the only trust boundary. Payment confirmation is the only point an order
 * becomes paid and inventory is taken, so an abandoned checkout never holds
 * tickets.
 */
export const stripeWebhook: Handler = async (req, _params, deps) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) throw new HttpError(400, "Missing Stripe-Signature header.");
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = deps.stripe().webhooks.constructEvent(rawBody, signature, deps.stripeWebhookSecret());
  } catch {
    throw new HttpError(400, "Invalid webhook signature.");
  }

  const received = ok({ received: true });

  // A refund we issued has settled (or failed) after we created it.
  if (event.type === "refund.updated" || event.type === "refund.failed") {
    const refund = event.data.object as Stripe.Refund;
    const orderId = refund.metadata?.orderId;
    if (orderId) await recordRefund(deps.db, orderId, refund);
    else await logUnmatchedRefund(deps.db, event.id, refund);
    return received;
  }

  // Any refund of a charge, including ones made in the Stripe dashboard.
  if (event.type === "charge.refunded") {
    const result = await recordPaymentRefund(deps.db, event.id, event.data.object as Stripe.Charge);
    // The released tickets may have queued waitlist emails (private.notify_waitlist, at commit): send them now.
    if (result === "refunded") sendWaitlistEmailsSoon(deps);
    return received;
  }

  const isPaymentEvent =
    event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
  const isFailureEvent =
    event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed";
  if (!isPaymentEvent && !isFailureEvent) return received;

  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.client_reference_id;
  const order = orderId ? await findOrder(deps.db, orderId) : undefined;
  if (!order) return received;
  // A redelivery after a refund attempt failed: try the refund again.
  if (order.status === "oversold_refund_required" && isPaymentEvent) {
    await refundOversoldOrder(deps, order.orderId, order.stripePaymentIntentId);
    return received;
  }
  // Paid for an order that had already failed (cancelled, expired or a checkout error): refund it.
  if (order.status === "failed" && isPaymentEvent) {
    if (session.payment_status === "paid") {
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      await refundPaymentForFailedOrder(deps, order.orderId, paymentIntentId);
    }
    return received;
  }
  // Already handled (Stripe redelivers) — nothing left to do.
  if (order.status !== "pending") return received;

  if (isFailureEvent) {
    if (order.seatIds) {
      // A seated order's holds go straight back (they'd also lapse on their own).
      await deps.db.query(`select private.release_seat_holds($1)`, [order.orderId]);
    } else {
      await deps.db.query(`update public.orders set status = 'failed' where id = $1 and status = 'pending'`, [order.orderId]);
    }
    return received;
  }
  // A completed session can still be awaiting a delayed payment method.
  if (session.payment_status !== "paid") return received;

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const status = await fulfilOrder(deps.db, order, {
    buyerEmail: session.customer_details?.email,
    paymentIntentId,
  });
  if (status === "paid") {
    // Queued by fulfil_order in the same transaction; this is just the first try.
    sendTicketEmailSoon(deps, order.orderId);
  } else if (status === "oversold_refund_required") {
    // Charged, but the last tickets went to someone else first.
    await refundOversoldOrder(deps, order.orderId, paymentIntentId);
  }
  return received;
};

// ---------------------------------------------------------------------------
// Reserved seating (docs/architecture.md, "Reserved seating")
// ---------------------------------------------------------------------------

/**
 * Seat holds (docs/SEATING_PLAN.md decisions 1 and 5): 35 minutes, Stripe's
 * page closing at 31 (its minimum is 30, and the buyer is told 30); per event,
 * 120 holds per 10 minutes (refused attempts don't count), and at most the
 * larger of 20 seats or 30% of its unblocked seats held at once.
 *
 * Per client (keyed on its IP address, lib/server/client-key.ts; a manager
 * decision): 20 hold attempts per event and 60 across all events per 10
 * minutes. Every attempt that reaches private.hold_seats counts, refused or
 * not. A buyer whose seats keep being taken retries a handful of times, so
 * 20 leaves plenty for them and for a few people on one connection (venue
 * wifi, a phone network's shared address), while one client can no longer
 * use up the event's 120 alone (it takes at least six). 60 bounds a client
 * working through many events.
 */
export const SEAT_HOLD_LIMITS = {
  hold: `${SEAT_HOLD.holdMinutes} minutes`,
  stripeSessionMinutes: SEAT_HOLD.stripeMinutes + 1,
  attempts: { limit: 120, window: "10 minutes" },
  perClient: { event: 20, allEvents: 60, window: "10 minutes" },
  capMin: 20,
  capShare: 0.3,
} as const;

const SEATS_TAKEN = "Some seats were taken while you were choosing. Choose other seats, then press Checkout again.";
const SEAT_MAP_CHANGED = "The seat map has changed. Reload it and choose your seats again.";
const BUSY = "A lot of people are checking out for this event right now. Try again in a minute.";
const CLIENT_BUSY = "You've started a lot of checkouts in the last few minutes. Wait a few minutes, then try again.";

function seatError(status: number, message: string, field: string, details: SeatErrorDetails): HttpError {
  return new HttpError(status, message, { [field]: message }, { ...details });
}

/** A tier with seats is sold only by choosing seats: never as a quantity (400). */
function refuseSeatedLines(event: EventRecord, lineItems: OrderLineItem[]) {
  if (!event.seating) return;
  const seated = new Set(event.ticketTypes.filter((t) => t.seated).map((t) => t.id));
  const line = lineItems.find((l) => seated.has(l.ticketTypeId));
  if (line) fail({ lineItems: `"${line.ticketTypeName}" seats are chosen on the seat map.` });
}

/**
 * One hold attempt against the client's own allowance (SEAT_HOLD_LIMITS.perClient,
 * private.take_seat_hold_attempt): 429 `client_rate_limited` when it's used
 * up, nothing else written. Fails open, with a log line (never the request's
 * headers), when the request has no usable client IP (always set on Vercel)
 * or the secret the key is salted with isn't configured.
 */
async function takeClientHoldAttempt(req: Request, deps: Deps, eventId: string, seatIds: string[]) {
  const ip = clientIp(req);
  if (!ip) {
    console.warn("Seat hold without a client IP header: the per-client hold limit was skipped.");
    return;
  }
  let secret: string;
  try {
    secret = deps.stripeWebhookSecret();
  } catch {
    console.error("STRIPE_WEBHOOK_SECRET isn't set: the per-client hold limit was skipped.");
    return;
  }
  const { event, allEvents, window } = SEAT_HOLD_LIMITS.perClient;
  const [row] = await deps.db.query<{ result: "ok" | "event" | "all" }>(
    `select private.take_seat_hold_attempt($1, $2, $3, $4, $5::interval) as result`,
    [clientKey(ip, secret), eventId, event, allEvents, window],
  );
  if (row.result !== "ok") throw seatError(429, CLIENT_BUSY, "seats", { code: "client_rate_limited", seatIds });
}

interface ChosenSeat extends TicketSeat {
  id: string;
  ticketTypeId: string;
}

/** The seats' tiers as priced lines (prices from the database), in the event's tier order. */
function seatLines(event: EventRecord, seats: ChosenSeat[]): OrderLineItem[] {
  return event.ticketTypes.flatMap((tier) => {
    const quantity = seats.filter((seat) => seat.ticketTypeId === tier.id).length;
    return quantity > 0
      ? [{ ticketTypeId: tier.id, ticketTypeName: tier.name, unitPriceCents: tier.priceCents, feePolicy: tier.feePolicy, quantity }]
      : [];
  });
}

/**
 * POST …/checkout with `seats: {mapVersion, seatIds}` (and optional
 * `lineItems` for the event's general admission tiers, which don't count
 * towards the 10 seats). Prices come from each seat's tier.
 * - Paid: 503 without card payments (nothing written), then one attempt
 *   against the client's own hold allowance, then the pending order and its
 *   35-minute holds in one step (private.hold_seats), then Stripe (an
 *   embedded session expiring in 31 minutes; a Stripe error, or no client
 *   secret, releases the holds). 201 `{url, holdExpiresAt, orderId}`, `url`
 *   being the payment page.
 * - Free: a member's own verified email gets the seats at once; anyone else
 *   an emailed link, holding nothing until it's confirmed.
 * Refusals write nothing (only a hold counts towards the event's hold
 * attempts): 400 bad input; 409 `seats` taken or unknown (body `seatIds`),
 * `seatMapVersion` changed; 429 too many seats held or holds made for the
 * event, or too many attempts by this client (`client_rate_limited`; body
 * `seatIds`).
 */
async function createSeatedCheckout(
  req: Request,
  deps: Deps,
  event: EventRecord,
  body: Record<string, unknown>,
): Promise<Response> {
  const { db } = deps;
  if (!event.seating) fail({ seats: "This event doesn't have reserved seating." });
  const { mapVersion, seatIds } = parseCheckoutSeats(body.seats);
  if (seatIds.length > MAX_SEATS_PER_ORDER) fail({ seats: `You can choose up to ${MAX_SEATS_PER_ORDER} seats.` });

  // General admission lines, if any (a seated tier here is a 400).
  const rawLines = body.lineItems;
  let gaLines: OrderLineItem[] = [];
  if (rawLines !== undefined && rawLines !== null && !(Array.isArray(rawLines) && rawLines.length === 0)) {
    gaLines = parseCheckoutLineItems(body, event.ticketTypes);
    refuseSeatedLines(event, gaLines);
  }

  if (mapVersion !== event.seating.version) {
    throw seatError(409, SEAT_MAP_CHANGED, "seatMapVersion", { code: "seat_map_changed" });
  }
  const seats = await db.query<ChosenSeat & { unavailable: boolean }>(
    `select s.id, s.ticket_type_id as "ticketTypeId", s.section_label as section, s.row_label as "row",
            s.seat_label as seat, s.kind,
            (s.blocked or s.sold_order_id is not null
              or (s.hold_order_id is not null and s.hold_expires_at > now())) as unavailable
       from public.event_seats s
      where s.event_id = $1 and s.id = any($2::text[])
      order by s.position`,
    [event.eventId, seatIds],
  );
  const found = new Set(seats.map((seat) => seat.id));
  const gone = [...seatIds.filter((id) => !found.has(id)), ...seats.filter((seat) => seat.unavailable).map((seat) => seat.id)].sort();
  if (gone.length > 0) throw seatError(409, SEATS_TAKEN, "seats", { code: "seats_unavailable", seatIds: gone });

  const lineItems = [...seatLines(event, seats), ...gaLines];
  const totals = orderTotals(lineItems);
  const trackingCode = parseTrackingCode(body.trackingCode);
  const labels = seats.map(({ section, row, seat, kind }) => ({ section, row, seat, kind }));

  if (totals.totalCents === 0) {
    const buyerEmail = parseBuyerEmail(body, true);
    await assertFreeTicketsPerOrder(deps, lineItems);
    await assertAvailable(db, event.eventId, lineItems);
    return refuseIfClosed(() =>
      createFreeOrder(req, deps, { event, lineItems, buyerEmail, trackingCode, seats: { seatIds, labels } }),
    );
  }

  const buyerEmail = parseBuyerEmail(body, false);
  await assertFreeTicketsPerOrder(deps, lineItems);
  await assertAvailable(db, event.eventId, lineItems);
  const organiser = await findOrganiserById(db, event.organiserId);
  if (organiser && !organiser.ownerUserId) throw new HttpError(409, PLATFORM_PAID_CHECKOUT_REFUSED);
  if (!organiser?.stripeAccountId || !organiser.payoutsEnabled) {
    throw new HttpError(409, "This organiser hasn't finished setting up payouts yet — ticket sales aren't open.");
  }

  refuseWithoutCardPayments(deps);
  await takeClientHoldAttempt(req, deps, event.eventId, seatIds);
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
  const [hold] = await refuseIfClosed(() =>
    db.query<{ result: string; hold_expires_at: string | Date | null; unavailable_seat_ids: string[] | null }>(
      `select result, hold_expires_at, unavailable_seat_ids
         from private.hold_seats($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::text[],
                                 $14::interval, $15, $16::interval, $17, $18)`,
      [
        orderId,
        event.eventId,
        event.organiserId,
        event.title,
        JSON.stringify(lineItems),
        totals.subtotalCents,
        totals.buyerFeeCents,
        totals.totalCents,
        totals.applicationFeeCents,
        buyerEmail,
        trackingCode,
        mapVersion,
        seatIds,
        SEAT_HOLD_LIMITS.hold,
        SEAT_HOLD_LIMITS.attempts.limit,
        SEAT_HOLD_LIMITS.attempts.window,
        SEAT_HOLD_LIMITS.capMin,
        SEAT_HOLD_LIMITS.capShare,
      ],
    ),
  );
  switch (hold.result) {
    case "held":
      break;
    case "rate_limited":
      throw seatError(429, BUSY, "seats", { code: "rate_limited", seatIds });
    case "hold_cap":
      throw seatError(429, BUSY, "seats", { code: "hold_cap", seatIds });
    case "seats_unavailable":
      throw seatError(409, SEATS_TAKEN, "seats", { code: "seats_unavailable", seatIds: hold.unavailable_seat_ids ?? seatIds });
    case "version":
    case "tier_mismatch":
      throw seatError(409, SEAT_MAP_CHANGED, "seatMapVersion", { code: "seat_map_changed" });
    case "not_on_sale":
      throw new HttpError(404, "This event isn't available for booking.");
    default:
      throw new Error(`Unexpected hold_seats result: ${hold.result}`);
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await deps.stripe().checkout.sessions.create({
      mode: "payment",
      client_reference_id: orderId,
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      expires_at: Math.floor(Date.now() / 1000) + SEAT_HOLD_LIMITS.stripeSessionMinutes * 60,
      line_items: lineItems.flatMap((line) => {
        const lineSeats = seats.filter((seat) => seat.ticketTypeId === line.ticketTypeId);
        const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
          {
            price_data: {
              currency: "aud",
              product_data: {
                name: `${line.ticketTypeName} — ${event.title}`,
                ...(lineSeats.length > 0 ? { description: lineSeats.map(formatSeatLine).join("; ") } : {}),
              },
              unit_amount: line.unitPriceCents,
            },
            quantity: line.quantity,
          },
        ];
        if (line.feePolicy === "buyer-pays" && line.unitPriceCents > 0) {
          items.push({
            price_data: {
              currency: "aud",
              product_data: { name: "Booking fee" },
              unit_amount: calculateBookingFeeCents(line.unitPriceCents),
            },
            quantity: line.quantity,
          });
        }
        return items;
      }),
      payment_intent_data: {
        application_fee_amount: totals.applicationFeeCents,
        transfer_data: { destination: organiser.stripeAccountId },
      },
      // Stripe's form on our own page (/checkout/pay). Back to the seat page releases the seats at once
      // (SeatPicker → POST /orders/by-session/{id}/cancel); there's no cancel_url in this mode.
      ui_mode: "embedded_page",
      return_url: checkoutReturnUrl(deps, orderId),
      metadata: { orderId, eventId: event.eventId },
    });
  } catch (err) {
    // Nobody can pay for these seats: give them back now, not in 35 minutes.
    await db.query(`select private.release_seat_holds($1)`, [orderId]);
    throw err;
  }
  if (!session.client_secret) {
    // Nobody could mount (so pay) it: the same as a Stripe error.
    await db.query(`select private.release_seat_holds($1)`, [orderId]);
    throw new Error("Stripe did not return an embedded Checkout Session's client secret.");
  }

  await db.query(`update public.orders set stripe_checkout_session_id = $2 where id = $1`, [orderId, session.id]);
  const result: CheckoutResult = {
    url: paymentPageUrl(orderId),
    holdExpiresAt: new Date(hold.hold_expires_at as string).toISOString(),
    // Only to the client that made the order (as for general admission): the seat page keeps it so Back from
    // the payment page can release the seats at once.
    orderId,
  };
  return createdPrivate(result);
}

/** Stripe's answer to expiring a session that can't be expired (already complete or expired). */
async function expireCheckoutSession(deps: Deps, sessionId: string): Promise<"expired" | "complete"> {
  try {
    await deps.stripe().checkout.sessions.expire(sessionId);
    return "expired";
  } catch (err) {
    const session = await deps.stripe().checkout.sessions.retrieve(sessionId);
    if (session.status === "expired") return "expired";
    if (session.status === "complete") return "complete";
    throw err;
  }
}

/**
 * POST /api/orders/by-session/[sessionId]/cancel — public, the order id is
 * the credential (as for GET). The buyer left the payment page (Back to the
 * seat page, or a hosted session's cancel_url from before embedded
 * checkout): the Stripe session is expired first, so it can't be paid any
 * more, then the order is cancelled and its seats released.
 * CancelOrderResult: `released` (also when it already was), `paid`, or
 * `processing` (Stripe already has the payment). 404 unknown or not a card
 * checkout; 409 still being set up (try again). `private, no-store`.
 * The id (`ord_` + 32 hex, 128 random bits) only ever reaches the client
 * that made the order: the checkout's response, the payment page's URL and
 * Stripe's return URL. A paid order is never changed here, and the session
 * is expired before anything is released, so nothing can be paid for seats
 * that are no longer held.
 */
export const cancelPendingOrder: Handler<{ sessionId: string }> = async (_req, { sessionId }, deps) => {
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  const [row] = await deps.db.query<{
    status: OrderStatus;
    stripe_checkout_session_id: string | null;
    free_link: boolean;
    event_title: string;
    event_slug: string | null;
  }>(
    `select o.status::text as status, o.stripe_checkout_session_id, o.confirmation_token_hash is not null as free_link,
            o.event_title, (select e.slug from public.events e where e.id = o.event_id) as event_slug
       from public.orders o where o.id = $1`,
    [sessionId],
  );
  // A guest's free booking isn't a card checkout: nothing to cancel here.
  if (!row || row.free_link) throw new HttpError(404, ORDER_NOT_FOUND);
  const answer = (status: CancelOrderResult["status"]) =>
    okPrivate({ status, eventTitle: row.event_title, ...(row.event_slug ? { eventSlug: row.event_slug } : {}) } satisfies CancelOrderResult);

  if (row.status === "paid") return answer("paid");
  if (row.status === "failed") return answer("released");
  if (row.status !== "pending") return answer("processing");
  if (!row.stripe_checkout_session_id) {
    throw new HttpError(409, "This checkout is still being set up. Try again in a moment.");
  }
  if ((await expireCheckoutSession(deps, row.stripe_checkout_session_id)) === "complete") return answer("processing");
  const [released] = await deps.db.query<{ result: string }>(`select private.release_seat_holds($1) as result`, [sessionId]);
  switch (released.result) {
    case "released":
    case "failed":
      return answer("released");
    case "paid":
      return answer("paid");
    default:
      return answer("processing");
  }
};

/**
 * Whether an open checkout could still be fulfilled right now: every line's
 * tickets are left, and (seated) none of its seats is sold, blocked, gone or
 * held by another order (private.unavailable_seats, as hold_seats checks).
 * Not binding (private.fulfil_order is), only so the payment page doesn't
 * offer a form whose payment would be refunded. Also reads the seats' labels
 * for the summary. One query: the order's ticket types (ticket_types_pkey)
 * and seats (event_seats_pkey).
 */
async function openOrderState(db: Db, orderId: string, eventId: string, lineItems: OrderLineItem[], seatIds: string[] | null) {
  const [row] = await db.query<{
    remaining: Record<string, number> | null;
    seats: (TicketSeat & { ticketTypeId: string })[] | null;
    seats_unavailable: boolean;
  }>(
    `select (select json_object_agg(t.id, t.quantity_available - t.quantity_sold)
               from public.ticket_types t
              where t.event_id = $1 and t.id = any($3::text[])) as remaining,
            (select json_agg(json_build_object('ticketTypeId', s.ticket_type_id, 'section', s.section_label,
                                              'row', s.row_label, 'seat', s.seat_label, 'kind', s.kind)
                             order by s.position)
               from public.event_seats s
              where s.event_id = $1 and s.id = any($4::text[])) as seats,
            coalesce(cardinality(private.unavailable_seats($1, $4::text[], $2)) > 0, false) as seats_unavailable`,
    [eventId, orderId, lineItems.map((line) => line.ticketTypeId), seatIds ?? []],
  );
  const remaining = row.remaining ?? {};
  const soldOut =
    lineItems.some((line) => line.quantity > (remaining[line.ticketTypeId] ?? 0)) || (seatIds !== null && row.seats_unavailable);
  return { soldOut, seats: row.seats ?? [] };
}

/** The payment page's lines: all-inclusive amounts from lib/fees.ts, with each seated tier's seats. */
function paymentLines(lineItems: OrderLineItem[], seats: (TicketSeat & { ticketTypeId: string })[]): OrderPaymentLine[] {
  return lineItems.map((line) => {
    const lineSeats = seats
      .filter((seat) => seat.ticketTypeId === line.ticketTypeId)
      .map(({ section, row, seat, kind }) => ({ section, row, seat, kind }));
    return {
      ticketTypeName: line.ticketTypeName,
      quantity: line.quantity,
      unitTotalCents: calculateOrderSummary(line.unitPriceCents, 1, line.feePolicy).totalCents,
      lineTotalCents: calculateOrderSummary(line.unitPriceCents, line.quantity, line.feePolicy).totalCents,
      ...(lineSeats.length > 0 ? { seats: lineSeats } : {}),
    };
  });
}

/**
 * GET /api/orders/by-session/[sessionId]/payment — public, the order id is
 * the credential (as for GET /orders/by-session/{id}). What the payment page
 * (/checkout/pay) needs to mount Stripe's embedded form, and its summary
 * (OrderPaymentLookup):
 * - malformed id: 404, no query; unknown, or a guest's free booking (not a
 *   card checkout): 404.
 * - `paid`, `refunded`, `oversold_refund_required`: `done`. `failed`: `closed`.
 * - pending without its Stripe session yet: 409 (as the cancel route).
 * - otherwise Stripe's session: `complete` → `processing` (`delayed` while
 *   the payment hasn't cleared); `expired`, or past its expiry → `closed`;
 *   `open` → `open` with the client secret and the summary, unless the
 *   event is no longer bookable (`closed`: not published, so unpublished by
 *   its organiser or an admin, or its organiser suspended, which is what
 *   private.fulfil_order refuses; or ended, `ends_at <= now()` as for new
 *   orders), or the tickets or seats have gone to someone else since
 *   (`sold_out`, not binding: openOrderState).
 * Writes nothing (the webhook alone settles orders) and logs nothing about
 * the order or the secret. `private, no-store`: the client secret is in it.
 */
export const getOrderPayment: Handler<{ sessionId: string }> = async (_req, { sessionId }, deps) => {
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  const [row] = await deps.db.query<{
    status: OrderStatus;
    stripe_checkout_session_id: string | null;
    free_link: boolean;
    event_id: string;
    event_title: string;
    line_items: OrderLineItem[];
    seat_ids: string[] | null;
    subtotal_cents: number;
    buyer_fee_cents: number;
    total_cents: number;
    event_slug: string | null;
    event_status: string | null;
    event_ended: boolean | null;
    event_starts_at: string | Date | null;
    event_ends_at: string | Date | null;
    event_venue_name: string | null;
    event_suburb: string | null;
  }>(
    `select o.status::text as status, o.stripe_checkout_session_id, o.confirmation_token_hash is not null as free_link,
            o.event_id, o.event_title, o.line_items, o.seat_ids, o.subtotal_cents, o.buyer_fee_cents, o.total_cents,
            e.slug as event_slug, e.status::text as event_status, e.ends_at <= now() as event_ended, e.starts_at as event_starts_at,
            e.ends_at as event_ends_at, e.venue_name as event_venue_name, e.suburb as event_suburb
       from public.orders o
       left join public.events e on e.id = o.event_id
      where o.id = $1`,
    [sessionId],
  );
  // A guest's free booking isn't a card checkout: nothing to pay here.
  if (!row || row.free_link) throw new HttpError(404, ORDER_NOT_FOUND);
  const answer = (lookup: OrderPaymentLookup) => okPrivate(lookup);
  const seated = row.seat_ids !== null;
  const ended = (status: "closed" | "sold_out") =>
    answer({ status, eventTitle: row.event_title, ...(row.event_slug ? { eventSlug: row.event_slug } : {}), seated });

  if (row.status === "paid" || row.status === "refunded" || row.status === "oversold_refund_required") {
    return answer({ status: "done" });
  }
  if (row.status === "failed") return ended("closed");
  if (!row.stripe_checkout_session_id) {
    throw new HttpError(409, "This checkout is still being set up. Try again in a moment.");
  }

  const session = await deps.stripe().checkout.sessions.retrieve(row.stripe_checkout_session_id);
  if (session.status === "complete") return answer({ status: "processing", delayed: session.payment_status !== "paid" });
  // Past its expiry, it can't be paid even if Stripe hasn't closed it yet.
  if (session.status !== "open" || session.expires_at * 1000 <= Date.now()) return ended("closed");
  // No form for an event that's gone or over. Not binding (a payment already
  // under way is still settled by the webhook: refunded if unpublished,
  // honoured if ended, as private.fulfil_order decides), only so nobody is
  // offered tickets they can't use.
  if (row.event_status !== "published" || row.event_ended !== false) return ended("closed");
  if (!session.client_secret) throw new Error("Stripe returned an open Checkout Session without a client secret.");

  const state = await openOrderState(deps.db, sessionId, row.event_id, row.line_items, row.seat_ids);
  if (state.soldOut) return ended("sold_out");
  // The event is published (checked above), so its date and venue are public.
  return answer({
    status: "open",
    clientSecret: session.client_secret,
    expiresAt: new Date(session.expires_at * 1000).toISOString(),
    eventTitle: row.event_title,
    ...(row.event_slug ? { eventSlug: row.event_slug } : {}),
    ...(row.event_starts_at ? { eventStartsAt: new Date(row.event_starts_at).toISOString() } : {}),
    ...(row.event_ends_at ? { eventEndsAt: new Date(row.event_ends_at).toISOString() } : {}),
    ...(row.event_venue_name ? { venueName: row.event_venue_name } : {}),
    ...(row.event_suburb ? { suburb: row.event_suburb } : {}),
    seated,
    lines: paymentLines(row.line_items, state.seats),
    subtotalCents: row.subtotal_cents,
    buyerFeeCents: row.buyer_fee_cents,
    totalCents: row.total_cents,
  });
};
