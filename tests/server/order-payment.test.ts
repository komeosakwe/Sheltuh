import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckout,
  getOrderBySession,
  getOrderPayment,
  SEAT_HOLD_LIMITS,
  stripeWebhook,
} from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent, seatStates, tierCounts } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// Embedded Checkout (ui_mode embedded_page): the session parameters, the
// publishable-key guard, GET /orders/by-session/{id}/payment, and the
// webhook staying the only thing that issues tickets.

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
  // A session per checkout (stripe_checkout_session_id is unique).
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => embeddedSession(`cs_test_${++n}`));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PAID_TICKETS = [
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 3 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 1 },
];
const FREE_TICKETS = [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }];

async function paidEvent(overrides: Record<string, unknown> = {}) {
  const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS, ...overrides });
  await enablePayouts(api, organiser.organiserId);
  return event;
}

const checkout = (eventId: string, body: Record<string, unknown>) => api.call(createCheckout, { params: { eventId }, body });
const payment = (orderId: string) => api.call(getOrderPayment, { params: { sessionId: orderId } });
const lastParams = () => api.stripe.checkout.sessions.create.mock.lastCall![0];

function completed(orderId: string, sessionId: string, paymentIntent = "pi_test_1") {
  // checkout.session.completed as Stripe sends it for an embedded session: no url, the return_url, ui_mode.
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        ui_mode: "embedded_page",
        url: null,
        client_secret: null,
        return_url: `${SITE_URL}/checkout/success?session_id=${orderId}`,
        redirect_on_completion: "always",
        status: "complete",
        mode: "payment",
        client_reference_id: orderId,
        payment_status: "paid",
        payment_intent: paymentIntent,
        customer_details: { email: "buyer@example.com" },
        metadata: { orderId },
      },
    },
  });
}

/** Everything getOrderPayment could conceivably change. */
async function dbSnapshot() {
  return {
    orders: await api.db.query(
      `select id, status::text as status, stripe_checkout_session_id, stripe_payment_intent_id, buyer_email, updated_at
         from public.orders order by id`,
    ),
    ticketTypes: await api.db.query(`select event_id, id, quantity_sold from public.ticket_types order by event_id, id`),
    seats: await api.db.query(
      `select event_id, id, hold_order_id, hold_expires_at, sold_order_id from public.event_seats order by event_id, id`,
    ),
    tickets: await api.db.query(`select code from public.tickets order by code`),
    outbox: await api.db.query(`select order_id, kind from private.email_outbox order by order_id`),
    clientLimits: await api.db.query(`select * from private.client_rate_limits`),
  };
}

// ---------------------------------------------------------------------------
// Session parameters
// ---------------------------------------------------------------------------

