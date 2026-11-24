import {
  type AdminTicketTransfer,
  type ReceivedTicket,
  type TicketGroup,
  type TicketOffer,
  type TicketOfferErrorCode,
  type TicketSeat,
  type TicketTransferErrorCode,
} from "@/lib/api/types";
import { MAX_HELD_TICKETS_PER_EVENT, TICKET_TRANSFER_RULES } from "@/lib/ticket-transfer-rules";
import { ticketTransfersEnabled } from "@/lib/ticket-transfers-flag";
import { requireAdmin, requireVerifiedCaller } from "../auth";
import { orderKey } from "../client-key";
import { type KeyedLimit, rateLimitSecret, takeClientLimit, takeKeyedLimit } from "../client-limits";
import type { Deps } from "../deps";
import { isPlainEmailAddress, maskEmail } from "../email-address";
import { refuseUndeliverableEmail } from "../email-domain";
import { createdPrivate, HttpError, okPrivate, type RateWindow, readJson, tooManyRequests, windowSeconds } from "../http";
import { parseMessageText } from "../message-input";
import { parsePersonName } from "../order-input";
import { ORDER_ID_PATTERN, orderReference } from "../order-reference";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { eventPlaceOf } from "../records";
import type { Handler } from "../route";
import { generateTicketCode } from "../ticket-issuance";
import {
  hashTransferToken,
  orderControl,
  orderFacts,
  type OrderFacts,
  ticketTransferJobsSoon,
  TRANSFER_TOKEN_PATTERN,
  transferReference,
  type OrderControl,
} from "../ticket-transfers";
import type { CustomerOrder } from "../types";
import { fail } from "../validation";
import { optionalCaller } from "./free-orders";
import { lookupCustomerOrder, ORDER_NOT_FOUND, ticketPageOrder } from "./orders";

/**
 * Ticket transfers' routes ("Send ticket to a friend"; docs/architecture.md,
 * "Ticket transfers"; supabase/migrations/20261203000000_ticket_transfers.sql).
 *
 * Every answer is `private, no-store`. Bodies are read with a 2 KB cap.
 * Tokens, addresses and names are never logged: an order is named by its
 * reference and a transfer by its own (transferReference) only. The rules
 * (lib/ticket-transfer-rules.ts) and the limits below are passed to the
 * database, which enforces them.
 */

/** Request bodies here are a few short fields. */
const MAX_BODY_BYTES = 2048;

/**
 * The limits. Per client (keyed IP, private.take_client_rate_limit) and per
 * order (an HMAC of the order id) in the API, failing open, logged, without a
 * client IP or STRIPE_WEBHOOK_SECRET; per account, recipient address and
 * platform in the database (taken last, inside the function's transaction,
 * and rolled back with any refusal). The three caps are database parameters.
 */
export const TICKET_TRANSFER_LIMITS = {
  sendsPerClient: { bucket: "ticket_transfer_sends", hits: 20, window: "1 hour" },
  sendsPerOrder: { bucket: "ticket_transfer_sends:order", hits: 10, window: "1 day" },
  /** private.take_rate_limit(sender, 'ticket_transfer_sends'): signed-in senders only. */
  sendsPerAccount: { hits: 10, window: "1 day" },
  /** private.take_platform_rate_limit('ticket_transfer_to:' || the first 40 hex of email_recipient_hash(address): the bucket's 64-character limit), across all senders. */
  offersPerRecipient: { hits: 3, window: "1 day" },
  /** private.take_platform_rate_limit('ticket_transfer_offers_daily'): the shared Workspace SMTP quota. */
  offersPlatform: { hits: 300, window: "1 day" },
  /** Every view counts (a wrong token too): bounds guessing. */
  viewsPerClient: { bucket: "ticket_transfer_views", hits: 60, window: "1 hour" },
  acceptsPerClient: { bucket: "ticket_transfer_accepts", hits: 30, window: "1 hour" },
  /** private.take_rate_limit(account, 'ticket_transfer_accepts'). */
  acceptsPerAccount: { hits: 10, window: "1 hour" },
  declinesPerClient: { bucket: "ticket_transfer_declines", hits: 30, window: "1 hour" },
  cancelsPerClient: { bucket: "ticket_transfer_cancels", hits: 30, window: "1 hour" },
  /** private.take_rate_limit(admin, 'ticket_transfer_admin_cancels'). */
  adminCancels: { hits: 30, window: "1 hour" },
  /** Offers per ticket, any outcome. */
  maxOffersPerTicket: 5,
  /** Offers waiting to be accepted per signed-in sender. */
  maxPendingPerAccount: 20,
  /** Tickets an account holds by transfer, per event. */
  maxHeldPerAccountPerEvent: MAX_HELD_TICKETS_PER_EVENT,
} as const satisfies Record<string, KeyedLimit | { hits: number; window: RateWindow } | number>;

const OFFER_NOT_FOUND = "Ticket offer not found.";
/** One answer for every offer that can't be opened, so a link's history isn't revealed. */
export const OFFER_UNAVAILABLE = "This ticket offer has expired or was already used.";
const RECEIVED_NOT_FOUND = "Ticket not found.";
const BUSY = "That's a lot of tries in a short time. Try again later.";

