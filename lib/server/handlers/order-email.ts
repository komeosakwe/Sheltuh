import { SUPPORT_EMAIL } from "@/lib/contact";
import { requireAdmin } from "../auth";
import { orderKey } from "../client-key";
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
import type { CustomerOrder, OrderEmailChangeErrorCode, OrderEmailChangeResult } from "../types";
import { fail, requireEmail } from "../validation";
import { optionalCaller } from "./free-orders";
import { type KeyedLimit, lookupCustomerOrder, ORDER_NOT_FOUND, rateLimitSecret, takeClientLimit } from "./orders";

/**
 * Changing a paid order's email (docs/architecture.md, "Buyer email checks";
 * supabase/migrations/20261127000000_order_email_changes.sql): the paying
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

/** An admin's reason: what support confirmed with the buyer. */
export const ADMIN_EMAIL_CHANGE_REASON = { min: 3, max: 500 } as const;

/**
 * Anything shaped like an email address (something@something.something): the
 * reason is kept in full and shown to every admin, while the change log keeps
 * the addresses themselves only masked, so a reason may not carry one.
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

async function takeOrderLimit(deps: Deps, orderId: string, secret: string): Promise<boolean> {
  const limit = ORDER_EMAIL_CHANGE_LIMITS.perOrder;
  const [row] = await deps.db.query<{ allowed: boolean }>(
    `select private.take_client_rate_limit($1, $2, $3, $4::interval) as allowed`,
    [orderKey(orderId, secret), limit.bucket, limit.hits, limit.window],
  );
  return row.allowed;
}

/** One plain address from `body[field]` (400 `fieldErrors[field]` otherwise). */
function parseEmail(body: Record<string, unknown>, field: string): string {
  const errors: Record<string, string> = {};
  const email = requireEmail(body[field], field, errors);
  if (Object.keys(errors).length > 0) fail(errors);
  return email;
}

/** The order as the paying browser sees it (getOrderBySession with its token). */
async function paidOrderView(req: Request, deps: Deps, orderId: string): Promise<CustomerOrder> {
  const lookup = await lookupCustomerOrder(deps.db, orderId);
  // Never pending here: only a paid order's email can change.
  if (lookup.status === "pending") throw new HttpError(404, ORDER_NOT_FOUND);
  return withOrderEmail(req, deps, orderId, lookup);
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
 * goes to the new address straight after the answer (the old address is
 * sent nothing). Nothing about the order or either address is logged.
 */
export const changeOrderEmail: Handler<{ sessionId: string }> = async (req, { sessionId }, deps) => {
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  const secret = rateLimitSecret(deps, "the email change's rate limits were skipped");
  const perClient = ORDER_EMAIL_CHANGE_LIMITS.perClient;
  if (!(await takeClientLimit(req, deps, secret, perClient, "An order email change"))) {
    throw tooManyRequests(CHANGE_BUSY, windowSeconds(perClient.window), undefined, { code: "rate_limited" });
  }
  if (!hasOrderAccess(req, deps, sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  if (secret && !(await takeOrderLimit(deps, sessionId, secret))) {
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
 * for one with an email address in it: the log keeps addresses masked only).
 * 404 unknown job; 409
 * `order_not_card` / `order_not_paid` / `email_change_busy`; 429 over
 * ADMIN_EMAIL_CHANGE_LIMIT (only changes made count, in the same
 * transaction). The same address is a 200 with nothing changed.
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
  } else if (!errors.reason && EMAIL_LIKE.test(reason)) {
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
  const [job] = await deps.db.query(`${ADMIN_EMAIL_JOB_SELECT} where j.id = $1::bigint`, [jobId]);
  return okPrivate(toAdminEmailJob(job));
};
