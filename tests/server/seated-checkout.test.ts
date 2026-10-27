import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkInTicket, getCheckInSummary } from "@/lib/server/handlers/check-ins";
import { confirmFreeOrder } from "@/lib/server/handlers/free-orders";
import {
  cancelPendingOrder,
  createCheckout,
  GA_CHECKOUT_SESSION_MINUTES,
  getOrderBySession,
  SEAT_HOLD_LIMITS,
  stripeWebhook,
} from "@/lib/server/handlers/orders";
import { joinWaitlist } from "@/lib/server/handlers/waitlist";
import { embeddedSession, expectSessionPaymentOptions, sessionAmount, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { orderIdFromUrl, seatedEvent, seatStates, tierCounts } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";
import type { EventRecord, SeatMapRecord } from "@/lib/server/types";

// Seated checkout, holds, fulfilment, refunds, cancel and check-in
// (supabase/migrations/20261101000100_seat_holds.sql).

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let map: SeatMapRecord;

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
  ({ event, map } = await seatedEvent(api, organiser, admin));
  // A session per checkout (stripe_checkout_session_id is unique).
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    n += 1;
    return embeddedSession(`cs_test_${n}`);
  });
});

const checkout = (body: Record<string, unknown>, options: { token?: string; eventId?: string } = {}) =>
  api.call(createCheckout, { token: options.token, params: { eventId: options.eventId ?? event.eventId }, body });

const seats = (seatIds: string[], mapVersion = map.version) => ({ seats: { mapVersion, seatIds } });

async function orders() {
  return api.db.query<{ id: string; status: string; seat_ids: string[] | null }>(
    `select id, status::text as status, seat_ids from public.orders where event_id = $1 order by created_at, id`,
    [event.eventId],
  );
}

async function completed(orderId: string, paymentIntent = `pi_${orderId}`) {
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        client_reference_id: orderId,
        ...(await sessionAmount(api.db, orderId)),
        payment_status: "paid",
        payment_intent: paymentIntent,
        customer_details: { email: "buyer@example.com" },
      },
    },
  });
}

function sessionEvent(type: string, orderId: string) {
  return stripeWebhookRequest({ type, data: { object: { id: "cs_test_1", object: "checkout.session", client_reference_id: orderId } } });
}

function refunded(paymentIntent: string, amount: number, full: boolean) {
  return stripeWebhookRequest({
    type: "charge.refunded",
    data: { object: { id: "ch_1", object: "charge", payment_intent: paymentIntent, amount_refunded: amount, refunded: full } },
  });
}

async function paidSeats(seatIds: string[]) {
  const res = await checkout(seats(seatIds));
  expect(res.status).toBe(201);
  const orderId = new URL(api.stripe.checkout.sessions.create.mock.lastCall![0].return_url).searchParams.get("session_id")!;
  expect((await api.send(stripeWebhook, completed(orderId))).status).toBe(200);
  return orderId;
}

