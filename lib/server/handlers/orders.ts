import type Stripe from "stripe";
import { calculateBookingFeeCents, calculateOrderSummary } from "@/lib/fees";
import type { Db } from "../db";
import { created, HttpError, ok, readJson } from "../http";
import { parseCheckoutLineItems } from "../order-input";
import { ORDER_SELECT, toOrder } from "../records";
import type { Handler } from "../route";
import { issueTickets } from "../ticket-issuance";
import type { OrderLineItem, OrderRecord, OrderStatus } from "../types";
import { findEventById } from "./event-queries";
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
  const [row] = await db.query<{ status: OrderStatus | null }>(
    `select private.fulfil_order($1, $2, $3, $4::text::jsonb)::text as status`,
    [order.orderId, payment.buyerEmail ?? null, payment.paymentIntentId ?? null, JSON.stringify(issueTickets(order.lineItems))],
  );
  return row.status;
}

/**
 * POST /api/events/[eventId]/checkout — public guest checkout, returns the
 * URL to send the browser to. A wholly free order never touches Stripe and
 * is fulfilled immediately; anything else becomes a Stripe Checkout Session
 * paying out to the organiser's Connect account, fulfilled by the webhook.
 */
export const createCheckout: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { db } = deps;
  const event = await findEventById(db, eventId);
  if (!event || event.status !== "published") throw new HttpError(404, "This event isn't available for booking.");

  const lineItems = parseCheckoutLineItems(await readJson(req), event.ticketTypes);
  await assertAvailable(db, eventId, lineItems);
  const totals = orderTotals(lineItems);
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;

  const insertOrder = () =>
    db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
         buyer_fee_cents, total_cents, application_fee_cents)
       values ($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9)`,
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
      ],
    );

  if (totals.totalCents === 0) {
    await insertOrder();
    const status = await fulfilOrder(db, (await findOrder(db, orderId))!);
    if (status !== "paid") {
      // Nothing was charged, so there's nothing to refund — just drop it.
      await db.query(`delete from public.orders where id = $1`, [orderId]);
      throw new HttpError(409, "Those tickets just sold out.");
    }
    return created({ url: `${deps.siteUrl()}/checkout/success?session_id=${orderId}` });
  }

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

/**
 * GET /api/orders/by-session/[sessionId] — public. The unguessable order id
 * from the confirmation page's URL is the credential (guest checkout has no
 * account). A pending order reveals nothing but its status.
 */
export const getOrderBySession: Handler<{ sessionId: string }> = async (_req, { sessionId }, { db }) => {
  const order = await findOrder(db, sessionId);
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.status === "pending") return ok({ status: order.status });
  return ok(order);
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
  const isPaymentEvent =
    event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
  const isFailureEvent =
    event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed";
  if (!isPaymentEvent && !isFailureEvent) return received;

  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.client_reference_id;
  const order = orderId ? await findOrder(deps.db, orderId) : undefined;
  // Unknown, or already handled (Stripe redelivers) — nothing left to do.
  if (!order || order.status !== "pending") return received;

  if (isFailureEvent) {
    await deps.db.query(`update public.orders set status = 'failed' where id = $1 and status = 'pending'`, [order.orderId]);
    return received;
  }
  // A completed session can still be awaiting a delayed payment method.
  if (session.payment_status !== "paid") return received;

  const status = await fulfilOrder(deps.db, order, {
    buyerEmail: session.customer_details?.email,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
  });
  if (status === "oversold_refund_required") {
    // The buyer has been charged but the last tickets went to someone else.
    // No automatic refund yet — find these in the orders table and refund
    // from the Stripe dashboard (see docs/supabase-setup.md).
    console.error(`Order ${order.orderId} oversold — needs a manual refund.`);
  }
  return received;
};
