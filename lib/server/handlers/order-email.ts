import { SUPPORT_EMAIL } from "@/lib/contact";
import { ADMIN_EMAIL_CHANGE_REASON } from "@/lib/api/types";
import { requireAdmin } from "../auth";
import { orderKey } from "../client-key";
import { type KeyedLimit, rateLimitSecret, takeClientLimit, takeKeyedLimit } from "../client-limits";
import type { Deps } from "../deps";
import { refuseUndeliverableEmail } from "../email-domain";
import { sendTicketEmailSoon } from "../email-outbox";
import { HttpError, okPrivate, readJson, tooManyRequests, windowSeconds } from "../http";
import { parseMessageText } from "../message-input";
import { hasOrderAccess } from "../order-access";
import { emailChangeBlockReason, withOrderEmail } from "../order-email-view";
import { ORDER_ID_PATTERN, orderReference } from "../order-reference";
import { ADMIN_EMAIL_JOB_SELECT, toAdminEmailJob } from "../records";
import type { Handler } from "../route";
import type { AdminOrderEmailChangeResult, CustomerOrder, OrderEmailChangeErrorCode, OrderEmailChangeResult } from "../types";
import { fail, requireEmail } from "../validation";
import { optionalCaller } from "./free-orders";
import { lookupCustomerOrder, ORDER_NOT_FOUND, withWallet } from "./orders";

/**
 * Changing a paid order's email (docs/architecture.md, "Buyer email checks";
 * supabase/migrations/20261130000000_order_email_changes.sql): the paying
 * browser's one change, and support's.
 */

/**
 * The buyer's change, on private.take_client_rate_limit (no migration: new
 * bucket names), salted as the checkout limits:
 * - `perClient`: every well-formed request, before the token is checked, so
 *   it also bounds guessing. 10 an hour: a buyer needs one or two.
 * - `perOrder`: keyed on an HMAC of the order id (never the id), taken only
 *   once the token is right, so whoever holds the order's link (the ticket
 *   email) can't use up the buyer's attempts. 5 a day: with the account
 *   check's 409, this also bounds what one purchase can learn about which
 *   addresses have accounts.
 * Both fail open, logged, without STRIPE_WEBHOOK_SECRET (then no token can
 * be checked either, so every change is a 404); the per-client one also
 * without a client IP.
 */
export const ORDER_EMAIL_CHANGE_LIMITS = {
  perClient: { bucket: "order_email_change", hits: 10, window: "1 hour" },
  perOrder: { bucket: "order_email_change:order", hits: 5, window: "1 day" },
} as const satisfies Record<string, KeyedLimit>;

/** An admin's changes per hour (private.take_rate_limit, bucket 'order_email_changes'). */
export const ADMIN_EMAIL_CHANGE_LIMIT = { hits: 20, window: "1 hour" } as const;

/** An admin's reason: what support confirmed with the buyer (its length shared with the admin form). */
export { ADMIN_EMAIL_CHANGE_REASON };

/**
 * Anything shaped like an email address (something@something.something): the
 * reason is kept in full and shown to every admin, while the change log keeps
 * the addresses themselves only masked, so a reason may not carry one. Tested
 * against the reason's NFKC form, so a full-width "＠" or "．" counts too.
 */
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

const CHANGE_BUSY = "You've tried to change this email a lot. Try again later.";
const CONTACT_SUPPORT = `Contact ${SUPPORT_EMAIL} and we'll sort it out.`;

/** The 409 for each refusal: never says whether an address has an account (owner decision Q3). */
const REFUSALS: Record<OrderEmailChangeErrorCode, string> = {
  order_not_paid: `This order isn't paid, so its email can't be changed. ${CONTACT_SUPPORT}`,
  event_ended: `This event has ended, so the email can't be changed here. ${CONTACT_SUPPORT}`,
  ticket_scanned: `A ticket in this order has been scanned at the door, so the email can't be changed here. ${CONTACT_SUPPORT}`,
  email_already_changed: `This order's email has already been changed once. ${CONTACT_SUPPORT}`,
  // Says nothing about the change itself (who asked, or to what).
  changed_by_support: `Contact ${SUPPORT_EMAIL} to change this email again.`,
  email_has_account: `Contact ${SUPPORT_EMAIL} to use this address.`,
  email_change_busy: "Your tickets are being sent right now. Try again in a moment.",
};

function refusal(code: OrderEmailChangeErrorCode): HttpError {
  return new HttpError(
    409,
    REFUSALS[code],
    undefined,
    { code },
    code === "email_change_busy" ? { "retry-after": "2" } : undefined,
  );
}