/** The longest of the database's send limits' windows: a 429 never says to come back sooner than it lifts. */
const SEND_LIMIT_RETRY_SECONDS = Math.max(
  windowSeconds(TICKET_TRANSFER_LIMITS.sendsPerAccount.window),
  windowSeconds(TICKET_TRANSFER_LIMITS.offersPerRecipient.window),
  windowSeconds(TICKET_TRANSFER_LIMITS.offersPlatform.window),
);

function busy(limit: { window: RateWindow }): HttpError {
  return tooManyRequests(BUSY, windowSeconds(limit.window), undefined, { code: "rate_limited" });
}

/** One hit on the request's client's counter for `limit` (429 over it). */
async function takeClient(req: Request, deps: Deps, secret: string | undefined, limit: KeyedLimit, what: string) {
  if (!(await takeClientLimit(req, deps, secret, limit, what))) throw busy(limit);
}

function refusal(status: number, code: TicketTransferErrorCode | TicketOfferErrorCode, message: string, fieldErrors?: Record<string, string>) {
  return new HttpError(status, message, fieldErrors, { code });
}

/** A uuid route id, else 404 with no query. */
function requireUuid(id: string, message: string): void {
  if (!isUuid(id)) throw new HttpError(404, message);
}

/** The link token from a body, else the uniform 404 (no query). */
function requireToken(body: Record<string, unknown>): string {
  const token = body.token;
  if (typeof token !== "string" || !TRANSFER_TOKEN_PATTERN.test(token)) throw new HttpError(404, OFFER_UNAVAILABLE);
  return token;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

interface SendInput {
  ticket: number;
  name: string;
  email: string;
  senderName: string;
}

/** A send's body (TicketTransferInput; `ticket` only when `withTicket`): every field's problem at once, 400. */
function parseSendInput(body: Record<string, unknown>, withTicket: boolean): SendInput {
  const errors: Record<string, string> = {};
  const ticket = body.ticket;
  if (withTicket && !(typeof ticket === "number" && Number.isInteger(ticket) && ticket >= 1 && ticket <= 9999)) {
    errors.ticket = "Choose a ticket.";
  }
  const name = parsePersonName(body.name, "name", errors, "Enter their name.");
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!isPlainEmailAddress(email)) errors.email = "Enter a valid email";
  const senderName = parsePersonName(body.senderName, "senderName", errors, "Enter your name.");
  if (Object.keys(errors).length > 0) fail(errors);
  return { ticket: withTicket ? (ticket as number) : 0, name, email, senderName };
}

/** The rule and limit arguments every send passes after its own (create_ticket_transfer / create_holder_ticket_transfer). */
function sendRuleParams(): unknown[] {
  const L = TICKET_TRANSFER_LIMITS;
  const R = TICKET_TRANSFER_RULES;
  return [
    R.allowPaid,
    R.allowFree,
    R.cutoffBeforeStart,
    R.pendingFor,
    R.maxAcceptedPerTicket,
    L.maxOffersPerTicket,
    L.maxPendingPerAccount,
    L.sendsPerAccount.hits,
    L.sendsPerAccount.window,
    L.offersPerRecipient.hits,
    L.offersPerRecipient.window,
    L.offersPlatform.hits,
    L.offersPlatform.window,
  ];
}

/** sendRuleParams' placeholders, numbered from `first`, with their casts. */
function ruleParamSql(first: number): string {
  const casts = ["", "", "::interval", "::interval", "", "", "", "", "::interval", "", "::interval", "", "::interval"];
  return casts.map((cast, i) => `$${first + i}${cast}`).join(", ");
}

/** A send's result as its answer: the id for `created`, else the refusal thrown. */
function sendOutcome(result: string, transferId: string | null): string {
  switch (result) {
    case "created":
      return transferId as string;
    case "not_found":
      throw new HttpError(404, RECEIVED_NOT_FOUND);
    case "not_paid":
      throw refusal(409, "order_not_paid", "This order isn't paid, so its tickets can't be sent.");
    case "event_unlisted":
      throw refusal(409, "event_unlisted", "This event isn't listed any more, so its tickets can't be sent.");
    case "closed":
      throw refusal(
        409,
        "transfers_closed",
        `Tickets can't be sent from ${TICKET_TRANSFER_RULES.cutoffBeforeStart} before the event starts.`,
      );
    case "type_not_allowed":
      throw refusal(409, "ticket_type_not_transferable", "This ticket can't be sent.");
    case "checked_in":
      throw refusal(409, "ticket_checked_in", "This ticket has been checked in, so it can't be sent.");
    case "pending":
      throw refusal(409, "transfer_pending", "This ticket is already waiting for someone to accept it. Cancel that first.");
    case "already_sent":
      throw refusal(409, "ticket_already_sent", "This ticket has already been sent.");
    case "own_email":
      throw refusal(409, "own_email", "That's your own email", { email: "That's your own email" });
    case "attempts_used":
      throw refusal(409, "transfer_attempts_used", "This ticket has been offered as many times as it can be.");
    case "pending_cap":
      throw refusal(409, "transfer_pending_cap", "You have a lot of tickets waiting to be accepted. Cancel one first.");
    case "rate_limited":
      throw tooManyRequests("You've sent a lot of tickets. Try again later.", SEND_LIMIT_RETRY_SECONDS, undefined, {
        code: "rate_limited",
      });
    default:
      throw new Error(`Unexpected ticket transfer send result: ${result}`);
  }
}

