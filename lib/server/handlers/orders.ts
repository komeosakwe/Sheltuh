import type Stripe from "stripe";
import { calculateBookingFeeCents, calculateOrderSummary } from "@/lib/fees";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { sendTicketEmailSoon } from "../email-outbox";
import { created, HttpError, ok, okPrivate, readJson } from "../http";
import { parseCheckoutLineItems } from "../order-input";
import { ORDER_ID_PATTERN, orderReference } from "../order-reference";
import { CUSTOMER_ORDER_SELECT, ORDER_SELECT, toCustomerOrder, toOrder } from "../records";
import type { Handler } from "../route";
import { parseTrackingCode } from "../tracking-codes";
import type { CustomerOrderLookup, OrderLineItem, OrderRecord, OrderStatus } from "../types";
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
      throw new HttpError(
        409,
        remaining === 0 ? `"${line.ticketTypeName}" is sold out.` : `Only ${remaining} of "${line.ticketTypeName}" left.`,
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
 * ours: Stripe would retry it for days.
 */
async function recordPaymentRefund(db: Db, eventId: string, charge: Stripe.Charge) {
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
    return;
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

/**
 * POST /api/events/[eventId]/checkout — public guest checkout. A paid order
 * becomes a Stripe Checkout Session paying out to the organiser's Connect
 * account, fulfilled by the webhook: 201 with its URL. A wholly free order
 * never touches Stripe (./free-orders.ts): 201 with the confirmation page's
 * URL for a member's own verified email, otherwise 202 once a confirmation
 * link has been emailed. Any order, paid or free, holds at most 4 free
 * tickets (400, fieldErrors.lineItems).
 */
export const createCheckout: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { db } = deps;
  const event = await findEventById(db, eventId);
  if (!event || event.status !== "published") throw new HttpError(404, "This event isn't available for booking.");

  const body = await readJson(req);
  const lineItems = parseCheckoutLineItems(body, event.ticketTypes);
  const totals = orderTotals(lineItems);
  const isFree = totals.totalCents === 0;
  // Free: tickets straight away for a member's own verified email, an emailed confirmation link for anyone else.
  if (isFree) {
    const buyerEmail = parseBuyerEmail(body, true);
    await assertFreeTicketsPerOrder(deps, lineItems);
    await assertAvailable(db, eventId, lineItems);
    return createFreeOrder(req, deps, { event, lineItems, buyerEmail, trackingCode: parseTrackingCode(body.trackingCode) });
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
  if (!organiser?.stripeAccountId || !organiser.payoutsEnabled) {
    throw new HttpError(409, "This organiser hasn't finished setting up payouts yet — ticket sales aren't open.");
  }

  // The order exists before Stripe does, so no payment can ever arrive
  // without an order to attach it to.
  await insertOrder();
  const siteUrl = deps.siteUrl();
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
      success_url: `${siteUrl}/checkout/success?session_id=${orderId}`,
      cancel_url: `${siteUrl}/events/${event.slug}`,
      metadata: { orderId, eventId },
    });
  } catch (err) {
    await db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    throw err;
  }
  if (!session.url) throw new Error("Stripe did not return a Checkout Session URL.");

  await db.query(`update public.orders set stripe_checkout_session_id = $2 where id = $1`, [orderId, session.id]);
  return created({ url: session.url });
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
    return received;
  }

  // Any refund of a charge, including ones made in the Stripe dashboard.
  if (event.type === "charge.refunded") {
    await recordPaymentRefund(deps.db, event.id, event.data.object as Stripe.Charge);
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
  // Already handled (Stripe redelivers) — nothing left to do.
  if (order.status !== "pending") return received;

  if (isFailureEvent) {
    await deps.db.query(`update public.orders set status = 'failed' where id = $1 and status = 'pending'`, [order.orderId]);
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
