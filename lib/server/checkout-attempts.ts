import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { calculateBookingFeeCents } from "@/lib/fees";
import { formatSeatLine } from "@/lib/seating/format";
import { SUPPORT_LABEL } from "@/lib/support";
import { clientIp, clientKey } from "./client-key";
import type { Db } from "./db";
import type { Deps } from "./deps";
import { sendOpsAlertsSoon } from "./email-outbox";
import { HttpError, PRIVATE_NO_STORE, createdPrivate } from "./http";
import { orderReference } from "./order-reference";
import type { CheckoutResult, EventRecord, OrderLineItem, TicketSeat } from "./types";

/**
 * Paid checkout idempotency (docs/architecture.md, "Checkout idempotency";
 * supabase/migrations/20261109000400_checkout_attempts.sql).
 *
 * Every paid checkout, general admission or seated, runs as one attempt per
 * Idempotency-Key (unique on its own, so per event too): the first request with a key makes the order and
 * its embedded Stripe Checkout Session (ui_mode embedded_page); a repeat with
 * the same key and basket gets the same order and payment page back (200,
 * `{url, orderId}` with `url` our /checkout/pay page, which reads the
 * session's client secret itself) while the session is open, a 409 while
 * the first is still being made, and never a second order or session. A key
 * reused for a different basket is a 422. A client that sends no key gets a
 * fresh one made up here, so it behaves exactly as before (a new order per
 * request). The header is optional for now (owner decision D8); the next
 * release is meant to require it.
 *
 * An attempt is bound to the client that made it (its keyed IP hash, as for
 * the per-client limits): a request with the same key from another client
 * key gets a 409 `checkout_other_client` that names neither the order nor
 * the session, and can't retry or take over the attempt. Without a usable
 * IP header (never on Vercel) the client key is null, and null matches only
 * null: such requests are bound to each other, not to an address.
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
   * admission's expires_at is fixed at the order's creation plus 60 minutes
   * (GA_CHECKOUT_SESSION_MINUTES, orders.ts), so a retry within 10 minutes
   * still sends Stripe one at least 50 minutes ahead (its minimum is 30); 10
   * minutes is also a bound on reusing an old price snapshot.
   */
  gaReuseWithin: "10 minutes",
  /**
   * Seated: the session's expires_at is fixed at the order's creation plus
   * 31 minutes and Stripe refuses one less than 30 minutes ahead, so a
   * repeated call must reach Stripe within 60 seconds of the order's
   * creation. A retry that starts within 15 seconds gets there in time even
   * in the worst case of its own call (a 15-second timeout, the SDK's backoff
   * of up to 2 seconds, then its one network retry: about 33 seconds in all).
   * Later, the old order and its holds are released and a new order made.
   * (Shortening this window was chosen over 32-minute seated sessions, which
   * would change the hold timings buyers are shown: SEAT_HOLD.) A seated order
   * is only kept pending for reuse when the request that made it died (its
   * lease lapsed); after an unknown Stripe outcome it's released at once
   * (runPaidCheckout).
   */
  seatedReuseWithin: "15 seconds",
  /** The Retry-After for a 409 checkout_in_progress or a 503 (seconds, at most). */
  retryAfterSeconds: 2,
} as const;

/**
 * General admission paid checkout limits (owner decision D7), taken by
 * private.take_checkout_attempt when a new order is about to be made (never
 * for replays, in-progress answers or refusals decided before it): per client
 * (its keyed IP hash, lib/server/client-key.ts), 20 per event and 60 across
 * all events, each per 10 minutes (a 429 over either). Per event, across
 * all clients, 600 per 10 minutes is a circuit breaker that only alerts
 * (a manager decision: as a refusal, about 30 addresses could use it up and
 * block real buyers): crossing it queues an ops alert, at most one per event
 * per window, and every buyer is still served. Seated checkouts keep
 * SEAT_HOLD_LIMITS (orders.ts) instead: nothing is counted twice.
 */
