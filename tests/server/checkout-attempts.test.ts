import Stripe from "stripe";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clientKey } from "@/lib/server/client-key";
import { CHECKOUT_LIMITS, checkoutFingerprint, STRIPE_SESSION_REQUEST } from "@/lib/server/checkout-attempts";
import { drainEmailOutbox } from "@/lib/server/email-outbox";
import { cancelPendingOrder, createCheckout, SEAT_HOLD_LIMITS, stripeWebhook } from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { OPS_ALERT_EMAIL, stripeWebhookRequest, TestApi, WEBHOOK_SECRET } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent, seatStates } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// Paid checkout idempotency and abuse controls
// (supabase/migrations/20261104000200_checkout_attempts.sql, lib/server/checkout-attempts.ts;
// docs/architecture.md, "Checkout idempotency").

const KEY = "6f0d7a52-3b1c-4e8f-9a2d-1c5b7e9f0a11";
const OTHER_KEY = "0b9e4c3a-8d7f-4a6b-b5c4-d3e2f1a0b9c8";
const IP = "203.0.113.7";
const OTHER_IP = "198.51.100.20";

const TICKETS = [
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 5 },
];

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

/**
 * Stripe's idempotency, as far as these tests need it: one session per
 * idempotency key (a key's later calls get the first one's session).
 * `failNext`: the next call throws, before Stripe made anything (`refused`:
 * an API error; `unreachable`: no connection) or after (`lost`: the session
 * was made, the answer never arrived).
 */
function fakeStripeSessions() {
  const sessions = new Map<string, { id: string; url: string }>();
  let made = 0;
  let next: "refused" | "unreachable" | "lost" | "idempotency" | undefined;
  let gate: Promise<void> | undefined;
  api.stripe.checkout.sessions.create.mockImplementation(async (_params: unknown, options?: { idempotencyKey?: string }) => {
    const mode = next;
    next = undefined;
    if (gate) await gate;
    if (mode === "refused") throw new Stripe.errors.StripeAPIError({ message: "Something went wrong.", statusCode: 500 });
    if (mode === "idempotency") {
      // Stripe's real wording quotes the key, and with it the order id.
      throw new Stripe.errors.StripeIdempotencyError({
        message: `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '${options?.idempotencyKey}' if you meant to execute a different request.`,
        type: "idempotency_error",
        statusCode: 400,
      });
    }
    if (mode === "unreachable") throw new Stripe.errors.StripeConnectionError({ message: "connect ECONNREFUSED" });
    const key = options?.idempotencyKey;
    let session = key ? sessions.get(key) : undefined;
    if (!session) {
      made += 1;
      session = { id: `cs_test_${made}`, url: `https://checkout.stripe.test/cs_test_${made}` };
      if (key) sessions.set(key, session);
    }
    if (mode === "lost") {
      throw new Stripe.errors.StripeConnectionError({ message: "Request aborted due to timeout being reached (15000ms)" });
    }
    return session;
  });
  return {
    made: () => made,
    failNext(mode: "refused" | "unreachable" | "lost" | "idempotency") {
      next = mode;
    },
    /** Holds every Stripe call until the returned function is called. */
    hold() {
      let open!: () => void;
      gate = new Promise<void>((resolve) => (open = resolve));
      return () => {
        gate = undefined;
        open();
      };
    },
  };
}

let stripe: ReturnType<typeof fakeStripeSessions>;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
  await enablePayouts(api, organiser.organiserId);
  stripe = fakeStripeSessions();
  // Requests without a client IP log that the per-client limit was skipped.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const BASKET = { lineItems: [{ ticketTypeId: "ga", quantity: 2 }], buyerEmail: "Fan@Example.com" };

function checkout(
  body: Record<string, unknown> = BASKET,
  options: { key?: string | null; ip?: string; on?: EventRecord } = {},
) {
  const key = options.key === undefined ? KEY : options.key;
  return api.call(createCheckout, {
    params: { eventId: (options.on ?? event).eventId },
    body,
    headers: {
      ...(key !== null ? { "idempotency-key": key } : {}),
      ...(options.ip ? { "x-forwarded-for": options.ip } : {}),
    },
  });
}

async function orders(eventId = event.eventId) {
  return api.db.query<{ id: string; status: string; stripe_checkout_session_id: string | null }>(
    `select id, status::text as status, stripe_checkout_session_id from public.orders where event_id = $1 order by created_at, id`,
    [eventId],
  );
}

