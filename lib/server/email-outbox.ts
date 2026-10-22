import { createHash, randomBytes } from "node:crypto";
import type { EmailOutboxKind } from "@/lib/api/types";
import type { Deps } from "./deps";
import { redactForLog } from "./email-address";
import { buildFollowerNewEventsEmail, FOLLOWER_EMAIL_MAX_EVENTS, followerUnsubscribeLink } from "./follower-email";
import { findEventById } from "./handlers/event-queries";
import { CHECKOUT_LIMITS } from "./checkout-attempts";
import { buildCheckoutSurgeAlertEmail, buildOpsAlertEmail } from "./ops-alert-email";
import { orderReference } from "./order-reference";
import { EVENT_SELECT, ORDER_SELECT, paymentExceptionDetails, toEvent, toOrder } from "./records";
import { buildTicketEmail } from "./ticket-email";
import { buildWaitlistAvailableEmail, waitlistEventLink, waitlistLeaveLink } from "./waitlist-email";

/**
 * The transactional email outbox (supabase/migrations/20261014000000_email_outbox.sql,
 * 20261024000000_waitlist.sql, 20261024000200_organiser_follows.sql,
 * 20261104000000_payment_reconciliation.sql). Four kinds of job:
 * - `ticket_email`: private.fulfil_order queues one when an order becomes paid.
 * - `waitlist_available`: private.notify_waitlist queues one per person told
 *   that tickets are available again (docs/architecture.md, "Waitlist").
 * - `organiser_new_events`: private.notify_followers queues one per follower
 *   (with notifications on) when an organiser they follow publishes a new
 *   event, at most one a day each (docs/architecture.md, "Following organisers").
 * - `ops_alert`: private.raise_payment_exception queues one when a payment
 *   exception is opened or reopened (at most 20 a day), and
 *   private.queue_checkout_surge_alert one when an event's paid checkouts
 *   cross the alert-only circuit breaker (at most one per event per window,
 *   10 a day), sent to OPS_ALERT_EMAIL (docs/architecture.md, "Refunds made
 *   in Stripe", "Checkout idempotency").
 * This module delivers them: once straight after the response (Deps.defer)
 * and then from the cron route until it's sent or has failed 6 times. The
 * cron route is called by Vercel Cron (daily on Hobby, every 5 minutes on
 * Pro) and, on Hobby, by Supabase Cron every 5 minutes once the owner has
 * scheduled it (docs/supabase-setup.md §3).
 * Delivery is at-least-once: a worker that dies between SMTP accepting the
 * message and recording it leaves a lease that expires, and the job is sent
 * again. A mail failure never touches the order or the waitlist entry.
 */

export type EmailJobKind = EmailOutboxKind;

/**
 * Delays after the 1st … 5th failed attempt: 1 min, 5 min, 30 min, 2 h, 6 h.
 * A delay is the earliest the next attempt can run: the job is then sent by
 * the next run of the cron route. With a runner every 5 minutes (Supabase
 * Cron, or Vercel Cron on Pro), the 2nd attempt runs within about 6 minutes
 * of the first failure, the 3rd within about 17, and the 6th and last 7 to 11
 * hours after it. With only the daily Vercel Cron (Hobby), each retry waits
 * for the next daily run.
 */
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
  job_follow_id: string | null;
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

/**
 * Builds and sends one follower's "new from {organiser}" email: every event
 * the organiser announced since this follower's last email (or since they
 * followed) that's still published and upcoming. A fresh unsubscribe link
 * per email (its token's hash stored first). After a send, the follower's
 * `notified_through` moves to the newest announcement considered, so the
 * next email starts after it. Skipped, not retried, if they unfollowed or
 * turned notifications off, the organiser isn't approved any more, there's
 * no confirmed address, or none of the events is still on. Never throws.
 */
