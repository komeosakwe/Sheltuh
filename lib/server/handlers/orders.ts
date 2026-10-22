import type Stripe from "stripe";
import { calculateBookingFeeCents, calculateOrderSummary } from "@/lib/fees";
import { PG_CHECK_VIOLATION, pgConstraint, pgErrorCode, type Db } from "../db";
import type { Deps } from "../deps";
import { sendOpsAlertsSoon, sendTicketEmailSoon, sendWaitlistEmailsSoon } from "../email-outbox";
import { MAX_SEATS_PER_ORDER } from "@/lib/seating/template";
import { REMAINING_SHOWN_AT_MOST } from "@/lib/api/public-events";
import { SEAT_HOLD } from "@/lib/api/types";
import {
  CHECKOUT_LIMITS,
  checkoutFingerprint,
  idempotencyKey,
  peekCheckoutAttempt,
  requestClientKey,
  runPaidCheckout,
  settledAttemptResponse,
} from "../checkout-attempts";
import { HttpError, ok, okPrivate, readJson } from "../http";
import { parseCheckoutLineItems } from "../order-input";
import { parseCheckoutSeats } from "../seat-map-input";
import { ORDER_ID_PATTERN, orderReference } from "../order-reference";
import { CUSTOMER_ORDER_SELECT, ORDER_SELECT, toCustomerOrder, toOrder } from "../records";
import type { Handler } from "../route";
import { parseTrackingCode } from "../tracking-codes";
import type {
  CancelOrderResult,
  CustomerOrderLookup,
  EventRecord,
  OrderLineItem,
  OrderRecord,
  OrderStatus,
  SeatErrorDetails,
  TicketSeat,
} from "../types";
import { fail, requireEmail } from "../validation";
import { findEventById } from "./event-queries";
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

/** Postgres `integer`: an amount beyond it can't be a real charge's. */
const MAX_INT4 = 2_147_483_647;

/** A Stripe id we store (refund, payment intent, charge, account, event): a non-empty string of at most 255 characters. */
function stripeId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 255 ? value : undefined;
}

/** An id or an expanded object's id. */
function expandableId(value: unknown): string | undefined {
  if (typeof value === "string") return stripeId(value);
  if (value && typeof value === "object" && "id" in value) return stripeId((value as { id: unknown }).id);
  return undefined;
}

/**
 * Stripe's answer to refunding a charge that's already refunded in full
 * (someone refunded it in the dashboard first, or an earlier attempt of ours
 * did). Nothing more can be refunded, so it's done: not an error to retry.
 */
function isChargeAlreadyRefunded(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "charge_already_refunded";
}

type RefundStatusResult = "opened" | "reopened" | "updated" | "unchanged" | "stale" | "resolved" | "not_found";

/** Where a refund's status came from: a webhook event (its id and creation time), or our own refund call. */
interface RefundStatusSource {
  eventId?: string;
  /** Stripe's event `created` (Unix seconds): events older than the last applied are ignored. */
  eventCreated?: number;
  /** Our automatic refunds carry the order id in their metadata. */
  orderId?: string;
}

/**
 * A refund's status (refund.updated, refund.failed, charge.refund.updated, or
 * what our own refund call returned): private.record_refund_status records
 * our automatic refund on its oversold order (refunded once it succeeded),
 * then opens a payment exception for a refund that failed, was canceled or
 * requires action (above all a refund that failed after its order was
 * already voided: the buyer has neither tickets nor their money), and
 * resolves it if the same refund later succeeds. Nothing is ever restored or
 * refunded again automatically. An opened exception queues an ops alert.
 * A refund of a payment that isn't ours writes nothing. Logged by Stripe's
 * event id and the order's short reference: never the order id, the buyer or
 * the payment intent. Never throws for a payment that isn't ours.
 */