async function attempts() {
  return api.db.query<{ idempotency_key: string; status: string; order_id: string | null; lease_token: string | null }>(
    `select idempotency_key::text, status, order_id, lease_token::text from private.checkout_attempts order by created_at`,
  );
}

const createCalls = () => api.stripe.checkout.sessions.create.mock.calls;

describe("the same Idempotency-Key and basket", () => {
  it("a lost response's retry gets the same order and session (200), with no second order or Stripe call", async () => {
    const first = await checkout();
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(first.body).sort()).toEqual(["orderId", "url"]);

    const again = await checkout({ ...BASKET, buyerEmail: " fan@example.com " }); // the same email, normalised
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.headers.get("cache-control")).toBe("private, no-store");

    expect(createCalls()).toHaveLength(1);
    expect(await orders()).toEqual([{ id: first.body.orderId, status: "pending", stripe_checkout_session_id: "cs_test_1" }]);
    expect(await attempts()).toEqual([{ idempotency_key: KEY, status: "open", order_id: first.body.orderId, lease_token: null }]);
  });

  it("Stripe is asked with a per-order idempotency key, a 15-second timeout and one network retry", async () => {
    const res = await checkout();
    expect(STRIPE_SESSION_REQUEST).toEqual({ timeout: 15_000, maxNetworkRetries: 1 });
    expect(createCalls()[0][1]).toEqual({ idempotencyKey: `checkout-session-${res.body.orderId}`, timeout: 15_000, maxNetworkRetries: 1 });
  });

  it("a double click (two identical requests at once): one order and one session; the other is told to wait, then replays", async () => {
    const open = stripe.hold();
    const results = [checkout(), checkout()];
    const early = await Promise.race(results);
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: "checkout_in_progress", retryAfterSeconds: 2 });
    expect(early.body.error).toMatch(/still being set up/);
    expect(early.headers.get("retry-after")).toBe("2");
    open();
    const [a, b] = await Promise.all(results);
    const done = [a, b].find((r) => r.status === 201)!;
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(createCalls()).toHaveLength(1);
    expect(await orders()).toHaveLength(1);

    const retried = await checkout();
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual(done.body);
  });

  it("a replay from another client: 409 checkout_other_client with no URL or order id; the attempt is untouched", async () => {
    const first = await checkout(BASKET, { ip: IP });
    expect(first.status).toBe(201);
    const [before] = await api.db.query(`select * from private.checkout_attempts`);
    for (const ip of [OTHER_IP, "2001:db8:aa:bb::1", undefined]) {
      const res = await checkout(BASKET, { ip });
      expect([res.status, res.body.code]).toEqual([409, "checkout_other_client"]);
      expect(res.body.error).toBe("This checkout was started from another connection. Start a new checkout.");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(first.body.orderId as string);
      expect(text).not.toContain("checkout.stripe.test");
      expect(res.body).not.toHaveProperty("url");
      expect(res.body).not.toHaveProperty("orderId");
    }
    expect(createCalls()).toHaveLength(1);
    expect(await api.db.query(`select * from private.checkout_attempts`)).toEqual([before]);
    // Its own client still gets the replay.
    const mine = await checkout(BASKET, { ip: IP });
    expect([mine.status, mine.body]).toEqual([200, first.body]);
  });

  it("no client IP binds to no client IP: such a replay works, one with an IP is another client", async () => {
    const first = await checkout();
    expect(first.status).toBe(201);
    expect((await checkout()).status).toBe(200);
    expect((await checkout(BASKET, { ip: IP })).body.code).toBe("checkout_other_client");
  });

  it("under the row lock too (begin_checkout_attempt, when the first look missed): other_client, and completed worded from the order", async () => {
    const first = await checkout(BASKET, { ip: IP });
    // The first look (peekCheckoutAttempt) sees nothing, as for a request that read just before the first one committed.
    const query = api.db.query.bind(api.db);
    vi.spyOn(api.db, "query").mockImplementation(((sql: string, params?: unknown[]) =>
      sql.includes("checkout_attempt_state(a, $2, $3)") ? Promise.resolve([]) : query(sql, params)) as typeof api.db.query);

    const other = await checkout(BASKET, { ip: OTHER_IP });
    expect([other.status, other.body.code]).toEqual([409, "checkout_other_client"]);
    expect(JSON.stringify(other.body)).not.toContain(first.body.orderId as string);

    await query(`update public.orders set status = 'refunded' where id = $1`, [first.body.orderId]);
    const refunded = await checkout(BASKET, { ip: IP });
    expect([refunded.status, refunded.body.code]).toEqual([409, "checkout_completed"]);
    expect(refunded.body.error).toMatch(/refunded, so it has no tickets/);

    // And an in-progress answer from there carries the lease's time left (1 second: not the default of 2).
    await query(
      `update private.checkout_attempts set status = 'in_progress', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '500 milliseconds'`,
    );
    const busy = await checkout(BASKET, { ip: IP });
    expect([busy.status, busy.body.code]).toEqual([409, "checkout_in_progress"]);
    expect(busy.body.retryAfterSeconds).toBe(1);
    expect(createCalls()).toHaveLength(1);
  });

  it("no key: every request makes its own order and session, as before; a malformed key is a 400 that writes nothing", async () => {
    expect((await checkout(BASKET, { key: null })).status).toBe(201);
    expect((await checkout(BASKET, { key: null })).status).toBe(201);
    expect(createCalls()).toHaveLength(2);
    expect(await orders()).toHaveLength(2);

    // Only random (v4) UUIDs: not the nil UUID, another version, or another variant.
    const nil = "00000000-0000-0000-0000-000000000000";
    const v1 = "6f0d7a52-3b1c-1e8f-9a2d-1c5b7e9f0a11";
    const otherVariant = "6f0d7a52-3b1c-4e8f-7a2d-1c5b7e9f0a11";
    for (const bad of ["", "not-a-uuid", `${KEY}x`, nil, v1, otherVariant]) {
      const res = await checkout(BASKET, { key: bad });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_idempotency_key");
    }
    expect(await orders()).toHaveLength(2);
    // Any case is the same key.
    expect((await checkout(BASKET, { key: KEY.toUpperCase() })).status).toBe(201);
    expect((await checkout(BASKET, { key: KEY })).status).toBe(200);
  });
});