/** The order as the ticket page shows it to `req` (ticketPageOrder): every send's and cancel's answer. */
async function pageOrder(req: Request, deps: Deps, orderId: string, control: OrderControl): Promise<CustomerOrder> {
  const lookup = await lookupCustomerOrder(deps.db, orderId);
  if (lookup.status === "pending") throw new HttpError(404, ORDER_NOT_FOUND);
  return ticketPageOrder(req, deps, orderId, lookup, control);
}

/**
 * The 403 for a request without control of the order. It names the buying
 * address, masked, only where the order's link alone shows it (withOrderEmail,
 * ../order-email-view.ts: a settled order whose email has never been changed),
 * so this says nothing the ticket page doesn't.
 */
function ownerOnly(facts: OrderFacts, action: string): HttpError {
  const masked =
    facts.buyerEmail && !facts.emailChanged && facts.status !== "pending" ? ` (${maskEmail(facts.buyerEmail)})` : "";
  return refusal(403, "order_owner_only", `Sign in with the email you bought with${masked} to ${action}.`);
}

/** The order's facts, and how `req` controls it: 404 unknown order, 403 no control (`order_owner_only`, ownerOnly). */
async function requireOrderControl(
  req: Request,
  deps: Deps,
  orderId: string,
  action: string,
): Promise<{ control: OrderControl; facts: OrderFacts }> {
  const facts = await orderFacts(deps, orderId);
  if (!facts) throw new HttpError(404, ORDER_NOT_FOUND);
  const control = await orderControl(req, deps, orderId, facts);
  if (!control) throw ownerOnly(facts, action);
  return { control, facts };
}

/**
 * POST /api/orders/by-session/[sessionId]/ticket-transfers
 * `{ticket, name, email, senderName}` (TicketTransferInput) — the buyer sends
 * ticket number `ticket` of their order to `name` at `email`. In order: an id
 * that isn't shaped like an order's is a 404 (no query); sending off
 * (NEXT_PUBLIC_TICKET_TRANSFERS) is a 404; the client's allowance (429); the
 * body (400, every field); control of the order (orderControl: the paying
 * browser's `x-order-access` unless support has changed the order's email,
 * or the signed-in buyer; 404 unknown order, 403 `order_owner_only`
 * otherwise, naming the buying address masked only where the order's link
 * shows it); the
 * order's allowance (429); the address's typo list and DNS (400
 * `email_typo` / `email_no_mail`); then private.create_ticket_transfer, which
 * checks everything else under the order's and ticket's locks (409 with a
 * TicketTransferErrorCode, 429 `rate_limited`). 201 TicketTransferCreated:
 * the order as the ticket page shows it now. The offer email is sent by the
 * outbox (ticketTransferJobsSoon).
 */
export const sendTicket: Handler<{ sessionId: string }> = async (req, { sessionId }, deps) => {
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  if (!ticketTransfersEnabled()) throw new HttpError(404, "Not found.");
  const secret = rateLimitSecret(deps, "the ticket transfer rate limits were skipped");
  await takeClient(req, deps, secret, TICKET_TRANSFER_LIMITS.sendsPerClient, "A ticket send");
  const input = parseSendInput(await readJson(req, MAX_BODY_BYTES), true);
  const { control, facts } = await requireOrderControl(req, deps, sessionId, "send this ticket");
  if (secret && !(await takeKeyedLimit(deps.db, orderKey(sessionId, secret), TICKET_TRANSFER_LIMITS.sendsPerOrder))) {
    throw busy(TICKET_TRANSFER_LIMITS.sendsPerOrder);
  }
  await refuseUndeliverableEmail(req, deps, input.email, "email");

  const [row] = await deps.db.query<{ result: string; transfer_id: string | null }>(
    `select result, transfer_id::text as transfer_id
       from private.create_ticket_transfer($1, $2, $3::uuid, $4, $5, $6, $7, ${ruleParamSql(8)})`,
    [
      sessionId,
      input.ticket,
      control.kind === "account" ? control.userId : null,
      control.kind === "account" ? control.email : null,
      input.senderName,
      input.name,
      input.email,
      ...sendRuleParams(),
    ],
  );
  // The email changed between the check above and the order's lock.
  if (row.result === "owner_only") throw ownerOnly({ ...facts, emailChanged: true, changedBySupport: true }, "send this ticket");
  const transferId = sendOutcome(row.result, row.transfer_id);
  console.info(`Order ${orderReference(sessionId)}: ticket transfer ${transferReference(transferId)} offered.`);
  ticketTransferJobsSoon(deps);
  return createdPrivate({ transferId, order: await pageOrder(req, deps, sessionId, control) });
};

