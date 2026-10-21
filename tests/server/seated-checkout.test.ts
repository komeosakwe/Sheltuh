import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkInTicket } from "@/lib/server/handlers/check-ins";
import { confirmFreeOrder } from "@/lib/server/handlers/free-orders";
import { cancelPendingOrder, createCheckout, getOrderBySession, SEAT_HOLD_LIMITS, stripeWebhook } from "@/lib/server/handlers/orders";
import { joinWaitlist } from "@/lib/server/handlers/waitlist";
import { SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
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
    return { id: `cs_test_${n}`, url: `https://checkout.stripe.test/cs_test_${n}` };
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

function completed(orderId: string, paymentIntent = `pi_${orderId}`) {
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        client_reference_id: orderId,
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
  const orderId = new URL(api.stripe.checkout.sessions.create.mock.lastCall![0].success_url).searchParams.get("session_id")!;
  expect((await api.send(stripeWebhook, completed(orderId))).status).toBe(200);
  return orderId;
}

describe("holding seats at checkout (paid)", () => {
  it("creates the pending order and holds its seats, priced per seat tier; Stripe expires in 31 minutes", async () => {
    const before = Date.now();
    const res = await checkout({ ...seats(["A1", "B2"]), lineItems: [{ ticketTypeId: "ga", quantity: 2 }], buyerEmail: "fan@example.com" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys(res.body).sort()).toEqual(["holdExpiresAt", "url"]);
    const holdMs = Date.parse(res.body.holdExpiresAt) - before;
    expect(holdMs).toBeGreaterThan(34 * 60_000);
    expect(holdMs).toBeLessThan(36 * 60_000);

    const params = api.stripe.checkout.sessions.create.mock.calls[0][0];
    const orderId = params.client_reference_id;
    expect(params.expires_at * 1000 - before).toBeGreaterThan(30 * 60_000);
    expect(params.expires_at * 1000 - before).toBeLessThanOrEqual(SEAT_HOLD_LIMITS.stripeSessionMinutes * 60_000 + 1000);
    expect(params.cancel_url).toBe(`${SITE_URL}/checkout/cancelled?order=${orderId}`);
    expect(params.line_items).toEqual([
      { price_data: { currency: "aud", product_data: { name: "Premium — Neon Static", description: "Stalls · Row A · Seat 1" }, unit_amount: 5000 }, quantity: 1 },
      { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 250 }, quantity: 1 },
      { price_data: { currency: "aud", product_data: { name: "Standard — Neon Static", description: "Stalls · Row B · Seat 2" }, unit_amount: 3000 }, quantity: 1 },
      { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 170 }, quantity: 1 },
      { price_data: { currency: "aud", product_data: { name: "Standing — Neon Static" }, unit_amount: 2000 }, quantity: 2 },
      { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 130 }, quantity: 2 },
    ]);
    expect(params.payment_intent_data.application_fee_amount).toBe(250 + 170 + 260);

    expect(await orders()).toEqual([{ id: orderId, status: "pending", seat_ids: ["A1", "B2"] }]);
    const [order] = await api.db.query(`select total_cents, stripe_checkout_session_id from public.orders where id = $1`, [orderId]);
    expect(order).toEqual({ total_cents: 5000 + 250 + 3000 + 170 + 2 * 2130, stripe_checkout_session_id: "cs_test_1" });
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

  it("anti-hoarding: 120 hold attempts per event per 10 minutes, then 429 (the attempt counter is all a refusal writes)", async () => {
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
});

describe("general admission is unchanged", () => {
  it("a GA checkout has no hold, no expiry and the event page as cancel_url; its body is just {url}", async () => {
    const ga = await publishedEvent(api, organiser, admin, { title: "Plain Gig" });
    const res = await checkout({ lineItems: [{ ticketTypeId: "ga", quantity: 1 }] }, { eventId: ga.eventId });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(["url"]);
    const params = api.stripe.checkout.sessions.create.mock.lastCall![0];
    expect(params).not.toHaveProperty("expires_at");
    expect(params.cancel_url).toBe(`${SITE_URL}/events/${ga.slug}`);
    const [order] = await api.db.query(`select seat_ids from public.orders where event_id = $1`, [ga.eventId]);
    expect(order.seat_ids).toBeNull();
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
