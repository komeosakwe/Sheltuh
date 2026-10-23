import { createHash, randomBytes } from "node:crypto";
import { MAX_FREE_TICKETS_PER_ORDER } from "@/lib/api/types";
import type { Caller } from "../auth";
import { pgConstraint, pgErrorCode, PG_UNIQUE_VIOLATION } from "../db";
import type { Deps } from "../deps";
import type { EmailMessage } from "../email";
import { redactForLog } from "../email-address";
import { sendTicketEmailSoon } from "../email-outbox";
import { buildFreeConfirmationEmail, freeOrderConfirmLink } from "../free-confirmation-email";
import { HttpError, PRIVATE_NO_STORE, readJson } from "../http";
import { orderReference } from "../order-reference";
import type { Handler } from "../route";
import { issueTickets } from "../ticket-issuance";
import type { CheckoutResult, EventRecord, IssuedTicket, OrderLineItem, SeatErrorDetails, TicketSeat } from "../types";
import { fail } from "../validation";
import { EVENT_ENDED } from "./event-queries";

/**
 * Free tickets (docs/architecture.md, "Free tickets"). A signed-in member
 * booking with their own verified email gets them straight away; anyone
 * else confirms by an emailed link first. See
 * supabase/migrations/20261014000100_free_order_protection.sql.
 */
export const FREE_LIMITS = {
  perOrder: MAX_FREE_TICKETS_PER_ORDER,
  perPersonPerEvent: 4,
  memberDaily: { hits: 10, window: "24 hours" },
  addressHourly: { hits: 3, window: "1 hour" },
  /**
   * Guest confirmation emails, platform-wide. They share the Workspace SMTP
   * quota (about 2,000 a day) with ticket emails, so these keep most of it for
   * those (docs/architecture.md, "Accepted risks (free tickets)"). Change the
   * daily one together with the delegating request_free_order in
   * supabase/migrations/20261017000000_free_order_caps.sql.
   */
  platformHourly: { hits: 60, window: "1 hour" },
  platformDaily: { hits: 400, window: "24 hours" },
  confirmHours: 24,
} as const;

/** 32 random bytes, base64url: 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

function successUrl(deps: Deps, orderId: string) {
  return `${deps.siteUrl()}/checkout/success?session_id=${orderId}`;
}

/**
 * Runs a fulfilment with freshly issued ticket codes, once more with new
 * ones if a code clashed with an existing ticket (40 random bits: rare, but
 * a clash would otherwise fail the whole order).
 */
export async function withTicketCodes<T>(lineItems: OrderLineItem[], fulfil: (tickets: IssuedTicket[]) => Promise<T>) {
  try {
    return await fulfil(issueTickets(lineItems));
  } catch (err) {
    if (pgErrorCode(err) !== PG_UNIQUE_VIOLATION || pgConstraint(err) !== "tickets_pkey") throw err;
    return fulfil(issueTickets(lineItems));
  }
}

async function recordRefusal(deps: Deps, reason: string) {
  await deps.db.query(`select private.record_free_order_refusal($1)`, [reason]);
}

/** The caller, if the request carries a valid token; a bad or missing one just means "guest". */
export async function optionalCaller(req: Request, deps: Deps): Promise<Caller | null> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return token ? deps.verifyAccessToken(token) : null;
}

export const FREE_PER_ORDER_LIMIT = `You can book up to ${FREE_LIMITS.perOrder} free tickets at a time.`;

/**
 * At most FREE_LIMITS.perOrder free (A$0) tickets in any order, paid or free:
 * 400 with fieldErrors.lineItems otherwise. Paid orders are bound by their
 * Stripe payment, so this is their only free-ticket limit; the per-person
 * allowance and the emailed confirmation are for wholly free orders.
 */
export async function assertFreeTicketsPerOrder(deps: Deps, lineItems: OrderLineItem[]): Promise<void> {
  const free = lineItems.reduce((n, l) => (l.unitPriceCents === 0 ? n + l.quantity : n), 0);
  if (free > FREE_LIMITS.perOrder) {
    await recordRefusal(deps, "order_too_large");
    fail({ lineItems: FREE_PER_ORDER_LIMIT });
  }
}

const SOLD_OUT = "Those tickets just ran out.";
const LINK_NOT_FOUND = "This link isn't valid. Check it's the whole link from your email.";
const PERSON_LIMIT = `You can have up to ${FREE_LIMITS.perPersonPerEvent} free tickets for this event, and this email address already has them.`;

interface FreeOrderInput {
  event: EventRecord;
  lineItems: OrderLineItem[];
  buyerEmail: string;
  trackingCode: string | null;
  /** A seated order's seats (reserved seating): taken at once for a member, at confirmation for a guest. */
  seats?: { seatIds: string[]; labels: TicketSeat[] };
}