export const CHECKOUT_LIMITS = {
  perClient: { event: 20, allEvents: 60 },
  perEventAlert: 600,
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

/**
 * Payment options shared by both paid Checkout Sessions (general admission
 * and seated).
 * - `adaptive_pricing` is pinned off. Buyers pay exactly the A$ total from
 *   lib/fees.ts that every page shows (ACL all-inclusive pricing). Left to
 *   the Dashboard setting, Stripe could charge a buyer abroad a converted
 *   amount plus its conversion fee.
 * - `payment_method_types` is deliberately never sent (nor
 *   `excluded_payment_method_types` or `wallet_options`), so the platform's
 *   Dashboard payment methods apply: cards, Apple Pay, Google Pay and Link,
 *   switched on there, on domains registered with `npm run payment-domains`.
 * - Nothing is saved for later: no `customer`, no
 *   `saved_payment_method_options`, no `payment_intent_data.setup_future_usage`.
 *   Anyone holding the order id can load the form, so it must never show a
 *   member's saved card. Link's saved cards sit behind its own one-time code.
 */
export const SESSION_PAYMENT_OPTIONS = {
  adaptive_pricing: { enabled: false },
} satisfies Pick<Stripe.Checkout.SessionCreateParams, "adaptive_pricing">;

/** Our payment page for a card checkout (CheckoutResult.url): relative, same origin. */
export function paymentPageUrl(orderId: string): string {
  return `/checkout/pay?order=${orderId}`;
}

/**
 * Where Stripe's embedded form sends the buyer once it's done (and back from
 * a redirect-based payment method): the confirmation page, which reads the
 * order (no `{CHECKOUT_SESSION_ID}`: the order id is the only id it needs).
 */
export function checkoutReturnUrl(siteUrl: string, orderId: string): string {
  return `${siteUrl}/checkout/success?session_id=${orderId}`;
}

/** A random (version 4, RFC 9562 variant) UUID: what crypto.randomUUID() makes. Never the nil UUID or a guessable one. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The request's Idempotency-Key (lowercased), or a fresh one when there's none. 400 if it isn't a random (v4) UUID. */
export function idempotencyKey(req: Request): string {
  const raw = req.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (raw === null) return crypto.randomUUID();
  const key = raw.trim().toLowerCase();
  if (!UUID_V4_PATTERN.test(key)) {
    throw new HttpError(400, "The Idempotency-Key header must be a random (version 4) UUID.", undefined, {
      code: "invalid_idempotency_key",
    });
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
  /** Support Sheltüh (validated: 0 for none). */
  supportCents?: number;
}

/**
 * SHA-256 (hex) over the event, the kind, the canonical basket (lines sorted
 * by ticket type, seats sorted, the map version), the normalised buyer email,
 * the tracking code and, only when there is one, the Support Sheltüh amount
 * (so a basket without it hashes exactly as before it existed, and an attempt
 * begun before a deploy still replays). Stored instead of the basket, so the
 * attempts table holds no email. A replay with another support amount is a
 * mismatch (422), like any other change.
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
    ...(basket.supportCents && basket.supportCents > 0 ? [basket.supportCents] : []),
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

type AttemptState = "mismatch" | "other_client" | "in_progress" | "completed" | "replay" | "expired" | "retry";

interface AttemptRow {
  state: AttemptState;
  order_id: string | null;
  session_url: string | null;
  hold_expires_at: string | Date | null;
  retry_after_seconds: number | null;
  /** The attempt's order's status (read for `completed`, to word the answer truthfully). */
  order_status: string | null;
}

/**
 * The attempt for this key, if any, as this client (`clientKey`, see
 * requestClientKey) should see it: read before the request's own checks, so
 * a replay isn't refused for seats its own order holds or tickets sold
 * since. Plain read; begin_checkout_attempt decides again under the row lock.
 */
export async function peekCheckoutAttempt(db: Db, key: string, fingerprint: string, clientKey: string | null) {
  // By key alone: a key reused for another event is found too (its fingerprint, which covers the event, differs).
  const [row] = await db.query<AttemptRow>(
    `select private.checkout_attempt_state(a, $2, $3) as state, a.order_id, a.session_url, a.hold_expires_at,
            greatest(1, ceil(extract(epoch from a.lease_expires_at - now())))::integer as retry_after_seconds,
            (select o.status::text from public.orders o where o.id = a.order_id) as order_status
       from private.checkout_attempts a
      where a.idempotency_key = $1::uuid`,
    [key, fingerprint, clientKey],
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
 * `checkout_completed`, worded for what happened to the order: only a paid
 * order has tickets to look for. One that couldn't be fulfilled after
 * payment (sold out, or the event closed) is being refunded or was; one
 * refunded in Stripe has no tickets either.
 */
function checkoutCompleted(orderStatus: string | null): HttpError {
  const message =
    orderStatus === "paid"
      ? "This checkout is already complete. Check your email for your tickets."
      : orderStatus === "oversold_refund_required"
        ? "This checkout was paid, but the tickets were gone before the payment came through, so it's being refunded in full. Start a new checkout if tickets are still available."
        : orderStatus === "refunded"
          ? "This checkout's payment was refunded, so it has no tickets. Start a new checkout if you still want tickets."
          : "This checkout has already finished. Start a new checkout if you still want tickets.";
  return new HttpError(409, message, undefined, { code: "checkout_completed" });
}

/** A key used from another client: nothing about the attempt (its order or session) is given out. */
const CHECKOUT_OTHER_CLIENT = (): HttpError =>
  new HttpError(409, "This checkout was started from another connection. Start a new checkout.", undefined, {
    code: "checkout_other_client",
  });

/**
 * The answer for an attempt that's settled (anything but `retry`): the same
 * order and session again (200, `Idempotent-Replayed: true`), or an error.
 * Undefined for `retry` (go ahead).
 */
export function settledAttemptResponse(row: Omit<AttemptRow, "state"> & { state: string }): Response | undefined {
  switch (row.state) {
    case "replay": {
      if (!row.session_url || !row.order_id) throw new Error("A replayed checkout attempt has no order or session.");
      return Response.json(checkoutResult(row.session_url, row.order_id, row.hold_expires_at), {
        status: 200,
        headers: { ...PRIVATE_NO_STORE, "idempotent-replayed": "true" },
      });
    }
    case "in_progress":
      throw inProgress(row.retry_after_seconds);
    case "mismatch":
      throw new HttpError(
        422,
        "This checkout key was already used for a different order. Start a new checkout.",
        undefined,
        { code: "idempotency_key_reused" },
      );
    case "other_client":
      throw CHECKOUT_OTHER_CLIENT();
    case "expired":
      throw CHECKOUT_EXPIRED();
    case "completed":
      throw checkoutCompleted(row.order_status);
    default:
      return undefined;
  }
}

/** The request's client key (null when there's none) and, if none, why. */
export interface RequestClient {
  key: string | null;
  missing?: "ip" | "secret";
}

/**
 * The client's key for per-client limits and for binding an attempt to its
 * client, or null (fail open) when the request has no usable client IP
 * (always set on Vercel) or the secret the key is salted with isn't
 * configured. Silent: runPaidCheckout logs the fail-open once a paid
 * checkout actually uses it.
 */
export function requestClientKey(req: Request, deps: Deps): RequestClient {
  const ip = clientIp(req);
  if (!ip) return { key: null, missing: "ip" };
  try {
    return { key: clientKey(ip, deps.stripeWebhookSecret()) };
  } catch {
    return { key: null, missing: "secret" };
  }
}

/** Logs a per-client limit skipped for want of a client key, without any request detail. */
function logClientKeyMissing(client: RequestClient, labels: { subject: string; limit: string }) {
  if (client.missing === "ip") {
    console.warn(`${labels.subject} without a client IP header: the per-client ${labels.limit} limit was skipped.`);
  } else if (client.missing === "secret") {
    console.error(`STRIPE_WEBHOOK_SECRET isn't set: the per-client ${labels.limit} limit was skipped.`);
  }
}

/** One paid checkout, general admission or seated, as orders.ts hands it over. */
export interface PaidCheckout {
  kind: "ga" | "seated";
  event: EventRecord;
  key: string;
  fingerprint: string;
  client: RequestClient;
  /** How the fail-open log line names this checkout and its limit. */
  clientLabels: { subject: string; limit: string };
  /**
   * Per-client limits passed to begin_checkout_attempt (seated: SEAT_HOLD_LIMITS.perClient), the
   * event's alert-only circuit breaker (general admission only; null: none), and the per-client
   * per-minute limit (general admission only, CHECKOUT_RATE_LIMITS.paidCheckout; null: none). All are
   * taken inside the attempt, only when a new order is about to be made.
   */
  limits: {
    clientEvent: number;
    clientAll: number;
    eventAlert: number | null;
    window: string;
    minute: { hits: number; window: string } | null;
  };
  stripeAccountId: string;
  /**
   * Stripe's session closes this many seconds after the order was made
   * (general admission 60 minutes, seated 31): fixed by the order, so a
   * retry for the same order sends Stripe the very same expires_at.
   */
  sessionSeconds: number;
  /** Makes pending order `orderId` (and, seated, its holds): throws on a refusal, having written nothing. */
  createOrder(orderId: string): Promise<void>;
  /** The 429 for a refused per-client limit: the per-minute one, or one of the per-window ones. */
  limitError(limit: "minute" | "window"): HttpError;
}

interface BeginRow {
  result: string;
  attempt_order_id: string | null;
  reused: boolean;
  attempt_session_url: string | null;
  attempt_hold_expires_at: string | Date | null;
  retry_after_seconds: number | null;
  attempt_order_status: string | null;
  alert_queued: boolean;
}

interface SessionOrder {
  line_items: OrderLineItem[];
  application_fee_cents: number;
  /** What the buyer pays, as stored when the order was made: the session must charge exactly this (sessionTotalCents). */
  total_cents: number;
  /** Support Sheltüh: all of it is the platform's (added to the application fee). */
  support_cents: number;
  buyer_email: string | null;
  event_title: string;
  created_epoch: number;
  seats: (TicketSeat & { ticketTypeId: string })[] | null;
  hold_expires_at: string | Date | null;
}

/** Everything the session is made from, read back from the order, so a retry for the same order sends Stripe the same parameters. */
async function loadSessionOrder(db: Db, orderId: string): Promise<SessionOrder | undefined> {
  const [row] = await db.query<SessionOrder>(
    `select o.line_items, o.application_fee_cents, o.total_cents, o.support_cents, o.buyer_email, o.event_title,
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

/**
 * What a session made from these parameters charges: its lines' unit amounts
 * times their quantities (Adaptive Pricing is off, so nothing else is added).
 */
function sessionTotalCents(params: Stripe.Checkout.SessionCreateParams): number {
  return (params.line_items ?? []).reduce(
    (sum, item) => sum + (item.price_data?.unit_amount ?? 0) * (item.quantity ?? 1),
    0,
  );
}

/**
 * The embedded Checkout Session's parameters, all from the stored order (and
 * its seats), so a retry for the same order sends exactly the same ones.
 * Support Sheltüh (lib/support.ts), when the order has it, is one more line
 * after the tickets and their fees, and is added to application_fee_amount:
 * all of it is Sheltüh's, and the organiser's transfer (the total less the
 * application fee) is exactly what it is without it. An order without it
 * gets the very same parameters as before support existed.
 */
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
    expires_at: order.created_epoch + checkout.sessionSeconds,
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
    }).concat(
      order.support_cents > 0
        ? [
            {
              price_data: { currency: "aud", product_data: { name: SUPPORT_LABEL }, unit_amount: order.support_cents },
              quantity: 1,
            },
          ]
        : [],
    ),
    // A destination charge: the organiser's transfer is part of the payment (charge.refunded's
    // transfer_data.destination is how an early refund is matched to one of our organisers: orders.ts).
    // The application fee is the booking fee plus any Support Sheltüh, so the transfer never includes support.
    payment_intent_data: {
      application_fee_amount: order.application_fee_cents + order.support_cents,
      transfer_data: { destination: checkout.stripeAccountId },
    },
    // Stripe's form on our own page (/checkout/pay); no cancel_url in this mode (Back is ours: for seats,
    // SeatPicker → POST /orders/by-session/{id}/cancel releases them at once).
    ui_mode: "embedded_page",
    return_url: checkoutReturnUrl(siteUrl, orderId),
    metadata: { orderId, eventId: event.eventId },
    // Exactly the A$ total (Adaptive Pricing off); no payment_method_types, so the Dashboard's wallets
    // and Link apply; nothing saved. See SESSION_PAYMENT_OPTIONS.
    ...SESSION_PAYMENT_OPTIONS,
  };
}

/**
 * What may be logged about a Stripe error: its type and code, never its
 * message (Stripe's messages can quote our idempotency key, and with it the
 * order id, the confirmation page's credential).
 */
export function stripeErrorLabel(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown error";
  const { type, code, statusCode } = err as { type?: unknown; code?: unknown; statusCode?: unknown };
  const safe = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : undefined);
  const parts = [safe(type), safe(code), typeof statusCode === "number" ? String(statusCode) : undefined].filter(Boolean);
  return parts.length > 0 ? parts.join("/") : "unknown error";
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
 * Retry-After), checkout_expired (also for a kept order whose stored total
 * no longer matches the session lib/fees.ts prices, as across a booking fee
 * change: nothing is sent to Stripe) or checkout_completed; 422
 * idempotency_key_reused; 429 from `limitError`; 503
 * payment_provider_unavailable when Stripe didn't answer (the order is kept
 * for a retry with the same key); 500 for any other Stripe error (the order
 * and its holds are released, so a retry starts afresh).
 */
export async function runPaidCheckout(deps: Deps, checkout: PaidCheckout): Promise<Response> {
  const { db } = deps;
  logClientKeyMissing(checkout.client, checkout.clientLabels);
  const lease = crypto.randomUUID();
  const [begun] = await db.query<BeginRow>(
    `select result, attempt_order_id, reused, attempt_session_url, attempt_hold_expires_at, retry_after_seconds,
            attempt_order_status, alert_queued
       from private.begin_checkout_attempt($1, $2::uuid, $3, $4, $5, $6::uuid, $7::interval, $8::interval,
                                           $9, $10, $11, $12, $13::interval, $14, $15::interval)`,
    [
      checkout.event.eventId,
      checkout.key,
      checkout.kind,
      checkout.fingerprint,
      `ord_${crypto.randomUUID().replace(/-/g, "")}`,
      lease,
      CHECKOUT_ATTEMPT.lease,
      checkout.kind === "seated" ? CHECKOUT_ATTEMPT.seatedReuseWithin : CHECKOUT_ATTEMPT.gaReuseWithin,
      checkout.client.key,
      checkout.limits.clientEvent,
      checkout.limits.clientAll,
      checkout.limits.eventAlert,
      checkout.limits.window,
      checkout.limits.minute?.hits ?? null,
      checkout.limits.minute?.window ?? null,
    ],
  );
  // The event's circuit breaker tripped: an ops alert was queued (at most one per event per window). Nobody is refused.
  if (begun.alert_queued) {
    console.warn(`Checkout surge on event ${checkout.event.eventId}: over its alert threshold; an ops alert was queued.`);
    sendOpsAlertsSoon(deps);
  }
  switch (begun.result) {
    case "create":
      break;
    case "client_minute_limit":
      throw checkout.limitError("minute");
    case "client_event_limit":
    case "client_all_limit":
      throw checkout.limitError("window");
    default: {
      const settled = settledAttemptResponse({
        state: begun.result,
        order_id: begun.attempt_order_id,
        session_url: begun.attempt_session_url,
        hold_expires_at: begun.attempt_hold_expires_at,
        retry_after_seconds: begun.retry_after_seconds,
        order_status: begun.attempt_order_status,
      });
      if (settled) return settled;
      throw new Error(`Unexpected begin_checkout_attempt result: ${begun.result}`);
    }
  }

  const orderId = begun.attempt_order_id;
  if (!orderId) {
    await failAttempt(db, checkout, lease, false);
    throw new Error("begin_checkout_attempt said create without an order id.");
  }
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
  // The booking fee lines are priced by lib/fees.ts as it is now, the order's total when it was made. They
  // differ only for an order made before the fee changed and reused after (a retry within gaReuseWithin or
  // seatedReuseWithin across a deploy): that session would charge more than the order, and the webhook would
  // refund it as an amount_mismatch. End this attempt instead (seats released), so the buyer's next press makes
  // a new order at today's fee. Nothing was sent to Stripe.
  if (sessionTotalCents(params) !== order.total_cents) {
    await failAttempt(db, checkout, lease, true);
    console.warn(`Checkout for order ${orderReference(orderId)}: its stored total no longer matches its session; ended.`);
    throw CHECKOUT_EXPIRED();
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await deps.stripe().checkout.sessions.create(params, {
      idempotencyKey: `checkout-session-${orderId}`,
      ...STRIPE_SESSION_REQUEST,
    });
  } catch (err) {
    if (stripeOutcomeUnknown(err)) {
      // General admission: keep the order (it holds nothing) for a retry with the same key: the same Stripe
      // idempotency key then returns the session if this call made one. Seated: release the order and its
      // holds now. The client never got the order id, so nothing else could release them before they lapse
      // (35 minutes), and a retry with the same key holds the seats again under a new order. A session
      // Stripe may have made for the released order is never shown to anyone (the payment page needs a
      // session recorded on a pending order), and a payment for a failed order is refunded in full by the
      // webhook (refundPaymentForFailedOrder, orders.ts).
      const release = checkout.kind === "seated";
      await failAttempt(db, checkout, lease, release);
      console.warn(
        `Checkout for order ${orderReference(orderId)}: Stripe didn't answer; ${release ? "released, its seats freed" : "kept for a retry with the same key"}.`,
      );
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
    // Not Stripe's message: it can quote our idempotency key (checkout-session-<order id>). Type and code only.
    throw new Error(`Stripe refused the Checkout Session (${stripeErrorLabel(err)}).`);
  }
  if (!session.client_secret) {
    // Nobody could mount (so pay) it: the same as a Stripe error. The order fails (seats released) now, not
    // when the session expires.
    await failAttempt(db, checkout, lease, true);
    throw new Error("Stripe did not return an embedded Checkout Session's client secret.");
  }
  // What the client gets (now and on a replay): our payment page, never Stripe's client secret (the page reads
  // it with GET …/payment, so it survives a reload and is never stored).
  const url = paymentPageUrl(orderId);

  const expiresAt =
    typeof session.expires_at === "number"
      ? session.expires_at
      : (params.expires_at ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60); // Stripe's default: 24 hours
  const [finished] = await db.query<{ result: string }>(
    `select private.finish_checkout_attempt($1, $2::uuid, $3::uuid, $4, $5, to_timestamp($6::float8), $7::timestamptz) as result`,
    [checkout.event.eventId, checkout.key, lease, session.id, url, expiresAt, order.hold_expires_at],
  );
  if (finished.result === "order_closed") throw CHECKOUT_EXPIRED();
  if (finished.result !== "open") throw inProgress(null);
  // The order id goes back only to the client that made the order (it's in the payment page's URL and Stripe's
  // return URL anyway), so the page can cancel it if the buyer goes Back: never cached.
  return createdPrivate(checkoutResult(url, orderId, checkout.kind === "seated" ? order.hold_expires_at : null));
}