describe("a key reused for something else", () => {
  it("a different basket, buyer, tracking code or event: 422 idempotency_key_reused, nothing written", async () => {
    const first = await checkout();
    const other = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS, title: "Other Gig" });
    for (const [body, on] of [
      [{ ...BASKET, lineItems: [{ ticketTypeId: "ga", quantity: 3 }] }, event],
      [{ ...BASKET, lineItems: [{ ticketTypeId: "ga", quantity: 2 }, { ticketTypeId: "vip", quantity: 1 }] }, event],
      [{ ...BASKET, buyerEmail: "someone@example.com" }, event],
      [{ lineItems: BASKET.lineItems }, event],
      [{ ...BASKET, trackingCode: "abcd2345" }, event],
      [BASKET, other],
    ] as const) {
      const res = await checkout(body, { on });
      expect([res.status, res.body.code]).toEqual([422, "idempotency_key_reused"]);
    }
    expect(createCalls()).toHaveLength(1);
    expect(await orders(other.eventId)).toEqual([]);
    expect((await attempts()).map((a) => a.order_id)).toEqual([first.body.orderId]);
  });

  it("the fingerprint is a hash of the canonical basket: order-insensitive, never the email itself", () => {
    const base = { kind: "ga" as const, eventId: event.eventId, buyerEmail: "fan@example.com", trackingCode: null };
    const a = checkoutFingerprint({ ...base, lines: [{ ticketTypeId: "ga", quantity: 1 }, { ticketTypeId: "vip", quantity: 2 }] });
    const b = checkoutFingerprint({ ...base, lines: [{ ticketTypeId: "vip", quantity: 2 }, { ticketTypeId: "ga", quantity: 1 }] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(checkoutFingerprint({ ...base, kind: "seated", lines: [], seats: { mapVersion: 1, seatIds: ["B2", "A1"] } })).toBe(
      checkoutFingerprint({ ...base, kind: "seated", lines: [], seats: { mapVersion: 1, seatIds: ["A1", "B2"] } }),
    );
    expect(checkoutFingerprint({ ...base, kind: "seated", lines: [], seats: { mapVersion: 2, seatIds: ["A1"] } })).not.toBe(
      checkoutFingerprint({ ...base, kind: "seated", lines: [], seats: { mapVersion: 1, seatIds: ["A1"] } }),
    );
  });
});

