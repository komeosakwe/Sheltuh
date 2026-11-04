import type Stripe from "stripe";
import type { Deps } from "./deps";
import { sendOpsAlertsSoon } from "./email-outbox";
import { orderReference } from "./order-reference";
import { stripeErrorLabel } from "./checkout-attempts";

/**
 * Delayed payouts (docs/architecture.md, "Delayed payouts"; supabase/migrations/
 * 20261119000000_delayed_payouts.sql). An order made with payout_method
 * 'transfer' (DELAYED_PAYOUTS on) was charged on the platform, with no
 * transfer_data. About 2 days after its event ends (events.ends_at + 48 hours)
 * this job sends the organiser their share as one Stripe transfer:
 * total - support - application fee, the amount stored with the claimed row.
 * Support Sheltuh and the booking fee stay with the platform, and a
 * 'destination' order (already paid out by Stripe with its charge) is never
 * picked: the database's due_transfer_orders and a trigger on order_transfers
 * both refuse it.
 *
 * An order is transferred at most once:
 *   - order_transfers.order_id is unique, so one row per order, ever;
 *   - the Stripe call carries the idempotency key order-transfer-<order>-<key_version>
 *     (the version only goes up after Stripe definitely rejected a request);
 *   - before it creates anything, the job asks Stripe for a transfer already made
 *     in the order's transfer group to the organiser (a worker may have died after
 *     Stripe accepted its request) and adopts it instead;
 *   - the claim leases a row to one worker at a time (`skip locked`).
 * A worker never retries a Stripe call itself (maxNetworkRetries 0): the row's
 * next attempt is the retry, and it looks first.
 *
 * Logs name an order by its short reference and a Stripe failure by error type
 * and code only; never the order id, an account, a payment or a message.
 */

/** How long after an event ends its orders' shares are due (passed to the database; the organiser's page says "about 2 days"). */
export const TRANSFER_DELAY = "48 hours";
export const TRANSFER_DELAY_HOURS = 48;
/** How long a worker holds a row: well over the three Stripe calls of one transfer, each capped below. */
export const TRANSFER_LEASE = "2 minutes";
/** The 5th failed attempt is final: the row is `failed`, with a transfer_failed payment exception. */
export const MAX_TRANSFER_ATTEMPTS = 5;
/** Seconds to wait after the 1st, 2nd, 3rd and 4th failed attempt: 1 hour, 6 hours, then a day. */
export const TRANSFER_RETRY_DELAYS_SECONDS = [3_600, 21_600, 86_400, 86_400] as const;
/**
 * One run: at most this many transfers, this many at once, and no new one started after the budget. A transfer
 * started at the last moment makes three Stripe calls of TRANSFER_STRIPE_REQUEST.timeout (10 s) each, so the run
 * ends within budgetMs + 30 s: 25 s keeps that (55 s, plus the database) inside the cron route's maxDuration of 60.
 */
export const TRANSFER_RUN = { maxTransfers: 50, concurrency: 4, budgetMs: 25_000 } as const;
/** Every Stripe call of a transfer: no automatic retry (the next attempt is the retry, and it looks first). */
export const TRANSFER_STRIPE_REQUEST = { timeout: 10_000, maxNetworkRetries: 0 } as const;

/** The Stripe idempotency key of an order's transfer. */
export function transferIdempotencyKey(orderId: string, keyVersion: number): string {
  return `order-transfer-${orderId}-${keyVersion}`;
}

/** Seconds to wait before the next attempt after `attempts` failed ones; null when that was the last. */
export function transferRetryDelaySeconds(attempts: number): number | null {
  if (attempts < 1 || attempts >= MAX_TRANSFER_ATTEMPTS) return null;
  return TRANSFER_RETRY_DELAYS_SECONDS[Math.min(attempts, TRANSFER_RETRY_DELAYS_SECONDS.length) - 1];
}