describe("the embedded Checkout Session", () => {
  it("general admission: exactly the hosted session's parameters, with ui_mode and return_url instead of success/cancel URLs", async () => {
    const event = await paidEvent();
    const res = await checkout(event.eventId, {
      lineItems: [{ ticketTypeId: "ga", quantity: 2 }, { ticketTypeId: "vip", quantity: 1 }],
      buyerEmail: "fan@example.com",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const params = lastParams();
    const orderId = params.client_reference_id as string;
    expect(params).toStrictEqual({
      mode: "payment",
      client_reference_id: orderId,
      customer_email: "fan@example.com",
      line_items: [
        { price_data: { currency: "aud", product_data: { name: "GA — Neon Static" }, unit_amount: 3000 }, quantity: 2 },
        { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 170 }, quantity: 2 },
        { price_data: { currency: "aud", product_data: { name: "VIP — Neon Static" }, unit_amount: 8000 }, quantity: 1 },
      ],
      payment_intent_data: { application_fee_amount: 710, transfer_data: { destination: "acct_test_1" } },
      ui_mode: "embedded_page",
      return_url: `${SITE_URL}/checkout/success?session_id=${orderId}`,
      metadata: { orderId, eventId: event.eventId },
    });
    // POST /checkout keeps its shape; only url's meaning changed (our page). No client secret in it.
    expect(res.body).toStrictEqual({ url: `/checkout/pay?order=${orderId}`, orderId });
    expect(JSON.stringify(res.body)).not.toContain("secret");
    const [order] = await api.db.query(`select status::text as status, stripe_checkout_session_id from public.orders`);
    expect(order).toEqual({ status: "pending", stripe_checkout_session_id: "cs_test_1" });
  });

  it("seated: the same, keeping expires_at and the seat descriptions", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const before = Date.now();
    const res = await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1", "B2"] } });
    expect(res.status).toBe(201);
    const params = lastParams();
    const orderId = params.client_reference_id as string;
    expect(params).toStrictEqual({
      mode: "payment",
      client_reference_id: orderId,
      expires_at: expect.any(Number),
      line_items: [
        {
          price_data: {
            currency: "aud",
            product_data: { name: "Premium — Neon Static", description: "Stalls · Row A · Seat 1" },
            unit_amount: 5000,
          },
          quantity: 1,
        },
        { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 250 }, quantity: 1 },
        {
          price_data: {
            currency: "aud",
            product_data: { name: "Standard — Neon Static", description: "Stalls · Row B · Seat 2" },
            unit_amount: 3000,
          },
          quantity: 1,
        },
        { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 170 }, quantity: 1 },
      ],
      payment_intent_data: { application_fee_amount: 420, transfer_data: { destination: "acct_test_1" } },
      ui_mode: "embedded_page",
      return_url: `${SITE_URL}/checkout/success?session_id=${orderId}`,
      metadata: { orderId, eventId: event.eventId },
    });
    expect(params.expires_at * 1000 - before).toBeGreaterThan(30 * 60_000);
    expect(params.expires_at * 1000 - before).toBeLessThanOrEqual(SEAT_HOLD_LIMITS.stripeSessionMinutes * 60_000 + 1000);
    expect(Object.keys(res.body).sort()).toEqual(["holdExpiresAt", "orderId", "url"]);
    expect(res.body.url).toBe(`/checkout/pay?order=${orderId}`);
  });

  it("no client secret from Stripe: the GA order fails at once (500), and nothing can be paid", async () => {
    const event = await paidEvent();
    api.stripe.checkout.sessions.create.mockResolvedValueOnce({ id: "cs_no_secret", url: null, client_secret: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await checkout(event.eventId, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] });
    expect(res.status).toBe(500);
    const [order] = await api.db.query(`select status::text as status from public.orders`);
    expect(order.status).toBe("failed");
  });

  it("no client secret from Stripe: the seats are released at once (500)", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    api.stripe.checkout.sessions.create.mockResolvedValueOnce({ id: "cs_no_secret", url: null, client_secret: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1", "A2"] } });
    expect(res.status).toBe(500);
    const [order] = await api.db.query(`select status::text as status from public.orders`);
    expect(order.status).toBe("failed");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free", A2: "free" });
    expect((await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1"] } })).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Publishable-key guard
// ---------------------------------------------------------------------------

describe("without a usable publishable key", () => {
  beforeEach(() => {
    api.stripePublishableKey = undefined;
  });

  it("a paid GA checkout is 503 before any order or Stripe session is made", async () => {
    const event = await paidEvent();
    const res = await checkout(event.eventId, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Card payments aren't available right now.");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await api.db.query(`select id from public.orders`)).toEqual([]);
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a paid seated checkout is 503 before any hold, hold attempt or order", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { seats: { mapVersion: map.version, seatIds: ["A1"] } },
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(res.status).toBe(503);
    expect(await api.db.query(`select id from public.orders`)).toEqual([]);
    expect(await api.db.query(`select * from private.client_rate_limits`)).toEqual([]);
    expect(await api.db.query(`select * from private.event_rate_limits`)).toEqual([]);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free" });
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("the usual refusals still come first, and free tickets don't need it", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: [...PAID_TICKETS, ...FREE_TICKETS] });
    // Payouts not set up yet: that 409, not the 503.
    expect((await checkout(event.eventId, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] })).status).toBe(409);
    await enablePayouts(api, organiser.organiserId);
    expect((await checkout(event.eventId, { lineItems: [{ ticketTypeId: "ga", quantity: 9 }] })).status).toBe(409);
    const free = await checkout(event.eventId, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" });
    expect(free.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// GET /orders/by-session/{id}/payment
// ---------------------------------------------------------------------------

describe("GET /orders/by-session/{id}/payment", () => {
  async function gaOrder(lineItems = [{ ticketTypeId: "ga", quantity: 2 }, { ticketTypeId: "vip", quantity: 1 }]) {
    const event = await paidEvent();
    const res = await checkout(event.eventId, { lineItems, buyerEmail: "fan@example.com" });
    expect(res.status).toBe(201);
    return { event, orderId: res.body.orderId as string };
  }

  function openSession(id = "cs_test_1", extra: Record<string, unknown> = {}) {
    return embeddedSession(id, { status: "open", payment_status: "unpaid", expires_at: Math.floor(Date.now() / 1000) + 1800, ...extra });
  }

  it("open (general admission): the client secret and a server-priced summary, nothing more; private, no-store", async () => {
    const { event, orderId } = await gaOrder();
    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession("cs_test_1", { expires_at: expiresAt }));
    const res = await payment(orderId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(api.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_1");
    expect(res.body).toStrictEqual({
      status: "open",
      clientSecret: "cs_test_1_secret_test",
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      eventTitle: "Neon Static",
      eventSlug: event.slug,
      eventStartsAt: new Date(event.startsAt).toISOString(),
      eventEndsAt: new Date(event.endsAt).toISOString(),
      venueName: "The Tote",
      suburb: "Collingwood",
      seated: false,
      lines: [
        { ticketTypeName: "GA", quantity: 2, unitTotalCents: 3170, lineTotalCents: 6340 },
        // The organiser absorbs VIP's fee: the buyer pays face value.
        { ticketTypeName: "VIP", quantity: 1, unitTotalCents: 8000, lineTotalCents: 8000 },
      ],
      subtotalCents: 14000,
      buyerFeeCents: 340,
      totalCents: 14340,
    });
    // No ids, fee split, email or other Stripe ids.
    const text = JSON.stringify(res.body);
    for (const leak of [orderId, event.eventId, organiser.organiserId, "acct_test_1", "fan@example.com", "cs_test_1\""]) {
      expect(text).not.toContain(leak);
    }
  });

  it("open (seated): each tier's seats on its line, and seated: true", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const res = await checkout(event.eventId, {
      seats: { mapVersion: map.version, seatIds: ["B2", "A1"] },
      lineItems: [{ ticketTypeId: "ga", quantity: 2 }],
    });
    const orderId = res.body.orderId as string;
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession());
    const body = (await payment(orderId)).body;
    expect(body).toMatchObject({ status: "open", seated: true, eventSlug: event.slug, totalCents: 5250 + 3170 + 2 * 2130 });
    expect(body.lines).toStrictEqual([
      {
        ticketTypeName: "Premium",
        quantity: 1,
        unitTotalCents: 5250,
        lineTotalCents: 5250,
        seats: [{ section: "Stalls", row: "A", seat: "1", kind: "standard" }],
      },
      {
        ticketTypeName: "Standard",
        quantity: 1,
        unitTotalCents: 3170,
        lineTotalCents: 3170,
        seats: [{ section: "Stalls", row: "B", seat: "2", kind: "standard" }],
      },
      { ticketTypeName: "Standing", quantity: 2, unitTotalCents: 2130, lineTotalCents: 4260 },
    ]);
    // The lines add up to the order's total (the same amount Stripe's form shows).
    expect(body.lines.reduce((sum: number, l: { lineTotalCents: number }) => sum + l.lineTotalCents, 0)).toBe(body.totalCents);
  });

  it("an unpublished event's date and venue are left out", async () => {
    const { event, orderId } = await gaOrder();
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession());
    const body = (await payment(orderId)).body;
    expect(body.status).toBe("open");
    for (const key of ["eventStartsAt", "eventEndsAt", "venueName", "suburb"]) expect(body).not.toHaveProperty(key);
  });

  it("processing once Stripe has completed the session; delayed while the payment hasn't cleared", async () => {
    const { orderId } = await gaOrder();
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(embeddedSession("cs_test_1", { status: "complete", payment_status: "paid" }));
    expect((await payment(orderId)).body).toStrictEqual({ status: "processing", delayed: false });
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(embeddedSession("cs_test_1", { status: "complete", payment_status: "unpaid" }));
    expect((await payment(orderId)).body).toStrictEqual({ status: "processing", delayed: true });
  });

  it("closed: Stripe expired it, it's past its expiry, or the order failed", async () => {
    const { event, orderId } = await gaOrder();
    const closed = { status: "closed", eventTitle: "Neon Static", eventSlug: event.slug, seated: false };
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(embeddedSession("cs_test_1", { status: "expired", client_secret: null }));
    expect((await payment(orderId)).body).toStrictEqual(closed);
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession("cs_test_1", { expires_at: Math.floor(Date.now() / 1000) - 5 }));
    expect((await payment(orderId)).body).toStrictEqual(closed);

    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    api.stripe.checkout.sessions.retrieve.mockClear();
    expect((await payment(orderId)).body).toStrictEqual(closed);
    expect(api.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("sold_out (general admission): the tickets went to someone else while it was open", async () => {
    const { event, orderId } = await gaOrder([{ ticketTypeId: "ga", quantity: 2 }]);
    await api.db.query(`update public.ticket_types set quantity_sold = 2 where event_id = $1 and id = 'ga'`, [event.eventId]);
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession());
    expect((await payment(orderId)).body).toStrictEqual({ status: "sold_out", eventTitle: "Neon Static", eventSlug: event.slug, seated: false });
    // Exactly enough left is still open.
    await api.db.query(`update public.ticket_types set quantity_sold = 1 where event_id = $1 and id = 'ga'`, [event.eventId]);
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession());
    expect((await payment(orderId)).body.status).toBe("open");
  });

  it("sold_out (seated): a seat sold to, or held by, another order", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const mine = (await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1", "A2"] } })).body.orderId as string;
    const other = (await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A3"] } })).body.orderId as string;
    const soldOut = { status: "sold_out", eventTitle: "Neon Static", eventSlug: event.slug, seated: true };

    // Another order holds A2 now (still pending; say mine lapsed and it was taken): a payment would be refused.
    await api.db.query(
      `update public.event_seats set hold_order_id = $2, hold_expires_at = now() + interval '5 minutes' where event_id = $1 and id = 'A2'`,
      [event.eventId, other],
    );
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession());
    expect((await payment(mine)).body).toStrictEqual(soldOut);

    // ...or sold it.
    await api.db.query(
      `update public.event_seats set hold_order_id = null, hold_expires_at = null, sold_order_id = $2 where event_id = $1 and id = 'A2'`,
      [event.eventId, other],
    );
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession());
    expect((await payment(mine)).body).toStrictEqual(soldOut);

    // The other order's own seat is fine.
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession("cs_test_2"));
    expect((await payment(other)).body.status).toBe("open");
  });

  it("done once settled: paid, refunded, or refund pending (Stripe isn't asked)", async () => {
    const { orderId } = await gaOrder();
    for (const status of ["paid", "refunded", "oversold_refund_required"]) {
      await api.db.query(`update public.orders set status = $2::public.order_status where id = $1`, [orderId, status]);
      expect((await payment(orderId)).body).toStrictEqual({ status: "done" });
    }
    expect(api.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("404: malformed (no query), unknown, or a guest's free booking; 409 while the session is being set up", async () => {
    const query = vi.spyOn(api.db, "query");
    for (const id of ["nope", "ord_ABC", `ord_${"0".repeat(31)}`, "cs_test_1"]) {
      const res = await payment(id);
      expect([res.status, res.headers.get("cache-control")]).toEqual([404, "private, no-store"]);
    }
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
    expect((await payment(`ord_${"0".repeat(32)}`)).status).toBe(404);

    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    expect((await checkout(event.eventId, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" })).status).toBe(202);
    const [freeLink] = await api.db.query<{ id: string }>(`select id from public.orders where confirmation_token_hash is not null`);
    expect((await payment(freeLink.id)).status).toBe(404);

    const { orderId } = await gaOrder();
    await api.db.query(`update public.orders set stripe_checkout_session_id = null where id = $1`, [orderId]);
    const settingUp = await payment(orderId);
    expect(settingUp.status).toBe(409);
    expect(settingUp.body.error).toBe("This checkout is still being set up. Try again in a moment.");
    expect(api.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("an open session without a client secret is a 500, logged without the order or session", async () => {
    const { orderId } = await gaOrder();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(openSession("cs_test_1", { client_secret: null }));
    expect((await payment(orderId)).status).toBe(500);
    expect(JSON.stringify(error.mock.calls)).not.toContain(orderId);
    expect(JSON.stringify(error.mock.calls)).not.toContain("cs_test_1");
  });

  it("writes nothing and logs nothing, whatever it answers (only the webhook settles an order)", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const seated = (await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1"] } })).body.orderId as string;
    const ga = (await gaOrder()).orderId;
    const logs = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const before = await dbSnapshot();
    const sessions = [
      openSession(),
      embeddedSession("cs_test_1", { status: "complete", payment_status: "paid" }),
      embeddedSession("cs_test_1", { status: "expired", client_secret: null }),
      openSession("cs_test_1", { expires_at: Math.floor(Date.now() / 1000) - 5 }),
    ];
    for (const session of sessions) {
      for (const orderId of [seated, ga]) {
        api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(session);
        expect((await payment(orderId)).status).toBe(200);
      }
    }
    expect(await dbSnapshot()).toEqual(before);
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(api.stripe.refunds.create).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fulfilment: the webhook alone issues tickets
// ---------------------------------------------------------------------------

describe("an embedded session's checkout.session.completed", () => {
  it("fulfils once however often Stripe redelivers it: one set of tickets, inventory once, one email", async () => {
    const event = await paidEvent();
    const res = await checkout(event.eventId, { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] });
    const orderId = res.body.orderId as string;
    // The payment page itself never settles anything.
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce(embeddedSession("cs_test_1", { status: "complete", payment_status: "paid" }));
    expect((await payment(orderId)).body).toStrictEqual({ status: "processing", delayed: false });
    expect((await api.call(getOrderBySession, { params: { sessionId: orderId } })).body).toEqual({ status: "pending" });

    for (let i = 0; i < 3; i++) {
      expect((await api.send(stripeWebhook, completed(orderId, "cs_test_1"))).status).toBe(200);
    }
    const order = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(order.body.status).toBe("paid");
    expect(order.body.tickets).toHaveLength(2);
    expect(await tierCounts(api, event.eventId)).toMatchObject({ ga: { sold: 2 }, vip: { sold: 0 } });
    expect(await api.db.query(`select kind from private.email_outbox where order_id = $1`, [orderId])).toEqual([{ kind: "ticket_email" }]);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect((await payment(orderId)).body).toStrictEqual({ status: "done" });
  });
});

// PGlite is one connection, so these run only with TEST_DATABASE_URL
// (CLAUDE.md, "Quality gates"); the API's postgres.js pool runs up to 5 at once.
describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrent duplicate deliveries (real Postgres only)", () => {
  it("general admission: the same payment delivered 5 times at once is fulfilled and ticketed once", async () => {
    const event: EventRecord = await paidEvent();
    const res = await checkout(event.eventId, { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] });
    const orderId = res.body.orderId as string;
    const results = await Promise.all(Array.from({ length: 5 }, () => api.send(stripeWebhook, completed(orderId, "cs_test_1"))));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const tickets = await api.db.query(`select code from public.tickets where order_id = $1`, [orderId]);
    expect(tickets).toHaveLength(2);
    expect(await tierCounts(api, event.eventId)).toMatchObject({ ga: { sold: 2 }, vip: { sold: 0 } });
    const [order] = await api.db.query(`select status::text as status from public.orders where id = $1`, [orderId]);
    expect(order.status).toBe("paid");
    expect(await api.db.query(`select kind from private.email_outbox where order_id = $1`, [orderId])).toEqual([{ kind: "ticket_email" }]);
    expect(api.stripe.refunds.create).not.toHaveBeenCalled();
  });
});