async function deliverFollowerEmail(deps: Deps, followId: string): Promise<Outcome> {
  try {
    const [follow] = await deps.db.query<{
      organiser_id: string;
      notify: boolean;
      since: string;
      email: string | null;
      email_confirmed: boolean;
      organiser_name: string;
      approved: boolean;
    }>(
      // Times as text, to the microsecond, so a boundary never moves: a JS Date
      // keeps milliseconds, and postgres.js sends a parameter the server types
      // as timestamptz through new Date(), hence `$n::text::timestamptz` below.
      `select f.organiser_id, f.notify_new_events as notify, coalesce(f.notified_through, f.created_at)::text as since,
              u.email, u.email_confirmed_at is not null as email_confirmed,
              o.display_name as organiser_name, o.status = 'approved' as approved
         from public.organiser_follows f
         join auth.users u on u.id = f.user_id
         join public.organisers o on o.id = f.organiser_id
        where f.id = $1`,
      [followId],
    );
    if (!follow) return skip("the follow no longer exists");
    if (!follow.notify) return skip("they turned these emails off");
    if (!follow.approved) return skip("the organiser isn't approved any more");
    if (!follow.email) return skip("the account has no email address");
    // Only to an address Supabase Auth has confirmed (private.notify_followers queues no others).
    if (!follow.email_confirmed) return skip("the account's email address isn't confirmed");

    const [window] = await deps.db.query<{ through: string | null }>(
      `select max(a.announced_at)::text as through from private.organiser_event_announcements a
        where a.organiser_id = $1 and a.announced_at > $2::text::timestamptz`,
      [follow.organiser_id, follow.since],
    );
    const rows = window.through
      ? await deps.db.query(
          `${EVENT_SELECT}
            where e.id in (select a.event_id from private.organiser_event_announcements a
                            where a.organiser_id = $1 and a.announced_at > $2::text::timestamptz
                              and a.announced_at <= $3::text::timestamptz)
              and e.status = 'published' and e.ends_at > now()
            order by e.starts_at, e.id`,
          [follow.organiser_id, follow.since, window.through],
        )
      : [];
    if (rows.length === 0) {
      if (window.through) {
        await deps.db.query(`update public.organiser_follows set notified_through = $2::text::timestamptz where id = $1`, [
          followId,
          window.through,
        ]);
      }
      return skip("none of the new events is still on");
    }
    const events = rows.map(toEvent);

    const token = randomBytes(32).toString("base64url");
    await deps.db.query(`insert into private.organiser_follow_tokens (token_hash, follow_id) values ($1, $2)`, [
      createHash("sha256").update(token, "utf8").digest("hex"),
      followId,
    ]);
    const siteUrl = deps.siteUrl();
    await deps.sendEmail(
      buildFollowerNewEventsEmail({
        to: follow.email,
        organiserName: follow.organiser_name,
        organiserId: follow.organiser_id,
        events: events.slice(0, FOLLOWER_EMAIL_MAX_EVENTS),
        total: events.length,
        siteUrl,
        unsubscribeLink: followerUnsubscribeLink(siteUrl, token),
      }),
    );
    // Only after the send: a failed attempt retries with the same events (and any newer).
    await deps.db.query(
      `update public.organiser_follows set notified_through = greatest(coalesce(notified_through, created_at), $2::text::timestamptz)
        where id = $1`,
      [followId, window.through],
    );
    return { sent: true };
  } catch (err) {
    return { sent: false, error: redactForLog(err instanceof Error ? err.message : "unknown error"), permanent: false };
  }
}

/**
 * Sends one ops alert about a checkout surge (an event's paid checkouts over
 * the alert-only circuit breaker): the event's title and id only.
 */
