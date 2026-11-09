import { CHECKOUT_PAY_MINUTES } from "@/lib/api/types";
import { stripeErrorLabel } from "../checkout-attempts";
import { requireCronSecret } from "../cron-auth";
import type { Deps } from "../deps";
import { okPrivate } from "../http";
import type { Handler } from "../route";
import { closeStripeSession, type StripeSessionClose } from "./orders";

/**
 * The checkout pay deadline's sweeper (docs/architecture.md, "Checkout pay
 * deadline"; supabase/migrations/20261123000000_checkout_pay_deadline.sql).
 * A card checkout can be paid for CHECKOUT_PAY_MINUTES from when it started.
 * The payment page closes one the moment it's read past that; this closes
 * the rest (a tab closed or left in the background) within a run or two:
 * each overdue pending order's Stripe session is expired, then the order is
 * failed and a seated order's seats released (private.finish_checkout_expiry,
 * through private.release_checkout_order).
 *
 * - Only `pending` card checkouts (never a guest's free booking) are claimed,
 *   and Stripe is asked first: a session Stripe reports complete (it has the
 *   payment) is left to the webhook and never looked at again; one Stripe
 *   can't be asked about, or won't expire, is retried later (backing off
 *   from 2 minutes to an hour) and nothing is released meanwhile.
 * - Safe to run concurrently: each order is leased to one run
 *   (claim_overdue_checkouts, `skip locked`), and releasing is idempotent.
 * - Bounded: at most `maxOrders` per run, `concurrency` at once, no new one
 *   started after `budgetMs`, each Stripe call capped (STRIPE_REQUEST), so a
 *   run ends inside the route's 60-second maxDuration. Whatever is left is
 *   the next run's (every 2 minutes, vercel.json).
 * - Logs counts only: never an order id, a session id or a secret.
 */

/** One run's bounds. The last order started at budgetMs makes two Stripe calls of 10 s at most: 45 s in all. */
export const CHECKOUT_EXPIRY_RUN = { maxOrders: 50, concurrency: 4, budgetMs: 25_000 } as const;
/** How long a run holds an order: well over its two capped Stripe calls, and the route's maxDuration (60 s). */
export const CHECKOUT_EXPIRY_LEASE = "90 seconds";
/** Each Stripe call: capped, and no automatic retry (the next run is the retry). */
export const CHECKOUT_EXPIRY_STRIPE_REQUEST = { timeout: 10_000, maxNetworkRetries: 0 } as const;

/** What one run did, counts only. */
export interface CheckoutExpirySummary {
  /** Overdue orders this run leased. */
  claimed: number;
  /** Closed now: the session expired (or had already, or there was none) and the order failed, its seats freed. */
  released: number;
  /** Stripe already has the payment (session complete): left to the webhook. */
  complete: number;
  /** Settled meanwhile (paid, refunded, or failed by something else): nothing changed. */
  settled: number;
  /** Stripe couldn't be asked, or the session wouldn't expire: retried by a later run. */
  failed: number;
  /** Another run had taken the order's lease by the time the outcome was recorded. */
  leaseLost: number;
}

interface ClaimedCheckout {
  claimed_order_id: string;
  claimed_session_id: string | null;
  claimed_lease_token: string;
}

type Outcome = "expired" | "complete" | "error";

async function finish(deps: Deps, job: ClaimedCheckout, outcome: Outcome): Promise<string> {
  const [row] = await deps.db.query<{ result: string }>(
    `select private.finish_checkout_expiry($1, $2::uuid, $3) as result`,
    [job.claimed_order_id, job.claimed_lease_token, outcome],
  );
  return row.result;
}

/** What happened to one claimed order: the summary count it adds to. */
type Counted = "released" | "complete" | "settled" | "failed" | "leaseLost";

async function closeOne(deps: Deps, job: ClaimedCheckout): Promise<Counted> {
  let closed: StripeSessionClose = { state: "expired" };
  if (job.claimed_session_id) {
    try {
      closed = await closeStripeSession(deps, job.claimed_session_id, CHECKOUT_EXPIRY_STRIPE_REQUEST);
    } catch (err) {
      console.warn(`Checkout expiry: Stripe couldn't expire an overdue session (${stripeErrorLabel(err)}); retried later.`);
      return (await finish(deps, job, "error")) === "lost" ? "leaseLost" : "failed";
    }
  }
  if (closed.state === "complete") {
    return (await finish(deps, job, "complete")) === "lost" ? "leaseLost" : "complete";
  }
  // Stripe has closed the session (or there was none): release it, whoever holds the lease now.
  return (await finish(deps, job, "expired")) === "released" ? "released" : "settled";
}

/**
 * One sweep: workers lease one overdue checkout at a time (so a lease is
 * taken just before its Stripe calls) until nothing is overdue, the run has
 * handled `maxOrders`, or the time budget is spent. Never throws for one
 * order's failure: its lease lapses and a later run takes it.
 */
export async function runCheckoutExpiry(
  deps: Deps,
  options: { maxOrders?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<CheckoutExpirySummary> {
  const {
    maxOrders = CHECKOUT_EXPIRY_RUN.maxOrders,
    concurrency = CHECKOUT_EXPIRY_RUN.concurrency,
    budgetMs = CHECKOUT_EXPIRY_RUN.budgetMs,
  } = options;
  const summary: CheckoutExpirySummary = { claimed: 0, released: 0, complete: 0, settled: 0, failed: 0, leaseLost: 0 };
  const deadline = Date.now() + budgetMs;
  let reserved = 0;
  let drained = false;

  async function worker(): Promise<void> {
    while (!drained && reserved < maxOrders && Date.now() < deadline) {
      reserved += 1;
      const [job] = await deps.db.query<ClaimedCheckout>(
        `select claimed_order_id, claimed_session_id, claimed_lease_token
           from private.claim_overdue_checkouts(make_interval(mins => $1::integer), 1, $2::interval)`,
        [CHECKOUT_PAY_MINUTES, CHECKOUT_EXPIRY_LEASE],
      );
      if (!job) {
        reserved -= 1;
        drained = true;
        return;
      }
      summary.claimed += 1;
      try {
        summary[await closeOne(deps, job)] += 1;
      } catch (err) {
        // Not recorded (the database failed): the lease lapses and a later run takes it.
        summary.failed += 1;
        console.error(
          `Checkout expiry: an overdue checkout couldn't be closed (${err instanceof Error ? err.name : "unknown error"}); its lease will lapse.`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  if (summary.claimed > 0) {
    console.info(
      `Checkout expiry: ${summary.claimed} overdue, ${summary.released} released, ${summary.complete} complete, ` +
        `${summary.settled} settled, ${summary.failed} failed, ${summary.leaseLost} lease lost.`,
    );
  }
  return summary;
}

/**
 * GET /api/cron/checkout-expiry — closes card checkouts whose pay deadline
 * (CHECKOUT_PAY_MINUTES) has passed (runCheckoutExpiry). Bearer CRON_SECRET
 * (lib/server/cron-auth.ts), like the other cron routes. Called by Vercel
 * Cron every 2 minutes (vercel.json; Vercel Pro). Returns the run's counts
 * only, `private, no-store`.
 */
export const runCheckoutExpiryCron: Handler = async (req, _params, deps) => {
  requireCronSecret(req, deps.cronSecret());
  return okPrivate(await runCheckoutExpiry(deps));
};
