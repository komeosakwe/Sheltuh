import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { calculateBookingFeeCents } from "@/lib/fees";
import { formatSeatLine } from "@/lib/seating/format";
import { clientIp, clientKey } from "./client-key";
import type { Db } from "./db";
import type { Deps } from "./deps";
import { HttpError, PRIVATE_NO_STORE, createdPrivate } from "./http";
import { orderReference } from "./order-reference";
import type { CheckoutResult, EventRecord, OrderLineItem, TicketSeat } from "./types";

/**
 * Paid checkout idempotency (docs/architecture.md, "Checkout idempotency";
 * supabase/migrations/20261104000200_checkout_attempts.sql).
 *
 * Every paid checkout, general admission or seated, runs as one attempt per
 * Idempotency-Key (unique on its own, so per event too): the first request with a key makes the order and
 * its Stripe Checkout Session; a repeat with the same key and basket gets the
 * same order and session back (200) while the session is open, a 409 while
 * the first is still being made, and never a second order or session. A key
 * reused for a different basket is a 422. A client that sends no key gets a
 * fresh one made up here, so it behaves exactly as before (a new order per
 * request). The header is optional for now (owner decision D8); the next
 * release is meant to require it.
 */

/** The request header (any case). A UUID, one per checkout attempt (lib/api/checkout-attempt.ts). */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export const CHECKOUT_ATTEMPT = {
  /**
   * How long a request owns its attempt while it makes the order and the
   * session. Longer than the route's maxDuration (60 seconds), so a lease
   * only lapses once its request is gone.
   */
  lease: "90 seconds",
  /**
   * A retry with the same key reuses the pending order a failed try left
   * (Stripe didn't answer) when it's younger than this: the Stripe call is
   * repeated with the same idempotency key and parameters. General
   * admission's parameters don't depend on time, so 10 minutes is just a
   * bound on reusing an old price snapshot.
   */
  gaReuseWithin: "10 minutes",
  /**
   * Seated: the session's expires_at is fixed at the order's creation plus
   * 31 minutes and Stripe refuses one less than 30 minutes ahead, so only a
   * retry within the first minute (less a 15-second margin) can repeat the
   * call; later, the old order and its holds are released and a new order
   * made.
   */
  seatedReuseWithin: "45 seconds",
  /** The Retry-After for a 409 checkout_in_progress or a 503 (seconds, at most). */
  retryAfterSeconds: 2,
} as const;

/**
 * General admission paid checkout limits (owner decision D7), taken by
 * private.take_checkout_attempt when a new order is about to be made (never
 * for replays, in-progress answers or refusals decided before it): per client
 * (its keyed IP hash, lib/server/client-key.ts), 20 per event and 60 across
 * all events; per event, 600 across all clients; each per 10 minutes. Seated
 * checkouts keep SEAT_HOLD_LIMITS (orders.ts) instead: nothing is counted
 * twice.
 */
export const CHECKOUT_LIMITS = {
  perClient: { event: 20, allEvents: 60 },
  perEvent: 600,
  window: "10 minutes",
} as const;

/**
 * Stripe request options for creating a Checkout Session. The idempotency
 * key is per order, so the SDK's own retry and any retry of ours for the same
 * order get the session Stripe already made (Stripe keeps keys for at least
 * 24 hours). A duplicate session wouldn't charge anyone by itself (a buyer
 * pays only on a session's page, and only the URL we return reaches them),
 * but it's an orphan we'd rather not make.
 */
export const STRIPE_SESSION_REQUEST = { timeout: 15_000, maxNetworkRetries: 1 } as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The request's Idempotency-Key (lowercased), or a fresh one when there's none. 400 if it isn't a UUID. */
export function idempotencyKey(req: Request): string {
  const raw = req.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (raw === null) return crypto.randomUUID();
  const key = raw.trim().toLowerCase();
  if (!UUID_PATTERN.test(key)) {
    throw new HttpError(400, "The Idempotency-Key header must be a UUID.", undefined, { code: "invalid_idempotency_key" });
  }
  return key;
}