describe("after the checkout ended", () => {
  it("cancelled (Back from Stripe): 409 checkout_expired, so the client starts a new checkout", async () => {
    const first = await checkout();
    expect((await api.call(cancelPendingOrder, { params: { sessionId: first.body.orderId }, method: "POST" })).body.status).toBe(
      "released",
    );
    const res = await checkout();
    expect([res.status, res.body.code]).toEqual([409, "checkout_expired"]);
    expect(res.body.error).toMatch(/Start a new checkout/);
    expect(createCalls()).toHaveLength(1);
    // A new key is a new checkout.
    expect((await checkout(BASKET, { key: OTHER_KEY })).status).toBe(201);
  });

  it("the session expired (or the webhook said so): 409 checkout_expired", async () => {
    const first = await checkout();
    await api.db.query(`update private.checkout_attempts set session_expires_at = now() - interval '1 second'`);
    expect((await checkout()).body.code).toBe("checkout_expired");
    await api.db.query(`update private.checkout_attempts set session_expires_at = now() + interval '1 day'`);
    expect((await checkout()).status).toBe(200);
    const expired = stripeWebhookRequest({
      type: "checkout.session.expired",
      data: { object: { id: "cs_test_1", object: "checkout.session", client_reference_id: first.body.orderId } },
    });
    expect((await api.send(stripeWebhook, expired)).status).toBe(200);
    expect((await checkout()).body.code).toBe("checkout_expired");
  });

  it("paid: 409 checkout_completed (derived from the order; begin_checkout_attempt records it when it gets there)", async () => {
    const first = await checkout();
    await api.db.query(`update public.orders set status = 'paid' where id = $1`, [first.body.orderId]);
    const res = await checkout();
    expect([res.status, res.body.code]).toEqual([409, "checkout_completed"]);
    expect(createCalls()).toHaveLength(1);
    // Under the row lock (a request that passed the first look just before the payment landed).
    const [begun] = await api.db.query<{ result: string }>(
      `select result from private.begin_checkout_attempt($1, $2::uuid, 'ga', $3, $4, gen_random_uuid(), '90 seconds',
         '10 minutes', null, 20, 60, 600, '10 minutes')`,
      [event.eventId, KEY, (await api.db.query<{ fingerprint: string }>(`select fingerprint from private.checkout_attempts`))[0].fingerprint,
        `ord_${"0".repeat(32)}`],
    );
    expect(begun.result).toBe("completed");
    expect((await attempts())[0]).toMatchObject({ status: "completed", lease_token: null });
    expect((await checkout()).body.error).toBe("This checkout is already complete. Check your email for your tickets.");
  });

  it("checkout_completed is worded truthfully when the order has no tickets: refunded, or being refunded after selling out", async () => {
    const first = await checkout();
    const orderId = first.body.orderId as string;
    await api.db.query(`update public.orders set status = 'oversold_refund_required' where id = $1`, [orderId]);
    const beingRefunded = await checkout();
    expect([beingRefunded.status, beingRefunded.body.code]).toEqual([409, "checkout_completed"]);
    expect(beingRefunded.body.error).toMatch(/being refunded in full/);
    expect(beingRefunded.body.error).not.toMatch(/email|your tickets/);

    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [orderId]);
    const refunded = await checkout();
    expect([refunded.status, refunded.body.code]).toEqual([409, "checkout_completed"]);
    expect(refunded.body.error).toMatch(/refunded, so it has no tickets/);
    expect(refunded.body.error).not.toMatch(/email|your tickets\./);
    expect(refunded.body).not.toHaveProperty("orderId");
  });
});