async function recordRefundStatus(deps: Deps, refund: Stripe.Refund, source: RefundStatusSource) {
  const label = source.eventId ? `Stripe ${source.eventId}` : "Our refund call";
  const refundId = stripeId(refund.id);
  if (!refundId) {
    console.warn(`${label}: a refund without a usable id; ignored.`);
    return;
  }
  const paymentIntentId = expandableId(refund.payment_intent);
  const status = typeof refund.status === "string" ? refund.status.replace(/[^a-z_]/g, "").slice(0, 40) || "unknown" : "unknown";
  const amount = Number.isSafeInteger(refund.amount) && refund.amount >= 0 && refund.amount <= MAX_INT4 ? refund.amount : null;
  const metadataOrderId = source.orderId && ORDER_ID_PATTERN.test(source.orderId) ? source.orderId : null;
  const created =
    source.eventCreated !== undefined && Number.isSafeInteger(source.eventCreated) && source.eventCreated > 0
      ? new Date(source.eventCreated * 1000).toISOString()
      : null;
  const [row] = await deps.db.query<{ result: RefundStatusResult; order_id: string | null; order_status: OrderStatus | null }>(
    `select result, order_id, order_status
       from private.record_refund_status($1, $2, $3, $4, $5, $6, $7::text::timestamptz)`,
    [refundId, paymentIntentId ?? null, metadataOrderId, status, amount, source.eventId ?? null, created],
  );
  const needsPerson = status === "failed" || status === "canceled" || status === "requires_action";
  const exception =
    row.result === "opened" || row.result === "reopened" ? ` Payment exception ${row.result}.` : "";
  if (row.result === "opened" || row.result === "reopened") sendOpsAlertsSoon(deps);

  if (metadataOrderId) {
    // Our own automatic refund.
    if (needsPerson) {
      console.error(`${label}: refund for order ${orderReference(metadataOrderId)} ${status} — refund it manually.${exception}`);
    }
    return;
  }
  const reference = row.order_id ? orderReference(row.order_id) : undefined;
  const subject = reference
    ? `a refund of order ${reference}`
    : row.result === "not_found"
      ? "a refund of a payment with no order on record"
      : "a refund of a payment not yet matched to an order";
  if (needsPerson) {
    const voided = row.order_status === "refunded" ? " The order was already voided: the buyer has neither tickets nor their money." : "";
    console.error(
      `${label}: ${subject} (made outside Sheltüh) has status ${status}. Check it in the Stripe dashboard.${voided}${exception}`,
    );
  } else {
    console.info(`${label}: ${subject} (made outside Sheltüh) has status ${status}; charge.refunded records it.`);
  }
}

/**
 * An automatic refund we couldn't even ask for (no payment intent on record):
 * a `manual_refund_required` payment exception (one open per order) and an
 * ops alert. Logged by short reference.
 */
async function raiseManualRefund(deps: Deps, orderId: string, eventId: string | undefined, message: string) {
  console.error(message);
  const [row] = await deps.db.query<{ outcome: string }>(
    `select outcome from private.raise_payment_exception('manual_refund_required', $1, null, null, $2, null,
       jsonb_build_object('reason', 'no_payment_intent', 'orderStatus', (select o.status::text from public.orders o where o.id = $1)))`,
    [orderId, eventId ?? null],
  );
  if (row.outcome === "opened") sendOpsAlertsSoon(deps);
}

/**
 * Refunds a paid order that couldn't be fulfilled (sold out, or the event
 * was unpublished, before payment confirmed) — including Sheltüh's fee and
 * the organiser's transfer. Stripe's idempotency key makes a retry (e.g.
 * Stripe redelivering the webhook after an earlier attempt failed) refund at
 * most once. A charge already refunded in full (e.g. in the dashboard) is
 * done: the order is marked refunded. Throws on any other failure so the
 * webhook returns 500 and Stripe tries again later.
 */
async function refundOversoldOrder(deps: Deps, orderId: string, paymentIntentId: string | undefined, eventId?: string) {
  if (!paymentIntentId) {
    await raiseManualRefund(
      deps,
      orderId,
      eventId,
      `Order ${orderReference(orderId)} couldn't be fulfilled and has no payment intent on record — refund it manually.`,
    );
    return;
  }
  let refund: Stripe.Refund;
  try {
    refund = await deps.stripe().refunds.create(
      {
        payment_intent: paymentIntentId,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: { orderId, reason: "could_not_fulfil_after_payment" },
      },
      { idempotencyKey: `oversold-refund-${orderId}` },
    );
  } catch (err) {
    if (!isChargeAlreadyRefunded(err)) throw err;
    await deps.db.query(`update public.orders set status = 'refunded' where id = $1 and status = 'oversold_refund_required'`, [
      orderId,
    ]);
    console.info(`Order ${orderReference(orderId)} couldn't be fulfilled; its payment was already refunded in full in Stripe: marked refunded.`);
    return;
  }
  await recordRefundStatus(deps, refund, { orderId, eventId });
}