/** A row leased by private.claim_due_transfers. */
interface ClaimedTransfer {
  transfer_id: string | number | bigint;
  transfer_order_id: string;
  transfer_lease_token: string;
  transfer_attempts: number;
  transfer_amount_cents: number;
  transfer_key_version: number;
  transfer_destination: string;
  transfer_payment_intent_id: string;
  transfer_event_id: string;
  transfer_total_cents: number;
}

export interface TransferRunSummary {
  claimed: number;
  sent: number;
  retrying: number;
  held: number;
  failed: number;
  /** Outcomes not recorded because another worker took the row (its lease ran out). */
  leaseLost: number;
}

/** What to do with a claimed transfer, decided from Stripe's answers. */
type Decision =
  | { outcome: "sent"; transferId: string }
  | { outcome: "retry"; error: string; bumpKey: boolean; alert: boolean }
  | { outcome: "held"; error: string };

/** Error codes (lower case and underscores, at most 40) are stored and shown; anything else becomes `fallback`. */
function safeCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[a-z_]{1,40}$/.test(value) ? value : fallback;
}

/** Stripe codes meaning the destination account can't take a transfer (until a person looks): the row is held. */
const ACCOUNT_ERROR_CODES = new Set([
  "account_invalid",
  "account_closed",
  "transfers_not_allowed",
  "platform_account_required",
  "capability_not_enabled",
]);

/**
 * Turns a Stripe error into what happens to the transfer. Only a definite
 * rejection (an invalid-request error: Stripe answered, and did nothing) moves
 * the idempotency key on, because Stripe replays a stored error for the same
 * key. Everything else is an unknown outcome (a timeout, a dropped connection,
 * a server error, a conflict): the same key is used again, and before that the
 * next attempt looks for the transfer in Stripe.
 */
export function classifyTransferError(err: unknown): Decision & { outcome: "retry" | "held" } {
  const { type, code, statusCode } = (typeof err === "object" && err !== null ? err : {}) as {
    type?: unknown;
    code?: unknown;
    statusCode?: unknown;
  };
  if (type === "StripeInvalidRequestError" && statusCode !== 409) {
    const stripeCode = safeCode(code, "");
    if (stripeCode === "balance_insufficient") {
      return { outcome: "retry", error: "balance_insufficient", bumpKey: true, alert: true };
    }
    if (ACCOUNT_ERROR_CODES.has(stripeCode)) return { outcome: "held", error: "destination_account" };
    return { outcome: "retry", error: safeCode(stripeCode ? `rejected_${stripeCode}` : "", "rejected_by_stripe"), bumpKey: true, alert: false };
  }
  if (type === "StripeIdempotencyError") return { outcome: "held", error: "idempotency_conflict" };
  if (type === "StripeAuthenticationError" || type === "StripePermissionError") {
    return { outcome: "retry", error: "stripe_access", bumpKey: false, alert: true };
  }
  if (type === "StripeRateLimitError") return { outcome: "retry", error: "rate_limited", bumpKey: false, alert: false };
  if (type === "StripeConnectionError") return { outcome: "retry", error: "stripe_unreachable", bumpKey: false, alert: false };
  return { outcome: "retry", error: "stripe_unknown_outcome", bumpKey: false, alert: false };
}

/** A failure before the transfer was created can't have used the idempotency key: it never moves on. */
function beforeCreate(err: unknown): Decision {
  const decision = classifyTransferError(err);
  return decision.outcome === "retry" ? { ...decision, bumpKey: false } : decision;
}

/**
 * The checks on the order's payment, made against Stripe itself (the database
 * only knows what the webhooks told it): a charge that is still good, whole,
 * undisputed and a plain platform charge. Returns the charge's id, or the hold.
 */