describe("Stripe failures and retries", () => {
  it("no answer from Stripe (the session was made, the answer lost): 503, the order kept; the retry gets the same session through Stripe's idempotency", async () => {
    stripe.failNext("lost");
    const first = await checkout();
    expect(first.status).toBe(503);
    expect(first.body).toMatchObject({ code: "payment_provider_unavailable" });
    expect(first.headers.get("retry-after")).toBe("2");
    const [kept] = await orders();
    expect(kept).toMatchObject({ status: "pending", stripe_checkout_session_id: null });
    expect(await attempts()).toEqual([{ idempotency_key: KEY, status: "failed", order_id: kept.id, lease_token: null }]);

    const retry = await checkout();
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual({ url: "https://checkout.stripe.test/cs_test_1", orderId: kept.id });
    expect(stripe.made()).toBe(1); // Stripe made one session in all
    expect(await orders()).toEqual([{ id: kept.id, status: "pending", stripe_checkout_session_id: "cs_test_1" }]);
    // The same order, so the same idempotency key and the very same parameters.
    const [[params1, options1], [params2, options2]] = createCalls();
    expect(options1).toEqual({ idempotencyKey: `checkout-session-${kept.id}`, ...STRIPE_SESSION_REQUEST });
    expect(options2).toEqual(options1);
    expect(params2).toEqual(params1);
  });

  it("Stripe unreachable (nothing made): the retry makes the session for the same order", async () => {
    stripe.failNext("unreachable");
    expect((await checkout()).status).toBe(503);
    const retry = await checkout();
    expect(retry.status).toBe(201);
    expect(stripe.made()).toBe(1);
    expect(await orders()).toHaveLength(1);
  });

  it("a Stripe API error: 500, the order released; a retry with the same key makes a new order (a new Stripe key)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stripe.failNext("refused");
    expect((await checkout()).status).toBe(500);
    const [failed] = await orders();
    expect(failed.status).toBe("failed");
    expect((await attempts())[0]).toMatchObject({ status: "failed", lease_token: null });

    const retry = await checkout();
    expect(retry.status).toBe(201);
    expect(retry.body.orderId).not.toBe(failed.id);
    expect((await orders()).map((o) => o.status)).toEqual(["failed", "pending"]);
    const keys = createCalls().map(([, options]) => options.idempotencyKey);
    expect(keys).toEqual([`checkout-session-${failed.id}`, `checkout-session-${retry.body.orderId}`]);
  });

  it("a Stripe error quoting our idempotency key is logged by type and code only: never the order id", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stripe.failNext("idempotency");
    const res = await checkout();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong." });
    const [order] = await orders();
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("Stripe refused the Checkout Session (StripeIdempotencyError/400)");
    expect(logged).not.toContain(order.id);
    expect(logged).not.toMatch(/ord_[0-9a-f]{32}/);
    expect(logged).not.toContain("Keys for idempotent requests");
  });

  it("a retry after the reuse window makes a new order and fails the kept one", async () => {
    stripe.failNext("unreachable");
    await checkout();
    await api.db.query(`update public.orders set created_at = now() - interval '11 minutes'`);
    const retry = await checkout();
    expect(retry.status).toBe(201);
    const rows = await orders();
    expect(rows.map((o) => o.status).sort()).toEqual(["failed", "pending"]);
    expect(rows.find((o) => o.status === "pending")!.id).toBe(retry.body.orderId);
  });

  it("a request that died mid-way (its lease lapsed): a retry takes over; until then it's in progress", async () => {
    // A lease nobody finished: as if the request was killed after making the order.
    stripe.failNext("unreachable");
    await checkout();
    await api.db.query(
      `update private.checkout_attempts set status = 'in_progress', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '30 seconds'`,
    );
    expect((await checkout()).body.code).toBe("checkout_in_progress");
    await api.db.query(`update private.checkout_attempts set lease_expires_at = now() - interval '1 second'`);
    const retry = await checkout();
    expect(retry.status).toBe(201);
    expect(await orders()).toHaveLength(1);
  });
});

