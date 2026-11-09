import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { CHECKOUT_PAY_MINUTES, SEAT_HOLD } from "@/lib/api/types";
import { CHECKOUT_ATTEMPT } from "@/lib/server/checkout-attempts";
import {
  CHECKOUT_EXPIRY_LEASE,
  CHECKOUT_EXPIRY_MAX_MISSING,
  CHECKOUT_EXPIRY_RUN,
  CHECKOUT_EXPIRY_STALE_COMPLETE,
  CHECKOUT_EXPIRY_STRIPE_REQUEST,
  runCheckoutExpiry,
  runCheckoutExpiryCron,
} from "@/lib/server/handlers/checkout-expiry";
import {
  BUYER_STRIPE_REQUEST,
  cancelPendingOrder,
  createCheckout,
  GA_CHECKOUT_SESSION_MINUTES,
  getOrderPayment,
  SEAT_HOLD_LIMITS,
  stripeWebhook,
} from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { CRON_SECRET, embeddedSession, sessionAmount, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent, seatStates, tierCounts } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// The checkout pay deadline (docs/architecture.md, "Checkout pay deadline";
// supabase/migrations/20261123000000_checkout_pay_deadline.sql): a card
// checkout is payable for CHECKOUT_PAY_MINUTES from its order's creation,
// then closed for good by the payment page's next read or the sweeper
// (GET /api/cron/checkout-expiry). A payment Stripe still takes for a closed
// order is refunded and issues nothing.

const IP = "203.0.113.7";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

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
  // One session per order, named after it, so each Stripe call can be traced to its order.
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async (params: { client_reference_id: string }) =>
    embeddedSession(`cs_test_${++n}_${params.client_reference_id.slice(4, 12)}`),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PAID = [{ id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }];
const FREE = [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }];

async function paidEvent(overrides: Record<string, unknown> = {}): Promise<EventRecord> {
  const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID, ...overrides });
  await enablePayouts(api, organiser.organiserId);
  return event;
}

const checkout = (eventId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  api.call(createCheckout, { params: { eventId }, body, headers: { "x-forwarded-for": IP, ...headers } });
const payment = (orderId: string) =>
  api.call(getOrderPayment, { params: { sessionId: orderId }, headers: { "x-forwarded-for": IP } });
const cron = (secret: string | null = CRON_SECRET) =>
  api.call(runCheckoutExpiryCron, { headers: secret === null ? {} : { authorization: `Bearer ${secret}` } });

async function gaOrder(event?: EventRecord, quantity = 2): Promise<{ event: EventRecord; orderId: string }> {
  const on = event ?? (await paidEvent());
  const res = await checkout(on.eventId, { lineItems: [{ ticketTypeId: "ga", quantity }] });
  expect(res.status).toBe(201);
  return { event: on, orderId: res.body.orderId as string };
}

async function seatedOrder(event: EventRecord, seatIds: string[]): Promise<string> {
  const res = await checkout(event.eventId, { seats: { mapVersion: event.seating!.version, seatIds } });
  expect(res.status).toBe(201);
  return res.body.orderId as string;
}

/** Moves an order (and its seat holds, which keep their 20 minutes from creation) `minutes` into the past. */
async function age(orderId: string, minutes: number) {
  await api.db.query(`update public.orders set created_at = created_at - make_interval(secs => $2::float8) where id = $1`, [
    orderId,
    minutes * 60,
  ]);
  await api.db.query(
    `update public.event_seats set hold_expires_at = hold_expires_at - make_interval(secs => $2::float8) where hold_order_id = $1`,
    [orderId, minutes * 60],
  );
}

async function order(orderId: string) {
  const [row] = await api.db.query<{ status: string; stripe_checkout_session_id: string | null; stripe_refund_id: string | null }>(
    `select status::text as status, stripe_checkout_session_id, stripe_refund_id from public.orders where id = $1`,
    [orderId],
  );
  return row;
}

const sessionOf = async (orderId: string) => (await order(orderId)).stripe_checkout_session_id!;
const expireCalls = () => api.stripe.checkout.sessions.expire.mock.calls.map((call) => call[0] as string);

async function completed(orderId: string, paymentIntent = "pi_late_1") {
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: await sessionOf(orderId),
        object: "checkout.session",
        ui_mode: "embedded_page",
        url: null,
        client_secret: null,
        return_url: `${SITE_URL}/checkout/success?session_id=${orderId}`,
        status: "complete",
        mode: "payment",
        client_reference_id: orderId,
        ...(await sessionAmount(api.db, orderId)),
        payment_status: "paid",
        payment_intent: paymentIntent,
        customer_details: { email: "late@example.com" },
        metadata: { orderId },
      },
    },
  });
}