async function deliverCheckoutSurgeAlert(deps: Deps, to: string, jobId: string): Promise<Outcome> {
  const [row] = await deps.db.query<{ event_id: string; title: string; slug: string | null; created_at: string | Date }>(
    `select e.id as event_id, e.title, e.slug, j.created_at
       from private.email_outbox j
       join public.events e on e.id = j.ops_event_id
      where j.id = $1::bigint`,
    [jobId],
  );
  if (!row) return skip("the event no longer exists");
  await deps.sendEmail(
    buildCheckoutSurgeAlertEmail(
      to,
      {
        eventId: row.event_id,
        eventTitle: row.title,
        eventSlug: row.slug ?? undefined,
        threshold: CHECKOUT_LIMITS.perEventAlert,
        window: CHECKOUT_LIMITS.window,
        queuedAt: new Date(row.created_at),
      },
      deps.siteUrl(),
    ),
  );
  return { sent: true };
}

/**
 * Sends one ops alert to OPS_ALERT_EMAIL: about a payment exception (the
 * order's short reference, amounts, statuses and Stripe's event id only), or
 * about a checkout surge (deliverCheckoutSurgeAlert). Skipped (never
 * retried) when OPS_ALERT_EMAIL isn't set, logged loudly: a payment
 * exception is still listed for admins. Skipped too if the exception was
 * resolved (or deleted) before the alert went out. Never throws.
 */
async function deliverOpsAlert(deps: Deps, jobId: string): Promise<Outcome> {
  try {
    const to = deps.opsAlertEmail();
    if (!to) {
      console.error(
        `Ops alert job ${jobId} not emailed: OPS_ALERT_EMAIL isn't set. A payment exception or checkout surge may ` +
          "need a person: see GET /api/admin/payment-exceptions.",
      );
      return skip("OPS_ALERT_EMAIL isn't set");
    }
    const [job] = await deps.db.query<{ about_event: boolean }>(
      `select j.ops_event_id is not null as about_event from private.email_outbox j where j.id = $1::bigint`,
      [jobId],
    );
    if (job?.about_event) return await deliverCheckoutSurgeAlert(deps, to, jobId);
    const [row] = await deps.db.query<{
      kind: "refund_not_completed" | "partial_refund" | "manual_refund_required";
      status: string;
      order_id: string | null;
      order_status: string | null;
      details: unknown;
      stripe_event_id: string | null;
      opened_at: string | Date;
    }>(
      `select e.kind, e.status, e.order_id, o.status::text as order_status, e.details, e.stripe_event_id, e.opened_at
         from private.email_outbox j
         join private.payment_exceptions e on e.id = j.payment_exception_id
         left join public.orders o on o.id = e.order_id
        where j.id = $1::bigint`,
      [jobId],
    );
    if (!row) return skip("the payment exception no longer exists");
    if (row.status !== "open") return skip("the payment exception was resolved first");
    const details = paymentExceptionDetails(row.details);
    const orderStatus = row.order_status ?? details.orderStatus;
    await deps.sendEmail(
      buildOpsAlertEmail(
        to,
        {
          kind: row.kind,
          reference: row.order_id ? orderReference(row.order_id) : undefined,
          orderStatus: orderStatus ?? undefined,
          urgent: row.kind === "refund_not_completed" && orderStatus === "refunded",
          details,
          stripeEventId: row.stripe_event_id ?? undefined,
          openedAt: new Date(row.opened_at),
        },
        deps.siteUrl(),
      ),
    );
    return { sent: true };
  } catch (err) {
    return { sent: false, error: redactForLog(err instanceof Error ? err.message : "unknown error"), permanent: false };
  }
}