describe("general admission paid checkout limits", () => {
  it("20 per event and 60 in all per client, an alert (never a refusal) past 600 per event, per 10 minutes", () => {
    expect(CHECKOUT_LIMITS).toEqual({ perClient: { event: 20, allEvents: 60 }, perEventAlert: 600, window: "10 minutes" });
  });

  it("20 new checkouts per event from one client, then 429 client_rate_limited writing nothing; replays don't count", async () => {
    const keys = Array.from({ length: CHECKOUT_LIMITS.perClient.event }, () => crypto.randomUUID());
    for (const key of keys) expect((await checkout(BASKET, { key, ip: IP })).status).toBe(201);
    // Replays of an open checkout aren't new checkouts.
    expect((await checkout(BASKET, { key: keys[0], ip: IP })).status).toBe(200);

    const over = await checkout(BASKET, { key: KEY, ip: IP });
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("client_rate_limited");
    expect(over.body.error).toMatch(/a lot of checkouts/);
    expect(await orders()).toHaveLength(20);
    expect(await attempts()).toHaveLength(20); // the refused key wasn't recorded
    const hits = await api.db.query<{ bucket: string; hits: number }>(
      `select bucket, hits from private.client_rate_limits where client_key = $1 order by bucket`,
      [clientKey(IP, WEBHOOK_SECRET)],
    );
    expect(hits).toEqual([
      { bucket: "checkouts", hits: 20 },
      { bucket: `checkouts:${event.eventId}`, hits: 20 },
    ]);
    // Another client still gets through.
    expect((await checkout(BASKET, { key: OTHER_KEY, ip: OTHER_IP })).status).toBe(201);
  });

  it("60 across events per client: 429 client_rate_limited on any event", async () => {
    await api.db.query(
      `insert into private.client_rate_limits (client_key, bucket, window_started_at, hits) values ($1, 'checkouts', now(), 60)`,
      [clientKey(IP, WEBHOOK_SECRET)],
    );
    const res = await checkout(BASKET, { ip: IP });
    expect([res.status, res.body.code]).toEqual([429, "client_rate_limited"]);
    expect(await orders()).toEqual([]);
  });

  it("past 600 per event across clients: every buyer is still served, and one ops alert is queued per event per window", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await api.db.query(
      `insert into private.event_rate_limits (event_id, bucket, window_started_at, hits) values ($1, 'checkouts', now(), 600)`,
      [event.eventId],
    );
    const surgeJobs = () =>
      api.db.query<{ status: string }>(`select status from private.email_outbox where kind = 'ops_alert' and ops_event_id = $1`, [
        event.eventId,
      ]);
    // Over the threshold: served (201), and the first one queues the alert.
    const first = await checkout(BASKET, { ip: IP });
    expect(first.status).toBe(201);
    expect(await surgeJobs()).toEqual([{ status: "pending" }]);
    expect(warn).toHaveBeenCalledWith(`Checkout surge on event ${event.eventId}: over its alert threshold; an ops alert was queued.`);
    // More over the threshold, from other clients: served too, no second alert in the window.
    expect((await checkout(BASKET, { key: OTHER_KEY, ip: OTHER_IP })).status).toBe(201);
    expect((await checkout(BASKET, { key: crypto.randomUUID(), ip: "192.0.2.1" })).status).toBe(201);
    expect(await surgeJobs()).toEqual([{ status: "pending" }]);
    // The per-client limits still count as usual.
    const [hits] = await api.db.query<{ hits: number }>(
      `select hits from private.client_rate_limits where client_key = $1 and bucket = 'checkouts'`,
      [clientKey(IP, WEBHOOK_SECRET)],
    );
    expect(hits.hits).toBe(1);

    // Straight after the response: emailed to OPS_ALERT_EMAIL with the event's title and id, nothing about clients.
    await api.runDeferred();
    expect(await surgeJobs()).toEqual([{ status: "sent" }]);
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const [message] = api.sendEmail.mock.calls[0];
    expect(message.to).toBe(OPS_ALERT_EMAIL);
    expect(message.subject).toBe(`Sheltüh ops alert: Checkout surge for ${event.title}`);
    expect(message.text).toContain(`Event: ${event.title} (${event.eventId})`);
    expect(message.text).toContain("More than 600 new paid checkouts");
    expect(message.text).toContain("Nobody was refused");
    for (const ip of [IP, OTHER_IP, clientKey(IP, WEBHOOK_SECRET)]) expect(message.text).not.toContain(ip);

    // The next window: another alert.
    await api.db.query(`update private.event_rate_limits set window_started_at = now() - interval '11 minutes' where event_id = $1`, [
      event.eventId,
    ]);
    await api.db.query(`update private.event_rate_limits set hits = 601, window_started_at = now() where event_id = $1 and bucket = 'checkouts'`, [
      event.eventId,
    ]);
    expect((await checkout(BASKET, { key: crypto.randomUUID(), ip: IP })).status).toBe(201);
    expect((await surgeJobs()).map((j) => j.status).sort()).toEqual(["pending", "sent"]);
  });

  it("surge alerts are capped at 10 a day platform-wide, apart from the payment exceptions' 20", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('ops_alerts_checkout_surge', now(), 10)`,
    );
    await api.db.query(
      `insert into private.event_rate_limits (event_id, bucket, window_started_at, hits) values ($1, 'checkouts', now(), 600)`,
      [event.eventId],
    );
    expect((await checkout(BASKET, { ip: IP })).status).toBe(201);
    expect(await api.db.query(`select 1 from private.email_outbox where kind = 'ops_alert'`)).toEqual([]);
    // The payment exceptions' own allowance is untouched.
    expect(await api.db.query(`select bucket from private.platform_rate_limits where bucket = 'ops_alerts'`)).toEqual([]);
    expect(await drainEmailOutbox(api.deps, { kind: "ops_alert" })).toMatchObject({ claimed: 0 });
  });

  it("fails open without a client IP (logged without request details): only the event's alert counter counts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await checkout()).status).toBe(201);
    expect(warn).toHaveBeenCalledWith("Checkout without a client IP header: the per-client checkout limit was skipped.");
    expect(await api.db.query(`select * from private.client_rate_limits`)).toEqual([]);
    const [row] = await api.db.query<{ hits: number }>(
      `select hits from private.event_rate_limits where event_id = $1 and bucket = 'checkouts'`,
      [event.eventId],
    );
    expect(row.hits).toBe(1);
  });

  it("refusals decided before the order (sold out, bad input) take nothing", async () => {
    expect((await checkout({ lineItems: [{ ticketTypeId: "vip", quantity: 6 }] }, { ip: IP })).status).toBe(409);
    expect((await checkout({ lineItems: [{ ticketTypeId: "nope", quantity: 1 }] }, { ip: IP })).status).toBe(400);
    expect(await api.db.query(`select * from private.client_rate_limits`)).toEqual([]);
    expect(await attempts()).toEqual([]);
  });
});

describe("seated checkout", () => {
  let seated: EventRecord;

  beforeEach(async () => {
    ({ event: seated } = await seatedEvent(api, organiser, admin, { overrides: { title: "Seat Hall" } }));
  });

  const seats = (seatIds: string[]) => ({ seats: { mapVersion: seated.seating!.version, seatIds } });
  const seatedCheckout = (body = seats(["A1", "A2"]), options: { key?: string; ip?: string } = {}) =>
    checkout(body, { on: seated, key: options.key, ip: options.ip });

  it("a double click holds the seats once and makes one session; a retry gets the same order, hold and session", async () => {
    const open = stripe.hold();
    const results = [seatedCheckout(seats(["A1", "A2"]), { ip: IP }), seatedCheckout(seats(["A1", "A2"]), { ip: IP })];
    const early = await Promise.race(results);
    expect(early.body.code).toBe("checkout_in_progress");
    open();
    const done = (await Promise.all(results)).find((r) => r.status === 201)!;
    expect(Object.keys(done.body).sort()).toEqual(["holdExpiresAt", "orderId", "url"]);
    expect(createCalls()).toHaveLength(1);
    expect((await orders(seated.eventId)).map((o) => o.id)).toEqual([done.body.orderId]);
    expect(await seatStates(api, seated.eventId)).toMatchObject({ A1: `held:${done.body.orderId}`, A2: `held:${done.body.orderId}` });

    // The retry isn't refused for seats its own order holds.
    const retry = await seatedCheckout(seats(["A2", "A1"]), { ip: IP });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(done.body);
    // One hold attempt counted for the client (the per-visitor hold limit), one hold for the event.
    const [client] = await api.db.query<{ hits: number }>(
      `select hits from private.client_rate_limits where client_key = $1 and bucket = $2`,
      [clientKey(IP, WEBHOOK_SECRET), `seat_holds:${seated.eventId}`],
    );
    expect(client.hits).toBe(1);
    const [eventWide] = await api.db.query<{ hits: number }>(
      `select hits from private.event_rate_limits where event_id = $1 and bucket = 'seat_holds'`,
      [seated.eventId],
    );
    expect(eventWide.hits).toBe(1);
    // General admission's checkout buckets aren't touched by seats.
    expect(await api.db.query(`select * from private.client_rate_limits where bucket like 'checkouts%'`)).toEqual([]);
  });

  it("no answer from Stripe: the holds are kept, and a retry within the minute repeats the call for the same order", async () => {
    stripe.failNext("lost");
    expect((await seatedCheckout()).status).toBe(503);
    const [kept] = await orders(seated.eventId);
    expect(await seatStates(api, seated.eventId)).toMatchObject({ A1: `held:${kept.id}`, A2: `held:${kept.id}` });

    const retry = await seatedCheckout();
    expect(retry.status).toBe(201);
    expect(retry.body.orderId).toBe(kept.id);
    expect(stripe.made()).toBe(1);
    const [[params1, options1], [params2, options2]] = createCalls();
    expect(params2).toEqual(params1); // expires_at is fixed by the order, not the call
    expect(options2).toEqual(options1);
    const before = Date.now();
    expect(params1.expires_at * 1000 - before).toBeGreaterThan(30 * 60_000);
    expect(params1.expires_at * 1000 - before).toBeLessThanOrEqual(SEAT_HOLD_LIMITS.stripeSessionMinutes * 60_000);
  });

  it("a retry after the minute: the old order's seats are released and held again by a new order", async () => {
    stripe.failNext("unreachable");
    expect((await seatedCheckout()).status).toBe(503);
    const [old] = await orders(seated.eventId);
    await api.db.query(`update public.orders set created_at = now() - interval '2 minutes' where id = $1`, [old.id]);
    const retry = await seatedCheckout();
    expect(retry.status).toBe(201);
    expect(retry.body.orderId).not.toBe(old.id);
    expect((await orders(seated.eventId)).map((o) => [o.id, o.status])).toEqual([
      [old.id, "failed"],
      [retry.body.orderId, "pending"],
    ]);
    expect(await seatStates(api, seated.eventId)).toMatchObject({ A1: `held:${retry.body.orderId}`, A2: `held:${retry.body.orderId}` });
  });

  it("a Stripe API error releases the holds at once; the same key then holds them again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stripe.failNext("refused");
    expect((await seatedCheckout()).status).toBe(500);
    expect(await seatStates(api, seated.eventId)).toMatchObject({ A1: "free", A2: "free" });
    expect((await seatedCheckout()).status).toBe(201);
  });

  it("a different seat with the same key: 422", async () => {
    await seatedCheckout();
    const res = await seatedCheckout(seats(["A1", "A3"]));
    expect([res.status, res.body.code]).toEqual([422, "idempotency_key_reused"]);
  });
});

describe("retention (purge_operational_data)", () => {
  it("deletes attempts 2 days old, first failing an order one kept pending with no session; keeps recent ones", async () => {
    const RECENT_KEY = crypto.randomUUID();
    stripe.failNext("unreachable");
    await checkout(); // kept pending, no session
    const open = await checkout(BASKET, { key: OTHER_KEY });
    const recent = await checkout(BASKET, { key: RECENT_KEY });
    await api.db.query(
      `update private.checkout_attempts set created_at = now() - interval '2 days 1 minute' where idempotency_key <> $1`,
      [RECENT_KEY],
    );
    const [kept] = await orders();
    const [counts] = await api.db.query<{ checkout_attempts_deleted: number }>(
      `select checkout_attempts_deleted from private.purge_operational_data()`,
    );
    expect(counts.checkout_attempts_deleted).toBe(2);
    expect((await attempts()).map((a) => a.idempotency_key)).toEqual([RECENT_KEY]);
    // Only the order no session was ever recorded for is failed; the others are left to Stripe's webhooks.
    const statuses = Object.fromEntries((await orders()).map((o) => [o.id, o.status]));
    expect(statuses).toEqual({ [kept.id]: "failed", [open.body.orderId]: "pending", [recent.body.orderId]: "pending" });
    const [again] = await api.db.query<{ checkout_attempts_deleted: number }>(
      `select checkout_attempts_deleted from private.purge_operational_data()`,
    );
    expect(again.checkout_attempts_deleted).toBe(0);
  });
});

// Real concurrency: only a real server (PGlite is one connection). Run with
// TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("under concurrency (real Postgres only)", () => {
  it("10 identical requests at once: one order, one Stripe call; the rest wait (409) or replay (200)", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => checkout(BASKET, { ip: IP })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => s === 201 || s === 200 || s === 409)).toBe(true);
    expect(createCalls()).toHaveLength(1);
    expect(await orders()).toHaveLength(1);
    // Only the one new checkout counted.
    const [hits] = await api.db.query<{ hits: number }>(
      `select hits from private.client_rate_limits where client_key = $1 and bucket = 'checkouts'`,
      [clientKey(IP, WEBHOOK_SECRET)],
    );
    expect(hits.hits).toBe(1);
  });

  it("25 different checkouts at once from one client: exactly 20 made, 5 refused, no deadlock", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => checkout(BASKET, { key: crypto.randomUUID(), ip: IP })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(20);
    expect(results.filter((r) => r.body?.code === "client_rate_limited")).toHaveLength(5);
    expect(await orders()).toHaveLength(20);
    expect(await attempts()).toHaveLength(20);
  });

  it("seated: 6 identical requests at once hold the seats once", async () => {
    const { event: seated } = await seatedEvent(api, organiser, admin, { overrides: { title: "Rush Hall" } });
    const body = { seats: { mapVersion: seated.seating!.version, seatIds: ["A1"] } };
    const results = await Promise.all(Array.from({ length: 6 }, () => checkout(body, { on: seated })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
    expect(results.filter((r) => r.body?.code === "seats_unavailable")).toEqual([]);
    expect(await orders(seated.eventId)).toHaveLength(1);
    expect(createCalls()).toHaveLength(1);
  });
});