/**
 * POST /api/orders/by-session/[sessionId]/ticket-transfers/[transferId]/cancel
 * — the sender takes back an offer that hasn't been accepted. Shape checks
 * (404, no query), the client's allowance (429); with sending off, a 404
 * unless it's this order's offer still waiting (those stay cancellable);
 * control of the order (as sendTicket: 404 / 403), the rule (409
 * `cancel_not_allowed`), then private.cancel_ticket_transfer: 200
 * TicketTransferCancelled, 409 `transfer_not_pending` (accepted, declined,
 * expired or cancelled already), 404 not this order's.
 */
export const cancelTicketTransfer: Handler<{ sessionId: string; transferId: string }> = async (
  req,
  { sessionId, transferId },
  deps,
) => {
  if (!ORDER_ID_PATTERN.test(sessionId)) throw new HttpError(404, ORDER_NOT_FOUND);
  requireUuid(transferId, OFFER_NOT_FOUND);
  const secret = rateLimitSecret(deps, "the ticket transfer rate limits were skipped");
  await takeClient(req, deps, secret, TICKET_TRANSFER_LIMITS.cancelsPerClient, "A ticket offer cancel");
  // With sending off, only an offer still waiting can be taken back (so no one is stranded); anything else is
  // a 404 before the order is looked at.
  if (!ticketTransfersEnabled()) {
    const [open] = await deps.db.query(
      `select 1 from private.ticket_transfers x
        where x.id = $1 and x.order_id = $2 and x.sender_kind = 'buyer' and x.status = 'pending' and x.expires_at > now()`,
      [transferId, sessionId],
    );
    if (!open) throw new HttpError(404, OFFER_NOT_FOUND);
  }
  const { control, facts } = await requireOrderControl(req, deps, sessionId, "cancel this");
  if (!TICKET_TRANSFER_RULES.senderMayCancel) {
    throw refusal(409, "cancel_not_allowed", "Offers can't be cancelled.");
  }
  const [row] = await deps.db.query<{ result: string }>(
    `select result from private.cancel_ticket_transfer($1::uuid, $2, 'sender', null, null, $3::uuid, $4)`,
    [transferId, sessionId, control.kind === "account" ? control.userId : null, control.kind === "account" ? control.email : null],
  );
  if (row.result === "owner_only") throw ownerOnly({ ...facts, emailChanged: true, changedBySupport: true }, "cancel this");
  if (row.result === "not_found") throw new HttpError(404, OFFER_NOT_FOUND);
  if (row.result === "not_pending") {
    throw refusal(409, "transfer_not_pending", "This offer can't be cancelled now: it was accepted, declined or has expired.");
  }
  if (row.result !== "cancelled") throw new Error(`Unexpected cancel_ticket_transfer result: ${row.result}`);
  console.info(`Order ${orderReference(sessionId)}: ticket transfer ${transferReference(transferId)} cancelled by its sender.`);
  return okPrivate({ order: await pageOrder(req, deps, sessionId, control) });
};

// ---------------------------------------------------------------------------
// The recipient: view, accept, decline
// ---------------------------------------------------------------------------

/** A ticket's seat and its place in its group (`t` is public.tickets), for the recipient's views. */
const TICKET_DETAIL_COLUMNS = `
  t.ticket_type_name, t.group_size, t.checked_in_at,
  (select count(*)::int from public.tickets t2
    where t2.order_id = t.order_id and t2.ticket_type_id = t.ticket_type_id and t2.code < t.code) as type_index,
  s.section_label as seat_section, s.row_label as seat_row, s.seat_label, s.kind as seat_kind`;

/** The event's public details (`e`), and the title when the order was placed (`o`), for the recipient's views. */
const EVENT_DETAIL_COLUMNS = `
  e.status::text as event_status, e.ticketing_mode, coalesce(e.title, o.event_title) as event_title, e.slug as event_slug,
  e.starts_at as event_starts_at, e.ends_at as event_ends_at, e.venue_name as event_venue_name, e.suburb as event_suburb,
  e.state as event_state, e.time_zone as event_time_zone`;

type DetailRow = {
  ticket_type_name: string;
  group_size: number | null;
  checked_in_at: Date | string | null;
  type_index: number;
  seat_section: string | null;
  seat_row: string | null;
  seat_label: string | null;
  seat_kind: TicketSeat["kind"] | null;
  event_status: string;
  ticketing_mode: string;
  event_title: string;
  event_slug: string | null;
  event_starts_at: Date | string | null;
  event_ends_at: Date | string | null;
  event_venue_name: string | null;
  event_suburb: string | null;
  event_state: string | null;
  event_time_zone: string | null;
};

const iso = (value: Date | string) => new Date(value).toISOString();

/** The ticket's seat and group, as the ticket page numbers them (withGroupPositions: per type, by code). */
function ticketShape(row: DetailRow): { ticketTypeName: string; seat?: TicketSeat; group?: TicketGroup } {
  const size = row.group_size;
  return {
    ticketTypeName: row.ticket_type_name,
    ...(row.seat_section !== null && row.seat_label !== null
      ? { seat: { section: row.seat_section, row: row.seat_row ?? "", seat: row.seat_label, kind: row.seat_kind ?? "standard" } }
      : {}),
    ...(typeof size === "number" && size >= 2 ? { group: { position: (row.type_index % size) + 1, size } } : {}),
  };
}