export interface CheckoutBasket {
  kind: "ga" | "seated";
  eventId: string;
  /** General admission lines as asked for (ids and quantities: prices come from the database). */
  lines: { ticketTypeId: string; quantity: number }[];
  seats?: { mapVersion: number; seatIds: string[] };
  /** As sent: normalised here (trimmed, lowercased). */
  buyerEmail: unknown;
  trackingCode: string | null;
}

/**
 * SHA-256 (hex) over the event, the kind, the canonical basket (lines sorted
 * by ticket type, seats sorted, the map version), the normalised buyer email
 * and the tracking code. Stored instead of the basket, so the attempts table
 * holds no email.
 */
export function checkoutFingerprint(basket: CheckoutBasket): string {
  const lines = basket.lines
    .map((line) => [line.ticketTypeId, line.quantity] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const email = typeof basket.buyerEmail === "string" && basket.buyerEmail.trim() ? basket.buyerEmail.trim().toLowerCase() : null;
  const canonical = JSON.stringify([
    "checkout/v1",
    basket.kind,
    basket.eventId,
    lines,
    basket.seats ? [basket.seats.mapVersion, [...basket.seats.seatIds].sort()] : null,
    email,
    basket.trackingCode,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

type AttemptState = "mismatch" | "in_progress" | "completed" | "replay" | "expired" | "retry";

interface AttemptRow {
  state: AttemptState;
  order_id: string | null;
  session_url: string | null;
  hold_expires_at: string | Date | null;
  retry_after_seconds: number | null;
}

/**
 * The attempt for this key, if any, as the request should see it: read
 * before the request's own checks, so a replay isn't refused for seats its
 * own order holds or tickets sold since. Plain read; begin_checkout_attempt
 * decides again under the row lock.
 */
export async function peekCheckoutAttempt(db: Db, key: string, fingerprint: string) {
  // By key alone: a key reused for another event is found too (its fingerprint, which covers the event, differs).
  const [row] = await db.query<AttemptRow>(
    `select private.checkout_attempt_state(a, $2) as state, a.order_id, a.session_url, a.hold_expires_at,
            greatest(1, ceil(extract(epoch from a.lease_expires_at - now())))::integer as retry_after_seconds
       from private.checkout_attempts a
      where a.idempotency_key = $1::uuid`,
    [key, fingerprint],
  );
  return row;
}

function checkoutResult(url: string, orderId: string, holdExpiresAt: string | Date | null): CheckoutResult {
  return holdExpiresAt ? { url, holdExpiresAt: new Date(holdExpiresAt).toISOString(), orderId } : { url, orderId };
}

function inProgress(retryAfterSeconds: number | null): HttpError {
  const seconds = Math.max(1, Math.min(retryAfterSeconds ?? CHECKOUT_ATTEMPT.retryAfterSeconds, CHECKOUT_ATTEMPT.retryAfterSeconds));
  return new HttpError(
    409,
    "This checkout is still being set up. Wait a moment, then try again.",
    undefined,
    { code: "checkout_in_progress", retryAfterSeconds: seconds },
    { "retry-after": String(seconds) },
  );
}

const CHECKOUT_EXPIRED = (): HttpError =>
  new HttpError(409, "This checkout has ended. Start a new checkout.", undefined, { code: "checkout_expired" });

/**
 * The answer for an attempt that's settled (anything but `retry`): the same
 * order and session again (200, `Idempotent-Replayed: true`), or an error.
 * Undefined for `retry` (go ahead).
 */
export function settledAttemptResponse(row: Omit<AttemptRow, "state"> & { state: string }): Response | undefined {
  switch (row.state) {
    case "replay":
      return Response.json(checkoutResult(row.session_url!, row.order_id!, row.hold_expires_at), {
        status: 200,
        headers: { ...PRIVATE_NO_STORE, "idempotent-replayed": "true" },
      });
    case "in_progress":
      throw inProgress(row.retry_after_seconds);
    case "mismatch":
      throw new HttpError(
        422,
        "This checkout key was already used for a different order. Start a new checkout.",
        undefined,
        { code: "idempotency_key_reused" },
      );
    case "expired":
      throw CHECKOUT_EXPIRED();
    case "completed":
      throw new HttpError(409, "This checkout is already complete. Check your email for your tickets.", undefined, {
        code: "checkout_completed",
      });
    default:
      return undefined;
  }
}

/**
 * The client's key for per-client limits, or null (fail open, logged without
 * any request detail) when the request has no usable client IP (always set
 * on Vercel) or the secret the key is salted with isn't configured.
 */
export function requestClientKey(req: Request, deps: Deps, labels: { subject: string; limit: string }): string | null {
  const ip = clientIp(req);
  if (!ip) {
    console.warn(`${labels.subject} without a client IP header: the per-client ${labels.limit} limit was skipped.`);
    return null;
  }
  try {
    return clientKey(ip, deps.stripeWebhookSecret());
  } catch {
    console.error(`STRIPE_WEBHOOK_SECRET isn't set: the per-client ${labels.limit} limit was skipped.`);
    return null;
  }
}

/** One paid checkout, general admission or seated, as orders.ts hands it over. */
export interface PaidCheckout {
  kind: "ga" | "seated";
  event: EventRecord;
  key: string;
  fingerprint: string;
  clientKey: string | null;
  /** Per-client limits passed to begin_checkout_attempt (seated: SEAT_HOLD_LIMITS.perClient). */
  limits: { clientEvent: number; clientAll: number; event: number | null; window: string };
  stripeAccountId: string;
  /** Seated: Stripe's page closes this many seconds after the order was made (31 minutes). */
  sessionSeconds?: number;
  /** Makes pending order `orderId` (and, seated, its holds): throws on a refusal, having written nothing. */
  createOrder(orderId: string): Promise<void>;
  /** The 429 for a refused limit. */
  limitError(scope: "client" | "event"): HttpError;
}

interface BeginRow {
  result: string;
  attempt_order_id: string | null;
  reused: boolean;
  attempt_session_url: string | null;
  attempt_hold_expires_at: string | Date | null;
  retry_after_seconds: number | null;
}

interface SessionOrder {
  line_items: OrderLineItem[];
  application_fee_cents: number;
  buyer_email: string | null;
  event_title: string;
  created_epoch: number;
  seats: (TicketSeat & { ticketTypeId: string })[] | null;
  hold_expires_at: string | Date | null;
}

/** Everything the session is made from, read back from the order, so a retry for the same order sends Stripe the same parameters. */
async function loadSessionOrder(db: Db, orderId: string): Promise<SessionOrder | undefined> {
  const [row] = await db.query<SessionOrder>(
    `select o.line_items, o.application_fee_cents, o.buyer_email, o.event_title,
            floor(extract(epoch from o.created_at))::float8 as created_epoch,
            case when o.seat_ids is not null then
              (select coalesce(jsonb_agg(jsonb_build_object('ticketTypeId', s.ticket_type_id, 'section', s.section_label,
                         'row', s.row_label, 'seat', s.seat_label, 'kind', s.kind) order by s.position), '[]'::jsonb)
                 from public.event_seats s where s.event_id = o.event_id and s.id = any(o.seat_ids))
            end as seats,
            (select min(s.hold_expires_at) from public.event_seats s
              where s.event_id = o.event_id and s.hold_order_id = o.id) as hold_expires_at
       from public.orders o where o.id = $1`,
    [orderId],
  );
  return row;
}

function sessionParams(
  order: SessionOrder,
  checkout: PaidCheckout,
  orderId: string,
  siteUrl: string,
): Stripe.Checkout.SessionCreateParams {
  const { event } = checkout;
  const seats = order.seats;
  return {
    mode: "payment",
    client_reference_id: orderId,
    ...(order.buyer_email ? { customer_email: order.buyer_email } : {}),
    ...(checkout.sessionSeconds !== undefined ? { expires_at: order.created_epoch + checkout.sessionSeconds } : {}),
    line_items: order.line_items.flatMap((line) => {
      const lineSeats = seats ? seats.filter((seat) => seat.ticketTypeId === line.ticketTypeId) : [];
      const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        {
          price_data: {
            currency: "aud",
            product_data: {
              name: `${line.ticketTypeName} — ${order.event_title}`,
              ...(lineSeats.length > 0 ? { description: lineSeats.map(formatSeatLine).join("; ") } : {}),
            },
            unit_amount: line.unitPriceCents,
          },
          quantity: line.quantity,
        },
      ];
      if (line.feePolicy === "buyer-pays" && line.unitPriceCents > 0) {
        items.push({
          price_data: {
            currency: "aud",
            product_data: { name: "Booking fee" },
            unit_amount: calculateBookingFeeCents(line.unitPriceCents),
          },
          quantity: line.quantity,
        });
      }
      return items;
    }),
    payment_intent_data: {
      application_fee_amount: order.application_fee_cents,
      transfer_data: { destination: checkout.stripeAccountId },
    },
    success_url: `${siteUrl}/checkout/success?session_id=${orderId}`,
    // Seated: the cancelled page releases the seats at once (POST /orders/by-session/{id}/cancel).
    cancel_url: checkout.kind === "seated" ? `${siteUrl}/checkout/cancelled?order=${orderId}` : `${siteUrl}/events/${event.slug}`,
    metadata: { orderId, eventId: event.eventId },
  };
}

/**
 * Stripe may have made the session although we got no answer: the request
 * timed out or the connection failed, Stripe rate-limited us, or another
 * request with the same idempotency key was still running there (409). A
 * retry with the same key is safe: Stripe returns the session if it was
 * made. Anything else (an API error, which Stripe replays for the same key,
 * or an invalid request) is final for this order.
 */
export function stripeOutcomeUnknown(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { type, statusCode } = err as { type?: unknown; statusCode?: unknown };
  return type === "StripeConnectionError" || type === "StripeRateLimitError" || statusCode === 409;
}

async function failAttempt(db: Db, checkout: PaidCheckout, lease: string, release: boolean) {
  try {
    await db.query(`select private.fail_checkout_attempt($1, $2::uuid, $3::uuid, $4)`, [
      checkout.event.eventId,
      checkout.key,
      lease,
      release,
    ]);
  } catch (err) {
    // The original error matters more; the lease lapses on its own (90 seconds) and a retry then starts afresh.
    console.error("Couldn't record a failed checkout attempt:", err instanceof Error ? err.name : "unknown error");
  }
}

/**
 * Runs a paid checkout as an attempt (see the top of this file): claims the
 * key (begin_checkout_attempt: limits taken only when a new order is made),
 * makes the order unless a failed try's order is reused, makes the Stripe
 * session from the order as stored (idempotency key
 * `checkout-session-<orderId>`), and records it (finish_checkout_attempt).
 * 201 the CheckoutResult; 200 for a replay; 409 checkout_in_progress (with
 * Retry-After), checkout_expired or checkout_completed; 422
 * idempotency_key_reused; 429 from `limitError`; 503
 * payment_provider_unavailable when Stripe didn't answer (the order is kept
 * for a retry with the same key); 500 for any other Stripe error (the order
 * and its holds are released, so a retry starts afresh).
 */
export async function runPaidCheckout(deps: Deps, checkout: PaidCheckout): Promise<Response> {
  const { db } = deps;
  const lease = crypto.randomUUID();
  const [begun] = await db.query<BeginRow>(
    `select result, attempt_order_id, reused, attempt_session_url, attempt_hold_expires_at, retry_after_seconds
       from private.begin_checkout_attempt($1, $2::uuid, $3, $4, $5, $6::uuid, $7::interval, $8::interval,
                                           $9, $10, $11, $12, $13::interval)`,
    [
      checkout.event.eventId,
      checkout.key,
      checkout.kind,
      checkout.fingerprint,
      `ord_${crypto.randomUUID().replace(/-/g, "")}`,
      lease,
      CHECKOUT_ATTEMPT.lease,
      checkout.kind === "seated" ? CHECKOUT_ATTEMPT.seatedReuseWithin : CHECKOUT_ATTEMPT.gaReuseWithin,
      checkout.clientKey,
      checkout.limits.clientEvent,
      checkout.limits.clientAll,
      checkout.limits.event,
      checkout.limits.window,
    ],
  );
  switch (begun.result) {
    case "create":
      break;
    case "client_event_limit":
    case "client_all_limit":
      throw checkout.limitError("client");
    case "event_limit":
      throw checkout.limitError("event");
    default: {
      const settled = settledAttemptResponse({
        state: begun.result,
        order_id: begun.attempt_order_id,
        session_url: begun.attempt_session_url,
        hold_expires_at: begun.attempt_hold_expires_at,
        retry_after_seconds: begun.retry_after_seconds,
      });
      if (settled) return settled;
      throw new Error(`Unexpected begin_checkout_attempt result: ${begun.result}`);
    }
  }

  const orderId = begun.attempt_order_id!;
  if (!begun.reused) {
    // The order exists before Stripe does, so no payment can ever arrive without an order to attach it to.
    try {
      await checkout.createOrder(orderId);
    } catch (err) {
      await failAttempt(db, checkout, lease, false);
      throw err;
    }
  }

  const order = await loadSessionOrder(db, orderId);
  if (!order) {
    await failAttempt(db, checkout, lease, false);
    throw new Error("A checkout's order vanished before its Stripe session was made.");
  }
  const params = sessionParams(order, checkout, orderId, deps.siteUrl());
  let session: Stripe.Checkout.Session;
  try {
    session = await deps.stripe().checkout.sessions.create(params, {
      idempotencyKey: `checkout-session-${orderId}`,
      ...STRIPE_SESSION_REQUEST,
    });
  } catch (err) {
    if (stripeOutcomeUnknown(err)) {
      // Keep the order (and its holds) for a retry with the same key: the same Stripe idempotency key then
      // returns the session if this call made one.
      await failAttempt(db, checkout, lease, false);
      console.warn(`Checkout for order ${orderReference(orderId)}: Stripe didn't answer; kept for a retry with the same key.`);
      throw new HttpError(
        503,
        "We couldn't reach our payment provider. Try again in a moment.",
        undefined,
        { code: "payment_provider_unavailable" },
        { "retry-after": String(CHECKOUT_ATTEMPT.retryAfterSeconds) },
      );
    }
    // Nobody can pay for this order: release it (and its seats) now, so a retry makes a new one.
    await failAttempt(db, checkout, lease, true);
    throw err;
  }
  if (!session.url) {
    await failAttempt(db, checkout, lease, true);
    throw new Error("Stripe did not return a Checkout Session URL.");
  }

  const expiresAt =
    typeof session.expires_at === "number"
      ? session.expires_at
      : (params.expires_at ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60); // Stripe's default: 24 hours
  const [finished] = await db.query<{ result: string }>(
    `select private.finish_checkout_attempt($1, $2::uuid, $3::uuid, $4, $5, to_timestamp($6::float8), $7::timestamptz) as result`,
    [checkout.event.eventId, checkout.key, lease, session.id, session.url, expiresAt, order.hold_expires_at],
  );
  if (finished.result === "order_closed") throw CHECKOUT_EXPIRED();
  if (finished.result !== "open") throw inProgress(null);
  // The order id goes back only to the client that made the order (it's in Stripe's success and cancel URLs
  // anyway), so the page can cancel it if the buyer comes Back from Stripe: never cached.
  return createdPrivate(checkoutResult(session.url, orderId, checkout.kind === "seated" ? order.hold_expires_at : null));
}