const stripeDown = () => new Stripe.errors.StripeConnectionError({ message: "connection refused" });
const notFound = () =>
  new Stripe.errors.StripeInvalidRequestError({
    message: "No such checkout.session",
    type: "invalid_request_error",
    code: "resource_missing",
    statusCode: 404,
  });
const notExpirable = () =>
  new Stripe.errors.StripeInvalidRequestError({ message: "Only Checkout Sessions with a status of open can be expired.", type: "invalid_request_error" });

// ---------------------------------------------------------------------------
// The timings
// ---------------------------------------------------------------------------

describe("the timings", () => {
  it("15 minutes to pay; seats held 5 minutes past it; Stripe's own sessions stay at its 30-minute minimum and a little more", () => {
    expect(CHECKOUT_PAY_MINUTES).toBe(15);
    expect(SEAT_HOLD).toEqual({ holdMinutes: 20, stripeMinutes: 15 });
    expect(SEAT_HOLD_LIMITS.hold).toBe("20 minutes");
    expect(SEAT_HOLD_LIMITS.stripeSessionMinutes).toBe(31);
    expect(GA_CHECKOUT_SESSION_MINUTES).toBe(33);
    // A same-key retry of a kept general admission order reaches Stripe with expires_at still 30+ minutes ahead.
    expect(CHECKOUT_ATTEMPT.gaReuseWithin).toBe("2 minutes");
    expect(CHECKOUT_EXPIRY_RUN).toEqual({ maxOrders: 50, concurrency: 4, budgetMs: 25_000 });
    expect(CHECKOUT_EXPIRY_LEASE).toBe("90 seconds");
    expect(CHECKOUT_EXPIRY_MAX_MISSING).toBe(24);
    expect(CHECKOUT_EXPIRY_STALE_COMPLETE).toBe("60 minutes");
    // The buyer's own requests: bounded too, with one network retry (the routes allow 60 seconds).
    expect(BUYER_STRIPE_REQUEST).toEqual({ timeout: 10_000, maxNetworkRetries: 1 });
  });
});

// ---------------------------------------------------------------------------
// GET …/payment: the deadline
// ---------------------------------------------------------------------------