/** The event's public details, only while it's published (as the ticket page: toCustomerOrder). */
function eventShape(row: DetailRow, show: boolean) {
  const listed = row.event_status === "published";
  const details = show && listed;
  return {
    eventTitle: row.event_title,
    eventListed: listed,
    ...(row.event_slug ? { eventSlug: row.event_slug } : {}),
    ...(details && row.event_starts_at ? { eventStartsAt: iso(row.event_starts_at), ...eventPlaceOf(row) } : {}),
    ...(details && row.event_ends_at ? { eventEndsAt: iso(row.event_ends_at) } : {}),
    ...(details && row.event_venue_name ? { venueName: row.event_venue_name } : {}),
    ...(details && row.event_suburb ? { suburb: row.event_suburb } : {}),
  };
}

/**
 * The offer behind a token's hash: tokens → transfers → tickets → orders →
 * events, each by primary key, and the seat. Never the order's id, its
 * buyer, its other tickets or any code.
 */
const OFFER_SELECT = `
  select x.id::text as id, x.status, x.expires_at, x.expires_at > now() as unexpired, x.accepted_user_id::text as accepted_user_id,
         x.sender_name, x.recipient_name, private.mask_email(x.recipient_email) as to_masked_email,
         o.status::text as order_status, ${TICKET_DETAIL_COLUMNS}, ${EVENT_DETAIL_COLUMNS}
    from private.ticket_transfer_tokens k
    join private.ticket_transfers x on x.id = k.transfer_id
    join public.tickets t on t.code = x.ticket_code
    join public.orders o on o.id = x.order_id
    join public.events e on e.id = x.event_id
    left join public.event_seats s on s.event_id = t.event_id and s.id = t.seat_id
   where k.token_hash = $1`;

/**
 * POST /api/ticket-transfers/view `{token}` — the accept page's offer
 * (TicketOffer), read-only (it writes nothing but the rate-limit counter),
 * and a POST so the token is never in a URL. The client's allowance (every
 * attempt counts: 429), then the token's shape (the uniform 404, no query).
 * 200 `open` for a pending offer that hasn't expired, of a paid order; 200
 * `accepted` with the transfer's id when the signed-in caller is the account
 * that accepted it; every other case (unknown, declined, cancelled, expired,
 * accepted by someone else, refunded) the same 404 OFFER_UNAVAILABLE, so the
 * link's history isn't revealed.
 */
export const viewTicketOffer: Handler = async (req, _params, deps) => {
  const secret = rateLimitSecret(deps, "the ticket transfer rate limits were skipped");
  await takeClient(req, deps, secret, TICKET_TRANSFER_LIMITS.viewsPerClient, "A ticket offer view");
  const token = requireToken(await readJson(req, MAX_BODY_BYTES));
  const [row] = await deps.db.query<
    DetailRow & {
      id: string;
      status: string;
      expires_at: Date | string;
      unexpired: boolean;
      accepted_user_id: string | null;
      sender_name: string;
      recipient_name: string;
      to_masked_email: string;
      order_status: string;
    }
  >(OFFER_SELECT, [hashTransferToken(token)]);
  if (!row) throw new HttpError(404, OFFER_UNAVAILABLE);
  if (row.status === "accepted") {
    const caller = await optionalCaller(req, deps);
    if (caller && row.accepted_user_id === caller.userId) {
      const accepted: TicketOffer = { status: "accepted", transferId: row.id };
      return okPrivate(accepted);
    }
    throw new HttpError(404, OFFER_UNAVAILABLE);
  }
  if (row.status !== "pending" || !row.unexpired || row.order_status !== "paid") throw new HttpError(404, OFFER_UNAVAILABLE);
  const offer: TicketOffer = {
    status: "open",
    fromName: row.sender_name,
    toName: row.recipient_name,
    toMaskedEmail: row.to_masked_email,
    expiresAt: iso(row.expires_at),
    ...eventShape(row, true),
    ...ticketShape(row),
  };
  return okPrivate(offer);
};

/**
 * POST /api/ticket-transfers/accept `{token, holderName}`
 * (TicketOfferAcceptInput) — any signed-in account with a verified email
 * accepts the offer (owner decision O1: the link is the capability; 401
 * signed out, 403 unverified, since the recipient's ticket email goes to the
 * account's address). The client's allowance (429), the token's shape (404),
 * the name (400 `fieldErrors.holderName`), then
 * private.accept_ticket_transfer with a fresh code (one retry on a clash):
 * 200 TicketOfferAccepted (also for the same account again); 404
 * OFFER_UNAVAILABLE; 409 `transfers_closed`, `ticket_unavailable`,
 * `own_ticket`, `received_cap`; 429 `rate_limited`.
 */