/** One plain address from `body[field]` (400 `fieldErrors[field]` otherwise). */
function parseEmail(body: Record<string, unknown>, field: string): string {
  const errors: Record<string, string> = {};
  const email = requireEmail(body[field], field, errors);
  if (Object.keys(errors).length > 0) fail(errors);
  return email;
}

/** The order as the paying browser sees it: exactly getOrderBySession's answer with its token (wallet included). */
async function paidOrderView(req: Request, deps: Deps, orderId: string): Promise<CustomerOrder> {
  const lookup = await lookupCustomerOrder(deps.db, orderId);
  // Never pending here: only a paid order's email can change.
  if (lookup.status === "pending") throw new HttpError(404, ORDER_NOT_FOUND);
  return withWallet(deps, await withOrderEmail(req, deps, orderId, lookup));
}

/**
 * POST /api/orders/by-session/[sessionId]/email `{email}` — the paying
 * browser's one change of a paid card order's email (OrderEmailChangeResult).
 * In order: an id that isn't shaped like one is a 404 (no query); one hit on
 * the client's allowance (429); the order's token in `x-order-access`, else
 * 404, the same answer as an unknown order; one hit on the order's
 * allowance (429); the address: its format (400 `fieldErrors.email`), then
 * the typo list and DNS (400 `email_typo` / `email_no_mail`, with any
 * `suggestion`); then private.buyer_change_order_email, which re-checks
 * everything under the order's lock. A signed-in caller whose confirmed
 * email is the new address may move the order to it (owner decision Q1);
 * any other address with a confirmed account is a 409 `email_has_account`,
 * worded to say only "contact support". After a change, the ticket email
 * goes to the new address straight after the answer (nothing new goes to
 * the old address; one already with the mail provider can't be recalled:
 * stillToSend in lib/server/email-outbox.ts). Nothing about the order or
 * either address is logged.
 */
