import { requireAdmin, requireCaller } from "../auth";
import { createdPrivate, HttpError, okPrivate, readJson } from "../http";
import { parseReport, parseResolveReport } from "../message-input";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { ADMIN_REPORT_SELECT, toAdminReport } from "../records";
import type { Handler } from "../route";
import type { ReportReceipt, ReportStatus } from "../types";

/**
 * Member reports (docs/architecture.md, "Messages"). A report keeps copies of
 * the reported message, the conversation leading up to it and the reported
 * member's display name, so it survives the messages and either account.
 * Admins review them here and can suspend the reported member in the same
 * step (private.social_suspensions).
 */

/** Reports per member per window: plenty for real problems, too few to flood the queue. */
export const REPORT_RATE_LIMIT = { hits: 20, window: "24 hours" } as const;

const NOT_FOUND = "We couldn't find that conversation, message, member or profile.";
const REPORT_NOT_FOUND = "Report not found.";
const REPORT_STATUSES: ReportStatus[] = ["open", "actioned", "dismissed"];

/**
 * POST /api/reports {conversationId, messageId?} | {attendeeId} | {profileId},
 * {reason, details?}. Signed in is enough: reporting is never gated on
 * verification (a profileId is only ever shown to verified members, so it
 * needs one). A profile report copies the bio, Instagram handle and photo.
 */
export const createReport: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const input = parseReport(await readJson(req), NOT_FOUND);

  type ReportRow = { result: string; new_report_id: string | null; filed_at: string | Date | null };
  let row: ReportRow;
  if (input.profileId) {
    // Profile ids are only ever shown to verified members.
    if (!caller.emailVerified) throw new HttpError(404, NOT_FOUND);
    [row] = await db.query<ReportRow>(`select * from private.file_profile_report($1, $2, $3, $4, $5, $6::interval)`, [
      caller.userId,
      input.profileId,
      input.reason,
      input.details ?? null,
      REPORT_RATE_LIMIT.hits,
      REPORT_RATE_LIMIT.window,
    ]);
  } else {
    [row] = await db.query<ReportRow>(`select * from private.file_report($1, $2, $3, $4::bigint, $5, $6, $7, $8::interval)`, [
      caller.userId,
      input.conversationId ?? null,
      input.attendeeId ?? null,
      input.messageId ?? null,
      input.reason,
      input.details ?? null,
      REPORT_RATE_LIMIT.hits,
      REPORT_RATE_LIMIT.window,
    ]);
  }
  switch (row.result) {
    case "filed":
      break;
    case "not_found":
      throw new HttpError(404, NOT_FOUND);
    case "self":
      throw new HttpError(400, "You can't report yourself.");
    case "rate_limited":
      throw new HttpError(429, "You've sent a lot of reports today. Email support@sheltuh.com.au if it's urgent.");
    default:
      throw new Error(`Unexpected file_report result: ${row.result}`);
  }
  const receipt: ReportReceipt = {
    reportId: row.new_report_id as string,
    createdAt: new Date(row.filed_at as string | Date).toISOString(),
  };
  return createdPrivate(receipt);
};

/** GET /api/admin/reports?status=open&cursor — open ones oldest first; resolved ones most recently resolved first. */
export const adminListReports: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const status = (qs.get("status") ?? "open") as ReportStatus;
  if (!REPORT_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of: ${REPORT_STATUSES.join(", ")}`);
  }
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  const order = status === "open" ? "r.created_at, r.id" : "r.resolved_at desc, r.id";
  const rows = await db.query(`${ADMIN_REPORT_SELECT} where r.status = $1 order by ${order} limit $2 offset $3`, [
    status,
    limit + 1,
    offset,
  ]);
  return okPrivate(toPage(rows.map(toAdminReport), offset, limit));
};

/**
 * POST /api/admin/reports/[reportId]/resolve {action: "dismiss" | "suspend", note?}.
 * Only an open report can be resolved (409 otherwise), so two admins can't
 * both act on one.
 */
export const adminResolveReport: Handler<{ reportId: string }> = async (
  req,
  { reportId },
  { db, verifyAccessToken },
) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  const input = parseResolveReport(await readJson(req));
  if (!isUuid(reportId)) throw new HttpError(404, REPORT_NOT_FOUND);

  const [{ result }] = await db.query<{ result: string }>(
    `select private.resolve_report($1, $2, $3, $4) as result`,
    [reportId, admin.userId, input.action, input.note ?? null],
  );
  if (result === "not_found") throw new HttpError(404, REPORT_NOT_FOUND);
  if (result === "not_open") throw new HttpError(409, "This report has already been resolved.");
  if (result !== "resolved") throw new Error(`Unexpected resolve_report result: ${result}`);

  const [row] = await db.query(`${ADMIN_REPORT_SELECT} where r.id = $1`, [reportId]);
  return okPrivate(toAdminReport(row));
};

/**
 * GET /api/admin/reports/[reportId]/avatar — admin: the copy of the photo a
 * profile report took (it outlives the member's photo). Never cached.
 */
export const adminGetReportAvatar: Handler<{ reportId: string }> = async (req, { reportId }, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  if (!isUuid(reportId)) throw new HttpError(404, REPORT_NOT_FOUND);
  const [row] = await db.query<{ data: Uint8Array }>(
    `select r.reported_avatar as data from private.user_reports r where r.id = $1 and r.reported_avatar is not null`,
    [reportId],
  );
  if (!row) throw new HttpError(404, "No photo on this report.");
  return new Response(new Uint8Array(row.data), {
    headers: {
      "content-type": "image/webp",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "cross-origin-resource-policy": "same-origin",
    },
  });
};
