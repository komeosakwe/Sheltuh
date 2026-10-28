import { requireAdmin } from "../auth";
import { requireCronSecret } from "../cron-auth";
import { pgErrorCode } from "../db";
import type { Deps } from "../deps";
import { drainEmailOutbox, sendTicketEmailSoon } from "../email-outbox";
import { HttpError, okPrivate } from "../http";
import { decodeCursor, parseLimit, toPage } from "../pagination";
import { ADMIN_EMAIL_JOB_SELECT, toAdminEmailJob } from "../records";
import type { Handler } from "../route";
import {
  EMAIL_JOB_STATUSES,
  EMAIL_OUTBOX_KINDS,
  type EmailJobStatus,
  type EmailOutboxHealth,
  type EmailOutboxHealthCounts,
} from "@/lib/api/types";

/**
 * The ticket-email outbox's routes (docs/architecture.md, "Payment flow"):
 * the cron that retries due jobs, and the admin list, health and manual resend.
 */

/** Manual resends per admin per hour. */
export const RESEND_RATE_LIMIT = { hits: 20, window: "1 hour" } as const;
/** A job can't be resent again within this, so a double click (or two admins) can't email the buyer twice. */
export const RESEND_MIN_INTERVAL = "5 minutes";

const JOB_NOT_FOUND = "Email not found.";
const JOB_ID = /^[1-9][0-9]{0,17}$/;

/** Welcomes queued per cron run (private.queue_member_welcomes also holds a platform cap of 300 a day). */
export const MEMBER_WELCOMES_PER_RUN = 50;

/** Logged once per process while the database lacks private.queue_member_welcomes. */
let warnedNoWelcomeQueue = false;

/**
 * Queues the welcome for members who've confirmed their email since the last
 * run. Never fails or delays the run, whatever goes wrong: queueing welcomes
 * must not stop a ticket email going out. In a deploy window where this code
 * runs before 20261111000700_onboarding_emails.sql is applied the function
 * doesn't exist, which is warned about once; any other error (a timeout, an
 * account deleted while the function ran) is logged as a fixed message with
 * its SQLSTATE only (never a message, which could carry data), and the next
 * run tries again.
 */
async function queueMemberWelcomes(deps: Deps): Promise<void> {
  try {
    await deps.db.query(`select private.queue_member_welcomes($1)`, [MEMBER_WELCOMES_PER_RUN]);
    return;
  } catch (err) {
    const code = pgErrorCode(err);
    // undefined_function can also come from inside the function, so ask the catalogue.
    let missing = false;
    try {
      const [row] = await deps.db.query<{ missing: boolean }>(
        `select to_regprocedure('private.queue_member_welcomes(integer)') is null as missing`,
      );
      missing = row?.missing === true;
    } catch {
      // Treated as the general failure below.
    }
    if (missing) {
      if (!warnedNoWelcomeQueue) {
        warnedNoWelcomeQueue = true;
        console.warn(
          "Email outbox: private.queue_member_welcomes is missing (migration 20261111000700_onboarding_emails.sql isn't applied); no welcome emails are queued until it is.",
        );
      }
      return;
    }
    console.error(`Email outbox: queueing member welcomes failed (SQLSTATE ${code ?? "unknown"}); sending what is due.`);
  }
}

/**
 * GET /api/cron/email-outbox — sends every due job (retries, and anything
 * the after-response attempt didn't finish), then records the run for
 * GET /api/admin/emails/health. Returns counts only. Called by Vercel Cron
 * (vercel.json: daily on Hobby, every 5 minutes on Pro) and, on Hobby, by
 * Supabase Cron with pg_net every 5 minutes (docs/supabase-setup.md §3).
 *
 * Safe to call that often, and from two schedulers at once: a run leases one
 * job at a time with `skip locked` (two runs never send the same job), takes
 * at most 100 jobs and stops claiming after DRAIN_BUDGET_MS (30 s, inside the
 * route's 60-second maxDuration), and with nothing due it's one welcome
 * queueing call, five indexed claims (one per drain phase) and one upsert.
 */
export const runEmailOutboxCron: Handler = async (req, _params, deps) => {
  requireCronSecret(req, deps.cronSecret());
  await queueMemberWelcomes(deps);
  const summary = await drainEmailOutbox(deps);
  await deps.db.query(
    `insert into private.cron_runs (name, finished_at, claimed, sent, retrying, failed)
     values ('email_outbox', now(), $1, $2, $3, $4)
     on conflict (name) do update set finished_at = excluded.finished_at, claimed = excluded.claimed,
       sent = excluded.sent, retrying = excluded.retrying, failed = excluded.failed`,
    [summary.claimed, summary.sent, summary.retrying, summary.failed],
  );
  return okPrivate(summary);
};

/**
 * A due job that has waited this long hasn't been picked up by any run. With
 * a 5-minute runner, that's three missed runs; with only the daily Vercel
 * Cron, every retry shows as overdue until that day's run.
 */
export const EMAIL_OVERDUE_AFTER_MINUTES = 15;

interface HealthRow {
  kind: string;
  due: number;
  overdue: number;
  oldest_overdue_seconds: number | null;
  waiting: number;
  sending: number;
  expired_leases: number;
  failed: number;
  failed_last_7_days: number;
}

