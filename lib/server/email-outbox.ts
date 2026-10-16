import type { Deps } from "./deps";
import { redactForLog } from "./email-address";
import { findEventById } from "./handlers/event-queries";
import { orderReference } from "./order-reference";
import { ORDER_SELECT, toOrder } from "./records";
import { buildTicketEmail } from "./ticket-email";

/**
 * The ticket-email outbox (supabase/migrations/20261014000000_email_outbox.sql).
 * private.fulfil_order queues a job when an order becomes paid; this module
 * delivers them: once straight after the response (Deps.defer) and then from
 * the cron route every 5 minutes until it's sent or has failed 6 times.
 * Delivery is at-least-once: a worker that dies between SMTP accepting the
 * message and recording it leaves a lease that expires, and the job is sent
 * again. A mail failure never touches the order itself.
 */

/** Delays after the 1st … 5th failed attempt: 1 min, 5 min, 30 min, 2 h, 6 h. */
export const EMAIL_RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 21600] as const;
/** The 6th failure is final: the job is `failed` and waits for an admin resend. */
export const MAX_EMAIL_ATTEMPTS = 6;
/** How long a worker holds a job. Comfortably more than one SMTP send (lib/server/email.ts timeouts). */
export const EMAIL_LEASE = "2 minutes";
/**
 * Jobs leased at a time. One: a job is leased just before it's sent, so even
 * a send that runs into every SMTP timeout ends well inside its lease, and a
 * second worker never takes over a job that's still being sent.
 */
const CLAIM_BATCH = 1;
/**
 * A drain stops claiming jobs after this long. The cron route's maxDuration
 * is 60 s, and a job claimed just before the deadline still has to be sent:
 * usually a second or two, and at worst SMTP's connection (10 s) and greeting
 * (10 s) timeouts. An invocation cut off anyway leaves its lease to expire and
 * the job is sent again (at-least-once).
 */
export const DRAIN_BUDGET_MS = 30_000;

/**
 * Seconds to wait before the next attempt, after `attempts` attempts have
 * failed; null when that was the last one. ±20% jitter so a burst of failures
 * (an SMTP outage) doesn't come back in lockstep.
 */
export function retryDelaySeconds(attempts: number, random: () => number = Math.random): number | null {
  if (attempts < 1 || attempts >= MAX_EMAIL_ATTEMPTS) return null;
  const base = EMAIL_RETRY_DELAYS_SECONDS[Math.min(attempts, EMAIL_RETRY_DELAYS_SECONDS.length) - 1];
  return Math.round(base * (0.8 + random() * 0.4));
}

interface ClaimedJob {
  job_id: string | number;
  job_order_id: string;
  job_lease_token: string;
  job_attempts: number;
}

export interface DrainSummary {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
}

type Outcome = { sent: true } | { sent: false; error: string; permanent: boolean };

/** Builds and sends one order's ticket email. Never throws. */
async function deliver(deps: Deps, orderId: string): Promise<Outcome> {
  try {
    const [row] = await deps.db.query(`${ORDER_SELECT} where o.id = $1`, [orderId]);
    const order = row ? toOrder(row) : undefined;
    // Not something to retry: nothing will change by itself.
    if (!order || order.status !== "paid") return { sent: false, error: "the order isn't paid", permanent: true };
    if (!order.buyerEmail) return { sent: false, error: "the order has no email address", permanent: true };
    const event = await findEventById(deps.db, order.eventId);
    if (!event) return { sent: false, error: "the event no longer exists", permanent: true };
    await deps.sendEmail(buildTicketEmail(order, event, deps.siteUrl()));
    return { sent: true };
  } catch (err) {
    return { sent: false, error: redactForLog(err instanceof Error ? err.message : "unknown error"), permanent: false };
  }
}

async function runJob(deps: Deps, job: ClaimedJob, summary: DrainSummary, random: () => number) {
  const outcome = await deliver(deps, job.job_order_id);
  const retryIn = outcome.sent || outcome.permanent ? null : retryDelaySeconds(job.job_attempts, random);
  const [{ result }] = await deps.db.query<{ result: string }>(
    `select private.finish_email_job($1::bigint, $2::uuid, $3, $4, $5::interval) as result`,
    [
      String(job.job_id),
      job.job_lease_token,
      outcome.sent,
      outcome.sent ? null : outcome.error,
      retryIn === null ? null : `${retryIn} seconds`,
    ],
  );
  if (result === "sent") summary.sent += 1;
  else if (result === "retry") summary.retrying += 1;
  else if (result === "failed") summary.failed += 1;

  if (!outcome.sent) {
    // The job id and the order's short reference only: never the address or the order id.
    console.error(
      `Ticket email job ${job.job_id} (order ${orderReference(job.job_order_id)}) attempt ${job.job_attempts} ` +
        `${result === "failed" ? "failed for good" : "failed, will retry"}: ${outcome.error}`,
    );
  }
}

/**
 * Leases due jobs and sends them, until none are due, `maxJobs` have been
 * taken or `budgetMs` has passed. With `orderId`, only that order's job (the
 * attempt straight after payment). Safe to run concurrently with itself.
 */
export async function drainEmailOutbox(
  deps: Deps,
  options: { orderId?: string; maxJobs?: number; budgetMs?: number; random?: () => number } = {},
): Promise<DrainSummary> {
  const { orderId, maxJobs = 100, budgetMs = DRAIN_BUDGET_MS, random = Math.random } = options;
  const deadline = Date.now() + budgetMs;
  const summary: DrainSummary = { claimed: 0, sent: 0, retrying: 0, failed: 0 };
  while (summary.claimed < maxJobs && Date.now() < deadline) {
    const jobs = await deps.db.query<ClaimedJob>(
      `select * from private.claim_email_jobs($1, $2::interval, $3, $4)`,
      [Math.min(CLAIM_BATCH, maxJobs - summary.claimed), EMAIL_LEASE, MAX_EMAIL_ATTEMPTS, orderId ?? null],
    );
    if (jobs.length === 0) break;
    summary.claimed += jobs.length;
    for (const job of jobs) await runJob(deps, job, summary, random);
  }
  return summary;
}

/** Queues the first attempt at `orderId`'s ticket email for straight after the response. */
export function sendTicketEmailSoon(deps: Deps, orderId: string): void {
  deps.defer(async () => {
    await drainEmailOutbox(deps, { orderId, maxJobs: 1 });
  });
}