function deliver(deps: Deps, job: ClaimedJob): Promise<Outcome> {
  if (job.job_kind === "ops_alert") return deliverOpsAlert(deps, String(job.job_id));
  if (job.job_kind === "waitlist_available" && job.job_waitlist_entry_id) {
    return deliverWaitlistEmail(deps, job.job_waitlist_entry_id);
  }
  if (job.job_kind === "organiser_new_events" && job.job_follow_id) {
    return deliverFollowerEmail(deps, job.job_follow_id);
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
  if (job.job_kind === "waitlist_available" || job.job_kind === "organiser_new_events" || job.job_kind === "ops_alert") {
    // The job id only: never the address, the entry, the follow or the exception.
    const label =
      job.job_kind === "waitlist_available" ? "Waitlist" : job.job_kind === "ops_alert" ? "Ops alert" : "Follower";
    const message = `${label} email job ${job.job_id} attempt ${job.job_attempts}`;
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
 * With neither, ops alerts first (private.claim_email_outbox only claims
 * them when asked for that kind), then every other kind.
 * Safe to run concurrently with itself.
 */
export async function drainEmailOutbox(
  deps: Deps,
  options: { orderId?: string; kind?: EmailJobKind; maxJobs?: number; budgetMs?: number; random?: () => number } = {},
): Promise<DrainSummary> {
  const { orderId, kind, maxJobs = 100, budgetMs = DRAIN_BUDGET_MS, random = Math.random } = options;
  const deadline = Date.now() + budgetMs;
  const summary: DrainSummary = { claimed: 0, sent: 0, retrying: 0, failed: 0 };
  const phases: (EmailJobKind | null)[] = kind ? [kind] : orderId ? [null] : ["ops_alert", null];
  for (const phase of phases) {
    while (summary.claimed < maxJobs && Date.now() < deadline) {
      const jobs = await deps.db.query<ClaimedJob>(
        `select * from private.claim_email_outbox($1, $2::interval, $3, $4, $5)`,
        [Math.min(CLAIM_BATCH, maxJobs - summary.claimed), EMAIL_LEASE, MAX_EMAIL_ATTEMPTS, orderId ?? null, phase],
      );
      if (jobs.length === 0) break;
      summary.claimed += jobs.length;
      for (const job of jobs) await runJob(deps, job, summary, random);
    }
  }
  return summary;
}

/** Queues the first attempt at `orderId`'s ticket email for straight after the response. */
export function sendTicketEmailSoon(deps: Deps, orderId: string): void {
  deps.defer(async () => {
    await drainEmailOutbox(deps, { orderId, maxJobs: 1 });
  });
}

/** Ops alerts sent per run straight after a response (at most 20 are queued a day). */
export const OPS_ALERT_DRAIN_MAX_JOBS = 20;

/** Queues a run over due ops alerts for straight after the response. Cheap when there are none. */
export function sendOpsAlertsSoon(deps: Deps): void {
  deps.defer(async () => {
    await drainEmailOutbox(deps, { kind: "ops_alert", maxJobs: OPS_ALERT_DRAIN_MAX_JOBS });
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

/**
 * Follower emails queued by a publish (private.notify_followers), sent
 * straight after the response that published the event (an approval, an
 * admin's create or edit). Up to 500 a day are queued platform-wide; whatever
 * this run doesn't send within DRAIN_BUDGET_MS, and emails scheduled for later
 * (one a day per follower per organiser), wait for the cron route.
 */
export const FOLLOWER_DRAIN_MAX_JOBS = 100;

/** Queues a run over due follower emails (any organiser) for straight after the response. Cheap when there are none. */
export function sendFollowerEmailsSoon(deps: Deps): void {
  deps.defer(async () => {
    await drainEmailOutbox(deps, { kind: "organiser_new_events", maxJobs: FOLLOWER_DRAIN_MAX_JOBS });
  });
}

/**
 * After a publish (or an admin's edit that may publish or free tickets): the
 * waitlist's emails, then the followers', in one run sharing one
 * DRAIN_BUDGET_MS, so the route's maxDuration (60 s) still covers both.
 */
export function sendPublishEmailsSoon(deps: Deps): void {
  deps.defer(async () => {
    const deadline = Date.now() + DRAIN_BUDGET_MS;
    await drainEmailOutbox(deps, { kind: "waitlist_available", maxJobs: WAITLIST_DRAIN_MAX_JOBS });
    const left = deadline - Date.now();
    if (left > 0) {
      await drainEmailOutbox(deps, { kind: "organiser_new_events", maxJobs: FOLLOWER_DRAIN_MAX_JOBS, budgetMs: left });
    }
  });
}
