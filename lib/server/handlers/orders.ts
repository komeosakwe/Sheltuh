import type Stripe from "stripe";
import { calculateBookingFeeCents, calculateOrderSummary } from "@/lib/fees";
import type { RefundPolicy } from "@/lib/refund-policy";
import { PG_CHECK_VIOLATION, pgConstraint, pgErrorCode, type Db } from "../db";
import type { Deps } from "../deps";
import { sendOpsAlertsSoon, sendTicketEmailSoon, sendWaitlistEmailsSoon } from "../email-outbox";
import { MAX_SEATS_PER_ORDER } from "@/lib/seating/template";
import { remainingShownAtMost } from "@/lib/api/public-events";
import { CHECKOUT_PAY_MINUTES, SEAT_HOLD } from "@/lib/api/types";
import {
  CHECKOUT_LIMITS,
  checkoutFingerprint,
  idempotencyKey,
  peekCheckoutAttempt,
  requestClientKey,
  runPaidCheckout,
  settledAttemptResponse,
  stripeErrorLabel,
} from "../checkout-attempts";
import { clientIp, clientKey, orderKey } from "../client-key";
import { HttpError, ok, okPrivate, readJson } from "../http";
import { parseBuyerName, parseCheckoutLineItems, parseSupportCents, refuseSupportOnFreeOrder } from "../order-input";
import { parseCheckoutSeats } from "../seat-map-input";
import { ORDER_ID_PATTERN, orderReference } from "../order-reference";
import { payoutsSchemaMissing } from "../payout-schema";
import { CUSTOMER_ORDER_SELECT, eventPlaceOf, ORDER_SELECT, toCustomerOrder, toOrder } from "../records";
import type { Handler } from "../route";
import { parseTrackingCode } from "../tracking-codes";
import type {
  CancelOrderResult,
  CheckoutClosedReason,
  CustomerOrder,
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

/** The error code of a 409 for a ticket type that isn't on sale yet (sequential release). */
export const TICKET_LOCKED_CODE = "ticket_locked";

const TICKET_NOT_ON_SALE = "A ticket in your order isn't on sale yet. Reload and choose again.";

/** A 409 for a ticket type that waits for another to sell out. */
function ticketLocked(ticketTypeName: string, blockerName: string): HttpError {
  return new HttpError(409, `"${ticketTypeName}" opens after "${blockerName}" sells out.`, undefined, {
    code: TICKET_LOCKED_CODE,
  });
}

/**
 * Friendly early rejection. The binding checks are the database's:
 * private.fulfil_order, at payment time, for stock, and the orders_tiers_open
 * trigger, when the order is made, for a ticket type that waits for the one
 * above it to sell out (private.ticket_type_locks; sequential release).
 */
async function assertAvailable(db: Db, eventId: string, lineItems: OrderLineItem[]) {
  const locks = await db.query<{ ticket_type_id: string; blocker_name: string }>(
    `select ticket_type_id, blocker_name from private.ticket_type_locks($1)`,
    [eventId],
  );
  if (locks.length > 0) {
    const waiting = new Map(locks.map((l) => [l.ticket_type_id, l.blocker_name]));
    for (const line of lineItems) {
      const blocker = waiting.get(line.ticketTypeId);
      if (blocker !== undefined) throw ticketLocked(line.ticketTypeName, blocker);
    }
  }
  const rows = await db.query<{ id: string; remaining: number }>(
    `select id, quantity_available - quantity_sold as remaining from public.ticket_types where event_id = $1`,
    [eventId],
  );
  const left = new Map(rows.map((r) => [r.id, r.remaining]));
  for (const line of lineItems) {
    // Stock is in people; a group ticket's line takes quantity x admits of it (and says what's left in groups).
    const admits = line.admits ?? 1;
    const remaining = left.get(line.ticketTypeId) ?? 0;
    if (line.quantity * admits > remaining) {
      // An exact count only when public payloads show one too (remainingShownAtMost, in people): a large
      // stock, and through it sales, is never given away by asking for more than there is.
      const groups = Math.floor(remaining / admits);
      throw new HttpError(
        409,
        groups <= 0
          ? `"${line.ticketTypeName}" is sold out.`
          : remaining <= remainingShownAtMost(admits)
            ? `Only ${groups} of "${line.ticketTypeName}" left.`
            : `There aren't that many "${line.ticketTypeName}" tickets left. Choose fewer.`,
      );
    }
  }
}

/**
 * private.fulfil_order_detailed: the order's status afterwards, and whether
 * fulfilling it queued an ops alert (an early partial refund applied).
 */
async function fulfilOrder(
  db: Db,
  order: OrderRecord,
  payment: { buyerEmail?: string | null; paymentIntentId?: string | null } = {},
): Promise<{ status: OrderStatus | null; alertQueued: boolean }> {
  return withTicketCodes(order.lineItems, async (tickets) => {
    const [row] = await db.query<{ status: OrderStatus | null; alert_queued: boolean }>(
      `select f.order_status::text as status, f.alert_queued
         from private.fulfil_order_detailed($1, $2, $3, $4::text::jsonb) f`,
      [order.orderId, payment.buyerEmail ?? null, payment.paymentIntentId ?? null, JSON.stringify(tickets)],
    );
    return { status: row.status, alertQueued: row.alert_queued === true };
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

/** Where a refund's status came from: a webhook event (its id and creation time), or our own refund call (neither). */
interface RefundStatusSource {
  eventId?: string;
  /** Stripe's event `created` (Unix seconds): events older than the last applied are ignored. */
  eventCreated?: number;
  /** Our automatic refunds carry the order id in their metadata. */
  orderId?: string;
  /**
   * Our own refund call: the payment intent we asked Stripe to refund, used
   * only if the refund object doesn't name one (Stripe's always does).
   */
  paymentIntentId?: string;
}

/** A refund status that needs a person: the refund didn't (or hasn't yet) gone through. */
const REFUND_NEEDS_PERSON = new Set(["failed", "canceled", "requires_action"]);

function refundStatusOf(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^a-z_]/g, "").slice(0, 40) || "unknown" : "unknown";
}

function refundAmountOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_INT4 ? value : null;
}

/**
 * Before a refund is reported as not completed, its current status from
 * Stripe: events arrive out of order (a `succeeded` can come before the
 * older `requires_action` it replaced), and our own refund call's answer can
 * be a stored replay (Stripe's idempotency) of an older state. When Stripe
 * says the refund is fine now, that's what's recorded. When Stripe can't be
 * asked (or says something unusable), the reported status stands: the
 * database still drops an event older than the newest one it has for the
 * refund (private.refund_status_marks), and otherwise a person checks.
 * Logged by Stripe's error type and code only.
 */
async function confirmRefundStatus(deps: Deps, refundId: string, reported: string, label: string) {
  try {
    const current = await deps.stripe().refunds.retrieve(refundId);
    if (current && current.id === refundId && typeof current.status === "string") {
      return { status: refundStatusOf(current.status), amount: refundAmountOf(current.amount) };
    }
    console.warn(`${label}: Stripe's answer for the refund had no usable status; acting on the reported ${reported}.`);
  } catch (err) {
    console.warn(`${label}: couldn't confirm the refund's status with Stripe (${stripeErrorLabel(err)}); acting on the reported ${reported}.`);
  }
  return undefined;
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
  const paymentIntentId = expandableId(refund.payment_intent) ?? (source.eventId ? undefined : source.paymentIntentId);
  let status = refundStatusOf(refund.status);
  let amount = refundAmountOf(refund.amount);
  if (REFUND_NEEDS_PERSON.has(status)) {
    const confirmed = await confirmRefundStatus(deps, refundId, status, label);
    if (confirmed) {
      status = confirmed.status;
      amount = confirmed.amount ?? amount;
    }
  }
  const metadataOrderId = source.orderId && ORDER_ID_PATTERN.test(source.orderId) ? source.orderId : null;
  const created =
    source.eventCreated !== undefined && Number.isSafeInteger(source.eventCreated) && source.eventCreated > 0
      ? new Date(source.eventCreated * 1000).toISOString()
      : null;
  const [row] = await deps.db.query<{
    result: RefundStatusResult;
    order_id: string | null;
    order_status: OrderStatus | null;
    alert_queued: boolean;
  }>(
    `select result, order_id, order_status, alert_queued
       from private.record_refund_status($1, $2, $3, $4, $5, $6, $7::text::timestamptz)`,
    [refundId, paymentIntentId ?? null, metadataOrderId, status, amount, source.eventId ?? null, created],
  );
  if (row.result === "stale") {
    console.info(`${label}: an older refund status (${status}) than one already recorded for the refund; ignored.`);
    return;
  }
  const needsPerson = REFUND_NEEDS_PERSON.has(status);
  const exception =
    row.result === "opened" || row.result === "reopened" ? ` Payment exception ${row.result}.` : "";
  if (row.alert_queued) sendOpsAlertsSoon(deps);

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
  const [row] = await deps.db.query<{ alert_queued: boolean }>(
    `select alert_queued from private.raise_payment_exception('manual_refund_required', $1, null, null, $2, null,
       jsonb_strip_nulls(jsonb_build_object('reason', 'no_payment_intent',
         'orderStatus', (select o.status::text from public.orders o where o.id = $1),
         'totalCents', (select o.total_cents from public.orders o where o.id = $1),
         'supportCents', (select o.support_cents from public.orders o where o.id = $1))))`,
    [orderId, eventId ?? null],
  );
  if (row.alert_queued) sendOpsAlertsSoon(deps);
}

/** Why a paid Checkout Session's money isn't its order's, or null when it is (sessionMoneyMismatch). */
type MoneyMismatch = "amount_mismatch" | "currency_mismatch";

/**
 * Defence in depth before fulfilling a paid order: the session must have
 * charged exactly the order's stored total (support included), in AUD. The
 * session is built from the stored order (checkout-attempts.ts: per-ticket
 * prices and fees, the support line, Adaptive Pricing off), so a difference
 * means the session or the order isn't what we made, and no tickets go out.
 */
function sessionMoneyMismatch(session: Stripe.Checkout.Session, order: OrderRecord): MoneyMismatch | null {
  if (session.currency !== "aud") return "currency_mismatch";
  if (session.amount_total !== order.totalCents) return "amount_mismatch";
  return null;
}

/**
 * A paid session whose amount or currency isn't the order's: nothing is
 * issued. private.fail_mismatched_order, in one transaction, marks the order
 * `failed` with the payment intent on it (so the refund's own webhooks find
 * it), releases a seated order's holds, and opens an `amount_mismatch`
 * payment exception (one open per order) with the amounts from the session
 * and the stored order, queuing an ops alert. Returns the order's status
 * afterwards: `failed` (now, or by a concurrent delivery) means the caller
 * refunds the payment (refundPaymentForFailedOrder). Logged by short
 * reference only.
 */
async function failMismatchedOrder(
  deps: Deps,
  order: OrderRecord,
  session: Stripe.Checkout.Session,
  paymentIntentId: string | undefined,
  eventId: string,
  reason: MoneyMismatch,
): Promise<OrderStatus | null> {
  const charged = session.amount_total;
  const amountCharged = typeof charged === "number" && Number.isSafeInteger(charged) && charged >= 0 && charged <= MAX_INT4 ? charged : null;
  const currency = typeof session.currency === "string" && /^[a-z]{3}$/.test(session.currency) ? session.currency : null;
  console.error(
    `Order ${orderReference(order.orderId)} was paid with ${reason === "currency_mismatch" ? "a different currency" : "a different amount"} ` +
      "from its total: no tickets issued; failing the order and refunding the payment. See GET /api/admin/payment-exceptions.",
  );
  const [row] = await deps.db.query<{ order_status: OrderStatus | null; alert_queued: boolean }>(
    `select f.order_status::text as order_status, f.alert_queued
       from private.fail_mismatched_order($1, $2, $3,
              jsonb_strip_nulls(jsonb_build_object('reason', $4::text, 'amountChargedCents', $5::integer, 'currency', $6::text))) f`,
    [order.orderId, paymentIntentId ?? null, eventId, reason, amountCharged, currency],
  );
  if (row?.alert_queued) sendOpsAlertsSoon(deps);
  return row?.order_status ?? null;
}

/**
 * The flags an automatic refund sends for a destination charge: the organiser's transfer is reversed and the
 * application fee refunded, so the refund costs the platform nothing. An order paid by separate charge and
 * transfer ('transfer', DELAYED_PAYOUTS) has no transfer yet at this point (it is only sent after the
 * event) and no application fee on the charge, and Stripe refuses these flags on a charge that has neither:
 * the platform's own balance pays the refund, and the transfer job never sends it (the order isn't paid).
 * Read from the order, never from the environment, so every retry of a refund sends Stripe the same
 * parameters. An unknown order is a destination order, as today.
 */
async function refundReversalFlags(db: Db, orderId: string): Promise<{ reverse_transfer?: true; refund_application_fee?: true }> {
  let payoutMethod: string | undefined;
  try {
    const [row] = await db.query<{ payout_method: string }>(`select payout_method from public.orders where id = $1`, [orderId]);
    payoutMethod = row?.payout_method;
  } catch (err) {
    // Before 20261119000000_delayed_payouts.sql is applied every order is a destination order, as it always was.
    if (!(await payoutsSchemaMissing(db, err))) throw err;
  }
  return payoutMethod === "transfer" ? {} : { reverse_transfer: true, refund_application_fee: true };
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
        ...(await refundReversalFlags(deps.db, orderId)),
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
  // Our own call's answer, not an event: no Stripe event id or time (the webhook's event is the checkout's, not this refund's).
  await recordRefundStatus(deps, refund, { orderId, paymentIntentId });
}

/**
 * A payment for an order that had already failed: its checkout errored or was
 * cancelled, or its session expired, before Stripe reported the payment
 * (e.g. a delayed payment method, or a session Stripe created although the
 * call to create it failed), or the payment's amount or currency wasn't the
 * order's (failMismatchedOrder failed it). There's nothing to fulfil it with
 * (a seated order's seats were released), so it's refunded in full, Sheltüh's
 * fee and the organiser's transfer included, as for an oversold order.
 * Stripe's idempotency key (per order) and the refund id recorded on the
 * order make a redelivery refund at most once; a charge already refunded in
 * full is done. The refund's metadata reason is `amount_mismatch` when the
 * order has an `amount_mismatch` exception (any status), else
 * `paid_after_order_failed`: decided from the database, so every retry sends
 * Stripe the same parameters. The payment intent is recorded on the order
 * before Stripe is asked, so the refund's charge.refunded finds the order
 * (and changes nothing: it isn't paid) instead of being held as a refund
 * "before its payment was recorded". The order stays `failed`. Logged by the
 * order's short reference only. Throws on any other Stripe error so the
 * webhook returns 500 and Stripe redelivers.
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
  const [row] = await deps.db.query<{ stripe_refund_id: string | null; mismatched: boolean }>(
    `select o.stripe_refund_id,
            exists (select 1 from private.payment_exceptions e
                     where e.order_id = o.id and e.kind = 'amount_mismatch') as mismatched
       from public.orders o
      where o.id = $1 and o.status = 'failed'`,
    [orderId],
  );
  if (!row || row.stripe_refund_id) return;
  // Recorded before Stripe is asked (if the order has none yet), so every webhook about this refund finds the order.
  await deps.db.query(
    `update public.orders set stripe_payment_intent_id = $2
      where id = $1 and status = 'failed' and stripe_payment_intent_id is null`,
    [orderId, paymentIntentId],
  );
  const reason = row.mismatched ? "amount_mismatch" : "paid_after_order_failed";
  console.warn(
    row.mismatched
      ? `Order ${reference} was paid with a different amount or currency from its total: refunding the payment.`
      : `Order ${reference} was paid after it failed: refunding the payment.`,
  );
  let refund: Stripe.Refund;
  try {
    refund = await deps.stripe().refunds.create(
      {
        payment_intent: paymentIntentId,
        ...(await refundReversalFlags(deps.db, orderId)),
        metadata: { orderId, reason },
      },
      { idempotencyKey: `failed-order-refund-${orderId}` },
    );
  } catch (err) {
    if (!isChargeAlreadyRefunded(err)) throw err;
    // Refunded in full already (e.g. in the dashboard): nothing more to ask for.
    console.info(`Order ${reference}'s payment was already refunded in full in Stripe.`);
    return;
  }
  // Recorded so a redelivery doesn't ask again.
  await deps.db.query(`update public.orders set stripe_refund_id = $2 where id = $1 and status = 'failed'`, [orderId, refund.id]);
  // Our own call's answer, not an event: no Stripe event id or time.
  await recordRefundStatus(deps, refund, { orderId, paymentIntentId });
}

/** Stripe answered that the object doesn't exist (HTTP 404, code resource_missing): the only failure that proves a payment isn't ours. */
export function isStripeNotFound(err: unknown): boolean {
  const { statusCode, code } = (typeof err === "object" && err !== null ? err : {}) as { statusCode?: unknown; code?: unknown };
  return statusCode === 404 || code === "resource_missing";
}

type PaymentRefundResult = "refunded" | "partial" | "unchanged" | "deferred" | "not_found";

/**
 * The connected account an early refund (one that arrives before its payment is recorded) of a separate charge
 * and transfer belongs to: the organiser of the 'transfer' order that the charge's metadata names (the
 * payment intent's, which the charge inherits; the payment intent is asked for when the charge lacks it).
 * Undefined when the payment is already recorded (the destination is then not needed), the charge isn't one
 * of those, or Stripe says it has no such payment intent (logged by error type and code; the refund is then
 * dropped as not ours). Any other Stripe failure is thrown, so the webhook is answered 500 and retried.
 */
async function organiserAccountOfCharge(deps: Deps, charge: Stripe.Charge, paymentIntentId: string): Promise<string | undefined> {
  const [recorded] = await deps.db.query(`select 1 from public.orders where stripe_payment_intent_id = $1 limit 1`, [paymentIntentId]);
  if (recorded) return undefined;
  let orderId = charge.metadata?.orderId;
  if (!orderId || !ORDER_ID_PATTERN.test(orderId)) {
    try {
      const paymentIntent = await deps.stripe().paymentIntents.retrieve(paymentIntentId);
      orderId = paymentIntent.metadata?.orderId;
    } catch (err) {
      // Only Stripe saying there is no such payment means it isn't ours. Anything else (a timeout, a 5xx, rate
      // limiting, our key failing) is unknown: rethrown, so the webhook answers 500 and Stripe sends it again,
      // instead of dropping the refund of one of our payments for good.
      if (!isStripeNotFound(err)) throw err;
      console.warn(`A refund's payment intent is unknown to Stripe (${stripeErrorLabel(err)}); treated as not ours.`);
      return undefined;
    }
  }
  if (!orderId || !ORDER_ID_PATTERN.test(orderId)) return undefined;
  try {
    const [row] = await deps.db.query<{ stripe_account_id: string | null }>(
      `select g.stripe_account_id from public.orders o join public.organisers g on g.id = o.organiser_id
        where o.id = $1 and o.payout_method = 'transfer'`,
      [orderId],
    );
    return row?.stripe_account_id ?? undefined;
  } catch (err) {
    // Before 20261119000000_delayed_payouts.sql there are no transfer orders, so no charge of that kind.
    if (!(await payoutsSchemaMissing(deps.db, err))) throw err;
    return undefined;
  }
}

/**
 * charge.refunded: a refund of one of our payments, whoever made it (usually
 * the Stripe dashboard). charge.amount_refunded is cumulative and
 * charge.refunded is true once it covers the whole charge. Only a full refund
 * (Stripe's `refunded`, or at least the order's total refunded) voids a paid
 * order (`refunded`, tickets void, inventory released); any other refund is
 * partial, whatever its amount (nothing is inferred from it: tickets only,
 * Support Sheltüh only or anything else), and is recorded with a payment
 * exception for a person, the tickets left valid
 * (private.record_payment_refund, 20261111000300_refund_no_inference.sql).
 * One that arrives before its order's payment is recorded, for a payment to
 * one of our organisers' accounts, is held for fulfilment (`deferred`) and
 * judged by the same rule then: in full, nothing is issued; in part, the
 * tickets are issued and flagged. Never throws for a payment that isn't ours
 * (Stripe would retry it for days), but does for a failure to find that out
 * (Stripe unreachable: organiserAccountOfCharge), so the webhook answers 500
 * and the refund is delivered again. Returns the result (undefined when the
 * charge was unusable).
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
  // Only a charge paying out to one of our organisers can be held as an early refund. A destination charge
  // (payment_intent_data.transfer_data.destination, lib/server/checkout-attempts.ts) names the organiser's
  // account itself. A charge made for separate charges and transfers (DELAYED_PAYOUTS) has no transfer_data:
  // its organiser is the one of the order its metadata names (organiserAccountOfCharge).
  const destination =
    expandableId(charge.transfer_data?.destination) ?? (await organiserAccountOfCharge(deps, charge, paymentIntentId));
  const [row] = await deps.db.query<{ result: PaymentRefundResult; order_id: string | null }>(
    `select result, order_id from private.record_payment_refund($1, $2, $3, $4, $5, $6)`,
    [paymentIntentId, amount, charge.refunded, stripeId(charge.id) ?? null, destination ?? null, stripeId(eventId) ?? null],
  );
  // A transfer order's organiser share, not sent yet, is cancelled (refunded in full, and Stripe never asked to
  // create it) or held (in part, or in full when Stripe may have made it: outcome unknown); one already sent, or
  // possibly sent, can only be settled by a person: a payment exception and an ops alert. Run for every
  // delivery of the event (idempotent), whatever record_payment_refund made of it.
  let flag: { result: string; alert_queued: boolean } | undefined;
  try {
    [flag] = await deps.db.query<{ result: string; alert_queued: boolean }>(
      `select result, alert_queued from private.flag_transfer_after_refund($1, $2)`,
      [paymentIntentId, stripeId(eventId) ?? null],
    );
  } catch (err) {
    // Before 20261119000000_delayed_payouts.sql there are no transfers to cancel, hold or flag.
    if (!(await payoutsSchemaMissing(deps.db, err))) throw err;
  }
  if (flag?.alert_queued) sendOpsAlertsSoon(deps);
  if (flag?.result === "flagged") {
    console.error(
      `Order ${row.order_id ? orderReference(row.order_id) : "(unmatched)"} was refunded after its organiser's transfer was sent: reverse the transfer (a payment exception was opened).`,
    );
  }
  if (flag?.result === "unknown") {
    console.error(
      `Order ${row.order_id ? orderReference(row.order_id) : "(unmatched)"} was refunded in full while its organiser's transfer may already exist in Stripe: the transfer is held and a payment exception was opened (check Stripe, then cancel it in the transfer queue).`,
    );
  }
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
 * A database trigger refused a new order: orders_sheltuh_only because the
 * event became external since it was read (an admin's change racing the
 * checkout), orders_not_ended because the event has ended (the end passed,
 * or its time was changed, since it was read), or orders_tiers_open because a
 * ticket type was locked since (409 `code: "ticket_locked"`). The same 409s as
 * the early checks. Anything else is rethrown.
 */
async function refuseIfClosed<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (pgErrorCode(err) === PG_CHECK_VIOLATION) {
      const constraint = pgConstraint(err);
      if (constraint === "orders_sheltuh_only") throw new HttpError(409, EXTERNAL_CHECKOUT_REFUSED);
      if (constraint === "orders_not_ended") throw new HttpError(409, EVENT_ENDED);
      // A tier that was open when the basket was read, locked since (the organiser's change racing the checkout).
      if (constraint === "orders_tiers_open") {
        throw new HttpError(409, TICKET_NOT_ON_SALE, undefined, { code: TICKET_LOCKED_CODE });
      }
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

/**
 * Stripe's shortest Checkout Session: it refuses an `expires_at` less than
 * 30 minutes after the session is created. Our own pay deadline
 * (CHECKOUT_PAY_MINUTES, 15) is shorter, so Stripe's expiry is only an outer
 * bound: the deadline is enforced by expiring the session ourselves
 * (getOrderPayment, and the sweeper: ./checkout-expiry.ts).
 */
export const STRIPE_MIN_SESSION_MINUTES = 30;

/**
 * Stripe's own expiry for a general admission Checkout Session (`expires_at`,
 * fixed at the order's creation plus this): 33 minutes, as short as Stripe
 * allows for a call repeated for the same order. A retry with the same
 * Idempotency-Key reuses a kept order up to CHECKOUT_ATTEMPT.gaReuseWithin
 * (2 minutes) old and its Stripe call can take about 33 seconds, so that
 * call still reaches Stripe with the session's expiry over 30 minutes ahead.
 * It bounds how long the client secret is any use to whoever holds the order
 * id, and how long a form already on screen could still be paid if expiring
 * the session at the pay deadline failed. Seated sessions have their own
 * (SEAT_HOLD_LIMITS).
 */
export const GA_CHECKOUT_SESSION_MINUTES = STRIPE_MIN_SESSION_MINUTES + 3;

/**
 * Anonymous rate limits on the card checkout routes: fixed windows on
 * private.take_client_rate_limit (no migration: the buckets are new names in
 * client_rate_limits), keyed with lib/server/client-key.ts and salted from
 * STRIPE_WEBHOOK_SECRET, as the per-client seat-hold limit. Each call that
 * gets past them can reach Stripe. Over one: 429, nothing else written.
 * - `paidCheckout`: paid general admission checkouts per client (its IP
 *   address), taken inside the checkout attempt (private.begin_checkout_attempt,
 *   which takes it in private.take_checkout_attempt under this bucket name,
 *   with the per-10-minute CHECKOUT_LIMITS, ../checkout-attempts.ts) only when
 *   a new order is about to be made: never for a reused order, a replay or a
 *   request that lost a race for its Idempotency-Key, nor after an early
 *   refusal. A refusal keeps no hit in any bucket. 10 a minute: a
 *   buyer starts one, or a few after going Back; 10 leaves room for several
 *   buyers on one address (venue wifi, a phone network's shared address)
 *   while bounding the pending orders and Stripe sessions one client can
 *   make. Seated checkouts have their own (SEAT_HOLD_LIMITS.perClient).
 * - `paymentPerClient`: GET …/payment per client, every well-formed id
 *   (unknown ones too). 30 a minute: the payment page reads it on load, on
 *   Back-Forward and at expiry, the return page once; 30 covers several
 *   buyers on one address and bounds how fast one client can try ids or
 *   drive Stripe retrieves.
 * - `paymentPerOrder`: GET …/payment per order (keyed on an HMAC of its id,
 *   never the id), taken just before the Stripe retrieve. 20 a minute: the
 *   bound on Stripe calls for one order however many addresses ask.
 * The per-client limits fail open, logged, without a client IP (always set
 * on Vercel); all three fail open, logged, without the secret.
 */
export const CHECKOUT_RATE_LIMITS = {
  paidCheckout: { bucket: "paid_checkouts", hits: 10, window: "1 minute" },
  paymentPerClient: { bucket: "order_payment", hits: 30, window: "1 minute" },
  paymentPerOrder: { bucket: "order_payment:order", hits: 20, window: "1 minute" },
} as const;

/** A fixed-window limit on private.take_client_rate_limit: CHECKOUT_RATE_LIMITS, and the wallet passes' (./wallet.ts). */
export type KeyedLimit = { readonly bucket: string; readonly hits: number; readonly window: string };

const CHECKOUTS_BUSY = "You've started a lot of checkouts in the last minute. Wait a minute, then try again.";
const PAYMENT_BUSY = "This checkout has been loaded a lot in the last minute. Wait a minute, then reload the page.";

/** One hit on a keyed fixed-window counter: whether it's within the limit. */
async function takeKeyedLimit(db: Db, key: string, limit: KeyedLimit): Promise<boolean> {
  const [row] = await db.query<{ allowed: boolean }>(
    `select private.take_client_rate_limit($1, $2, $3, $4::interval) as allowed`,
    [key, limit.bucket, limit.hits, limit.window],
  );
  return row.allowed;
}

/**
 * The secret rate-limit keys are salted with, or undefined when it isn't
 * configured (logged, naming only the limits skipped): the caller fails open.
 */
export function rateLimitSecret(deps: Deps, skipped: string): string | undefined {
  try {
    return deps.stripeWebhookSecret();
  } catch {
    console.error(`STRIPE_WEBHOOK_SECRET isn't set: ${skipped}.`);
    return undefined;
  }
}

/**
 * One hit on the request's client's counter for `limit`: false when it's
 * over. True (fails open) without `secret`, or without a usable client IP,
 * logged without any request detail.
 */
export async function takeClientLimit(req: Request, deps: Deps, secret: string | undefined, limit: KeyedLimit, what: string) {
  if (!secret) return true;
  const ip = clientIp(req);
  if (!ip) {
    console.warn(`${what} without a client IP header: the per-client limit was skipped.`);
    return true;
  }
  return takeKeyedLimit(deps.db, clientKey(ip, secret), limit);
}

/**
 * POST /api/events/[eventId]/checkout — public guest checkout. A paid order
 * becomes an embedded Stripe Checkout Session (ui_mode embedded_page) paying
 * out to the organiser's Connect account, fulfilled by the webhook: 201
 * `{url, orderId}` (private, no-store), `url` being our payment page
 * (/checkout/pay?order={orderId}, which reads the session's client secret
 * from GET /orders/by-session/{orderId}/payment). The order id also lets the
 * page cancel it (POST /orders/by-session/{orderId}/cancel) if the buyer goes
 * Back. The checkout can be paid for CHECKOUT_PAY_MINUTES (15) from now, then
 * closes for good; Stripe's own session expires a little later
 * (GA_CHECKOUT_SESSION_MINUTES) as an outer bound.
 *
 * A paid checkout is idempotent per `Idempotency-Key` header (optional for
 * now; ../checkout-attempts.ts): the same key and basket again is a 200 with
 * the same `{url, orderId}` while the session is open; 409
 * `checkout_in_progress` (Retry-After), `checkout_expired` or
 * `checkout_completed` (worded for a paid, refunded or being-refunded order)
 * or `checkout_other_client` (the key belongs to another client: nothing
 * about it is given out); 422 `idempotency_key_reused`; 400
 * `invalid_idempotency_key` (not a random v4 UUID); 503
 * `payment_provider_unavailable` (Stripe didn't answer: retry with the same
 * key).
 *
 * 503 when card payments aren't configured (refuseWithoutCardPayments),
 * before anything is written; then 429 (`code: "client_rate_limited"`) over
 * the client's paid checkouts: 10 a minute (CHECKOUT_RATE_LIMITS.paidCheckout),
 * 20 per event and 60 in all per 10 minutes (CHECKOUT_LIMITS), all taken in
 * the attempt, nothing else written either. 600 new checkouts per event per
 * 10 minutes only queues an ops alert (CHECKOUT_LIMITS). A wholly free order
 * never touches Stripe (./free-orders.ts): 201 with the confirmation page's
 * URL for a member's own verified email, otherwise 202, the confirmation
 * link being emailed straight after the response. Any order, paid or free, holds at most 4 free
 * tickets (400, fieldErrors.lineItems). An event that has ended takes no new
 * order or seat hold, paid or free (409 "This event has ended."; the
 * database refuses the order too: orders_not_ended).
 *
 * Optional `supportCents` (Support Sheltüh, lib/support.ts; general admission
 * and seated alike): omitted or 0 is none. Paused unless
 * NEXT_PUBLIC_SUPPORT_SHELTUH is "1" (isSupportSheltuhEnabled; unset by
 * default): then anything else is a 400 `fieldErrors.supportCents` ("Support
 * Sheltüh isn't available right now"), nothing written. When it's on: a whole
 * number of cents from A$1 to A$500, and only with a paid ticket in the order
 * (400 `fieldErrors.supportCents` otherwise). It's stored on the order, part of
 * its total and of the attempt's fingerprint (a replay with another amount is
 * a 422), a line of its own in Stripe's session, and all of it goes to
 * Sheltüh (application_fee_amount): ../checkout-attempts.ts.
 *
 * Optional `buyerName` (CheckoutBuyerDetails in lib/api/types.ts; paid, free,
 * general admission and seated alike): cleaned by parseBuyerName (400
 * `fieldErrors.buyerName`), stored on the order (the database stamps
 * `details_notice_at`) and part of the attempt's fingerprint (a replay with
 * another name is a 422). It reaches the event's organiser's Orders view
 * (./event-orders.ts), and nothing else: never a CustomerOrder, an email or a log.
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
  // Paid checkouts only (free ones ignore it); a malformed one is a 400 on any checkout.
  const key = idempotencyKey(req);
  // Reserved seating: seats chosen on the map (and any general admission lines with them).
  if (body.seats !== undefined && body.seats !== null) return createSeatedCheckout(req, deps, event, body, key);
  const lineItems = parseCheckoutLineItems(body, event.ticketTypes);
  refuseSeatedLines(event, lineItems);
  const totals = orderTotals(lineItems);
  // Support Sheltüh: validated here, and only on an order with a paid ticket (400 otherwise).
  const supportCents = parseSupportCents(body.supportCents);
  refuseSupportOnFreeOrder(supportCents, totals.subtotalCents);
  // Shown to the organiser with the email; optional for one release (null: no details). Part of the attempt's fingerprint.
  const buyerName = parseBuyerName(body.buyerName);
  const isFree = totals.totalCents === 0;
  // Free: tickets straight away for a member's own verified email, an emailed confirmation link for anyone else.
  if (isFree) {
    const buyerEmail = parseBuyerEmail(body, true);
    await assertFreeTicketsPerOrder(deps, lineItems);
    await assertAvailable(db, eventId, lineItems);
    return refuseIfClosed(() =>
      createFreeOrder(req, deps, {
        event,
        lineItems,
        buyerEmail,
        buyerName,
        trackingCode: parseTrackingCode(body.trackingCode),
      }),
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
    supportCents,
    buyerName,
  });
  // The attempt is bound to this client: a replay or retry from another client key is refused.
  const client = requestClientKey(req, deps);
  const peeked = await peekCheckoutAttempt(db, key, fingerprint, client.key);
  const settled = peeked && settledAttemptResponse(peeked);
  if (settled) return settled;

  // Free lines in a paid order: the same per-order cap. The Stripe payment identifies the buyer, so there's
  // no emailed confirmation or per-person allowance (those count wholly free orders only).
  await assertFreeTicketsPerOrder(deps, lineItems);
  await assertAvailable(db, eventId, lineItems);

  const insertOrder = (orderId: string) =>
    db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
         buyer_fee_cents, total_cents, application_fee_cents, buyer_email, tracking_code, support_cents, buyer_name)
       values ($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9, $10,
         (select l.code from public.event_tracking_links l where l.event_id = $2 and l.code = $11), $12, $13)`,
      [
        orderId,
        eventId,
        event.organiserId,
        event.title,
        JSON.stringify(lineItems),
        totals.subtotalCents,
        totals.buyerFeeCents,
        // What the buyer pays: tickets, buyer-paid fees and any Support Sheltüh (orders_support_in_total).
        totals.totalCents + supportCents,
        totals.applicationFeeCents,
        buyerEmail,
        trackingCode,
        supportCents,
        buyerName,
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
  return runPaidCheckout(deps, {
    kind: "ga",
    event,
    key,
    fingerprint,
    client,
    clientLabels: { subject: "Checkout", limit: "checkout" },
    limits: {
      clientEvent: CHECKOUT_LIMITS.perClient.event,
      clientAll: CHECKOUT_LIMITS.perClient.allEvents,
      eventAlert: CHECKOUT_LIMITS.perEventAlert,
      window: CHECKOUT_LIMITS.window,
      // Taken in the attempt with the others, only when a new order is about to be made (not for a reused
      // order, a replay or a request that lost a race for its key); a refusal keeps no hit in any bucket.
      minute: { hits: CHECKOUT_RATE_LIMITS.paidCheckout.hits, window: CHECKOUT_RATE_LIMITS.paidCheckout.window },
    },
    stripeAccountId: organiser.stripeAccountId,
    sessionSeconds: GA_CHECKOUT_SESSION_MINUTES * 60,
    // The order exists before Stripe does, so no payment can ever arrive without an order to attach it to.
    createOrder: async (orderId) => {
      await refuseIfClosed(() => insertOrder(orderId));
    },
    limitError: (limit) =>
      new HttpError(429, limit === "minute" ? CHECKOUTS_BUSY : CLIENT_BUSY, undefined, { code: "client_rate_limited" }),
  });
};

export const ORDER_NOT_FOUND = "Order not found.";

/**
 * The ticket page's lookup by the order id it holds (the capability): 404
 * for an id that isn't shaped like one (no query) or an unknown one; a
 * pending order is its status only; anything else is the CustomerOrder the
 * page shows (toCustomerOrder: ticket codes only while it's paid, event
 * details only while the event is published). Shared with the wallet pass
 * routes (./wallet.ts), so a pass is only ever what the page would show.
 */
export async function lookupCustomerOrder(db: Db, sessionId: string): Promise<CustomerOrderLookup> {
  // Anything that isn't shaped like an order id can't be one: no query needed.
  // A refunded order's tickets are void: CUSTOMER_ORDER_SELECT returns codes for paid orders only.
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  const [row] = await db.query(`${CUSTOMER_ORDER_SELECT} where o.id = $1`, [sessionId]);
  if (!row) throw new HttpError(404, ORDER_NOT_FOUND);
  return row.status === "pending" ? { status: "pending" } : toCustomerOrder(row);
}

/**
 * Whether an order's tickets can be added to a wallet: it's paid, its event
 * is still published, and it has tickets. The wallet pass routes serve
 * nothing else (./wallet.ts).
 */
export function walletEligible(lookup: CustomerOrderLookup): lookup is CustomerOrder {
  return lookup.status === "paid" && lookup.eventListed === true && lookup.tickets.length > 0;
}

/**
 * GET /api/orders/by-session/[sessionId] — public. The unguessable order id
 * from the confirmation page's URL is the credential (guest checkout has no
 * account), so the response is only what that page shows (CustomerOrder),
 * never cached anywhere. A pending order reveals nothing but its status.
 * For an order whose tickets can go in a wallet (walletEligible), `wallet`
 * says which wallets' passes are on, from the server's own configuration
 * (Deps.googleWallet / appleWallet), so the page never offers a button the
 * server would refuse.
 */
export const getOrderBySession: Handler<{ sessionId: string }> = async (_req, { sessionId }, deps) => {
  const lookup = await lookupCustomerOrder(deps.db, sessionId);
  if (!walletEligible(lookup)) return okPrivate(lookup);
  const order: CustomerOrder = { ...lookup, wallet: { google: !!deps.googleWallet(), apple: !!(await deps.appleWallet()) } };
  return okPrivate(order);
};

/**
 * POST /api/stripe/webhook — Stripe calls this directly; the signature is
 * the only trust boundary. Payment confirmation is the only point an order
 * becomes paid and inventory is taken, so an abandoned checkout never holds
 * tickets. A paid session is fulfilled only when it charged exactly the
 * order's stored total in AUD (sessionMoneyMismatch); otherwise nothing is
 * issued, the order fails, an `amount_mismatch` payment exception is opened
 * and the payment is refunded in full.
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
  // Only the amount the order was priced at, in AUD, fulfils it. (Free orders never reach here: they
  // have no Checkout Session, and their own paths fulfil them.)
  const mismatch = sessionMoneyMismatch(session, order);
  if (mismatch) {
    // Failed, then refunded in full (once, however often Stripe redelivers: a redelivery takes the failed-order path above).
    const status = await failMismatchedOrder(deps, order, session, paymentIntentId, event.id, mismatch);
    if (status === "failed") await refundPaymentForFailedOrder(deps, order.orderId, paymentIntentId, event.id);
    return received;
  }
  const { status, alertQueued } = await fulfilOrder(deps.db, order, {
    buyerEmail: session.customer_details?.email,
    paymentIntentId,
  });
  // A partial refund recorded before the payment opened a payment exception and queued its alert.
  if (alertQueued) sendOpsAlertsSoon(deps);
  if (status === "paid") {
    // Queued by fulfil_order in the same transaction; this is just the first try.
    sendTicketEmailSoon(deps, order.orderId);
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
 * Seat holds (docs/SEATING_PLAN.md decisions 1 and 5): SEAT_HOLD.holdMinutes
 * (20), five minutes past the checkout's pay deadline (CHECKOUT_PAY_MINUTES,
 * 15, which is what the buyer is told), when the seats are released anyway;
 * Stripe's own session expires at 31 minutes (its minimum is 30), an outer
 * bound only; per event,
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
  stripeSessionMinutes: STRIPE_MIN_SESSION_MINUTES + 1,
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
 * - Paid: 503 without card payments (nothing written), then an attempt per
 *   Idempotency-Key (../checkout-attempts.ts: a repeat gets the same order,
 *   holds and payment page back, never a second hold), then one attempt
 *   against the client's own hold allowance (SEAT_HOLD_LIMITS.perClient,
 *   take_seat_hold_attempt, in begin_checkout_attempt), the pending order
 *   and its 20-minute holds in one step (private.hold_seats), then Stripe (an
 *   embedded session expiring 31 minutes after the order was made; a Stripe
 *   error, or no client secret, releases the holds; no answer from Stripe
 *   keeps them for a retry with the same key). 201 `{url, holdExpiresAt,
 *   orderId}`, `url` being the payment page.
 * - Free: a member's own verified email gets the seats at once; anyone else
 *   an emailed link, holding nothing until it's confirmed.
 * Optional `supportCents` as for general admission (createCheckout).
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
  // Support Sheltüh: its form here; whether the order may carry it once it's priced (below).
  const supportCents = parseSupportCents(body.supportCents);
  const buyerName = parseBuyerName(body.buyerName);
  // The same key and basket again: the same order and holds, before the seat check (which would see them held).
  const fingerprint = checkoutFingerprint({
    kind: "seated",
    eventId: event.eventId,
    lines: gaLines,
    seats: { mapVersion, seatIds },
    buyerEmail: body.buyerEmail,
    trackingCode,
    supportCents,
    buyerName,
  });
  const client = requestClientKey(req, deps);
  const peeked = await peekCheckoutAttempt(db, key, fingerprint, client.key);
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
    const now = await peekCheckoutAttempt(db, key, fingerprint, client.key);
    const answer = now && settledAttemptResponse(now);
    if (answer) return answer;
    throw seatError(409, SEATS_TAKEN, "seats", { code: "seats_unavailable", seatIds: gone });
  }

  const lineItems = [...seatLines(event, seats), ...gaLines];
  const totals = orderTotals(lineItems);
  const labels = seats.map(({ section, row, seat, kind }) => ({ section, row, seat, kind }));
  refuseSupportOnFreeOrder(supportCents, totals.subtotalCents);

  if (totals.totalCents === 0) {
    const buyerEmail = parseBuyerEmail(body, true);
    await assertFreeTicketsPerOrder(deps, lineItems);
    await assertAvailable(db, event.eventId, lineItems);
    return refuseIfClosed(() =>
      createFreeOrder(req, deps, { event, lineItems, buyerEmail, buyerName, trackingCode, seats: { seatIds, labels } }),
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

  const createOrder = async (orderId: string) => {
    const [hold] = await refuseIfClosed(() =>
      db.query<{ result: string; unavailable_seat_ids: string[] | null }>(
        `select result, unavailable_seat_ids
           from private.hold_seats($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::text[],
                                   $14::interval, $15, $16::interval, $17, $18, $19, $20)`,
        [
          orderId,
          event.eventId,
          event.organiserId,
          event.title,
          JSON.stringify(lineItems),
          totals.subtotalCents,
          totals.buyerFeeCents,
          totals.totalCents + supportCents,
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
          supportCents,
          buyerName,
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
  // page keeps it so Back from the payment page can release the seats at once.
  return runPaidCheckout(deps, {
    kind: "seated",
    event,
    key,
    fingerprint,
    client,
    clientLabels: { subject: "Seat hold", limit: "hold" },
    limits: {
      clientEvent: SEAT_HOLD_LIMITS.perClient.event,
      clientAll: SEAT_HOLD_LIMITS.perClient.allEvents,
      eventAlert: null,
      window: SEAT_HOLD_LIMITS.perClient.window,
      minute: null,
    },
    stripeAccountId: organiser.stripeAccountId,
    sessionSeconds: SEAT_HOLD_LIMITS.stripeSessionMinutes * 60,
    createOrder,
    // Seated: only the per-client limit is taken before the hold (hold_seats refuses the event's itself).
    limitError: () => seatError(429, CLIENT_BUSY, "seats", { code: "client_rate_limited", seatIds }),
  });
}

/** What Stripe said when asked to close a Checkout Session (closeStripeSession). */
export type StripeSessionClose = { state: "expired" } | { state: "complete"; paid: boolean };

/**
 * Every Stripe call the buyer's own checkout requests make (the payment
 * page's GET …/payment, and the cancel route): at most 10 seconds each and
 * one network retry, so a slow Stripe can't hold a buyer's request open
 * (the routes' maxDuration is 60 seconds; closing a session is at most two
 * calls). The sweeper has its own, with no retry (./checkout-expiry.ts).
 */
export const BUYER_STRIPE_REQUEST = { timeout: 10_000, maxNetworkRetries: 1 } as const;

/**
 * Asks Stripe to expire Checkout Session `sessionId`, so it can't be paid any
 * more: `expired` (now, or it already was) or `complete` (Stripe already has
 * the payment; `paid` once it has cleared). Stripe refuses to expire a
 * session that isn't open, so on a refusal the session's status is read to
 * tell which. Throws when Stripe can't be asked, says the session doesn't
 * exist (isStripeNotFound), or the session is somehow still open (e.g. its
 * payment is under way): nothing may be released then. `options` bound both
 * calls (BUYER_STRIPE_REQUEST, or the sweeper's).
 */
export async function closeStripeSession(
  deps: Deps,
  sessionId: string,
  options: Stripe.RequestOptions,
): Promise<StripeSessionClose> {
  const sessions = deps.stripe().checkout.sessions;
  try {
    await sessions.expire(sessionId, {}, options);
    return { state: "expired" };
  } catch (err) {
    const session = await sessions.retrieve(sessionId, {}, options);
    if (session.status === "expired") return { state: "expired" };
    if (session.status === "complete") return { state: "complete", paid: session.payment_status === "paid" };
    throw err;
  }
}

/** What closing a pending card checkout came to (closePendingCheckout). */
type CheckoutClose =
  | { kind: "complete"; paid: boolean }
  | { kind: "released" }
  /** The order wasn't pending any more (paid, refunded, being refunded; or gone): nothing changed. */
  | { kind: "settled"; status: string };

/**
 * Closes a pending card checkout for good: Stripe's session (if it has one)
 * is expired first, so nothing can be paid for seats that are no longer
 * held, then the order is failed and a seated order's holds released
 * (private.release_seat_holds, which changes nothing unless the order is
 * still pending). A session Stripe reports complete is left alone: Stripe has
 * the payment and the webhook settles it. Shared by Back from the payment
 * page (cancelPendingOrder) and the pay deadline (getOrderPayment). Throws
 * when Stripe can't be asked (closeStripeSession): nothing is released then.
 */
async function closePendingCheckout(deps: Deps, orderId: string, sessionId: string | null): Promise<CheckoutClose> {
  if (sessionId) {
    const closed = await closeStripeSession(deps, sessionId, BUYER_STRIPE_REQUEST);
    if (closed.state === "complete") return { kind: "complete", paid: closed.paid };
  }
  const [released] = await deps.db.query<{ result: string }>(`select private.release_seat_holds($1) as result`, [orderId]);
  return released.result === "released" || released.result === "failed"
    ? { kind: "released" }
    : { kind: "settled", status: released.result };
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
 * The id (`ord_` + 32 hex: a UUIDv4, 122 random bits) only ever reaches the client
 * that made the order: the checkout's response, the payment page's URL and
 * Stripe's return URL. A paid order is never changed here, and the session
 * is expired before anything is released, so nothing can be paid for seats
 * that are no longer held (closePendingCheckout).
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
  const closed = await closePendingCheckout(deps, sessionId, row.stripe_checkout_session_id);
  if (closed.kind === "released") return answer("released");
  if (closed.kind === "settled" && closed.status === "paid") return answer("paid");
  return answer("processing");
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
    lineItems.some((line) => line.quantity * (line.admits ?? 1) > (remaining[line.ticketTypeId] ?? 0)) ||
    (seatIds !== null && row.seats_unavailable);
  return { soldOut, seats: row.seats ?? [] };
}

/** An order the payment page answers `done` for: paid, refunded, or being refunded (Stripe isn't asked). */
const SETTLED_ORDER_STATUSES: ReadonlySet<string> = new Set(["paid", "refunded", "oversold_refund_required"]);

/** The payment page's lines: all-inclusive amounts from lib/fees.ts, whether each includes a fee, and each seated tier's seats. */
function paymentLines(lineItems: OrderLineItem[], seats: (TicketSeat & { ticketTypeId: string })[]): OrderPaymentLine[] {
  return lineItems.map((line) => {
    const lineSeats = seats
      .filter((seat) => seat.ticketTypeId === line.ticketTypeId)
      .map(({ section, row, seat, kind }) => ({ section, row, seat, kind }));
    const unit = calculateOrderSummary(line.unitPriceCents, 1, line.feePolicy);
    return {
      ticketTypeName: line.ticketTypeName,
      quantity: line.quantity,
      ...(line.admits !== undefined && line.admits > 1 ? { admits: line.admits } : {}),
      unitTotalCents: unit.totalCents,
      lineTotalCents: calculateOrderSummary(line.unitPriceCents, line.quantity, line.feePolicy).totalCents,
      // This line's own fee policy: a paid buyer-pays ticket (an organiser-absorbed or free one has none).
      buyerPaysFee: unit.buyerFeeCents > 0,
      ...(lineSeats.length > 0 ? { seats: lineSeats } : {}),
    };
  });
}

/**
 * GET /api/orders/by-session/[sessionId]/payment — public, the order id is
 * the credential (as for GET /orders/by-session/{id}). What the payment page
 * (/checkout/pay) needs to mount Stripe's embedded form, and its summary
 * (OrderPaymentLookup):
 * - malformed id: 404, no query. Then one hit on the client's allowance
 *   (CHECKOUT_RATE_LIMITS.paymentPerClient; 429 over it). Unknown, or a
 *   guest's free booking (not a card checkout): 404.
 * - `paid`, `refunded`, `oversold_refund_required`: `done`. `failed`:
 *   `closed` (reason `time_up` once its pay deadline has passed, else
 *   `ended`).
 * - The pay deadline (the order's creation plus CHECKOUT_PAY_MINUTES, by the
 *   database's clock) has passed and the order is still pending: it's closed
 *   for good here, as Back from the payment page does (closePendingCheckout):
 *   Stripe's session is expired (one hit on the order's allowance first,
 *   429 over it), then the order is failed and its seats released: `closed`,
 *   reason `time_up`. Stripe already holding the payment (the session is
 *   complete) is `processing` and changes nothing. If Stripe can't be asked
 *   (or the session won't expire, or isn't found), it's `closed` with reason
 *   `unconfirmed`: the buyer may have paid in the last seconds, so the page
 *   never says they weren't charged; nothing is released, and the sweeper
 *   (./checkout-expiry.ts) tries again. Stripe calls here are bounded
 *   (BUYER_STRIPE_REQUEST).
 * - pending without its Stripe session yet: 409 (as the cancel route).
 * - otherwise one hit on the order's allowance (paymentPerOrder; 429 over
 *   it), then Stripe's session: `complete` → `processing` (`delayed` while
 *   the payment hasn't cleared); `expired`, or past its own expiry → `closed`
 *   (`ended`); `open` → `open` with the client secret, `expiresAt` (the pay
 *   deadline, or Stripe's expiry if that were sooner), `serverTime` and the
 *   summary, unless the event is no longer bookable (`closed`,
 *   `unavailable`: not published, so unpublished by its organiser or an
 *   admin, or its organiser suspended, which is what private.fulfil_order
 *   refuses; or ended, `ends_at <= now()` as for new orders), or the tickets
 *   or seats have gone to someone else since (`sold_out`, not binding:
 *   openOrderState).
 * Before the deadline it writes nothing but its rate-limit counters (the
 * webhook alone settles orders); it never logs anything about the order or
 * the secret. `private, no-store`: the client secret is in it.
 */
export const getOrderPayment: Handler<{ sessionId: string }> = async (req, { sessionId }, deps) => {
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  const secret = rateLimitSecret(deps, "the payment page's rate limits were skipped");
  if (!(await takeClientLimit(req, deps, secret, CHECKOUT_RATE_LIMITS.paymentPerClient, "Payment page read"))) {
    throw new HttpError(429, PAYMENT_BUSY);
  }
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
    support_cents: number;
    event_slug: string | null;
    event_status: string | null;
    event_ended: boolean | null;
    event_starts_at: string | Date | null;
    event_ends_at: string | Date | null;
    event_venue_name: string | null;
    event_suburb: string | null;
    event_state: string | null;
    event_time_zone: string | null;
    event_refund_policy: RefundPolicy | null;
    event_refund_days: number | null;
    pay_deadline: string | Date;
    pay_time_up: boolean;
    server_now: string | Date;
  }>(
    `select o.status::text as status, o.stripe_checkout_session_id, o.confirmation_token_hash is not null as free_link,
            o.event_id, o.event_title, o.line_items, o.seat_ids, o.subtotal_cents, o.buyer_fee_cents, o.total_cents,
            o.support_cents, e.slug as event_slug, e.status::text as event_status, e.ends_at <= now() as event_ended, e.starts_at as event_starts_at,
            e.ends_at as event_ends_at, e.venue_name as event_venue_name, e.suburb as event_suburb,
            e.state as event_state, e.time_zone as event_time_zone,
            e.refund_policy as event_refund_policy, e.refund_days as event_refund_days,
            o.created_at + make_interval(mins => $2::integer) as pay_deadline,
            o.created_at + make_interval(mins => $2::integer) <= now() as pay_time_up,
            now() as server_now
       from public.orders o
       left join public.events e on e.id = o.event_id
      where o.id = $1`,
    [sessionId, CHECKOUT_PAY_MINUTES],
  );
  // When `server_now` was read, by this process's clock: the answer's serverTime is moved on by the time
  // spent since (a slow Stripe call), so the countdown never shows time that's already gone.
  const sampledAt = Date.now();
  // A guest's free booking isn't a card checkout: nothing to pay here.
  if (!row || row.free_link) throw new HttpError(404, ORDER_NOT_FOUND);
  const answer = (lookup: OrderPaymentLookup) => okPrivate(lookup);
  const seated = row.seat_ids !== null;
  const context = { eventTitle: row.event_title, ...(row.event_slug ? { eventSlug: row.event_slug } : {}), seated };
  const closed = (reason: CheckoutClosedReason) => answer({ status: "closed", reason, ...context });

  if (SETTLED_ORDER_STATUSES.has(row.status)) return answer({ status: "done" });
  if (row.status === "failed") return closed(row.pay_time_up ? "time_up" : "ended");
  // Time's up (by the database's clock, as the sweeper judges it): closed for good, whatever Stripe's own expiry says.
  if (row.pay_time_up) {
    // Stripe is asked (to expire the session) only when there is one: at most so many a minute per order.
    if (
      row.stripe_checkout_session_id &&
      secret &&
      !(await takeKeyedLimit(deps.db, orderKey(sessionId, secret), CHECKOUT_RATE_LIMITS.paymentPerOrder))
    ) {
      throw new HttpError(429, PAYMENT_BUSY);
    }
    let result: CheckoutClose;
    try {
      // No session (a checkout that failed to make one and was kept for a retry): nothing to expire, just released.
      result = await closePendingCheckout(deps, sessionId, row.stripe_checkout_session_id);
    } catch (err) {
      // We couldn't learn from Stripe whether the buyer paid in the last seconds (Stripe unreachable, the session
      // still open with a payment under way, or not found): never "you haven't been charged". Nothing was
      // released; the sweeper tries again, and the webhook settles a payment. No order or session id logged.
      console.warn(`Payment page: couldn't close a checkout past its pay deadline (${stripeErrorLabel(err)}); the sweeper will retry.`);
      return closed("unconfirmed");
    }
    if (result.kind === "complete") return answer({ status: "processing", delayed: !result.paid });
    // Settled meanwhile (the webhook won the race): paid, refunded or being refunded.
    if (result.kind === "settled" && SETTLED_ORDER_STATUSES.has(result.status)) return answer({ status: "done" });
    return closed("time_up");
  }
  if (!row.stripe_checkout_session_id) {
    throw new HttpError(409, "This checkout is still being set up. Try again in a moment.");
  }

  // Every answer from here asks Stripe: at most so many a minute per order, from any number of clients.
  if (secret && !(await takeKeyedLimit(deps.db, orderKey(sessionId, secret), CHECKOUT_RATE_LIMITS.paymentPerOrder))) {
    throw new HttpError(429, PAYMENT_BUSY);
  }
  const session = await deps.stripe().checkout.sessions.retrieve(row.stripe_checkout_session_id, {}, BUYER_STRIPE_REQUEST);
  if (session.status === "complete") return answer({ status: "processing", delayed: session.payment_status !== "paid" });
  // Past its expiry, it can't be paid even if Stripe hasn't closed it yet.
  if (session.status !== "open" || session.expires_at * 1000 <= Date.now()) return closed("ended");
  // No form for an event that's gone or over. Not binding (a payment already
  // under way is still settled by the webhook: refunded if unpublished,
  // honoured if ended, as private.fulfil_order decides), only so nobody is
  // offered tickets they can't use.
  if (row.event_status !== "published" || row.event_ended !== false) return closed("unavailable");
  if (!session.client_secret) throw new Error("Stripe returned an open Checkout Session without a client secret.");

  const state = await openOrderState(deps.db, sessionId, row.event_id, row.line_items, row.seat_ids);
  if (state.soldOut) return answer({ status: "sold_out", ...context });
  // The pay deadline, or Stripe's own expiry if that were ever sooner: the form can't be paid past either.
  const expiresAtMs = Math.min(new Date(row.pay_deadline).getTime(), session.expires_at * 1000);
  // The event is published (checked above), so its date and venue are public.
  return answer({
    status: "open",
    clientSecret: session.client_secret,
    expiresAt: new Date(expiresAtMs).toISOString(),
    // The database's clock, which judges the deadline: a countdown can allow for a client clock that's off.
    serverTime: new Date(new Date(row.server_now).getTime() + (Date.now() - sampledAt)).toISOString(),
    eventTitle: row.event_title,
    ...(row.event_slug ? { eventSlug: row.event_slug } : {}),
    ...(row.event_starts_at ? { eventStartsAt: new Date(row.event_starts_at).toISOString() } : {}),
    ...(row.event_ends_at ? { eventEndsAt: new Date(row.event_ends_at).toISOString() } : {}),
    // The zone (and state, for its label) to show the times in.
    ...(row.event_starts_at ? eventPlaceOf(row) : {}),
    ...(row.event_venue_name ? { venueName: row.event_venue_name } : {}),
    ...(row.event_suburb ? { suburb: row.event_suburb } : {}),
    seated,
    // The policy the buyer is paying under: it can't be tightened once this order's session is recorded
    // (private.event_has_payable_orders), and this answer needs that session.
    ...(row.event_refund_policy ? { refundPolicy: row.event_refund_policy } : {}),
    ...(row.event_refund_policy === "days_before" && row.event_refund_days !== null
      ? { refundDays: row.event_refund_days }
      : {}),
    lines: paymentLines(row.line_items, state.seats),
    subtotalCents: row.subtotal_cents,
    buyerFeeCents: row.buyer_fee_cents,
    // Support Sheltüh, only when there is some; totalCents includes it (what Stripe's form charges).
    ...(row.support_cents > 0 ? { supportCents: row.support_cents } : {}),
    totalCents: row.total_cents,
  });
};