/** The seats of a free seated order went to someone else (409; the body names them, SeatErrorDetails). */
const SEATS_GONE = "Some of your seats were booked by someone else just now. Choose other seats.";
const SEATS_GONE_AT_CONFIRM = "Some of your seats were booked by someone else before you confirmed. Nothing was booked.";

/**
 * The free branch of POST /api/events/[eventId]/checkout, after the line
 * items (including assertFreeTicketsPerOrder), the email and availability
 * have been checked.
 */
export async function createFreeOrder(req: Request, deps: Deps, input: FreeOrderInput): Promise<Response> {
  const { event, lineItems, buyerEmail, trackingCode, seats } = input;
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
  const caller = await optionalCaller(req, deps);
  const isOwnVerifiedEmail =
    caller?.emailVerified === true && !!caller.email && caller.email.trim().toLowerCase() === buyerEmail.toLowerCase();

  if (caller && isOwnVerifiedEmail) {
    const result = await withTicketCodes(lineItems, async (tickets) => {
      const [row] = await deps.db.query<{ result: string }>(
        seats
          ? `select private.place_free_seated_order($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9::text::jsonb, $10, $11,
               $12::interval, $13::text[]) as result`
          : `select private.place_free_order($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9::text::jsonb, $10, $11, $12::interval) as result`,
        [
          orderId,
          event.eventId,
          event.organiserId,
          event.title,
          JSON.stringify(lineItems),
          buyerEmail,
          trackingCode,
          caller.userId,
          JSON.stringify(tickets),
          FREE_LIMITS.perPersonPerEvent,
          FREE_LIMITS.memberDaily.hits,
          FREE_LIMITS.memberDaily.window,
          ...(seats ? [seats.seatIds] : []),
        ],
      );
      return row.result;
    });
    switch (result) {
      case "paid":
        sendTicketEmailSoon(deps, orderId);
        return Response.json({ url: successUrl(deps, orderId) } satisfies CheckoutResult, { status: 201, headers: PRIVATE_NO_STORE });
      case "person_event_limit":
        throw new HttpError(409, PERSON_LIMIT);
      case "member_daily_limit":
        throw new HttpError(429, "You've booked a lot of free tickets today. Try again tomorrow.");
      case "sold_out":
        throw new HttpError(409, SOLD_OUT);
      case "seats_unavailable":
        throw new HttpError(409, SEATS_GONE, { seats: SEATS_GONE }, {
          code: "seats_unavailable",
          seatIds: seats?.seatIds,
        } satisfies SeatErrorDetails);
      default:
        throw new Error(`Unexpected place_free_order result: ${result}`);
    }
  }

  const token = randomBytes(32).toString("base64url");
  const [{ result }] = await deps.db.query<{ result: string }>(
    seats
      ? `select private.request_free_seated_order($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9::interval, $10, $11::interval,
           $12, $13::interval, $14, $15::interval, $16::text[]) as result`
      : `select private.request_free_order($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9::interval, $10, $11::interval,
           $12, $13::interval, $14, $15::interval) as result`,
    [
      orderId,
      event.eventId,
      event.organiserId,
      event.title,
      JSON.stringify(lineItems),
      buyerEmail,
      trackingCode,
      hashToken(token),
      `${FREE_LIMITS.confirmHours} hours`,
      FREE_LIMITS.addressHourly.hits,
      FREE_LIMITS.addressHourly.window,
      FREE_LIMITS.platformHourly.hits,
      FREE_LIMITS.platformHourly.window,
      FREE_LIMITS.platformDaily.hits,
      FREE_LIMITS.platformDaily.window,
      ...(seats ? [seats.seatIds] : []),
    ],
  );
  const sent: CheckoutResult = { status: "confirmation_sent", expiresInHours: FREE_LIMITS.confirmHours };
  switch (result) {
    case "requested":
      break;
    // The same answer as a sent link: whether an address has had links
    // recently is nobody else's business. Its owner already has 3 in their inbox.
    case "address_limited":
      return Response.json(sent, { status: 202, headers: PRIVATE_NO_STORE });
    case "platform_limited":
    case "platform_daily_limited":
      throw new HttpError(503, "Free bookings are busy right now. Try again in a few minutes.");
    default:
      throw new Error(`Unexpected request_free_order result: ${result}`);
  }

  // Sent after the response, so a real link's 202 takes as long as an address-limited one (no SMTP round
  // trip to time). Nobody can confirm a link that never arrived: a failed send drops the order (it holds nothing).
  const message = buildFreeConfirmationEmail(
    buyerEmail,
    event,
    lineItems,
    freeOrderConfirmLink(deps.siteUrl(), token),
    FREE_LIMITS.confirmHours,
    seats?.labels,
  );
  deps.defer(() => sendFreeConfirmation(deps, orderId, message));
  return Response.json(sent, { status: 202, headers: PRIVATE_NO_STORE });
}