function checkCharge(paymentIntent: Stripe.PaymentIntent, job: ClaimedTransfer): { chargeId: string } | { held: string } {
  const charge = paymentIntent.latest_charge;
  if (!charge || typeof charge === "string") return { held: "no_charge" };
  if (paymentIntent.status !== "succeeded" || charge.status !== "succeeded" || charge.paid !== true) {
    return { held: "charge_not_successful" };
  }
  if (charge.refunded || charge.amount_refunded > 0) return { held: "refunded" };
  if (charge.disputed) return { held: "disputed" };
  if (charge.currency !== "aud" || charge.amount !== job.transfer_total_cents) return { held: "amount_mismatch" };
  // A destination charge already paid its organiser with the payment: never transfer it again.
  if (charge.transfer_data?.destination || charge.on_behalf_of) return { held: "destination_charge" };
  // A payment that doesn't name this order (its metadata is missing, or names another) isn't proved to be ours.
  if (paymentIntent.metadata?.orderId !== job.transfer_order_id) return { held: "metadata_mismatch" };
  return { chargeId: charge.id };
}

/**
 * A transfer already made for this order, if any: Stripe is asked for the
 * transfers in the order's transfer group to the organiser's account. One for
 * the share is adopted (a worker that died after Stripe accepted the request);
 * one that was reversed since, or for another amount, is a person's to look at.
 */
async function findExistingTransfer(
  deps: Deps,
  job: ClaimedTransfer,
): Promise<{ transferId: string } | { held: string } | undefined> {
  const list = await deps.stripe().transfers.list(
    { transfer_group: job.transfer_order_id, destination: job.transfer_destination, limit: 10 },
    TRANSFER_STRIPE_REQUEST,
  );
  let other = false;
  for (const transfer of list.data) {
    if (transfer.amount !== job.transfer_amount_cents) {
      other = true;
      continue;
    }
    if (transfer.reversed || transfer.amount_reversed > 0) return { held: "transfer_reversed" };
    return { transferId: transfer.id };
  }
  return other ? { held: "transfer_mismatch" } : undefined;
}

/** What Stripe has for an order's transfer group and an organiser's account: see lookupOrderTransfer. */
export type TransferLookup = { kind: "none" } | { kind: "found"; transferId: string } | { kind: "unclear" };

/**
 * Asks Stripe whether a transfer of this order's share already exists (in the order's transfer group, to the
 * organiser's account): for an admin who is about to cancel a transfer and pay by hand. A cancel after an
 * unknown outcome (a timeout, a worker that died) could otherwise pay the organiser twice, because Stripe may
 * have accepted the request. `found`: a whole transfer for exactly the share (to be recorded as sent);
 * `none`: none, or only ones reversed in full (the money came back, so paying by hand is right); `unclear`:
 * one for another amount or reversed in part, or more than one page of them: a person looks in Stripe.
 * Throws when Stripe can't be asked: the caller must not cancel then.
 */
export async function lookupOrderTransfer(
  deps: Deps,
  order: { orderId: string; destination: string; amountCents: number },
): Promise<TransferLookup> {
  const list = await deps.stripe().transfers.list(
    { transfer_group: order.orderId, destination: order.destination, limit: 100 },
    TRANSFER_STRIPE_REQUEST,
  );
  let unclear = list.has_more === true;
  for (const transfer of list.data) {
    if (transfer.reversed) continue;
    if (transfer.amount === order.amountCents && transfer.amount_reversed === 0) {
      return { kind: "found", transferId: transfer.id };
    }
    unclear = true;
  }
  return unclear ? { kind: "unclear" } : { kind: "none" };
}

/**
 * Reads the order and the row again from the database, just before the transfer is created. Returns the
 * decision to take instead of creating (held, or retried when its lease lapsed), or undefined when it is still payable:
 * the order paid and not refunded even in part, and the row still leased to this worker. A refund recorded by the webhook meanwhile
 * has usually cancelled or held the row already (flag_transfer_after_refund), in which case the lease is gone
 * and recording the hold changes nothing ('lease_lost'); if only record_payment_refund has run, the hold is
 * recorded here and flag_transfer_after_refund cancels (full) or keeps it held (partial) when it follows.
 * A failure to read is thrown (nothing is created; the lease lapses and the next run looks in Stripe first).
 */
