import { PAYMENT_EXCEPTION_STATUSES, type PaymentExceptionStatus } from "@/lib/api/types";
import { requireAdmin } from "../auth";
import { HttpError, okPrivate, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { ADMIN_PAYMENT_EXCEPTION_SELECT, toAdminPaymentException } from "../records";
import type { Handler } from "../route";
import { fail } from "../validation";

/**
 * Payment exceptions (docs/architecture.md, "Refunds made in Stripe"):
 * refunds that didn't complete, partial refunds and refunds that couldn't be
 * requested, for an admin to act on in the Stripe dashboard and then resolve
 * with a note. Nothing here changes an order, restores a ticket or calls
 * Stripe. Every response is `private, no-store`.
 */

const NOT_FOUND = "Payment exception not found.";
/** Notes are kept for 2 years after resolution (private.purge_operational_data). */
export const RESOLUTION_NOTE_MAX_LENGTH = 500;

/**
 * GET /api/admin/payment-exceptions?status=open&cursor&limit — open ones
 * (the default) oldest first; resolved ones most recently resolved first.
 */
export const adminListPaymentExceptions: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const status = (qs.get("status") ?? "open") as PaymentExceptionStatus;
  if (!PAYMENT_EXCEPTION_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of: ${PAYMENT_EXCEPTION_STATUSES.join(", ")}`);
  }
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  // Each order matches a partial index (payment_exceptions_open_idx / _resolved_idx).
  const query =
    status === "open"
      ? `${ADMIN_PAYMENT_EXCEPTION_SELECT} where e.status = 'open' order by e.opened_at, e.id limit $1 offset $2`
      : `${ADMIN_PAYMENT_EXCEPTION_SELECT} where e.status = 'resolved' order by e.resolved_at desc, e.id limit $1 offset $2`;
  const rows = await db.query(query, [limit + 1, offset]);
  return okPrivate(toPage(rows.map(toAdminPaymentException), offset, limit));
};

/**
 * POST /api/admin/payment-exceptions/[exceptionId]/resolve {note} — closes an
 * open exception with what was done (1–500 characters). 400 note; 404
 * unknown; 409 already resolved (by another admin, or automatically).
 */
export const adminResolvePaymentException: Handler<{ exceptionId: string }> = async (
  req,
  { exceptionId },
  { db, verifyAccessToken },
) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  const body = await readJson(req);
  const errors: Record<string, string> = {};
  const note = parseMessageText(body.note, "note", errors, {
    allowLinks: true,
    label: "Notes",
    maxLength: RESOLUTION_NOTE_MAX_LENGTH,
  });
  if (Object.keys(errors).length > 0) fail(errors);
  if (!isUuid(exceptionId)) throw new HttpError(404, NOT_FOUND);

  const [{ result }] = await db.query<{ result: string }>(
    `select private.resolve_payment_exception($1, $2, $3) as result`,
    [exceptionId, admin.userId, note],
  );
  if (result === "not_found") throw new HttpError(404, NOT_FOUND);
  if (result === "not_open") throw new HttpError(409, "This payment exception has already been resolved.");
  if (result !== "resolved") throw new Error(`Unexpected resolve_payment_exception result: ${result}`);

  const [row] = await db.query(`${ADMIN_PAYMENT_EXCEPTION_SELECT} where e.id = $1`, [exceptionId]);
  return okPrivate(toAdminPaymentException(row));
};