describe("holding seats at checkout (paid)", () => {
  it("creates the pending order and holds its seats, priced per seat tier; Stripe expires in 31 minutes", async () => {
    const before = Date.now();
    const res = await checkout({ ...seats(["A1", "B2"]), lineItems: [{ ticketTypeId: "ga", quantity: 2 }], buyerEmail: "fan@example.com" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(res.body).sort()).toEqual(["holdExpiresAt", "orderId", "url"]);
    const holdMs = Date.parse(res.body.holdExpiresAt) - before;
    expect(holdMs).toBeGreaterThan(34 * 60_000);
    expect(holdMs).toBeLessThan(36 * 60_000);

    const params = api.stripe.checkout.sessions.create.mock.calls[0][0];
    const orderId = params.client_reference_id;
    // The response's order id is the order just made (the one in Stripe's URLs).
    expect(res.body.orderId).toBe(orderId);
    expect(res.body.orderId).toMatch(/^ord_[0-9a-f]{32}$/);
    expect(params.expires_at * 1000 - before).toBeGreaterThan(30 * 60_000);
    expect(params.expires_at * 1000 - before).toBeLessThanOrEqual(SEAT_HOLD_LIMITS.stripeSessionMinutes * 60_000 + 1000);
    // Embedded: our payment page, Stripe's return URL; no success or cancel URL (Back releases the seats).
    expect(res.body.url).toBe(`/checkout/pay?order=${orderId}`);
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toBe(`${SITE_URL}/checkout/success?session_id=${orderId}`);
    expect(params).not.toHaveProperty("cancel_url");
    expect(params).not.toHaveProperty("success_url");
    // Exactly the A$ total (Adaptive Pricing off); the Dashboard's wallets and Link; nothing saved.
    expectSessionPaymentOptions(params);
    expect(params.line_items).toEqual([
      { price_data: { currency: "aud", product_data: { name: "Premium — Neon Static", description: "Stalls · Row A · Seat 1" }, unit_amount: 5000 }, quantity: 1 },
      { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 350 }, quantity: 1 },
      { price_data: { currency: "aud", product_data: { name: "Standard — Neon Static", description: "Stalls · Row B · Seat 2" }, unit_amount: 3000 }, quantity: 1 },
      { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 230 }, quantity: 1 },
      { price_data: { currency: "aud", product_data: { name: "Standing — Neon Static" }, unit_amount: 2000 }, quantity: 2 },
      { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 170 }, quantity: 2 },
    ]);
    expect(params.payment_intent_data.application_fee_amount).toBe(350 + 230 + 340);

    expect(await orders()).toEqual([{ id: orderId, status: "pending", seat_ids: ["A1", "B2"] }]);
    const [order] = await api.db.query(`select total_cents, stripe_checkout_session_id from public.orders where id = $1`, [orderId]);
    expect(order).toEqual({ total_cents: 5000 + 350 + 3000 + 230 + 2 * 2170, stripe_checkout_session_id: "cs_test_1" });
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${orderId}`, B2: `held:${orderId}`, A2: "free" });
    // Nothing is sold until payment.
    expect(await tierCounts(api, event.eventId)).toMatchObject({ prem: { sold: 0 }, std: { sold: 0 }, ga: { sold: 0 } });
  });

  it("every refusal writes nothing: taken, blocked or unknown seats (409 with the seat ids), a changed map, bad input", async () => {
    await checkout(seats(["A1"]));
    const snapshot = { orders: await orders(), seats: await seatStates(api, event.eventId) };
    const cases: [Record<string, unknown>, number, Record<string, unknown>][] = [
      [seats(["A1", "A2"]), 409, { code: "seats_unavailable", seatIds: ["A1"], fieldErrors: { seats: expect.any(String) } }],
      [seats(["B6"]), 409, { code: "seats_unavailable", seatIds: ["B6"] }],
      [seats(["Z9", "A3"]), 409, { code: "seats_unavailable", seatIds: ["Z9"] }],
      [seats(["A3"], map.version + 1), 409, { code: "seat_map_changed", fieldErrors: { seatMapVersion: expect.any(String) } }],
      [{ ...seats(["A3"]), lineItems: [{ ticketTypeId: "prem", quantity: 1 }] }, 400, { fieldErrors: { lineItems: expect.any(String) } }],
      [{ lineItems: [{ ticketTypeId: "std", quantity: 1 }] }, 400, { fieldErrors: { lineItems: expect.stringMatching(/seat map/) } }],
      [seats(Array.from({ length: 11 }, (_, i) => `S${i}`)), 400, { fieldErrors: { seats: expect.stringMatching(/10/) } }],
      [seats(["A3", "A3"]), 400, { fieldErrors: { seats: expect.any(String) } }],
      [seats([]), 400, { fieldErrors: { seats: expect.any(String) } }],
      [{ seats: { seatIds: ["A3"] } }, 400, { fieldErrors: { seatMapVersion: expect.any(String) } }],
    ];
    for (const [body, status, expected] of cases) {
      const res = await checkout(body);
      expect([res.status, res.body]).toEqual([status, expect.objectContaining(expected)]);
    }
    expect({ orders: await orders(), seats: await seatStates(api, event.eventId) }).toEqual(snapshot);
    expect(api.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("general admission lines don't count towards the 10 seats", async () => {
    const { event: big } = await seatedEvent(api, organiser, admin, {
      rows: [{ label: "A", tier: "prem", seats: 12 }],
      overrides: { title: "Big Room" },
    });
    const res = await checkout(
      { seats: { mapVersion: big.seating!.version, seatIds: Array.from({ length: 10 }, (_, i) => `A${i + 1}`) }, lineItems: [{ ticketTypeId: "ga", quantity: 5 }] },
      { eventId: big.eventId },
    );
    expect(res.status).toBe(201);
  });

  it("a seat map on a general admission request, or seats on an event without a map, is a 400", async () => {
    const ga = await publishedEvent(api, organiser, admin, { title: "Plain" });
    expect((await checkout(seats(["A1"]), { eventId: ga.eventId })).status).toBe(400);
  });

  it("anti-hoarding: past the event's held-seat cap (the larger of 20 or 30%), a 429 with the seats asked for, nothing written", async () => {
    const { event: big } = await seatedEvent(api, organiser, admin, {
      rows: [
        { label: "A", tier: "prem", seats: 15 },
        { label: "B", tier: "std", seats: 15 },
      ],
      overrides: { title: "Hoard Hall" },
    });
    const version = big.seating!.version;
    const ids = (row: string, from: number, n: number) => Array.from({ length: n }, (_, i) => `${row}${from + i}`);
    expect((await checkout({ seats: { mapVersion: version, seatIds: ids("A", 1, 10) } }, { eventId: big.eventId })).status).toBe(201);
    expect((await checkout({ seats: { mapVersion: version, seatIds: ids("A", 11, 5).concat(ids("B", 1, 5)) } }, { eventId: big.eventId })).status).toBe(201);
    const over = await checkout({ seats: { mapVersion: version, seatIds: ["B9"] } }, { eventId: big.eventId });
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ code: "hold_cap", seatIds: ["B9"], fieldErrors: { seats: expect.any(String) } });
    expect(await api.db.query(`select 1 from public.orders where event_id = $1`, [big.eventId])).toHaveLength(2);
    // An expired hold doesn't count.
    await api.db.query(`update public.event_seats set hold_expires_at = now() - interval '1 second' where event_id = $1 and id = 'A1'`, [big.eventId]);
    expect((await checkout({ seats: { mapVersion: version, seatIds: ["B9"] } }, { eventId: big.eventId })).status).toBe(201);
  });

  it("only real holds count towards the event's hold attempts: refusals (cap, taken seats, stale map) write nothing", async () => {
    const { event: big } = await seatedEvent(api, organiser, admin, {
      rows: [
        { label: "A", tier: "prem", seats: 15 },
        { label: "B", tier: "std", seats: 15 },
      ],
      overrides: { title: "Count Hall" },
    });
    const version = big.seating!.version;
    const hits = async () =>
      (
        await api.db.query<{ hits: number }>(
          `select hits from private.event_rate_limits where event_id = $1 and bucket = 'seat_holds'`,
          [big.eventId],
        )
      )[0]?.hits ?? 0;
    const ids = (row: string, from: number, n: number) => Array.from({ length: n }, (_, i) => `${row}${from + i}`);
    const holdIn = (seatIds: string[], mapVersion = version) => checkout({ seats: { mapVersion, seatIds } }, { eventId: big.eventId });
    expect((await holdIn(ids("A", 1, 10))).status).toBe(201);
    expect((await holdIn(ids("A", 11, 5).concat(ids("B", 1, 5)))).status).toBe(201);
    expect(await hits()).toBe(2);
    // At the cap (20 held): every attempt is refused, and none counts.
    for (let i = 0; i < 25; i++) expect((await holdIn([`B${10 + (i % 5)}`])).body.code).toBe("hold_cap");
    expect(await hits()).toBe(2);
    // Refused by the database for taken seats or a stale map (the API's early checks bypassed): nothing counted either.
    for (const [seatIds, mapVersion, result] of [
      [["A1"], version, "seats_unavailable"],
      [["B9"], version + 1, "version"],
    ] as const) {
      const [row] = await api.db.query<{ result: string }>(
        `select result from private.hold_seats($1, $2, $3, 'x', '[]'::jsonb, 0, 0, 0, 0, null, null, $4, $5::text[],
                                               '35 minutes', 120, '10 minutes', 20, 0.3)`,
        [`ord_${crypto.randomUUID().replace(/-/g, "")}`, big.eventId, big.organiserId, mapVersion, seatIds],
      );
      expect(row.result).toBe(result);
    }
    expect(await hits()).toBe(2);
    expect(await api.db.query(`select 1 from public.orders where event_id = $1`, [big.eventId])).toHaveLength(2);
  });

  it("a used-up hold window is refused up front: no order, and the counter stays at the limit", async () => {
    await api.db.query(
      `insert into private.event_rate_limits (event_id, bucket, window_started_at, hits) values ($1, 'seat_holds', now(), $2)`,
      [event.eventId, SEAT_HOLD_LIMITS.attempts.limit],
    );
    const res = await checkout(seats(["A1"]));
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: "rate_limited" });
    expect(await orders()).toEqual([]);
    const [{ hits }] = await api.db.query<{ hits: number }>(
      `select hits from private.event_rate_limits where event_id = $1 and bucket = 'seat_holds'`,
      [event.eventId],
    );
    expect(hits).toBe(SEAT_HOLD_LIMITS.attempts.limit);
  });

  it("anti-hoarding: 120 holds per event per 10 minutes, then 429", async () => {
    await api.db.query(
      `insert into private.event_rate_limits (event_id, bucket, window_started_at, hits) values ($1, 'seat_holds', now(), 120)`,
      [event.eventId],
    );
    const res = await checkout(seats(["A1"]));
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: "rate_limited", seatIds: ["A1"] });
    expect(await orders()).toEqual([]);
  });

  it("a Stripe error releases the seats at once and fails the order", async () => {
    api.stripe.checkout.sessions.create.mockRejectedValueOnce(new Error("stripe down"));
    const res = await checkout(seats(["A1", "A2"]));
    expect(res.status).toBe(500);
    const [order] = await orders();
    expect(order.status).toBe("failed");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free", A2: "free" });
    expect((await checkout(seats(["A1"]))).status).toBe(201);
  });

  it("refuses a platform-managed organiser's paid seats and an organiser without payouts, writing nothing", async () => {
    await api.db.query(`update public.organisers set payouts_enabled = false where id = $1`, [organiser.organiserId]);
    expect((await checkout(seats(["A1"]))).status).toBe(409);
    expect(await orders()).toEqual([]);
  });
});

describe("the webhook", () => {
  it("payment: the seats are sold, each ticket gets one, and the buyer sees and is emailed them", async () => {
    const orderId = await paidSeats(["A2", "A1", "B3"]);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `sold:${orderId}`, A2: `sold:${orderId}`, B3: `sold:${orderId}` });
    expect(await tierCounts(api, event.eventId)).toMatchObject({ prem: { sold: 2 }, std: { sold: 1 } });
    const tickets = await api.db.query<{ ticket_type_id: string; seat_id: string }>(
      `select ticket_type_id, seat_id from public.tickets where order_id = $1 order by seat_id`,
      [orderId],
    );
    expect(tickets).toEqual([
      { ticket_type_id: "prem", seat_id: "A1" },
      { ticket_type_id: "prem", seat_id: "A2" },
      { ticket_type_id: "std", seat_id: "B3" },
    ]);
    const order = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(order.body.tickets.map((t: { seat: unknown }) => t.seat)).toEqual(
      expect.arrayContaining([
        { section: "Stalls", row: "A", seat: "1", kind: "standard" },
        { section: "Stalls", row: "A", seat: "2", kind: "standard" },
        { section: "Stalls", row: "B", seat: "3", kind: "standard" },
      ]),
    );
    await api.runDeferred();
    const email = api.sendEmail.mock.calls.at(-1)![0];
    expect(email.text).toContain("Seat: Stalls, Row A, Seat 1");
    expect(email.text).toContain("Seat: Stalls, Row B, Seat 3");
    expect(email.html).toContain("Stalls · Row A · Seat 2");
    // A redelivery changes nothing.
    await api.send(stripeWebhook, completed(orderId));
    expect(await api.db.query(`select 1 from public.tickets where order_id = $1`, [orderId])).toHaveLength(3);
  });

  it("a payment arriving after the hold lapsed still gets the seats if nobody took them", async () => {
    await checkout(seats(["A1"]));
    const [order] = await orders();
    await api.db.query(`update public.event_seats set hold_expires_at = now() - interval '1 minute' where hold_order_id = $1`, [order.id]);
    await api.send(stripeWebhook, completed(order.id));
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `sold:${order.id}` });
  });

  it("oversold: the lapsed hold's seat went to someone else, so the payment is refunded and nothing is sold", async () => {
    await checkout(seats(["A1", "A2"]));
    const [first] = await orders();
    await api.db.query(`update public.event_seats set hold_expires_at = now() - interval '1 minute' where hold_order_id = $1`, [first.id]);
    expect((await checkout(seats(["A2"]))).status).toBe(201);
    const second = (await orders())[1];
    await api.send(stripeWebhook, completed(first.id));
    expect((await orders())[0].status).toBe("refunded");
    expect(api.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: `pi_${first.id}`, reverse_transfer: true, refund_application_fee: true }),
      { idempotencyKey: `oversold-refund-${first.id}` },
    );
    // Its own (expired) hold on A1 is cleared; A2 stays with the other buyer.
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free", A2: `held:${second.id}` });
    expect(await api.db.query(`select hold_order_id from public.event_seats where event_id = $1 and id = 'A1'`, [event.eventId])).toEqual([
      { hold_order_id: null },
    ]);
    expect(await tierCounts(api, event.eventId)).toMatchObject({ prem: { sold: 0 } });
  });

  it("an expired session or a failed async payment releases the seats", async () => {
    for (const type of ["checkout.session.expired", "checkout.session.async_payment_failed"]) {
      await checkout(seats(["A1"]));
      const order = (await orders()).at(-1)!;
      await api.send(stripeWebhook, sessionEvent(type, order.id));
      expect((await orders()).at(-1)!.status).toBe("failed");
      expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free" });
    }
  });

  it("a full refund frees the seats (tickets void) and tells the waitlist; a partial refund doesn't", async () => {
    const { event: tiny } = await seatedEvent(api, organiser, admin, {
      tiers: [{ id: "only", name: "Seat", priceCents: 4000, feePolicy: "buyer-pays", quantityAvailable: 1 }],
      rows: [{ label: "A", tier: "only", seats: 2 }],
      overrides: { title: "Tiny Room" },
    });
    const version = tiny.seating!.version;
    await api.call(createCheckout, { params: { eventId: tiny.eventId }, body: { seats: { mapVersion: version, seatIds: ["A1", "A2"] } } });
    const orderId = api.stripe.checkout.sessions.create.mock.lastCall![0].client_reference_id;
    await api.send(stripeWebhook, completed(orderId, "pi_tiny"));
    expect((await tierCounts(api, tiny.eventId)).only).toEqual({ available: 2, sold: 2, seated: true });
    // Sold out: a member joins the waitlist.
    const fan = await api.signUp({ email: "fan@example.com" });
    expect((await api.call(joinWaitlist, { token: fan.token, params: { eventId: tiny.eventId }, body: {} })).status).toBe(201);

    await api.send(stripeWebhook, refunded("pi_tiny", 1000, false));
    expect(await seatStates(api, tiny.eventId)).toEqual({ A1: `sold:${orderId}`, A2: `sold:${orderId}` });

    await api.send(stripeWebhook, refunded("pi_tiny", 8360, true));
    expect(await seatStates(api, tiny.eventId)).toEqual({ A1: "free", A2: "free" });
    expect((await tierCounts(api, tiny.eventId)).only.sold).toBe(0);
    expect(await api.db.query(`select seat_id from public.tickets where order_id = $1`, [orderId])).toEqual([{ seat_id: null }, { seat_id: null }]);
    const [{ jobs }] = await api.db.query<{ jobs: number }>(
      `select count(*)::int as jobs from private.email_outbox where kind = 'waitlist_available'`,
    );
    expect(jobs).toBe(1);
    // The freed seats can be bought again.
    expect((await api.call(createCheckout, { params: { eventId: tiny.eventId }, body: { seats: { mapVersion: version, seatIds: ["A1"] } } })).status).toBe(201);
    // A redelivered full refund changes nothing.
    await api.send(stripeWebhook, refunded("pi_tiny", 8360, true));
    expect((await tierCounts(api, tiny.eventId)).only.sold).toBe(0);
  });

  it("a seated tier is only ever sold with seats, whatever reaches fulfil_order", async () => {
    const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
    await api.db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents, buyer_fee_cents, total_cents,
         application_fee_cents) values ($1, $2, $3, 'x', $4::text::jsonb, 5000, 0, 5000, 0)`,
      [orderId, event.eventId, event.organiserId, JSON.stringify([{ ticketTypeId: "prem", ticketTypeName: "Premium", unitPriceCents: 5000, feePolicy: "buyer-pays", quantity: 1 }])],
    );
    const [row] = await api.db.query<{ status: string }>(
      `select private.fulfil_order($1, null, null, $2::text::jsonb)::text as status`,
      [orderId, JSON.stringify([{ ticketCode: "AAAA-BBBB", ticketTypeId: "prem", ticketTypeName: "Premium" }])],
    );
    expect(row.status).toBe("oversold_refund_required");
    expect(await tierCounts(api, event.eventId)).toMatchObject({ prem: { sold: 0 } });
  });

  it("the database keeps one owner per seat and a ticket's seat sold to its own order", async () => {
    const orderId = await paidSeats(["A1"]);
    const other = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
    await api.db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents, buyer_fee_cents, total_cents,
         application_fee_cents) values ($1, $2, $3, 'x', '[]'::jsonb, 0, 0, 0, 0)`,
      [other, event.eventId, event.organiserId],
    );
    await expect(
      api.db.query(`update public.event_seats set hold_order_id = $2, hold_expires_at = now() where event_id = $1 and id = 'A1'`, [event.eventId, other]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(api.db.query(`update public.event_seats set blocked = true where event_id = $1 and id = 'A1'`, [event.eventId])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      api.db.query(
        `insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name, seat_id) values ('ZZZZ-ZZZZ', $2, $1, 'prem', 'P', 'A2')`,
        [event.eventId, other],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    expect(orderId).toBeTruthy();
  });
});

describe("cancelling a seated checkout (the buyer left Stripe's page)", () => {
  const cancel = (orderId: string) => api.call(cancelPendingOrder, { params: { sessionId: orderId }, method: "POST" });

  it("Back from Stripe: the order id from the checkout's response cancels it and frees the seats at once", async () => {
    const res = await checkout(seats(["A1", "A2"]));
    expect(res.status).toBe(201);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${res.body.orderId}`, A2: `held:${res.body.orderId}` });
    const cancelled = await cancel(res.body.orderId);
    expect(cancelled.body).toEqual({ status: "released", eventTitle: "Neon Static", eventSlug: event.slug });
    expect(api.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_test_1");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free", A2: "free" });
    // Someone else can have them straight away.
    expect((await checkout(seats(["A1"]))).status).toBe(201);
  });

  it("a paid order's id cancels nothing: it stays paid, its seats sold, and Stripe isn't asked", async () => {
    const orderId = await paidSeats(["A1"]);
    const res = await cancel(orderId);
    expect(res.body.status).toBe("paid");
    expect(api.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect((await orders())[0].status).toBe("paid");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `sold:${orderId}` });
  });

  it("expires the Stripe session first, then releases the seats; safe to repeat", async () => {
    await checkout(seats(["A1", "A2"]));
    const [order] = await orders();
    const res = await cancel(order.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({ status: "released", eventTitle: "Neon Static", eventSlug: event.slug });
    expect(api.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_test_1");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free", A2: "free" });
    expect((await orders())[0].status).toBe("failed");
    expect((await cancel(order.id)).body.status).toBe("released");
  });

  it("a session Stripe already completed isn't cancelled: processing (the webhook settles it)", async () => {
    await checkout(seats(["A1"]));
    const [order] = await orders();
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(new Error("not expirable"));
    api.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({ id: "cs_test_1", status: "complete" });
    expect((await cancel(order.id)).body.status).toBe("processing");
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${order.id}` });
    await api.send(stripeWebhook, completed(order.id));
    expect((await cancel(order.id)).body.status).toBe("paid");
  });

  it("a Stripe failure while expiring leaves the seats held (500), so nothing can be paid for unheld seats", async () => {
    await checkout(seats(["A1"]));
    const [order] = await orders();
    api.stripe.checkout.sessions.expire.mockRejectedValueOnce(new Error("stripe down"));
    expect((await cancel(order.id)).status).toBe(500);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `held:${order.id}` });
  });

  it("404 for an unknown or malformed id; 409 while the session is being set up", async () => {
    expect((await cancel("ord_" + "0".repeat(32))).status).toBe(404);
    expect((await cancel("nope")).status).toBe(404);
    await checkout(seats(["A1"]));
    const [order] = await orders();
    await api.db.query(`update public.orders set stripe_checkout_session_id = null where id = $1`, [order.id]);
    expect((await cancel(order.id)).status).toBe(409);
  });
});

describe("free seats", () => {
  beforeEach(async () => {
    ({ event, map } = await seatedEvent(api, organiser, admin, {
      tiers: [{ id: "free", name: "Free seat", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 1 }],
      rows: [{ label: "A", tier: "free", seats: 6 }],
      overrides: { title: "Free Recital" },
    }));
  });

  it("a member with their own verified email gets the seats at once, through fulfil_order", async () => {
    const fan = await api.signUp({ email: "fan@example.com" });
    const res = await checkout({ ...seats(["A1", "A2"]), buyerEmail: "fan@example.com" }, { token: fan.token });
    expect(res.status).toBe(201);
    const orderId = orderIdFromUrl(res.body.url);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: `sold:${orderId}`, A2: `sold:${orderId}` });
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    const taken = await checkout({ ...seats(["A2", "A3"]), buyerEmail: "fan@example.com" }, { token: fan.token });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: "seats_unavailable", seatIds: ["A2"] });
  });

  it("a guest's seats aren't held until the link is confirmed; the email lists them", async () => {
    const res = await checkout({ ...seats(["A3"]), buyerEmail: "guest@example.com" });
    expect(res.status).toBe(202);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A3: "free" });
    await api.runDeferred(); // the link is emailed after the response
    const email = api.sendEmail.mock.lastCall![0];
    expect(email.text).toContain("Seats: Stalls · Row A · Seat 3");
    expect(email.text).toContain("only held once you confirm");
    const token = email.text.match(/#token=([A-Za-z0-9_-]+)/)![1];
    const confirmed = await api.call(confirmFreeOrder, { body: { token } });
    expect(confirmed.status).toBe(200);
    expect(await seatStates(api, event.eventId)).toMatchObject({ A3: `sold:${orderIdFromUrl(confirmed.body.url)}` });
  });

  it("seats taken before the guest confirms: a tailored 409 naming them, the order failed, nothing issued", async () => {
    await checkout({ ...seats(["A4", "A5"]), buyerEmail: "guest@example.com" });
    await api.runDeferred();
    const token = api.sendEmail.mock.lastCall![0].text.match(/#token=([A-Za-z0-9_-]+)/)![1];
    const fan = await api.signUp({ email: "fan@example.com" });
    expect((await checkout({ ...seats(["A5"]), buyerEmail: "fan@example.com" }, { token: fan.token })).status).toBe(201);
    const res = await api.call(confirmFreeOrder, { body: { token } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "seats_taken",
      seats: [{ section: "Stalls", row: "A", seat: "5", kind: "standard" }],
      eventSlug: event.slug,
    });
    expect(await seatStates(api, event.eventId)).toMatchObject({ A4: "free" });
    const statuses = (await orders()).map((o) => o.status).sort();
    expect(statuses).toEqual(["failed", "paid"]);
  });
});

describe("check-in", () => {
  it("the door is told the seat", async () => {
    const orderId = await paidSeats(["B2"]);
    const [{ code }] = await api.db.query<{ code: string }>(`select code from public.tickets where order_id = $1`, [orderId]);
    const res = await api.call(checkInTicket, {
      token: organiser.token,
      params: { eventId: event.eventId },
      body: { code, requestId: crypto.randomUUID() },
    });
    expect(res.body).toMatchObject({
      outcome: "admitted",
      ticket: { ticketTypeName: "Standard", seat: { section: "Stalls", row: "B", seat: "2", kind: "standard" } },
    });
  });

  it("Recent scans carry the seat for this event's seated tickets only", async () => {
    const orderId = await paidSeats(["B2"]);
    const [{ code }] = await api.db.query<{ code: string }>(`select code from public.tickets where order_id = $1`, [orderId]);
    const ga = await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    expect(ga.status).toBe(201);
    await api.send(stripeWebhook, completed(ga.body.orderId, "pi_ga"));
    const [{ code: gaCode }] = await api.db.query<{ code: string }>(`select code from public.tickets where order_id = $1`, [ga.body.orderId]);
    // A seated ticket of another event: an other_event entry here, and no seat (it's somewhere else).
    const { event: other } = await seatedEvent(api, organiser, admin, { overrides: { title: "Other Hall" } });
    const otherHold = await api.call(createCheckout, {
      params: { eventId: other.eventId },
      body: { seats: { mapVersion: other.seating!.version, seatIds: ["A3"] } },
    });
    await api.send(stripeWebhook, completed(otherHold.body.orderId, "pi_other"));
    const [{ code: otherCode }] = await api.db.query<{ code: string }>(`select code from public.tickets where order_id = $1`, [otherHold.body.orderId]);

    const scan = (ticketCode: string) =>
      api.call(checkInTicket, { token: organiser.token, params: { eventId: event.eventId }, body: { code: ticketCode, requestId: crypto.randomUUID() } });
    await scan(code);
    await scan(gaCode);
    await scan(otherCode);
    await scan("NOPE-NOPE");
    const summary = await api.call(getCheckInSummary, { token: organiser.token, params: { eventId: event.eventId } });
    expect(summary.status).toBe(200);
    const [invalid, otherEvent, gaEntry, seated] = summary.body.recent;
    expect(seated).toMatchObject({ result: "admitted", ticketTypeName: "Standard", seat: { section: "Stalls", row: "B", seat: "2", kind: "standard" } });
    expect(gaEntry).toMatchObject({ result: "admitted", ticketTypeName: "Standing" });
    expect(otherEvent).toMatchObject({ result: "other_event", otherEventTitle: "Other Hall" });
    expect(invalid).toMatchObject({ result: "invalid" });
    for (const entry of [invalid, otherEvent, gaEntry]) expect(entry).not.toHaveProperty("seat");

    // A full refund frees the seat: the log entry no longer names one.
    await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "charge.refunded",
        data: { object: { id: "ch_1", object: "charge", payment_intent: `pi_${orderId}`, amount_refunded: 3230, refunded: true } },
      }),
    );
    const afterRefund = await api.call(getCheckInSummary, { token: organiser.token, params: { eventId: event.eventId } });
    expect(afterRefund.body.recent.at(-1)).not.toHaveProperty("seat");
  });
});

describe("general admission is unchanged", () => {
  it("a GA checkout has no hold, its own hour-long expiry and no cancel_url; its body is {url, orderId}, never cached", async () => {
    const ga = await publishedEvent(api, organiser, admin, { title: "Plain Gig" });
    const before = Date.now();
    const res = await checkout({ lineItems: [{ ticketTypeId: "ga", quantity: 1 }] }, { eventId: ga.eventId });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["orderId", "url"]);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const params = api.stripe.checkout.sessions.create.mock.lastCall![0];
    expect(res.body.orderId).toBe(params.client_reference_id);
    // An hour (GA_CHECKOUT_SESSION_MINUTES), not the seats' 31 minutes: nothing is held for it.
    expect(params.expires_at * 1000 - before).toBeGreaterThan((GA_CHECKOUT_SESSION_MINUTES - 1) * 60_000);
    expect(params.expires_at * 1000 - before).toBeLessThanOrEqual(GA_CHECKOUT_SESSION_MINUTES * 60_000 + 1000);
    expect(params).not.toHaveProperty("cancel_url");
    expectSessionPaymentOptions(params);
    expect(res.body.url).toBe(`/checkout/pay?order=${res.body.orderId}`);
    const [order] = await api.db.query(`select seat_ids from public.orders where event_id = $1`, [ga.eventId]);
    expect(order.seat_ids).toBeNull();

    // Its id cancels it too (expired at Stripe first; nothing to release).
    const cancelled = await api.call(cancelPendingOrder, { params: { sessionId: res.body.orderId }, method: "POST" });
    expect(cancelled.body).toEqual({ status: "released", eventTitle: "Plain Gig", eventSlug: ga.slug });
    expect(api.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    const [after] = await api.db.query(`select status::text as status from public.orders where event_id = $1`, [ga.eventId]);
    expect(after.status).toBe("failed");
  });

  it("a mixed event's GA tier can still be bought without seats", async () => {
    const res = await checkout({ lineItems: [{ ticketTypeId: "ga", quantity: 2 }] });
    expect(res.status).toBe(201);
    const orderId = api.stripe.checkout.sessions.create.mock.lastCall![0].client_reference_id;
    await api.send(stripeWebhook, completed(orderId));
    expect(await tierCounts(api, event.eventId)).toMatchObject({ ga: { sold: 2 } });
  });
});

describe("the runbooks in docs/supabase-setup.md (\"Reserved seating\") work as written", () => {
  async function runbookSql() {
    const { readFile } = await import("node:fs/promises");
    const doc = await readFile(new URL("../../docs/supabase-setup.md", import.meta.url), "utf8");
    const section = doc.slice(doc.indexOf("### Reserved seating"), doc.indexOf("### Redacting personal information"));
    return [...section.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
  }
  const fill = (sql: string, values: Record<string, string>) =>
    Object.entries(values).reduce((text, [key, value]) => text.split(`<${key}>`).join(value), sql);

  it("release a stuck hold, block a seat after approval, move a buyer's seat", async () => {
    const [release, block, move] = await runbookSql();
    await checkout(seats(["A1"]));
    const [held] = await orders();
    await api.db.query(fill(release, { "order id": held.id }));
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free" });
    expect((await orders())[0].status).toBe("failed");

    const sold = await paidSeats(["A2"]);
    await api.db.query(fill(block, { "event id": event.eventId, "seat id": "A3", "your admin user id": admin.userId, why: "camera" }));
    expect(await tierCounts(api, event.eventId)).toMatchObject({ prem: { available: 3, sold: 1 } });
    await expect(api.db.query(fill(block, { "event id": event.eventId, "seat id": "A2", "your admin user id": admin.userId, why: "x" }))).rejects.toThrow(
      /nothing changed/,
    );

    await api.db.query(fill(move, { "event id": event.eventId, "order id": sold, "current seat id": "A2", "new seat id": "A4" }));
    expect(await seatStates(api, event.eventId)).toMatchObject({ A2: "free", A4: `sold:${sold}` });
    expect(await api.db.query(`select seat_id from public.tickets where order_id = $1`, [sold])).toEqual([{ seat_id: "A4" }]);
    const [order] = await api.db.query(`select seat_ids from public.orders where id = $1`, [sold]);
    expect(order.seat_ids).toEqual(["A4"]);
    await expect(
      api.db.query(fill(move, { "event id": event.eventId, "order id": sold, "current seat id": "A4", "new seat id": "B1" })),
    ).rejects.toThrow(/same ticket type/);
  });
});