function toHealthCounts(row: HealthRow | undefined): EmailOutboxHealthCounts {
  const counts: EmailOutboxHealthCounts = {
    due: row?.due ?? 0,
    overdue: row?.overdue ?? 0,
    waiting: row?.waiting ?? 0,
    sending: row?.sending ?? 0,
    expiredLeases: row?.expired_leases ?? 0,
    failed: row?.failed ?? 0,
    failedLast7Days: row?.failed_last_7_days ?? 0,
  };
  if (row?.oldest_overdue_seconds != null) counts.oldestOverdueSeconds = row.oldest_overdue_seconds;
  return counts;
}

/**
 * GET /api/admin/emails/health — is the outbox being worked? Per kind and in
 * total: due, overdue (more than 15 minutes), the oldest overdue job's age,
 * waiting, being sent, expired leases and failed; plus when the cron route
 * last finished a run, and whether CRON_SECRET is set. Counts and times only.
 */
export const adminEmailOutboxHealth: Handler = async (req, _params, deps) => {
  await requireAdmin(req, deps.verifyAccessToken);
  const rows = await deps.db.query<HealthRow>(`select * from private.email_outbox_health($1::interval)`, [
    `${EMAIL_OVERDUE_AFTER_MINUTES} minutes`,
  ]);
  const [run] = await deps.db.query<{
    finished_at: string | Date;
    claimed: number;
    sent: number;
    retrying: number;
    failed: number;
    checked_at: string | Date;
  }>(
    `select r.finished_at, r.claimed, r.sent, r.retrying, r.failed, now() as checked_at
       from (select 1) one left join private.cron_runs r on r.name = 'email_outbox'`,
  );
  const byKind = EMAIL_OUTBOX_KINDS.map((kind) => ({ kind, ...toHealthCounts(rows.find((r) => r.kind === kind)) }));
  const totals = toHealthCounts({
    kind: "all",
    due: sum(rows, (r) => r.due),
    overdue: sum(rows, (r) => r.overdue),
    oldest_overdue_seconds: rows.reduce<number | null>(
      (max, r) => (r.oldest_overdue_seconds == null ? max : Math.max(max ?? 0, r.oldest_overdue_seconds)),
      null,
    ),
    waiting: sum(rows, (r) => r.waiting),
    sending: sum(rows, (r) => r.sending),
    expired_leases: sum(rows, (r) => r.expired_leases),
    failed: sum(rows, (r) => r.failed),
    failed_last_7_days: sum(rows, (r) => r.failed_last_7_days),
  });
  const body: EmailOutboxHealth = {
    checkedAt: new Date(run.checked_at).toISOString(),
    overdueAfterMinutes: EMAIL_OVERDUE_AFTER_MINUTES,
    cronSecretConfigured: Boolean(deps.cronSecret()),
    totals,
    byKind,
  };
  if (run.finished_at != null) {
    body.lastCronRun = {
      finishedAt: new Date(run.finished_at).toISOString(),
      claimed: run.claimed,
      sent: run.sent,
      retrying: run.retrying,
      failed: run.failed,
    };
  }
  return okPrivate(body);
};

function sum(rows: HealthRow[], pick: (row: HealthRow) => number): number {
  return rows.reduce((n, r) => n + pick(r), 0);
}

/** GET /api/admin/emails?status=failed&cursor — newest first. Default `failed`. */
export const adminListEmailJobs: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const status = (qs.get("status") ?? "failed") as EmailJobStatus;
  if (!EMAIL_JOB_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of: ${EMAIL_JOB_STATUSES.join(", ")}`);
  }
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  const rows = await db.query(
    `${ADMIN_EMAIL_JOB_SELECT} where j.status = $1 order by j.created_at desc, j.id desc limit $2 offset $3`,
    [status, limit + 1, offset],
  );
  return okPrivate(toPage(rows.map(toAdminEmailJob), offset, limit));
};

/**
 * POST /api/admin/emails/[jobId]/resend — sends the ticket email again, now,
 * with a fresh set of attempts. 404 unknown job; 409 while it's being sent;
 * 429 if it was resent in the last 5 minutes, or the admin is over 20 an hour
 * (only resends that were queued count towards that).
 */
export const adminResendEmailJob: Handler<{ jobId: string }> = async (req, { jobId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  if (!JOB_ID.test(jobId)) throw new HttpError(404, JOB_NOT_FOUND);

  // Only a resend that's actually queued uses the admin's allowance (one transaction).
  const [row] = await deps.db.query<{ result: string; order_id: string | null }>(
    `select * from private.admin_resend_email_job($1, $2::bigint, $3::interval, $4, $5::interval)`,
    [admin.userId, jobId, RESEND_MIN_INTERVAL, RESEND_RATE_LIMIT.hits, RESEND_RATE_LIMIT.window],
  );
  switch (row.result) {
    case "queued":
      break;
    case "rate_limited":
      throw new HttpError(429, "That's a lot of resends for one hour. Try again later.");
    case "not_found":
      throw new HttpError(404, JOB_NOT_FOUND);
    case "in_progress":
      throw new HttpError(409, "That email is being sent right now.");
    case "too_soon":
      throw new HttpError(429, "That email was resent in the last few minutes. Give it a moment to arrive.");
    default:
      throw new Error(`Unexpected resend_email_job result: ${row.result}`);
  }
  sendTicketEmailSoon(deps, row.order_id as string);
  const [job] = await deps.db.query(`${ADMIN_EMAIL_JOB_SELECT} where j.id = $1::bigint`, [jobId]);
  return okPrivate(toAdminEmailJob(job));
};