export const acceptTicketOffer: Handler = async (req, _params, deps) => {
  const caller = await requireVerifiedCaller(req, deps.verifyAccessToken);
  const secret = rateLimitSecret(deps, "the ticket transfer rate limits were skipped");
  await takeClient(req, deps, secret, TICKET_TRANSFER_LIMITS.acceptsPerClient, "A ticket offer accept");
  const body = await readJson(req, MAX_BODY_BYTES);
  const token = requireToken(body);
  const errors: Record<string, string> = {};
  const holderName = parsePersonName(body.holderName, "holderName", errors, "Enter your name.");
  if (Object.keys(errors).length > 0) fail(errors);

  let row: { result: string; transfer_id: string | null } | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    [row] = await deps.db.query<{ result: string; transfer_id: string | null }>(
      `select result, transfer_id::text as transfer_id
         from private.accept_ticket_transfer($1, $2::uuid, $3, $4, $5, $6::interval, $7, $8, $9::interval)`,
      [
        hashTransferToken(token),
        caller.userId,
        caller.email,
        holderName,
        generateTicketCode(),
        TICKET_TRANSFER_RULES.cutoffBeforeStart,
        TICKET_TRANSFER_LIMITS.maxHeldPerAccountPerEvent,
        TICKET_TRANSFER_LIMITS.acceptsPerAccount.hits,
        TICKET_TRANSFER_LIMITS.acceptsPerAccount.window,
      ],
    );
    if (row.result !== "code_taken") break;
  }
  switch (row?.result) {
    case "accepted":
      console.info(`Ticket transfer ${transferReference(row.transfer_id as string)} accepted.`);
      ticketTransferJobsSoon(deps);
      return okPrivate({ transferId: row.transfer_id });
    case "already_accepted":
      return okPrivate({ transferId: row.transfer_id });
    case "unavailable":
      throw new HttpError(404, OFFER_UNAVAILABLE);
    case "closed":
      throw refusal(409, "transfers_closed", `Tickets can't be accepted from ${TICKET_TRANSFER_RULES.cutoffBeforeStart} before the event starts.`);
    case "ticket_unavailable":
      throw refusal(409, "ticket_unavailable", "This ticket can't be accepted any more.");
    case "own_ticket":
      throw refusal(409, "own_ticket", "This is your own ticket. Send the link to the person it's for.");
    case "held_cap":
      throw refusal(409, "received_cap", "You've been sent as many tickets for this event as one account can hold.");
    case "rate_limited":
      throw tooManyRequests(BUSY, windowSeconds(TICKET_TRANSFER_LIMITS.acceptsPerAccount.window), undefined, {
        code: "rate_limited",
      });
    case "user_unavailable":
      throw new HttpError(401, "Sign in required.");
    default:
      // Two clashes running (a new code is 40 random bits): never expected.
      throw new Error(`Unexpected accept_ticket_transfer result: ${row?.result}`);
  }
};

/**
 * POST /api/ticket-transfers/decline `{token}` — no sign-in (owner decision
 * D6): the client's allowance (429), the token's shape (404), then
 * private.decline_ticket_transfer: 200 `{status: "declined"}`, else the
 * uniform 404. The sender's "declined" email is sent by the outbox.
 */
export const declineTicketOffer: Handler = async (req, _params, deps) => {
  const secret = rateLimitSecret(deps, "the ticket transfer rate limits were skipped");
  await takeClient(req, deps, secret, TICKET_TRANSFER_LIMITS.declinesPerClient, "A ticket offer decline");
  const token = requireToken(await readJson(req, MAX_BODY_BYTES));
  const [row] = await deps.db.query<{ result: string; transfer_id: string | null }>(
    `select result, transfer_id::text as transfer_id from private.decline_ticket_transfer($1)`,
    [hashTransferToken(token)],
  );
  if (row.result !== "declined") throw new HttpError(404, OFFER_UNAVAILABLE);
  console.info(`Ticket transfer ${transferReference(row.transfer_id as string)} declined.`);
  ticketTransferJobsSoon(deps);
  return okPrivate({ status: "declined" });
};

// ---------------------------------------------------------------------------
// The received ticket
// ---------------------------------------------------------------------------

/** A transfer the account accepted, with its ticket and event (never its order's id, buyer or other tickets). */
const RECEIVED_SELECT = `
  select x.id::text as id, x.sender_name, x.holder_name, x.decided_at, x.issued_code,
         x.superseded_at is null as current, o.status::text as order_status,
         ${TICKET_DETAIL_COLUMNS}, ${EVENT_DETAIL_COLUMNS}
    from private.ticket_transfers x
    join public.tickets t on t.code = x.ticket_code
    join public.orders o on o.id = x.order_id
    join public.events e on e.id = x.event_id
    left join public.event_seats s on s.event_id = t.event_id and s.id = t.seat_id
   where x.id = $1 and x.accepted_user_id = $2 and x.status = 'accepted'`;

/**
 * GET /api/me/received-tickets/[transferId] — a ticket the verified caller
 * accepted (ReceivedTicket): 401 / 403 / 404 (another account's, or none: the
 * same 404). The code (the transfer's issued_code) only while it's valid:
 * the order is paid and the ticket wasn't sent on. The event's details only
 * while it's published. Never the order's id or reference, the buyer's name
 * or email, amounts, or the order's other tickets. ticket_transfers_pkey.
 */
