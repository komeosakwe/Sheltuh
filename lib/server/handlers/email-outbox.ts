import { createHash, timingSafeEqual } from "node:crypto";
import { requireAdmin } from "../auth";
import { drainEmailOutbox, sendTicketEmailSoon } from "../email-outbox";
import { HttpError, okPrivate } from "../http";
import { decodeCursor, parseLimit, toPage } from "../pagination";
import { ADMIN_EMAIL_JOB_SELECT, toAdminEmailJob } from "../records";
import type { Handler } from "../route";
import { EMAIL_JOB_STATUSES, type EmailJobStatus } from "@/lib/api/types";

/**
 * The ticket-email outbox's routes (docs/architecture.md, "Payment flow"):
 * the cron that retries due jobs, and the admin list and manual resend.
 */

/** Manual resends per admin per hour. */
export const RESEND_RATE_LIMIT = { hits: 20, window: "1 hour" } as const;
/** A job can't be resent again within this, so a double click (or two admins) can't email the buyer twice. */
export const RESEND_MIN_INTERVAL = "5 minutes";

const JOB_NOT_FOUND = "Email not found.";
const JOB_ID = /^[1-9][0-9]{0,17}$/;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Compared in
 * constant time (as fixed-length digests, so the length doesn't leak either).
 * Without CRON_SECRET set, nothing gets in.
 */
function requireCronSecret(req: Request, secret: string | undefined): void {
  if (!secret) {
    console.error("CRON_SECRET isn't set: refusing a cron request.");
    throw new HttpError(401, "Unauthorized.");
  }
  const match = req.headers.get("authorization")?.match(/^Bearer (.+)$/);
  if (!match || !timingSafeEqual(sha256(match[1]), sha256(secret))) {
    throw new HttpError(401, "Unauthorized.");
  }
}

/**
 * GET /api/cron/email-outbox — Vercel Cron, every 5 minutes (vercel.json).
 * Sends every due ticket email (retries, and anything the after-response
 * attempt didn't finish). Returns counts only.
 */
export const runEmailOutboxCron: Handler = async (req, _params, deps) => {
  requireCronSecret(req, deps.cronSecret());
  return okPrivate(await drainEmailOutbox(deps));
};

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