describe("the payment page's deadline (GET /orders/by-session/{id}/payment)", () => {
  it("open: expiresAt is the order's creation + 15 minutes (not Stripe's later expiry), the same on every read; serverTime is the database's clock", async () => {
    const { orderId } = await gaOrder();
    const [made] = await api.db.query<{ deadline: Date | string; now: Date | string }>(
      `select created_at + interval '15 minutes' as deadline, now() as now from public.orders where id = $1`,
      [orderId],
    );
    const first = await payment(orderId);
    expect(first.body.status).toBe("open");
    expect(first.body.expiresAt).toBe(new Date(made.deadline).toISOString());
    expect(Date.parse(first.body.serverTime)).toBeGreaterThanOrEqual(new Date(made.now).getTime());
    expect(Date.parse(first.body.expiresAt) - Date.parse(first.body.serverTime)).toBeGreaterThan(14 * 60_000);
    // A later read: the same deadline, a later server time.
    await age(orderId, 10);
    const later = await payment(orderId);
    expect(later.body.expiresAt).toBe(new Date(new Date(made.deadline).getTime() - 10 * 60_000).toISOString());
    expect(Date.parse(later.body.expiresAt) - Date.parse(later.body.serverTime)).toBeLessThan(5 * 60_000 + 1000);
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it("seated: the same deadline, before the seats' hold ends", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const orderId = await seatedOrder(event, ["A1"]);
    const res = await payment(orderId);
    expect(res.body.status).toBe("open");
    const [row] = await api.db.query<{ deadline: Date | string; hold: Date | string }>(
      `select o.created_at + interval '15 minutes' as deadline,
              (select min(s.hold_expires_at) from public.event_seats s where s.hold_order_id = o.id) as hold
         from public.orders o where o.id = $1`,
      [orderId],
    );
    expect(res.body.expiresAt).toBe(new Date(row.deadline).toISOString());
    expect(new Date(row.hold).getTime() - Date.parse(res.body.expiresAt)).toBeGreaterThan(4 * 60_000);
  });

  it("Stripe's expiry, if ever sooner than the deadline, is what expiresAt says", async () => {
    const { orderId } = await gaOrder();
    const soon = Math.floor(Date.now() / 1000) + 120;
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(
      embeddedSession(await sessionOf(orderId), { status: "open", payment_status: "unpaid", expires_at: soon }),
    );
    expect((await payment(orderId)).body.expiresAt).toBe(new Date(soon * 1000).toISOString());
  });

  it("just before the deadline it's still open; at it, closed (time_up), Stripe's session expired once and the order failed", async () => {
    const { event, orderId } = await gaOrder();
    const session = await sessionOf(orderId);
    await age(orderId, CHECKOUT_PAY_MINUTES - 0.25);
    expect((await payment(orderId)).body.status).toBe("open");
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();

    await age(orderId, 0.25);
    api.stripe.checkout.sessions.retrieve.mockClear();
    const res = await payment(orderId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toStrictEqual({ status: "closed", reason: "time_up", eventTitle: "Neon Static", eventSlug: event.slug, seated: false });
    expect(expireCalls()).toEqual([session]);
    // Expired straight away: Stripe's session isn't even read first.
    expect(api.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect((await order(orderId)).status).toBe("failed");

    // Closed for good: later reads (and the sweeper) don't ask Stripe again.
    expect((await payment(orderId)).body).toMatchObject({ status: "closed", reason: "time_up" });
    expect((await runCheckoutExpiry(api.deps)).claimed).toBe(0);
    expect(expireCalls()).toEqual([session]);
    expect(api.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("seated: the seats are released at once (before their hold would lapse), so someone else can hold them", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const orderId = await seatedOrder(event, ["A1", "A2"]);
    await age(orderId, 16);
    // The hold itself still has about 4 minutes to run.
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${orderId}`, A2: `held:${orderId}` });
    expect((await payment(orderId)).body).toMatchObject({ status: "closed", reason: "time_up", seated: true });
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free", A2: "free" });
    expect((await order(orderId)).status).toBe("failed");
    const next = await checkout(event.eventId, { seats: { mapVersion: event.seating!.version, seatIds: ["A1"] } });
    expect(next.status).toBe(201);
  });

  it("Stripe already has the payment (complete): processing, nothing released; the webhook then fulfils it", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const orderId = await seatedOrder(event, ["A1"]);
    await age(orderId, 16);
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(notExpirable());
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(
      embeddedSession(await sessionOf(orderId), { status: "complete", payment_status: "paid" }),
    );
    expect((await payment(orderId)).body).toStrictEqual({ status: "processing", delayed: false });
    expect((await order(orderId)).status).toBe("pending");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${orderId}` });

    await api.send(stripeWebhook, completed(orderId));
    expect((await order(orderId)).status).toBe("paid");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `sold:${orderId}` });
    expect(api.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("a delayed payment Stripe has but hasn't cleared: processing (delayed: true)", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(notExpirable());
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(
      embeddedSession(await sessionOf(orderId), { status: "complete", payment_status: "unpaid" }),
    );
    expect((await payment(orderId)).body).toStrictEqual({ status: "processing", delayed: true });
    expect((await order(orderId)).status).toBe("pending");
  });

  it("Stripe can't be asked: closed as unconfirmed (never \"not charged\"), nothing released, logged without the order or session", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const orderId = await seatedOrder(event, ["A1"]);
    const session = await sessionOf(orderId);
    await age(orderId, 16);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(stripeDown());
    api.stripe.checkout.sessions.retrieve.mockRejectedValueOnce(stripeDown());
    expect((await payment(orderId)).body).toStrictEqual({
      status: "closed",
      reason: "unconfirmed",
      eventTitle: "Neon Static",
      eventSlug: event.slug,
      seated: true,
    });
    expect((await order(orderId)).status).toBe("pending");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${orderId}` });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("StripeConnectionError");
    expect(logged).not.toContain(orderId);
    expect(logged).not.toContain(session);

    // The sweeper closes it once Stripe answers.
    warn.mockRestore();
    expect((await runCheckoutExpiry(api.deps)).released).toBe(1);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free" });
  });

  it("a session Stripe has already expired: released without a second expire succeeding", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 40);
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(notExpirable());
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(
      embeddedSession(await sessionOf(orderId), { status: "expired", client_secret: null }),
    );
    expect((await payment(orderId)).body).toMatchObject({ status: "closed", reason: "time_up" });
    expect((await order(orderId)).status).toBe("failed");
  });

  it("a session still open at Stripe (its payment under way, so expire is refused): unconfirmed, nothing released; once paid, it's processing", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const orderId = await seatedOrder(event, ["A1"]);
    const session = await sessionOf(orderId);
    await age(orderId, 16);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(notExpirable());
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(embeddedSession(session, { status: "open", payment_status: "unpaid" }));
    expect((await payment(orderId)).body).toMatchObject({ status: "closed", reason: "unconfirmed" });
    expect((await order(orderId)).status).toBe("pending");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${orderId}` });
    // Both Stripe calls bounded, like every Stripe call of the buyer's requests.
    expect(api.stripe.checkout.sessions.expire).toHaveBeenCalledWith(session, {}, BUYER_STRIPE_REQUEST);
    expect(api.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(session, {}, BUYER_STRIPE_REQUEST);
    // The payment went through: the next read finds the session complete.
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(notExpirable());
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(embeddedSession(session, { status: "complete", payment_status: "paid" }));
    expect((await payment(orderId)).body).toStrictEqual({ status: "processing", delayed: false });
  });

  it("Stripe says the session doesn't exist: unconfirmed, never released", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(notFound());
    api.stripe.checkout.sessions.retrieve.mockRejectedValueOnce(notFound());
    expect((await payment(orderId)).body).toMatchObject({ status: "closed", reason: "unconfirmed" });
    expect((await order(orderId)).status).toBe("pending");
  });

  it("a kept order with no session (Stripe didn't answer, nobody retried): closed past the deadline, not 409, and no Stripe call", async () => {
    const { orderId } = await gaOrder();
    await api.db.query(`update public.orders set stripe_checkout_session_id = null where id = $1`, [orderId]);
    expect((await payment(orderId)).status).toBe(409);
    await age(orderId, 16);
    expect((await payment(orderId)).body).toMatchObject({ status: "closed", reason: "time_up" });
    expect((await order(orderId)).status).toBe("failed");
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it("past the deadline, an order the webhook paid meanwhile is done, never failed", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    await api.send(stripeWebhook, completed(orderId));
    expect((await order(orderId)).status).toBe("paid");
    expect((await payment(orderId)).body).toStrictEqual({ status: "done" });
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it("past the deadline the per-order limit still bounds Stripe calls (429 without asking Stripe)", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    api.stripe.checkout.sessions.expire.mockRejectedValue(stripeDown());
    api.stripe.checkout.sessions.retrieve.mockRejectedValue(stripeDown());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The checkout's own creation read nothing; 20 reads that reach Stripe, then the 21st is refused.
    for (let i = 0; i < 20; i++) expect((await payment(orderId)).status).toBe(200);
    const calls = api.stripe.checkout.sessions.expire.mock.calls.length;
    expect((await payment(orderId)).status).toBe(429);
    expect(api.stripe.checkout.sessions.expire.mock.calls.length).toBe(calls);
  });

  it("the same Idempotency-Key replays the checkout before its deadline, and is checkout_expired after it", async () => {
    const event = await paidEvent();
    const key = crypto.randomUUID();
    const body = { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] };
    const first = await checkout(event.eventId, body, { "idempotency-key": key });
    expect(first.status).toBe(201);
    const replay = await checkout(event.eventId, body, { "idempotency-key": key });
    expect(replay.status).toBe(200);
    expect(replay.body.orderId).toBe(first.body.orderId);
    // The attempt replays until the pay deadline (the order's creation + 15 minutes), not Stripe's later expiry.
    const [attempt] = await api.db.query<{ off: number }>(
      `select abs(extract(epoch from a.session_expires_at - (o.created_at + interval '15 minutes')))::float8 as off
         from private.checkout_attempts a join public.orders o on o.id = a.order_id where a.idempotency_key = $1::uuid`,
      [key],
    );
    expect(attempt.off).toBeLessThanOrEqual(1);
    // 16 minutes on (the attempt's stored deadline with it): even before anything has closed the order, no replay.
    await age(first.body.orderId, 16);
    await api.db.query(
      `update private.checkout_attempts set session_expires_at = session_expires_at - interval '16 minutes' where idempotency_key = $1::uuid`,
      [key],
    );
    expect((await order(first.body.orderId)).status).toBe("pending");
    const late = await checkout(event.eventId, body, { "idempotency-key": key });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("checkout_expired");
  });

  it("Back from the payment page still releases as before (one shared path)", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const orderId = await seatedOrder(event, ["A1"]);
    const res = await api.call(cancelPendingOrder, { params: { sessionId: orderId }, method: "POST" });
    expect(res.body.status).toBe("released");
    expect(expireCalls()).toEqual([await sessionOf(orderId)]);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free" });
    // Read before its deadline, a cancelled checkout is closed as ended, not time_up.
    expect((await payment(orderId)).body).toMatchObject({ status: "closed", reason: "ended" });
  });
});