/** A guest's confirmation link, after the response. Never throws: logged by short reference, never the address. */
async function sendFreeConfirmation(deps: Deps, orderId: string, message: EmailMessage) {
  try {
    await deps.sendEmail(message);
  } catch (err) {
    console.error(
      `Free order ${orderReference(orderId)} confirmation email failed:`,
      redactForLog(err instanceof Error ? err.message : "unknown error"),
    );
    try {
      await deps.db.query(`delete from public.orders where id = $1 and status = 'pending'`, [orderId]);
    } catch {
      console.error(`Free order ${orderReference(orderId)} could not be dropped after its email failed.`);
    }
  }
}

/**
 * POST /api/orders/confirm {token} — public. The token from a guest's
 * emailed link (its URL fragment). Issues the tickets and returns the
 * confirmation page's URL; a second confirmation returns the same URL.
 * 400 malformed token; 404 unknown; 410 expired (confirmed or not); 409 sold
 * out, the address already has its free tickets for the event, a ticket
 * type is no longer free, or the event has ended (nothing issued: a link
 * confirmed after the end issues no tickets).
 */
export const confirmFreeOrder: Handler = async (req, _params, deps) => {
  const body = await readJson(req);
  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN_PATTERN.test(token)) fail({ token: "This link is incomplete. Open it from your email again." });

  const tokenHash = hashToken(token);
  const [order] = await deps.db.query<{ line_items: OrderLineItem[]; event_id: string; seat_ids: string[] | null }>(
    `select line_items, event_id, seat_ids from public.orders where confirmation_token_hash = $1`,
    [tokenHash],
  );
  if (!order) throw new HttpError(404, LINK_NOT_FOUND);

  const row = await withTicketCodes(order.line_items, async (tickets) => {
    const [r] = await deps.db.query<{ result: string; confirmed_order_id: string | null }>(
      `select * from private.confirm_free_order($1, $2::text::jsonb, $3)`,
      [tokenHash, JSON.stringify(tickets), FREE_LIMITS.perPersonPerEvent],
    );
    return r;
  });
  switch (row.result) {
    case "confirmed":
      sendTicketEmailSoon(deps, row.confirmed_order_id as string);
      break;
    case "already_confirmed":
      break;
    case "not_found":
      throw new HttpError(404, LINK_NOT_FOUND);
    case "expired":
      throw new HttpError(410, "This link has expired. Book again to get a new one.");
    case "expired_confirmed":
      throw new HttpError(410, "This link has expired. Your tickets were emailed to you when you confirmed it.");
    case "person_event_limit":
      throw new HttpError(409, PERSON_LIMIT);
    case "sold_out":
      throw new HttpError(409, SOLD_OUT);
    case "seats_taken":
      throw new HttpError(409, SEATS_GONE_AT_CONFIRM, undefined, await seatsGone(deps, order.event_id, order.seat_ids ?? []));
    case "ended":
      throw new HttpError(409, EVENT_ENDED);
    case "no_longer_free":
      throw new HttpError(409, "These tickets aren't free any more. Book again from the event page.");
    case "unavailable":
      throw new HttpError(409, "This booking couldn't be completed. Book again from the event page.");
    default:
      throw new Error(`Unexpected confirm_free_order result: ${row.result}`);
  }
  return Response.json({ url: successUrl(deps, row.confirmed_order_id as string) }, { status: 200, headers: PRIVATE_NO_STORE });
};

/** SeatErrorDetails for a guest's free seated order whose seats went before it was confirmed. */
async function seatsGone(deps: Deps, eventId: string, seatIds: string[]): Promise<Record<string, unknown>> {
  const rows = await deps.db.query<TicketSeat>(
    `select s.section_label as section, s.row_label as "row", s.seat_label as seat, s.kind
       from public.event_seats s
      where s.event_id = $1 and s.id = any($2::text[])
        and (s.blocked or s.sold_order_id is not null or (s.hold_order_id is not null and s.hold_expires_at > now()))
      order by s.position`,
    [eventId, seatIds],
  );
  const [event] = await deps.db.query<{ slug: string }>(`select slug from public.events where id = $1`, [eventId]);
  const details: SeatErrorDetails = {
    code: "seats_taken",
    seats: rows.map(({ section, row, seat, kind }) => ({ section, row, seat, kind })),
    ...(event ? { eventSlug: event.slug } : {}),
  };
  return { ...details };
}