/**
 * A payment for an order that had already failed: its checkout errored or was
 * cancelled, or its session expired, before Stripe reported the payment
 * (e.g. a delayed payment method, or a session Stripe created although the
 * call to create it failed). There's nothing to fulfil it with (a seated
 * order's seats were released), so it's refunded in full, Sheltüh's fee and
 * the organiser's transfer included, as for an oversold order. Stripe's
 * idempotency key (per order) and the refund id recorded on the order make a
 * redelivery refund at most once; a charge already refunded in full is done.
 * The order stays `failed`. Logged by the order's short reference only.
 * Throws on any other Stripe error so the webhook returns 500 and Stripe
 * redelivers.
 */
async function refundPaymentForFailedOrder(
  deps: Deps,
  orderId: string,
  paymentIntentId: string | undefined,
  eventId?: string,
) {
  const reference = orderReference(orderId);
  if (!paymentIntentId) {
    await raiseManualRefund(
      deps,
      orderId,
      eventId,
      `Order ${reference} was paid after it failed, with no payment intent on record — refund it manually.`,
    );
    return;
  }
  const [row] = await deps.db.query<{ stripe_refund_id: string | null }>(
    `select stripe_refund_id from public.orders where id = $1`,
    [orderId],
  );
  if (row?.stripe_refund_id) return;
  console.warn(`Order ${reference} was paid after it failed: refunding the payment.`);
  let refund: Stripe.Refund;
  try {
    refund = await deps.stripe().refunds.create(
      {
        payment_intent: paymentIntentId,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: { orderId, reason: "paid_after_order_failed" },
      },
      { idempotencyKey: `failed-order-refund-${orderId}` },
    );
  } catch (err) {
    if (!isChargeAlreadyRefunded(err)) throw err;
    // Refunded in full already (e.g. in the dashboard): nothing more to ask for.
    await deps.db.query(
      `update public.orders set stripe_payment_intent_id = coalesce(stripe_payment_intent_id, $2) where id = $1 and status = 'failed'`,
      [orderId, paymentIntentId],
    );
    console.info(`Order ${reference}'s payment was already refunded in full in Stripe.`);
    return;
  }
  // Recorded so a redelivery doesn't ask again, and charge.refunded finds the order (it changes only paid ones).
  await deps.db.query(
    `update public.orders
        set stripe_refund_id = $2, stripe_payment_intent_id = coalesce(stripe_payment_intent_id, $3)
      where id = $1 and status = 'failed'`,
    [orderId, refund.id, paymentIntentId],
  );
  await recordRefundStatus(deps, refund, { orderId, eventId });
}

type PaymentRefundResult = "refunded" | "partial" | "unchanged" | "deferred" | "not_found";

/**
 * charge.refunded: a refund of one of our payments, whoever made it (usually
 * the Stripe dashboard). charge.amount_refunded is cumulative and
 * charge.refunded is true once it covers the whole charge. A full refund of a
 * paid order voids it (`refunded`, tickets void, inventory released); a
 * partial one is recorded and opens a payment exception for a person
 * (private.record_payment_refund). One that arrives before its order's
 * payment is recorded, for a payment to one of our organisers' accounts, is
 * held for fulfilment (`deferred`): the order is then voided, or flagged if
 * partial. Never throws for a payment that isn't ours: Stripe would retry it
 * for days. Returns the result (undefined when the charge was unusable).
 */
