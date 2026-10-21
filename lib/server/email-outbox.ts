import { createHash, randomBytes } from "node:crypto";
import type { Deps } from "./deps";
import { redactForLog } from "./email-address";
import { findEventById } from "./handlers/event-queries";
import { orderReference } from "./order-reference";
import { ORDER_SELECT, toOrder } from "./records";
import { buildTicketEmail } from "./ticket-email";
import { buildWaitlistAvailableEmail, waitlistEventLink, waitlistLeaveLink } from "./waitlist-email";

/**
 * The transactional email outbox (supabase/migrations/20261014000000_email_outbox.sql,
 * 20261024000000_waitlist.sql). Two kinds of job:
 * - `ticket_email`: private.fulfil_order queues one when an order becomes paid.
 * - `waitlist_available`: private.notify_waitlist queues one per person told
 *   that tickets are available again (docs/architecture.md, "Waitlist").
 * This module delivers them: once straight after the response (Deps.defer)
 * and then from the cron route until it's sent or has failed 6 times.
 * Delivery is at-least-once: a worker that dies between SMTP accepting the
 * message and recording it leaves a lease that expires, and the job is sent
 * again. A mail failure never touches the order or the waitlist entry.
 */

export type EmailJobKind = "ticket_email" | "waitlist_available";

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
  job_kind: EmailJobKind;
  job_order_id: string | null;
  job_waitlist_entry_id: string | null;
  job_lease_token: string;
  job_attempts: number;
}

export interface DrainSummary {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
}

/**
 * `skipped`: nothing went wrong, there was just nothing to send any more
 * (e.g. the person left the waitlist). Recorded as failed, never retried.
 */
type Outcome = { sent: true } | { sent: false; error: string; permanent: boolean; skipped?: boolean };

/** Builds and sends one order's ticket email. Never throws. */
async function deliverTicketEmail(deps: Deps, orderId: string): Promise<Outcome> {
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

const skip = (error: string): Outcome => ({ sent: false, error, permanent: true, skipped: true });

/**
 * Builds and sends one "tickets are available again" email, with a fresh
 * leave link (its token's hash stored first, so the link works as soon as the
 * email lands; one per attempt, each valid until the entry is deleted).
 * Skipped, not retried, if the person has left the list, or the event is no
 * longer open or has sold out again since the job was queued. Never throws.
 */
async function deliverWaitlistEmail(deps: Deps, entryId: string): Promise<Outcome> {
  try {
    const [entry] = await deps.db.query<{ event_id: string; email: string; on_list: boolean }>(
      `select w.event_id, w.email, w.confirmed_at is not null and w.unsubscribed_at is null as on_list
         from private.event_waitlist w where w.id = $1`,
      [entryId],
    );
    if (!entry) return skip("the waitlist entry no longer exists");
    if (!entry.on_list) return skip("they left the waitlist");
    const [state] = await deps.db.query<{ open: boolean; available: boolean }>(
      `select e.status = 'published' and e.ticketing_mode = 'sheltuh' and e.ends_at > now() as open,
              exists (select 1 from public.ticket_types t
                       where t.event_id = e.id and t.quantity_sold < t.quantity_available) as available
         from public.events e where e.id = $1`,
      [entry.event_id],
    );
    if (!state?.open) return skip("the event isn't open any more");
    if (!state.available) return skip("the tickets sold out again");
    const event = await findEventById(deps.db, entry.event_id);
    if (!event) return skip("the event no longer exists");

    const token = randomBytes(32).toString("base64url");
    await deps.db.query(
      `insert into private.event_waitlist_tokens (token_hash, entry_id, purpose) values ($1, $2, 'leave')`,
      [createHash("sha256").update(token, "utf8").digest("hex"), entryId],
    );
    const siteUrl = deps.siteUrl();
    await deps.sendEmail(
      buildWaitlistAvailableEmail(
        entry.email,
        event,
        waitlistEventLink(siteUrl, event.slug),
        waitlistLeaveLink(siteUrl, token),
      ),
    );
    return { sent: true };
  } catch (err) {
    return { sent: false, error: redactForLog(err instanceof Error ? err.message : "unknown error"), permanent: false };
  }
}

function deliver(deps: Deps, job: ClaimedJob): Promise<Outcome> {
  if (job.job_kind === "waitlist_available" && job.job_waitlist_entry_id) {
    return deliverWaitlistEmail(deps, job.job_waitlist_entry_id);
  }
  if (job.job_kind === "ticket_email" && job.job_order_id) return deliverTicketEmail(deps, job.job_order_id);
  return Promise.resolve({ sent: false, error: "unknown job", permanent: true });
}

async function runJob(deps: Deps, job: ClaimedJob, summary: DrainSummary, random: () => number) {
  const outcome = await deliver(deps, job);
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

  if (outcome.sent) return;
  if (job.job_kind === "waitlist_available") {
    // The job id only: never the address or the entry.
    const message = `Waitlist email job ${job.job_id} attempt ${job.job_attempts}`;
    if (outcome.skipped) console.info(`${message} not sent: ${outcome.error}.`);
    else console.error(`${message} ${result === "failed" ? "failed for good" : "failed, will retry"}: ${outcome.error}`);
    return;
  }
  // The job id and the order's short reference only: never the address or the order id.
  console.error(
    `Ticket email job ${job.job_id} (order ${job.job_order_id ? orderReference(job.job_order_id) : "unknown"}) attempt ${job.job_attempts} ` +
      `${result === "failed" ? "failed for good" : "failed, will retry"}: ${outcome.error}`,
  );
}

/**
 * Leases due jobs and sends them, until none are due, `maxJobs` have been
 * taken or `budgetMs` has passed. With `orderId`, only that order's job (the
 * attempt straight after payment); with `kind`, only jobs of that kind.
 * Safe to run concurrently with itself.
 */
export async function drainEmailOutbox(
  deps: Deps,
  options: { orderId?: string; kind?: EmailJobKind; maxJobs?: number; budgetMs?: number; random?: () => number } = {},
): Promise<DrainSummary> {
  const { orderId, kind, maxJobs = 100, budgetMs = DRAIN_BUDGET_MS, random = Math.random } = options;
  const deadline = Date.now() + budgetMs;
  const summary: DrainSummary = { claimed: 0, sent: 0, retrying: 0, failed: 0 };
  while (summary.claimed < maxJobs && Date.now() < deadline) {
    const jobs = await deps.db.query<ClaimedJob>(
      `select * from private.claim_outbox_jobs($1, $2::interval, $3, $4, $5)`,
      [Math.min(CLAIM_BATCH, maxJobs - summary.claimed), EMAIL_LEASE, MAX_EMAIL_ATTEMPTS, orderId ?? null, kind ?? null],
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

/**
 * Waitlist emails sent straight after a response that may have freed tickets
 * (a refund, an admin's edit, an approval). private.notify_waitlist queues
 * at most 100 per event in 12 hours; whatever this run doesn't send within
 * DRAIN_BUDGET_MS waits for the cron route.
 */
export const WAITLIST_DRAIN_MAX_JOBS = 100;

/** Queues a run over due waitlist emails (any event) for straight after the response. Cheap when there are none. */
export function sendWaitlistEmailsSoon(deps: Deps): void {
  deps.defer(async () => {
    await drainEmailOutbox(deps, { kind: "waitlist_available", maxJobs: WAITLIST_DRAIN_MAX_JOBS });
  });
}