async function recheckBeforeCreate(deps: Deps, job: ClaimedTransfer): Promise<Decision | undefined> {
  const [row] = await deps.db.query<{ order_status: string; amount_refunded_cents: number; owned: boolean; lapsed: boolean }>(
    `select o.status::text as order_status, o.amount_refunded_cents,
            coalesce(t.status = 'sending' and t.lease_token = $3::uuid, false) as owned,
            coalesce(t.lease_expires_at <= now(), false) as lapsed
       from public.orders o
       left join private.order_transfers t on t.id = $2::bigint
      where o.id = $1`,
    [job.transfer_order_id, String(job.transfer_id), job.transfer_lease_token],
  );
  if (!row) return { outcome: "held", error: "order_not_found" };
  if (row.order_status !== "paid" || row.amount_refunded_cents > 0) return { outcome: "held", error: "refunded" };
  // Not this worker's row any more: recording anything is refused by the lease check, and nothing is created.
  if (!row.owned) return { outcome: "held", error: "lease_lost" };
  // Still its row, but stalled past the lease: another worker may take it any moment, so leave it to the next attempt.
  if (row.lapsed) return { outcome: "retry", error: "lease_lapsed", bumpKey: false, alert: false };
  return undefined;
}

/** What to do with one claimed transfer: Stripe is asked about the payment and any earlier transfer, then the transfer is made. */
async function decide(deps: Deps, job: ClaimedTransfer): Promise<Decision> {
  const stripe = deps.stripe();
  let chargeId: string;
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      job.transfer_payment_intent_id,
      { expand: ["latest_charge"] },
      TRANSFER_STRIPE_REQUEST,
    );
    const checked = checkCharge(paymentIntent, job);
    if ("held" in checked) return { outcome: "held", error: checked.held };
    chargeId = checked.chargeId;
  } catch (err) {
    return beforeCreate(err);
  }

  try {
    const existing = await findExistingTransfer(deps, job);
    if (existing && "held" in existing) return { outcome: "held", error: existing.held };
    if (existing) return { outcome: "sent", transferId: existing.transferId };
  } catch (err) {
    // Not knowing whether it exists is not a reason to send another: try again later.
    return beforeCreate(err);
  }

  // The last look before money moves: a refund (or a lost lease) since the claim stops the transfer. The webhook
  // that records a refund and this check are not one transaction, so a refund landing after this still ends in
  // finish_order_transfer's transfer_reversal_required exception, but the window is now milliseconds, not minutes.
  const stillPayable = await recheckBeforeCreate(deps, job);
  if (stillPayable) return stillPayable;

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: job.transfer_amount_cents,
        currency: "aud",
        destination: job.transfer_destination,
        source_transaction: chargeId,
        transfer_group: job.transfer_order_id,
        metadata: { orderId: job.transfer_order_id, eventId: job.transfer_event_id },
      },
      {
        idempotencyKey: transferIdempotencyKey(job.transfer_order_id, job.transfer_key_version),
        ...TRANSFER_STRIPE_REQUEST,
      },
    );
    if (typeof transfer.id !== "string" || transfer.id.length === 0) {
      return { outcome: "retry", error: "stripe_unknown_outcome", bumpKey: false, alert: false };
    }
    return { outcome: "sent", transferId: transfer.id };
  } catch (err) {
    return classifyTransferError(err);
  }
}