export const changeOrderEmail: Handler<{ sessionId: string }> = async (req, { sessionId }, deps) => {
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  const secret = rateLimitSecret(deps, "the email change's rate limits were skipped");
  const perClient = ORDER_EMAIL_CHANGE_LIMITS.perClient;
  if (!(await takeClientLimit(req, deps, secret, perClient, "An order email change"))) {
    throw tooManyRequests(CHANGE_BUSY, windowSeconds(perClient.window), undefined, { code: "rate_limited" });
  }
  if (!hasOrderAccess(req, deps, sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  if (secret && !(await takeKeyedLimit(deps.db, orderKey(sessionId, secret), ORDER_EMAIL_CHANGE_LIMITS.perOrder))) {
    throw tooManyRequests(CHANGE_BUSY, windowSeconds(ORDER_EMAIL_CHANGE_LIMITS.perOrder.window), undefined, { code: "rate_limited" });
  }

  const body = await readJson(req);
  const email = parseEmail(body, "email");
  await refuseUndeliverableEmail(req, deps, email, "email");

  // Their own confirmed account's address: the one account the database won't refuse it for.
  const caller = await optionalCaller(req, deps);
  const ownAccount =
    caller?.emailVerified === true && !!caller.email && caller.email.trim().toLowerCase() === email.toLowerCase()
      ? caller.userId
      : null;
  const [row] = await deps.db.query<{ result: string }>(`select private.buyer_change_order_email($1, $2, $3) as result`, [
    sessionId,
    email,
    ownAccount,
  ]);
  switch (row.result) {
    case "changed":
      // The ticket email was queued again in the same transaction; this is just the first try.
      sendTicketEmailSoon(deps, sessionId);
      console.info(`Order ${orderReference(sessionId)}: the buyer changed its email.`);
      break;
    case "unchanged":
      break;
    case "not_found":
    case "not_card_order":
      throw new HttpError(404, ORDER_NOT_FOUND);
    case "account_email":
      throw refusal("email_has_account");
    case "busy":
      throw refusal("email_change_busy");
    default: {
      const reason = emailChangeBlockReason(row.result);
      if (reason) throw refusal(reason);
      throw new Error(`Unexpected buyer_change_order_email result: ${row.result}`);
    }
  }
  const result: OrderEmailChangeResult = {
    result: row.result === "changed" ? "changed" : "unchanged",
    order: await paidOrderView(req, deps, sessionId),
  };
  return okPrivate(result);
};

const JOB_NOT_FOUND = "Email not found.";
const JOB_ID = /^[1-9][0-9]{0,17}$/;

/**
 * POST /api/admin/emails/[jobId]/change-email `{email, reason}` — support
 * moves a ticket email's order to another address and sends the tickets
 * there now (AdminChangeOrderEmailInput). Any time (after the event, after a
 * scan, after the buyer's own change) and to any address, an account's
 * included (owner decision Q2), but the address must pass its format and
 * DNS (the typo list is skipped: support has checked it with the buyer) and
 * the reason is required, and logged with the admin (400 `fieldErrors.reason`
 * for one with an email address in it, full-width "＠" included: the log
 * keeps addresses masked only). 200 AdminOrderEmailChangeResult: `changed`
 * or `unchanged` (the same address: nothing done), with the order's ticket
 * email job as it is now (read again by the order: a new job, with another id,
 * if the purge removed the old one meanwhile). 404 unknown job (also an
 * `unchanged` whose job has gone since); 409
 * `order_not_card` / `order_not_paid` / `email_change_busy`; 429 over
 * ADMIN_EMAIL_CHANGE_LIMIT (only changes made count, in the same
 * transaction).
 */
export const adminChangeOrderEmail: Handler<{ jobId: string }> = async (req, { jobId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  if (!JOB_ID.test(jobId)) throw new HttpError(404, JOB_NOT_FOUND);
  const body = await readJson(req);
  const errors: Record<string, string> = {};
  const email = requireEmail(body.email, "email", errors);
  const reason = parseMessageText(body.reason, "reason", errors, {
    allowLinks: true,
    label: "Reasons",
    maxLength: ADMIN_EMAIL_CHANGE_REASON.max,
  });
  if (!errors.reason && Array.from(reason).length < ADMIN_EMAIL_CHANGE_REASON.min) {
    errors.reason = `Must be at least ${ADMIN_EMAIL_CHANGE_REASON.min} characters.`;
  } else if (!errors.reason && EMAIL_LIKE.test(reason.normalize("NFKC"))) {
    errors.reason = "Leave email addresses out of the reason.";
  }
  if (Object.keys(errors).length > 0) fail(errors);
  await refuseUndeliverableEmail(req, deps, email, "email", { typoList: false });

  const [row] = await deps.db.query<{ result: string; order_id: string | null }>(
    `select * from private.admin_change_order_email($1, $2::bigint, $3, $4, $5, $6::interval)`,
    [admin.userId, jobId, email, reason, ADMIN_EMAIL_CHANGE_LIMIT.hits, ADMIN_EMAIL_CHANGE_LIMIT.window],
  );
  switch (row.result) {
    case "changed":
      sendTicketEmailSoon(deps, row.order_id as string);
      console.info(`Order ${orderReference(row.order_id as string)}: an admin changed its email.`);
      break;
    case "unchanged":
      break;
    case "not_found":
      throw new HttpError(404, JOB_NOT_FOUND);
    case "not_card_order":
      throw new HttpError(409, "This is a free booking: its email can't be changed.", undefined, { code: "order_not_card" });
    case "not_paid":
      throw new HttpError(409, "This order isn't paid (or was refunded): its email can't be changed.", undefined, {
        code: "order_not_paid",
      });
    case "busy":
      throw refusal("email_change_busy");
    case "rate_limited":
      throw tooManyRequests("That's a lot of email changes for one hour. Try again later.", windowSeconds(ADMIN_EMAIL_CHANGE_LIMIT.window));
    default:
      throw new Error(`Unexpected admin_change_order_email result: ${row.result}`);
  }
  // The order's ticket email as it is now, found by the order (one per order: email_outbox_order_kind_key), not by
  // `jobId`: the purge of sent jobs may have removed that one meanwhile, and the change then queued a new one.
  const [job] = await deps.db.query(`${ADMIN_EMAIL_JOB_SELECT} where j.order_id = $1 and j.kind = 'ticket_email'`, [
    row.order_id,
  ]);
  if (!job) {
    // Unchanged: nothing was done, and the email has gone since (purged): as an unknown job.
    if (row.result !== "changed") throw new HttpError(404, JOB_NOT_FOUND);
    // A change queues (or re-queues) it in its own transaction, and only sent jobs are purged: never expected.
    throw new Error("No ticket email job after an admin email change");
  }
  const result: AdminOrderEmailChangeResult = {
    result: row.result === "changed" ? "changed" : "unchanged",
    job: toAdminEmailJob(job),
  };
  return okPrivate(result);
};