export const getReceivedTicket: Handler<{ transferId: string }> = async (req, { transferId }, deps) => {
  const caller = await requireVerifiedCaller(req, deps.verifyAccessToken);
  requireUuid(transferId, RECEIVED_NOT_FOUND);
  const [row] = await deps.db.query<
    DetailRow & {
      id: string;
      sender_name: string;
      holder_name: string;
      decided_at: Date | string;
      issued_code: string;
      current: boolean;
      order_status: string;
    }
  >(RECEIVED_SELECT, [transferId, caller.userId]);
  if (!row) throw new HttpError(404, RECEIVED_NOT_FOUND);
  const valid = row.order_status === "paid" && row.current;
  const received: ReceivedTicket = {
    transferId: row.id,
    reference: transferReference(row.id),
    fromName: row.sender_name,
    holderName: row.holder_name,
    acceptedAt: iso(row.decided_at),
    status: valid ? "valid" : "void",
    ...eventShape(row, valid),
    ...(valid
      ? {
          ticket: {
            ticketCode: row.issued_code,
            ...ticketShape(row),
            checkedInAt: row.checked_in_at ? iso(row.checked_in_at) : null,
          },
        }
      : {}),
    ...(TICKET_TRANSFER_RULES.recipientMayResend ? { canSend: valid && ticketTransfersEnabled() } : {}),
  };
  return okPrivate(received);
};

/**
 * POST /api/me/received-tickets/[transferId]/ticket-transfers
 * `{name, email, senderName}` — a recipient sends on a ticket they hold.
 * Refused (409 `resend_not_allowed`) while recipients may not re-send
 * (TICKET_TRANSFER_RULES.recipientMayResend, the owner's rule); otherwise as
 * sendTicket, by private.create_holder_ticket_transfer. 201 `{transferId}`.
 */
export const sendHeldTicket: Handler<{ transferId: string }> = async (req, { transferId }, deps) => {
  const caller = await requireVerifiedCaller(req, deps.verifyAccessToken);
  requireUuid(transferId, RECEIVED_NOT_FOUND);
  if (!TICKET_TRANSFER_RULES.recipientMayResend) {
    throw refusal(409, "resend_not_allowed", "A ticket you were sent can't be sent on.");
  }
  if (!ticketTransfersEnabled()) throw new HttpError(404, "Not found.");
  const secret = rateLimitSecret(deps, "the ticket transfer rate limits were skipped");
  await takeClient(req, deps, secret, TICKET_TRANSFER_LIMITS.sendsPerClient, "A ticket send");
  const input = parseSendInput(await readJson(req, MAX_BODY_BYTES), false);
  await refuseUndeliverableEmail(req, deps, input.email, "email");
  const [row] = await deps.db.query<{ result: string; transfer_id: string | null }>(
    `select result, transfer_id::text as transfer_id
       from private.create_holder_ticket_transfer($1::uuid, $2::uuid, $3, $4, $5, ${ruleParamSql(6)})`,
    [transferId, caller.userId, input.senderName, input.name, input.email, ...sendRuleParams()],
  );
  const created = sendOutcome(row.result, row.transfer_id);
  console.info(`Ticket transfer ${transferReference(created)} offered by its holder.`);
  ticketTransferJobsSoon(deps);
  return createdPrivate({ transferId: created });
};

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

/** An 8-hex reference: an order's (orderReference) or a transfer's (transferReference). */
const REFERENCE = /^#?([0-9a-f]{8})$/i;

const ADMIN_TICKET_TRANSFER_SELECT = `
  select x.id::text as id, x.order_id, o.event_title, x.status, x.created_at, x.expires_at, x.decided_at,
         x.sender_name, x.sender_kind, x.sender_user_id::text as sender_user_id, x.recipient_name,
         private.mask_email(x.recipient_email) as to_masked_email, x.holder_name,
         case when x.accepted_email is not null then private.mask_email(x.accepted_email) end as accepted_masked_email,
         x.accepted_user_id::text as accepted_user_id, x.superseded_at, x.cancelled_by, x.cancel_reason
    from private.ticket_transfers x
    join public.orders o on o.id = x.order_id`;

type AdminRow = {
  id: string;
  order_id: string;
  event_title: string;
  status: AdminTicketTransfer["status"];
  created_at: Date | string;
  expires_at: Date | string;
  decided_at: Date | string | null;
  sender_name: string;
  sender_kind: "buyer" | "holder";
  sender_user_id: string | null;
  recipient_name: string;
  to_masked_email: string;
  holder_name: string | null;
  accepted_masked_email: string | null;
  accepted_user_id: string | null;
  superseded_at: Date | string | null;
  cancelled_by: "sender" | "admin" | null;
  cancel_reason: string | null;
};