async function recordPaymentRefund(deps: Deps, eventId: string, charge: Stripe.Charge): Promise<PaymentRefundResult | undefined> {
  const paymentIntentId = expandableId(charge.payment_intent);
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
  const destination = expandableId(charge.transfer_data?.destination);
  const [row] = await deps.db.query<{ result: PaymentRefundResult; order_id: string | null }>(
    `select result, order_id from private.record_payment_refund($1, $2, $3, $4, $5, $6)`,
    [paymentIntentId, amount, charge.refunded, stripeId(charge.id) ?? null, destination ?? null, stripeId(eventId) ?? null],
  );
  // Logs name the order by its short reference only: never its id (the confirmation page's credential) or the buyer.
  const reference = row.order_id ? orderReference(row.order_id) : undefined;
  if (row.result === "refunded") {
    console.info(`Order ${reference} was refunded in full in Stripe: marked refunded, tickets void, inventory released.`);
  } else if (row.result === "partial") {
    // Needs a person: a payment exception (and an ops alert) as well as the log line.
    console.error(`Order ${reference} was partly refunded in Stripe; it stays paid and its tickets stay valid. Review it manually.`);
    sendOpsAlertsSoon(deps);
  } else if (row.result === "deferred") {
    console.warn(
      `Stripe ${eventId}: charge.refunded arrived before its payment was recorded; held for the payment (a full refund voids the order, a partial one is flagged).`,
    );
  } else if (row.result === "not_found") {
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
 * The orders_sheltuh_only trigger refused an order because the event became
 * external since it was read (an admin's change racing the checkout): the
 * same 409 as the early check. Anything else is rethrown.
 */
async function refuseIfExternal<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (pgErrorCode(err) === PG_CHECK_VIOLATION && pgConstraint(err) === "orders_sheltuh_only") {
      throw new HttpError(409, EXTERNAL_CHECKOUT_REFUSED);
    }
    throw err;
  }
}

/**
 * POST /api/events/[eventId]/checkout — public guest checkout. A paid order
 * becomes a Stripe Checkout Session paying out to the organiser's Connect
 * account, fulfilled by the webhook: 201 `{url, orderId}` (private,
 * no-store; the order id lets the page cancel it, POST
 * /orders/by-session/{orderId}/cancel, if the buyer comes Back from
 * Stripe). A paid checkout is idempotent per `Idempotency-Key` header
 * (optional for now; ../checkout-attempts.ts): the same key and basket again
 * is a 200 with the same `{url, orderId}` while the session is open; 409
 * `checkout_in_progress` (Retry-After), `checkout_expired` or
 * `checkout_completed`; 422 `idempotency_key_reused`; 400
 * `invalid_idempotency_key`; 429 `client_rate_limited` (20 per event, 60 in
 * all, per client per 10 minutes) or `rate_limited` (600 per event per 10
 * minutes); 503 `payment_provider_unavailable` (Stripe didn't answer: retry
 * with the same key). A wholly free order
 * never touches Stripe (./free-orders.ts): 201 with the confirmation page's
 * URL for a member's own verified email, otherwise 202, the confirmation
 * link being emailed straight after the response. Any order, paid or free, holds at most 4 free
 * tickets (400, fieldErrors.lineItems).
 */
export const createCheckout: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { db } = deps;
  const event = await findEventById(db, eventId);
  if (!event || event.status !== "published") throw new HttpError(404, "This event isn't available for booking.");
  // External ticketing: no Sheltüh checkout, free or paid (the database refuses the order too).
  if (event.ticketingMode === "external") throw new HttpError(409, EXTERNAL_CHECKOUT_REFUSED);

  const body = await readJson(req);
  // Paid checkouts only (free ones ignore it); a malformed one is a 400 on any checkout.
  const key = idempotencyKey(req);
  // Reserved seating: seats chosen on the map (and any general admission lines with them).
  if (body.seats !== undefined && body.seats !== null) return createSeatedCheckout(req, deps, event, body, key);
  const lineItems = parseCheckoutLineItems(body, event.ticketTypes);
  refuseSeatedLines(event, lineItems);
  const totals = orderTotals(lineItems);
  const isFree = totals.totalCents === 0;
  // Free: tickets straight away for a member's own verified email, an emailed confirmation link for anyone else.
  if (isFree) {
    const buyerEmail = parseBuyerEmail(body, true);
    await assertFreeTicketsPerOrder(deps, lineItems);
    await assertAvailable(db, eventId, lineItems);
    return refuseIfExternal(() =>
      createFreeOrder(req, deps, { event, lineItems, buyerEmail, trackingCode: parseTrackingCode(body.trackingCode) }),
    );
  }

  const buyerEmail = parseBuyerEmail(body, false);
  // Attribution only (never affects price or status): kept if it's one of the event's tracking codes, else null.
  const trackingCode = parseTrackingCode(body.trackingCode);
  // The same key and basket again: the same order and session, before any other check (./checkout-attempts.ts).
  const fingerprint = checkoutFingerprint({
    kind: "ga",
    eventId: event.eventId,
    lines: lineItems,
    buyerEmail: body.buyerEmail,
    trackingCode,
  });
  const peeked = await peekCheckoutAttempt(db, key, fingerprint);
  const settled = peeked && settledAttemptResponse(peeked);
  if (settled) return settled;

  // Free lines in a paid order: the same per-order cap. The Stripe payment identifies the buyer, so there's
  // no emailed confirmation or per-person allowance (those count wholly free orders only).
  await assertFreeTicketsPerOrder(deps, lineItems);
  await assertAvailable(db, eventId, lineItems);

  const insertOrder = (orderId: string) =>
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

  return runPaidCheckout(deps, {
    kind: "ga",
    event,
    key,
    fingerprint,
    clientKey: requestClientKey(req, deps, { subject: "Checkout", limit: "checkout" }),
    limits: {
      clientEvent: CHECKOUT_LIMITS.perClient.event,
      clientAll: CHECKOUT_LIMITS.perClient.allEvents,
      event: CHECKOUT_LIMITS.perEvent,
      window: CHECKOUT_LIMITS.window,
    },
    stripeAccountId: organiser.stripeAccountId,
    createOrder: async (orderId) => {
      await refuseIfExternal(() => insertOrder(orderId));
    },
    limitError: (scope) =>
      scope === "client"
        ? new HttpError(429, CLIENT_BUSY, undefined, { code: "client_rate_limited" })
        : new HttpError(429, BUSY, undefined, { code: "rate_limited" }),
  });
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

  // A refund's status changed: ours (metadata.orderId) or one made in the Stripe dashboard.
  if (event.type === "refund.updated" || event.type === "refund.failed" || event.type === "charge.refund.updated") {
    const refund = event.data.object as Stripe.Refund;
    await recordRefundStatus(deps, refund, {
      eventId: event.id,
      eventCreated: event.created,
      orderId: refund.metadata?.orderId,
    });
    return received;
  }

  // Any refund of a charge, including ones made in the Stripe dashboard.
  if (event.type === "charge.refunded") {
    const result = await recordPaymentRefund(deps, event.id, event.data.object as Stripe.Charge);
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
    await refundOversoldOrder(deps, order.orderId, order.stripePaymentIntentId, event.id);
    return received;
  }
  // Paid for an order that had already failed (cancelled, expired or a checkout error): refund it.
  if (order.status === "failed" && isPaymentEvent) {
    if (session.payment_status === "paid") {
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      await refundPaymentForFailedOrder(deps, order.orderId, paymentIntentId, event.id);
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
    // A partial refund recorded before the payment opens a payment exception (and queues its alert) here.
    sendOpsAlertsSoon(deps);
  } else if (status === "oversold_refund_required") {
    // Charged, but the last tickets went to someone else first.
    await refundOversoldOrder(deps, order.orderId, paymentIntentId, event.id);
  } else if (status === "refunded") {
    // Refunded in full in Stripe before this payment was recorded (or, for a redelivery, since): nothing to issue or refund.
    console.info(`Order ${orderReference(order.orderId)} is refunded in Stripe: nothing issued for this payment.`);
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
 * - Paid: an attempt per Idempotency-Key (../checkout-attempts.ts: a repeat
 *   gets the same order, holds and session back, never a second hold), then
 *   one attempt against the client's own hold allowance
 *   (SEAT_HOLD_LIMITS.perClient, take_seat_hold_attempt, in
 *   begin_checkout_attempt), the pending order and its 35-minute holds in one
 *   step (private.hold_seats), then Stripe (expires 31 minutes after the
 *   order was made; a Stripe error releases the holds, no answer from Stripe
 *   keeps them for a retry with the same key). 201 `{url, holdExpiresAt,
 *   orderId}`.
 * - Free: a member's own verified email gets the seats at once; anyone else
 *   an emailed link, holding nothing until it's confirmed.
 * Refusals write nothing (only a hold counts towards the event's hold
 * attempts): 400 bad input; 409 `seats` taken or unknown (body `seatIds`),
 * `seatMapVersion` changed; 429 too many seats held or holds made for the
 * event, or too many attempts by this client (`client_rate_limited`; body
 * `seatIds`); the attempt's own answers as for general admission.
 */
async function createSeatedCheckout(
  req: Request,
  deps: Deps,
  event: EventRecord,
  body: Record<string, unknown>,
  key: string,
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
  const trackingCode = parseTrackingCode(body.trackingCode);
  // The same key and basket again: the same order and holds, before the seat check (which would see them held).
  const fingerprint = checkoutFingerprint({
    kind: "seated",
    eventId: event.eventId,
    lines: gaLines,
    seats: { mapVersion, seatIds },
    buyerEmail: body.buyerEmail,
    trackingCode,
  });
  const peeked = await peekCheckoutAttempt(db, key, fingerprint);
  const settled = peeked && settledAttemptResponse(peeked);
  if (settled) return settled;

  // A retry's own earlier order may still hold these seats: not "taken" (begin_checkout_attempt reuses or releases it).
  const ownOrderId = peeked?.order_id ?? null;
  const seats = await db.query<ChosenSeat & { unavailable: boolean }>(
    `select s.id, s.ticket_type_id as "ticketTypeId", s.section_label as section, s.row_label as "row",
            s.seat_label as seat, s.kind,
            (s.blocked or s.sold_order_id is not null
              or (s.hold_order_id is not null and s.hold_order_id is distinct from $3 and s.hold_expires_at > now())) as unavailable
       from public.event_seats s
      where s.event_id = $1 and s.id = any($2::text[])
      order by s.position`,
    [event.eventId, seatIds, ownOrderId],
  );
  const found = new Set(seats.map((seat) => seat.id));
  const gone = [...seatIds.filter((id) => !found.has(id)), ...seats.filter((seat) => seat.unavailable).map((seat) => seat.id)].sort();
  if (gone.length > 0) {
    // A duplicate of a request that held these seats since our first look (a double click): its answer, not "taken".
    const now = await peekCheckoutAttempt(db, key, fingerprint);
    const answer = now && settledAttemptResponse(now);
    if (answer) return answer;
    throw seatError(409, SEATS_TAKEN, "seats", { code: "seats_unavailable", seatIds: gone });
  }

  const lineItems = [...seatLines(event, seats), ...gaLines];
  const totals = orderTotals(lineItems);
  const labels = seats.map(({ section, row, seat, kind }) => ({ section, row, seat, kind }));

  if (totals.totalCents === 0) {
    const buyerEmail = parseBuyerEmail(body, true);
    await assertFreeTicketsPerOrder(deps, lineItems);
    await assertAvailable(db, event.eventId, lineItems);
    return refuseIfExternal(() =>
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

  const createOrder = async (orderId: string) => {
    const [hold] = await refuseIfExternal(() =>
      db.query<{ result: string; unavailable_seat_ids: string[] | null }>(
        `select result, unavailable_seat_ids
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
        return;
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
  };

  // The response's order id goes only to the client that made the order (as for general admission): the seat
  // page keeps it so Back from Stripe can release the seats at once.
  return runPaidCheckout(deps, {
    kind: "seated",
    event,
    key,
    fingerprint,
    clientKey: requestClientKey(req, deps, { subject: "Seat hold", limit: "hold" }),
    limits: {
      clientEvent: SEAT_HOLD_LIMITS.perClient.event,
      clientAll: SEAT_HOLD_LIMITS.perClient.allEvents,
      event: null,
      window: SEAT_HOLD_LIMITS.perClient.window,
    },
    stripeAccountId: organiser.stripeAccountId,
    sessionSeconds: SEAT_HOLD_LIMITS.stripeSessionMinutes * 60,
    createOrder,
    // Seated: only the per-client limit is taken before the hold (hold_seats refuses the event's itself).
    limitError: () => seatError(429, CLIENT_BUSY, "seats", { code: "client_rate_limited", seatIds }),
  });
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
 * the credential (as for GET). The buyer left Stripe's page (the seated
 * checkout's cancel_url): the Stripe session is expired first, so it can't
 * be paid any more, then the order is cancelled and its seats released.
 * CancelOrderResult: `released` (also when it already was), `paid`, or
 * `processing` (Stripe already has the payment). 404 unknown or not a card
 * checkout; 409 still being set up (try again). `private, no-store`.
 * The id (`ord_` + 32 hex, 128 random bits) only ever reaches the client
 * that made the order: the checkout's response and Stripe's success and
 * cancel URLs. A paid order is never changed here, and the session is
 * expired before anything is released, so nothing can be paid for seats
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