/** Records the decision (lease-checked in the database), turning a retry on the last attempt into a failure. */
async function finish(deps: Deps, job: ClaimedTransfer, decision: Decision, summary: TransferRunSummary): Promise<boolean> {
  let outcome: "sent" | "retry" | "held" | "failed" = decision.outcome;
  let retrySeconds: number | null = null;
  if (decision.outcome === "retry") {
    retrySeconds = transferRetryDelaySeconds(job.transfer_attempts);
    if (retrySeconds === null) outcome = "failed";
  }
  const error = decision.outcome === "sent" ? null : decision.error;
  const [row] = await deps.db.query<{ result: string; alert_queued: boolean }>(
    `select result, alert_queued
       from private.finish_order_transfer($1::bigint, $2::uuid, $3, $4, $5::interval, $6, $7, $8)`,
    [
      String(job.transfer_id),
      job.transfer_lease_token,
      outcome,
      error,
      retrySeconds === null ? null : `${retrySeconds} seconds`,
      decision.outcome === "sent" ? decision.transferId : null,
      decision.outcome === "retry" ? decision.bumpKey : false,
      decision.outcome === "retry" ? decision.alert : false,
    ],
  );
  const reference = orderReference(job.transfer_order_id);
  switch (row.result) {
    case "sent":
      summary.sent += 1;
      break;
    case "retry":
      summary.retrying += 1;
      console.warn(`Transfer for order ${reference}: will retry (${error}).`);
      break;
    case "held":
      summary.held += 1;
      console.warn(`Transfer for order ${reference}: held (${error}).`);
      break;
    case "failed":
      summary.failed += 1;
      console.error(`Transfer for order ${reference}: failed after ${job.transfer_attempts} attempts (${error}); a payment exception was opened.`);
      break;
    case "duplicate":
      summary.failed += 1;
      console.error(`Transfer for order ${reference}: a second transfer exists in Stripe; a payment exception was opened.`);
      break;
    case "cancelled_paid":
      summary.failed += 1;
      console.error(
        `Transfer for order ${reference}: it was sent after an admin cancelled it; the row stays cancelled and a payment exception was opened (reverse the transfer, or the payment made by hand).`,
      );
      break;
    default:
      summary.leaseLost += 1;
      console.warn(`Transfer for order ${reference}: its lease was taken by another run; its outcome (${outcome}) wasn't recorded.`);
  }
  return row.alert_queued === true;
}

/**
 * One run of the payouts job (GET /api/cron/payouts): leases due transfers one
 * at a time per worker (so a lease is taken just before its Stripe calls),
 * with TRANSFER_RUN.concurrency workers, until nothing is due, the run has
 * handled TRANSFER_RUN.maxTransfers, or the time budget is spent. Safe to run
 * concurrently with itself. Never throws for a failure of one transfer (it is
 * recorded, or its lease runs out and the next run takes it).
 */
export async function runOrderTransfers(
  deps: Deps,
  options: { maxTransfers?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<TransferRunSummary> {
  const { maxTransfers = TRANSFER_RUN.maxTransfers, concurrency = TRANSFER_RUN.concurrency, budgetMs = TRANSFER_RUN.budgetMs } = options;
  const summary: TransferRunSummary = { claimed: 0, sent: 0, retrying: 0, held: 0, failed: 0, leaseLost: 0 };
  const deadline = Date.now() + budgetMs;
  let reserved = 0;
  let drained = false;
  let alertQueued = false;

  async function worker(): Promise<void> {
    while (!drained && reserved < maxTransfers && Date.now() < deadline) {
      reserved += 1;
      const [job] = await deps.db.query<ClaimedTransfer>(
        `select * from private.claim_due_transfers(1, $1::interval, $2, $3::interval)`,
        [TRANSFER_LEASE, MAX_TRANSFER_ATTEMPTS, TRANSFER_DELAY],
      );
      if (!job) {
        reserved -= 1;
        drained = true;
        return;
      }
      summary.claimed += 1;
      try {
        const decision = await decide(deps, job);
        if (await finish(deps, job, decision, summary)) alertQueued = true;
      } catch (err) {
        // Not recorded (the database, or Stripe's client, failed): the lease runs out and the next run takes it,
        // looking in Stripe for a transfer first.
        console.error(
          `Transfer for order ${orderReference(job.transfer_order_id)}: couldn't be processed (${stripeErrorLabel(err)}); its lease will lapse.`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  if (alertQueued) sendOpsAlertsSoon(deps);
  return summary;
}