function toAdminTicketTransfer(row: AdminRow): AdminTicketTransfer {
  return {
    transferId: row.id,
    reference: transferReference(row.id),
    orderReference: orderReference(row.order_id),
    eventTitle: row.event_title,
    status: row.status,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    ...(row.decided_at ? { decidedAt: iso(row.decided_at) } : {}),
    senderName: row.sender_name,
    // A buyer whose account is deleted since reads as the paying browser (the account is gone).
    senderKind: row.sender_kind === "holder" ? "holder" : row.sender_user_id ? "account" : "paying_browser",
    ...(row.sender_user_id ? { senderUserId: row.sender_user_id } : {}),
    toName: row.recipient_name,
    toMaskedEmail: row.to_masked_email,
    ...(row.holder_name ? { holderName: row.holder_name } : {}),
    ...(row.accepted_masked_email ? { acceptedMaskedEmail: row.accepted_masked_email } : {}),
    ...(row.accepted_user_id ? { acceptedUserId: row.accepted_user_id } : {}),
    ...(row.superseded_at ? { supersededAt: iso(row.superseded_at) } : {}),
    ...(row.cancelled_by ? { cancelledBy: row.cancelled_by } : {}),
    ...(row.cancel_reason ? { cancelReason: row.cancel_reason } : {}),
  };
}

/**
 * GET /api/admin/ticket-transfers?reference=&cursor= — admins only. Newest
 * first (ticket_transfers_created_idx), pages of 20 (AdminTicketTransferPage,
 * offset cursors as the other admin lists). With `reference` (8 hex
 * characters, `#` optional): the offers of that order (by its reference) or
 * that transfer (by its own), a prefix match on the ids (fine at this size;
 * 400 for anything else). Addresses masked only.
 */
export const adminListTicketTransfers: Handler = async (req, _params, deps) => {
  await requireAdmin(req, deps.verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  const reference = qs.get("reference");
  let rows: AdminRow[];
  if (reference !== null) {
    const match = REFERENCE.exec(reference.trim());
    if (!match) throw new HttpError(400, "reference must be an 8-character order or transfer reference, like #7C1F2E0A.");
    const hex = match[1].toLowerCase();
    rows = await deps.db.query<AdminRow>(
      `${ADMIN_TICKET_TRANSFER_SELECT} where x.order_id like $1 or x.id::text like $2
        order by x.created_at desc, x.id desc limit $3 offset $4`,
      [`ord_${hex}%`, `${hex}%`, limit + 1, offset],
    );
  } else {
    rows = await deps.db.query<AdminRow>(
      `${ADMIN_TICKET_TRANSFER_SELECT} order by x.created_at desc, x.id desc limit $1 offset $2`,
      [limit + 1, offset],
    );
  }
  return okPrivate(toPage(rows.map(toAdminTicketTransfer), offset, limit));
};

/** An admin reason's length, in characters. */
const ADMIN_REASON = { min: 3, max: 500 } as const;
/** Anything shaped like an email address, full-width "＠" included (tested on the NFKC form), as an email change's reason. */
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

/**
 * POST /api/admin/ticket-transfers/[transferId]/cancel `{reason}` — support
 * cancels an offer that hasn't been accepted, with a reason (3 to 500
 * characters, no email address: 400 `fieldErrors.reason`) kept with it.
 * ADMIN limit: TICKET_TRANSFER_LIMITS.adminCancels (429). 200
 * `{result: "cancelled"}`, 409 `transfer_not_pending`, 404.
 */
export const adminCancelTicketTransfer: Handler<{ transferId: string }> = async (req, { transferId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  requireUuid(transferId, OFFER_NOT_FOUND);
  const body = await readJson(req, MAX_BODY_BYTES);
  const errors: Record<string, string> = {};
  const reason = parseMessageText(body.reason, "reason", errors, { allowLinks: true, label: "Reasons", maxLength: ADMIN_REASON.max });
  if (!errors.reason && Array.from(reason).length < ADMIN_REASON.min) {
    errors.reason = `Must be at least ${ADMIN_REASON.min} characters.`;
  } else if (!errors.reason && EMAIL_LIKE.test(reason.normalize("NFKC"))) {
    errors.reason = "Leave email addresses out of the reason.";
  }
  if (Object.keys(errors).length > 0) fail(errors);
  const limit = TICKET_TRANSFER_LIMITS.adminCancels;
  const [allowed] = await deps.db.query<{ ok: boolean }>(
    `select private.take_rate_limit($1::uuid, 'ticket_transfer_admin_cancels', $2, $3::interval) as ok`,
    [admin.userId, limit.hits, limit.window],
  );
  if (!allowed.ok) throw busy(limit);
  const [row] = await deps.db.query<{ result: string }>(
    `select result from private.cancel_ticket_transfer($1::uuid, null, 'admin', $2::uuid, $3, null, null)`,
    [transferId, admin.userId, reason],
  );
  if (row.result === "not_found") throw new HttpError(404, OFFER_NOT_FOUND);
  if (row.result === "not_pending") throw refusal(409, "transfer_not_pending", "Only an offer waiting to be accepted can be cancelled.");
  if (row.result !== "cancelled") throw new Error(`Unexpected cancel_ticket_transfer result: ${row.result}`);
  console.info(`Ticket transfer ${transferReference(transferId)} cancelled by an admin.`);
  return okPrivate({ result: "cancelled" });
};