// ---------------------------------------------------------------------------
// The sweeper (GET /api/cron/checkout-expiry)
// ---------------------------------------------------------------------------

describe("the sweeper (GET /api/cron/checkout-expiry)", () => {
  it("401 without the cron secret, with a wrong one, or when CRON_SECRET isn't set; nothing claimed", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    expect((await cron(null)).status).toBe(401);
    expect((await cron("wrong")).status).toBe(401);
    api.cronSecret = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await cron()).status).toBe(401);
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect((await order(orderId)).status).toBe("pending");
  });

  it("closes only overdue pending card checkouts: paid, failed, fresh and free bookings untouched; returns counts only", async () => {
    const event = await paidEvent();
    const { event: seated } = await seatedEvent(api, organiser, admin, { overrides: { title: "Seat Hall" } });
    const overdueGa = (await gaOrder(event)).orderId;
    const overdueSeated = await seatedOrder(seated, ["A1"]);
    const fresh = (await gaOrder(event)).orderId;
    const justInside = (await gaOrder(event)).orderId;
    const paid = (await gaOrder(event)).orderId;
    const failed = (await gaOrder(event)).orderId;
    const noSession = (await gaOrder(event)).orderId;
    for (const id of [overdueGa, overdueSeated, paid, failed, noSession]) await age(id, 16);
    await age(justInside, CHECKOUT_PAY_MINUTES - 0.5);
    await api.send(stripeWebhook, completed(paid));
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [failed]);
    await api.db.query(`update public.orders set stripe_checkout_session_id = null where id = $1`, [noSession]);
    // A guest's free booking, pending its emailed confirmation (no payment page): never the sweeper's.
    const freeEvent = await publishedEvent(api, organiser, admin, { ticketTypes: FREE, title: "Free Night" });
    expect((await checkout(freeEvent.eventId, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" })).status).toBe(202);
    const [freeLink] = await api.db.query<{ id: string }>(`select id from public.orders where confirmation_token_hash is not null`);
    await age(freeLink.id, 60);
    const sessions = { ga: await sessionOf(overdueGa), seated: await sessionOf(overdueSeated) };

    const res = await cron();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toStrictEqual({
      claimed: 3,
      released: 3,
      complete: 0,
      settled: 0,
      failed: 0,
      leaseLost: 0,
      gaveUp: 0,
      staleComplete: 0,
    });
    expect(expireCalls().sort()).toEqual([sessions.ga, sessions.seated].sort());
    // Bounded: each Stripe call has the sweeper's timeout and no automatic retry.
    for (const call of api.stripe.checkout.sessions.expire.mock.calls) {
      expect(call.slice(1)).toEqual([{}, CHECKOUT_EXPIRY_STRIPE_REQUEST]);
    }
    const statuses = Object.fromEntries(
      await Promise.all(
        [overdueGa, overdueSeated, fresh, justInside, paid, failed, noSession, freeLink.id].map(async (id) => [id, (await order(id)).status]),
      ),
    );
    expect(statuses).toEqual({
      [overdueGa]: "failed",
      [overdueSeated]: "failed",
      [fresh]: "pending",
      [justInside]: "pending",
      [paid]: "paid",
      [failed]: "failed",
      [noSession]: "failed",
      [freeLink.id]: "pending",
    });
    expect(await seatStates(api, seated.eventId)).toMatchObject({ A1: "free" });
    // Released orders leave no bookkeeping behind.
    expect(await api.db.query(`select order_id from private.checkout_expiry_checks`)).toEqual([]);
  });

  it("idempotent: a second run finds nothing and asks Stripe nothing", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    expect((await runCheckoutExpiry(api.deps)).released).toBe(1);
    api.stripe.checkout.sessions.expire.mockClear();
    api.stripe.checkout.sessions.retrieve.mockClear();
    expect(await runCheckoutExpiry(api.deps)).toEqual({
      claimed: 0,
      released: 0,
      complete: 0,
      settled: 0,
      failed: 0,
      leaseLost: 0,
      gaveUp: 0,
      staleComplete: 0,
    });
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(api.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("a session Stripe reports complete is left to the webhook, never looked at again, and cleaned up once settled", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const orderId = await seatedOrder(event, ["A1"]);
    await age(orderId, 16);
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(notExpirable());
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(
      embeddedSession(await sessionOf(orderId), { status: "complete", payment_status: "unpaid" }),
    );
    expect(await runCheckoutExpiry(api.deps)).toMatchObject({ claimed: 1, complete: 1, released: 0 });
    expect((await order(orderId)).status).toBe("pending");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${orderId}` });
    api.stripe.checkout.sessions.expire.mockClear();
    expect((await runCheckoutExpiry(api.deps)).claimed).toBe(0);
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();

    await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "checkout.session.async_payment_succeeded",
        data: { object: { ...(await (await completed(orderId)).json()).data.object } },
      }),
    );
    expect((await order(orderId)).status).toBe("paid");
    expect(await runCheckoutExpiry(api.deps)).toMatchObject({ claimed: 0 });
    expect(await api.db.query(`select order_id from private.checkout_expiry_checks`)).toEqual([]);
  });

  it("Stripe unreachable: nothing released, retried after a back-off (not every run), then closed", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const orderId = await seatedOrder(event, ["A1"]);
    await age(orderId, 16);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(stripeDown());
    api.stripe.checkout.sessions.retrieve.mockRejectedValueOnce(stripeDown());
    expect(await runCheckoutExpiry(api.deps)).toMatchObject({ claimed: 1, failed: 1, released: 0 });
    expect((await order(orderId)).status).toBe("pending");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${orderId}` });
    const [check] = await api.db.query<{ attempts: number; wait: number; lease_token: string | null; last_outcome: string }>(
      `select attempts, extract(epoch from next_check_at - now())::float8 as wait, lease_token, last_outcome
         from private.checkout_expiry_checks where order_id = $1`,
      [orderId],
    );
    expect(check).toMatchObject({ attempts: 1, lease_token: null, last_outcome: "error" });
    expect(check.wait).toBeGreaterThan(110);
    expect(check.wait).toBeLessThanOrEqual(120);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(orderId);

    // The next run, straight away, leaves it alone.
    expect((await runCheckoutExpiry(api.deps)).claimed).toBe(0);
    // Once the back-off has passed, it's closed.
    await api.db.query(`update private.checkout_expiry_checks set next_check_at = now() - interval '1 second'`);
    expect(await runCheckoutExpiry(api.deps)).toMatchObject({ claimed: 1, released: 1 });
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free" });
  });

  it("the back-off doubles from 2 minutes up to an hour", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    api.stripe.checkout.sessions.expire.mockRejectedValue(stripeDown());
    api.stripe.checkout.sessions.retrieve.mockRejectedValue(stripeDown());
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      await api.db.query(`update private.checkout_expiry_checks set next_check_at = now() - interval '1 second'`);
      expect((await runCheckoutExpiry(api.deps)).failed).toBe(1);
      const [row] = await api.db.query<{ wait: number }>(
        `select round(extract(epoch from next_check_at - now()) / 60)::int as wait from private.checkout_expiry_checks`,
      );
      waits.push(row.wait);
    }
    expect(waits).toEqual([2, 4, 8, 16, 32, 60, 60]);
  });

  it("a session Stripe says doesn't exist: never released, retried with the back-off, given up after 24 tries with a warning (counts only)", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const orderId = await seatedOrder(event, ["A1"]);
    const session = await sessionOf(orderId);
    await age(orderId, 16);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.stripe.checkout.sessions.expire.mockRejectedValue(notFound());
    api.stripe.checkout.sessions.retrieve.mockRejectedValue(notFound());
    for (let i = 1; i < CHECKOUT_EXPIRY_MAX_MISSING; i++) {
      await api.db.query(`update private.checkout_expiry_checks set next_check_at = now() - interval '1 second'`);
      expect(await runCheckoutExpiry(api.deps)).toMatchObject({ claimed: 1, failed: 1, gaveUp: 0, released: 0 });
    }
    expect(JSON.stringify(warn.mock.calls)).not.toContain("gave_up=");
    await api.db.query(`update private.checkout_expiry_checks set next_check_at = now() - interval '1 second'`);
    expect(await runCheckoutExpiry(api.deps)).toMatchObject({ claimed: 1, failed: 1, gaveUp: 1, released: 0 });
    const [check] = await api.db.query<{ attempts: number; next_check_at: unknown; last_outcome: string }>(
      `select attempts, next_check_at, last_outcome from private.checkout_expiry_checks where order_id = $1`,
      [orderId],
    );
    expect(check).toEqual({ attempts: 24, next_check_at: null, last_outcome: "missing" });
    // Never released, and never asked about again.
    expect((await order(orderId)).status).toBe("pending");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${orderId}` });
    api.stripe.checkout.sessions.expire.mockClear();
    expect((await runCheckoutExpiry(api.deps)).claimed).toBe(0);
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("gave_up=1");
    expect(logged).not.toContain(orderId);
    expect(logged).not.toContain(session);
  });

  it("other Stripe errors are retried without a cap", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await api.db.query(
      `insert into private.checkout_expiry_checks (order_id, attempts, next_check_at, last_outcome) values ($1, 40, now(), 'error')`,
      [orderId],
    );
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(stripeDown());
    api.stripe.checkout.sessions.retrieve.mockRejectedValueOnce(stripeDown());
    expect(await runCheckoutExpiry(api.deps)).toMatchObject({ failed: 1, gaveUp: 0 });
    const [check] = await api.db.query<{ scheduled: boolean }>(`select next_check_at is not null as scheduled from private.checkout_expiry_checks`);
    expect(check.scheduled).toBe(true);
  });

  it("warns (counts only) about complete sessions whose order is still pending an hour on: a lost webhook", async () => {
    const event = await paidEvent();
    const stale = (await gaOrder(event)).orderId;
    const recent = (await gaOrder(event)).orderId;
    await age(stale, 61);
    await age(recent, 16);
    api.stripe.checkout.sessions.expire.mockRejectedValue(notExpirable());
    api.stripe.checkout.sessions.retrieve.mockImplementation(async (id: string) =>
      embeddedSession(id, { status: "complete", payment_status: "unpaid" }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await runCheckoutExpiry(api.deps)).toMatchObject({ claimed: 2, complete: 2, staleComplete: 1 });
    // Every run says so while it lasts (the sessions themselves aren't asked about again).
    api.stripe.checkout.sessions.expire.mockClear();
    expect(await runCheckoutExpiry(api.deps)).toMatchObject({ claimed: 0, staleComplete: 1 });
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("stale_complete=1");
    for (const id of [stale, recent]) expect(logged).not.toContain(id);
    // Once the webhook lands, it's gone.
    await api.send(stripeWebhook, completed(stale));
    expect((await runCheckoutExpiry(api.deps)).staleComplete).toBe(0);
  });

  it("an order another run has leased is skipped", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    await api.db.query(
      `insert into private.checkout_expiry_checks (order_id, lease_token, lease_expires_at, next_check_at)
       values ($1, gen_random_uuid(), now() + interval '60 seconds', now())`,
      [orderId],
    );
    expect((await runCheckoutExpiry(api.deps)).claimed).toBe(0);
    // A lease that lapsed (its run died) is taken over.
    await api.db.query(`update private.checkout_expiry_checks set lease_expires_at = now() - interval '1 second'`);
    expect(await runCheckoutExpiry(api.deps)).toMatchObject({ claimed: 1, released: 1 });
  });

  it("a recorded outcome needs the lease; releasing doesn't (Stripe has closed the session)", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    const [claim] = await api.db.query<{ claimed_order_id: string; claimed_lease_token: string }>(
      `select * from private.claim_overdue_checkouts(interval '15 minutes', 10, interval '90 seconds')`,
    );
    expect(claim.claimed_order_id).toBe(orderId);
    const finish = (lease: string, outcome: string) =>
      api.db.query<{ r: string }>(`select private.finish_checkout_expiry($1, $2::uuid, $3) as r`, [orderId, lease, outcome]);
    expect((await finish(crypto.randomUUID(), "error"))[0].r).toBe("lost");
    expect((await finish(crypto.randomUUID(), "complete"))[0].r).toBe("lost");
    expect((await finish(crypto.randomUUID(), "expired"))[0].r).toBe("released");
    expect((await finish(claim.claimed_lease_token, "expired"))[0].r).toBe("failed");
    await expect(finish(claim.claimed_lease_token, "paid")).rejects.toThrow(/invalid arguments/);
    await expect(
      api.db.query(`select private.finish_checkout_expiry($1, $2::uuid, 'missing', 0)`, [orderId, claim.claimed_lease_token]),
    ).rejects.toThrow(/invalid arguments/);
    await expect(
      api.db.query(`select * from private.claim_overdue_checkouts(interval '0', 10, interval '90 seconds')`),
    ).rejects.toThrow(/invalid arguments/);
  });

  it("bounded: at most maxOrders per run, oldest first; the next run takes the rest", async () => {
    const event = await paidEvent();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await gaOrder(event, 1)).orderId);
    for (const [i, id] of ids.entries()) await age(id, 30 - i);
    const first = await runCheckoutExpiry(api.deps, { maxOrders: 2, concurrency: 1 });
    expect(first).toMatchObject({ claimed: 2, released: 2 });
    expect((await order(ids[0])).status).toBe("failed");
    expect((await order(ids[1])).status).toBe("failed");
    expect((await order(ids[2])).status).toBe("pending");
    expect((await runCheckoutExpiry(api.deps)).released).toBe(3);
  });

  it("logs counts only: never an order id, a session id or a secret", async () => {
    const { orderId } = await gaOrder();
    await age(orderId, 16);
    const logs = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const session = await sessionOf(orderId);
    await cron();
    const logged = JSON.stringify(logs.map((l) => l.mock.calls));
    expect(logged).toContain("1 overdue, 1 released");
    for (const leak of [orderId, session, CRON_SECRET, "secret_test"]) expect(logged).not.toContain(leak);
  });
});

// ---------------------------------------------------------------------------
// A payment that still completes after we closed the checkout
// ---------------------------------------------------------------------------

describe("a late checkout.session.completed for a checkout closed at its deadline", () => {
  it("seated: refunded in full once, no tickets, and the seats stay with whoever has them now", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const late = await seatedOrder(event, ["A1"]);
    await age(late, 16);
    expect((await runCheckoutExpiry(api.deps)).released).toBe(1);
    // Someone else takes and pays for A1.
    const other = await seatedOrder(event, ["A1"]);
    await api.send(stripeWebhook, completed(other, "pi_other"));
    expect((await order(other)).status).toBe("paid");
    const tiers = await tierCounts(api, event.eventId);

    // The first buyer's form had been mid-payment: Stripe completes it anyway.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await api.send(stripeWebhook, completed(late))).status).toBe(200);
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    const [params, options] = api.stripe.refunds.create.mock.calls[0];
    expect(params).toMatchObject({ payment_intent: "pi_late_1", metadata: { orderId: late, reason: "paid_after_order_failed" } });
    expect(options).toEqual({ idempotencyKey: `failed-order-refund-${late}` });
    expect(await order(late)).toMatchObject({ status: "failed", stripe_refund_id: "re_test_1" });
    expect(await api.db.query(`select code from public.tickets where order_id = $1`, [late])).toEqual([]);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `sold:${other}` });
    expect(await tierCounts(api, event.eventId)).toEqual(tiers);

    // Stripe redelivers: nothing more.
    await api.send(stripeWebhook, completed(late));
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("general admission: refunded, no tickets issued and no inventory taken", async () => {
    const event = await paidEvent();
    const { orderId } = await gaOrder(event, 2);
    await age(orderId, 16);
    expect((await payment(orderId)).body).toMatchObject({ status: "closed", reason: "time_up" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await api.send(stripeWebhook, completed(orderId));
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect((await order(orderId)).status).toBe("failed");
    expect(await api.db.query(`select code from public.tickets where order_id = $1`, [orderId])).toEqual([]);
    expect((await tierCounts(api, event.eventId)).ga.sold).toBe(0);
    expect(await api.db.query(`select kind from private.email_outbox where order_id = $1`, [orderId])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Real concurrency (PGlite is one connection): TEST_DATABASE_URL only
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.TEST_DATABASE_URL)("under concurrency (real Postgres only)", () => {
  /** Stripe answering slowly, so the runs' leases overlap. */
  function slowStripe() {
    api.stripe.checkout.sessions.expire.mockImplementation(async (id: string) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { id, status: "expired" };
    });
  }

  it("3 sweeps at once over 12 overdue checkouts: each session expired exactly once, each order released once, no deadlock", async () => {
    slowStripe();
    const event = await paidEvent();
    const { event: seated } = await seatedEvent(api, organiser, admin, { overrides: { title: "Race Hall" } });
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push((await gaOrder(event, 1)).orderId);
    for (const seat of ["A1", "A2", "A3", "A4"]) ids.push(await seatedOrder(seated, [seat]));
    for (const id of ids) await age(id, 16);

    const runs = await Promise.all([1, 2, 3].map(() => runCheckoutExpiry(api.deps)));
    expect(runs.reduce((n, r) => n + r.claimed, 0)).toBe(12);
    expect(runs.reduce((n, r) => n + r.released, 0)).toBe(12);
    expect(runs.every((r) => r.failed === 0 && r.leaseLost === 0 && r.settled === 0)).toBe(true);
    const calls = expireCalls();
    expect(new Set(calls).size).toBe(12);
    expect(calls).toHaveLength(12);
    for (const id of ids) expect((await order(id)).status).toBe("failed");
    expect(await seatStates(api, seated.eventId)).toMatchObject({ A1: "free", A2: "free", A3: "free", A4: "free" });
  });

  it("sweeps racing the payment page and paying webhooks: paid orders stay paid with one set of tickets, the rest are released", async () => {
    const event = await paidEvent();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await gaOrder(event, 1)).orderId);
    for (const id of ids) await age(id, 16);
    const paying = new Set(ids.slice(0, 3));
    const sessionToOrder = new Map<string, string>();
    for (const id of ids) sessionToOrder.set(await sessionOf(id), id);
    // Stripe: the paying buyers' sessions are complete (expire refused), the others expire.
    api.stripe.checkout.sessions.expire.mockImplementation(async (id: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (paying.has(sessionToOrder.get(id)!)) throw notExpirable();
      return { id, status: "expired" };
    });
    api.stripe.checkout.sessions.retrieve.mockImplementation(async (id: string) =>
      embeddedSession(id, paying.has(sessionToOrder.get(id)!) ? { status: "complete", payment_status: "paid" } : { status: "expired" }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const webhooks = await Promise.all([...paying].map((id) => completed(id, `pi_${id.slice(4, 12)}`)));
    await Promise.all([
      runCheckoutExpiry(api.deps),
      runCheckoutExpiry(api.deps),
      ...ids.map((id) => payment(id)),
      ...webhooks.map((req) => api.send(stripeWebhook, req)),
    ]);
    for (const id of ids) {
      expect((await order(id)).status, id).toBe(paying.has(id) ? "paid" : "failed");
    }
    const tickets = await api.db.query<{ order_id: string; n: number }>(
      `select order_id, count(*)::int as n from public.tickets group by order_id order by order_id`,
    );
    expect(tickets).toEqual([...paying].sort().map((order_id) => ({ order_id, n: 1 })));
    expect((await tierCounts(api, event.eventId)).ga.sold).toBe(3);
    expect(api.stripe.refunds.create).not.toHaveBeenCalled();
  });
});
