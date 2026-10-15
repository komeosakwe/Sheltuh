import { createHash, randomBytes } from "node:crypto";
import { MAX_FREE_TICKETS_PER_ORDER } from "@/lib/api/types";
import type { Caller } from "../auth";
import { pgConstraint, pgErrorCode, PG_UNIQUE_VIOLATION } from "../db";
import type { Deps } from "../deps";
import { redactForLog } from "../email-address";
import { sendTicketEmailSoon } from "../email-outbox";
import { buildFreeConfirmationEmail, freeOrderConfirmLink } from "../free-confirmation-email";
import { HttpError, PRIVATE_NO_STORE, readJson } from "../http";
import { orderReference } from "../order-reference";
import type { Handler } from "../route";
import { issueTickets } from "../ticket-issuance";
import type { CheckoutResult, EventRecord, IssuedTicket, OrderLineItem } from "../types";
import { fail } from "../validation";

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
  platformHourly: { hits: 300, window: "1 hour" },
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
async function optionalCaller(req: Request, deps: Deps): Promise<Caller | null> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return token ? deps.verifyAccessToken(token) : null;
}

const SOLD_OUT = "Those tickets just ran out.";
const LINK_NOT_FOUND = "This link isn't valid. Check it's the whole link from your email.";
const PERSON_LIMIT = `You can have up to ${FREE_LIMITS.perPersonPerEvent} free tickets for this event, and this email address already has them.`;

interface FreeOrderInput {
  event: EventRecord;
  lineItems: OrderLineItem[];
  buyerEmail: string;
  trackingCode: string | null;
}

/**
 * The free branch of POST /api/events/[eventId]/checkout, after the line
 * items, the email and availability have been checked.
 */
export async function createFreeOrder(req: Request, deps: Deps, input: FreeOrderInput): Promise<Response> {
  const { event, lineItems, buyerEmail, trackingCode } = input;
  const quantity = lineItems.reduce((n, l) => n + l.quantity, 0);
  if (quantity > FREE_LIMITS.perOrder) {
    await recordRefusal(deps, "order_too_large");
    fail({ lineItems: `You can book up to ${FREE_LIMITS.perOrder} free tickets at a time.` });
  }
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
  const caller = await optionalCaller(req, deps);
  const isOwnVerifiedEmail =
    caller?.emailVerified === true && !!caller.email && caller.email.trim().toLowerCase() === buyerEmail.toLowerCase();

  if (caller && isOwnVerifiedEmail) {
    const result = await withTicketCodes(lineItems, async (tickets) => {
      const [row] = await deps.db.query<{ result: string }>(
        `select private.place_free_order($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9::text::jsonb, $10, $11, $12::interval) as result`,
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
      default:
        throw new Error(`Unexpected place_free_order result: ${result}`);
    }
  }

  const token = randomBytes(32).toString("base64url");
  const [{ result }] = await deps.db.query<{ result: string }>(
    `select private.request_free_order($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9::interval, $10, $11::interval, $12, $13::interval) as result`,
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
      throw new HttpError(503, "Free bookings are busy right now. Try again in a few minutes.");
    default:
      throw new Error(`Unexpected request_free_order result: ${result}`);
  }

  try {
    const link = freeOrderConfirmLink(deps.siteUrl(), token);
    await deps.sendEmail(buildFreeConfirmationEmail(buyerEmail, event, lineItems, link, FREE_LIMITS.confirmHours));
  } catch (err) {
    // Nobody can confirm a link that never arrived: drop the order (it holds nothing).
    await deps.db.query(`delete from public.orders where id = $1 and status = 'pending'`, [orderId]);
    console.error(
      `Free order ${orderReference(orderId)} confirmation email failed:`,
      redactForLog(err instanceof Error ? err.message : "unknown error"),
    );
    throw new HttpError(503, "We couldn't send the confirmation email just now. Try again in a few minutes.");
  }
  return Response.json(sent, { status: 202, headers: PRIVATE_NO_STORE });
}

/**
 * POST /api/orders/confirm {token} — public. The token from a guest's
 * emailed link (its URL fragment). Issues the tickets and returns the
 * confirmation page's URL; a second confirmation returns the same URL.
 * 400 malformed token; 404 unknown; 410 expired; 409 sold out, or the
 * address already has its free tickets for the event.
 */
export const confirmFreeOrder: Handler = async (req, _params, deps) => {
  const body = await readJson(req);
  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN_PATTERN.test(token)) fail({ token: "This link is incomplete. Open it from your email again." });

  const tokenHash = hashToken(token);
  const [order] = await deps.db.query<{ line_items: OrderLineItem[] }>(
    `select line_items from public.orders where confirmation_token_hash = $1`,
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
    case "person_event_limit":
      throw new HttpError(409, PERSON_LIMIT);
    case "sold_out":
      throw new HttpError(409, SOLD_OUT);
    case "unavailable":
      throw new HttpError(409, "This booking couldn't be completed. Book again from the event page.");
    default:
      throw new Error(`Unexpected confirm_free_order result: ${row.result}`);
  }
  return Response.json({ url: successUrl(deps, row.confirmed_order_id as string) }, { status: 200, headers: PRIVATE_NO_STORE });
};
