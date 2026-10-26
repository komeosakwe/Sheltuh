import { createHash } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkoutFingerprint } from "@/lib/server/checkout-attempts";
import { getAnalyticsOverview, getEventAnalytics } from "@/lib/server/handlers/analytics";
import { createCheckout, getOrderBySession, getOrderPayment, stripeWebhook } from "@/lib/server/handlers/orders";
import { adminListPaymentExceptions } from "@/lib/server/handlers/payment-exceptions";
import { orderReference } from "@/lib/server/order-reference";
import { createTrackingLink, listTrackingLinks } from "@/lib/server/handlers/tracking-links";
import { parseSupportCents } from "@/lib/server/order-input";
import { opsAlertLines } from "@/lib/server/ops-alert-email";
import { paymentExceptionUrgent } from "@/lib/server/records";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import type { EventRecord, OrderRecord } from "@/lib/server/types";
import {
  isValidSupportCents,
  SUPPORT_BLURB,
  SUPPORT_LABEL,
  SUPPORT_MAX_CENTS,
  SUPPORT_MIN_CENTS,
  SUPPORT_PRESETS_CENTS,
  SUPPORT_RECIPIENT_NOTE,
  SUPPORT_REFUND_NOTE,
} from "@/lib/support";
import { embeddedSession, OPS_ALERT_EMAIL, sessionAmount, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent, seatStates } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// Support Sheltüh (docs/architecture.md, "Support Sheltüh";
// supabase/migrations/20261110000100_order_support.sql): an optional amount a
// buyer adds to a paid checkout, all of it the platform's.

const IP = "203.0.113.9";

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
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 5 },
];
const MIXED_TICKETS = [...PAID_TICKETS, { id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }];
const FREE_TICKETS = [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }];
/** 2 × GA (A$30 + A$2.30 fee, buyer pays) and 1 × VIP (A$80, A$5.30 fee absorbed): A$144.60 paid, A$9.90 booking fees. */
const BASKET = [
  { ticketTypeId: "ga", quantity: 2 },
  { ticketTypeId: "vip", quantity: 1 },
];
const BASKET_TOTAL = 2 * 3230 + 8000;
const BASKET_FEES = 2 * 230 + 530;

async function paidEvent(ticketTypes: unknown[] = PAID_TICKETS) {
  const event = await publishedEvent(api, organiser, admin, { ticketTypes });
  await enablePayouts(api, organiser.organiserId);
  return event;
}

const checkout = (eventId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  api.call(createCheckout, { params: { eventId }, body, headers: { "x-forwarded-for": IP, ...headers } });
const lastParams = () => api.stripe.checkout.sessions.create.mock.lastCall![0];

/** What Stripe charges for a session's line items, and what it transfers to the organiser (total − application fee). */
function money(params: {
  line_items: { price_data: { unit_amount: number }; quantity: number }[];
  payment_intent_data: { application_fee_amount: number };
}) {
  const charged = params.line_items.reduce((sum, l) => sum + l.price_data.unit_amount * l.quantity, 0);
  return { charged, fee: params.payment_intent_data.application_fee_amount, transfer: charged - params.payment_intent_data.application_fee_amount };
}

async function storedOrder(orderId: string) {
  const [row] = await api.db.query<Record<string, unknown>>(
    `select status::text as status, subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, support_cents,
            amount_refunded_cents
       from public.orders where id = $1`,
    [orderId],
  );
  return row;
}

async function completed(orderId: string, sessionId: string, paymentIntent = "pi_test_1") {
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
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

/** checkout.session.completed with what Stripe says it charged set by the test (null: left out). */
function paidWithMoney(
  orderId: string,
  money: { amount_total: number | null; currency: string | null },
  paymentIntent = `pi_${orderId}`,
  eventId = "evt_paid",
) {
  return stripeWebhookRequest({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        client_reference_id: orderId,
        payment_status: "paid",
        payment_intent: paymentIntent,
        customer_details: { email: "buyer@example.com" },
        ...(money.amount_total === null ? {} : { amount_total: money.amount_total }),
        ...(money.currency === null ? {} : { currency: money.currency }),
      },
    },
  });
}

async function exceptionsOf(orderId: string) {
  return api.db.query<{ kind: string; status: string; payment_intent_id: string | null; stripe_event_id: string | null; details: Record<string, unknown> }>(
    `select kind, status, payment_intent_id, stripe_event_id, details from private.payment_exceptions where order_id = $1 order by created_at`,
    [orderId],
  );
}

async function opsAlertJobs() {
  return api.db.query<{ status: string }>(`select status from private.email_outbox where kind = 'ops_alert' order by id`);
}

/** A GA checkout of BASKET with `supportCents`, paid (webhook): its order id. */
async function paidOrder(eventId: string, supportCents?: number, extra: Record<string, unknown> = {}) {
  const res = await checkout(eventId, { lineItems: BASKET, ...(supportCents !== undefined ? { supportCents } : {}), ...extra });
  expect(res.status).toBe(201);
  const orderId = res.body.orderId as string;
  const sessionId = (await api.db.query<{ s: string }>(`select stripe_checkout_session_id as s from public.orders where id = $1`, [orderId]))[0].s;
  const hook = await api.send(stripeWebhook, completed(orderId, sessionId, `pi_${orderId}`));
  expect(hook.status).toBe(200);
  return orderId;
}

// ---------------------------------------------------------------------------
// The shared module and the boundary
// ---------------------------------------------------------------------------

describe("lib/support.ts", () => {
  it("has the owner's amounts and limits, and copy that never says donation, charity or tax", () => {
    expect(SUPPORT_PRESETS_CENTS).toEqual([200, 500, 1000]);
    expect([SUPPORT_MIN_CENTS, SUPPORT_MAX_CENTS]).toEqual([100, 50_000]);
    expect(SUPPORT_LABEL).toBe("Support Sheltüh");
    for (const copy of [SUPPORT_LABEL, SUPPORT_BLURB, SUPPORT_RECIPIENT_NOTE]) {
      expect(copy).not.toMatch(/donat|charit|tax|deductib|tip\b/i);
    }
  });

  it("isValidSupportCents: 0 (none) or a whole number of cents from A$1 to A$500", () => {
    for (const ok of [0, 100, 200, 500, 1000, 50_000]) expect(isValidSupportCents(ok), String(ok)).toBe(true);
    for (const bad of [1, 99, 50_001, -100, 5.5, Number.NaN, Infinity, "500", null, undefined, true]) {
      expect(isValidSupportCents(bad), String(bad)).toBe(false);
    }
  });

  it("parseSupportCents: omitted, null and 0 are none; anything else out of range or not whole is a 400 on supportCents", () => {
    expect([parseSupportCents(undefined), parseSupportCents(null), parseSupportCents(0)]).toEqual([0, 0, 0]);
    expect([parseSupportCents(100), parseSupportCents(50_000)]).toEqual([100, 50_000]);
    for (const [value, message] of [
      [99, "Support Sheltüh must be at least A$1."],
      [-500, "Support Sheltüh must be at least A$1."],
      [50_001, "Support Sheltüh can be at most A$500."],
      [5.5, "Support Sheltüh must be a whole number of cents."],
      ["500", "Support Sheltüh must be a whole number of cents."],
      [Number.NaN, "Support Sheltüh must be a whole number of cents."],
    ] as const) {
      expect(() => parseSupportCents(value)).toThrow(expect.objectContaining({ statusCode: 400, fieldErrors: { supportCents: message } }));
    }
  });

  it("the attempt fingerprint is unchanged without support, and differs with any amount", () => {
    const basket = {
      kind: "ga" as const,
      eventId: "evt",
      lines: [{ ticketTypeId: "ga", quantity: 2 }],
      buyerEmail: " Fan@Example.com ",
      trackingCode: null,
    };
    // Exactly the hash an attempt made before Support Sheltüh existed has (so a replay across the deploy still matches).
    const before = createHash("sha256")
      .update(JSON.stringify(["checkout/v1", "ga", "evt", [["ga", 2]], null, "fan@example.com", null]), "utf8")
      .digest("hex");
    expect(checkoutFingerprint(basket)).toBe(before);
    expect(checkoutFingerprint({ ...basket, supportCents: 0 })).toBe(before);
    const five = checkoutFingerprint({ ...basket, supportCents: 500 });
    expect(five).not.toBe(before);
    expect(checkoutFingerprint({ ...basket, supportCents: 1000 })).not.toBe(five);
  });
});

describe("validation at checkout", () => {
  it("general admission: refuses a bad amount with 400 fieldErrors.supportCents, before any order or Stripe call", async () => {
    const event = await paidEvent();
    for (const supportCents of [99, 50_001, -100, 2.5, "500", true, {}]) {
      const res = await checkout(event.eventId, { lineItems: BASKET, supportCents });
      expect(res.status, JSON.stringify(supportCents)).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["supportCents"]);
    }
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await api.db.query(`select id from public.orders`)).toEqual([]);
    expect(await api.db.query(`select idempotency_key from private.checkout_attempts`)).toEqual([]);
  });

  it("general admission: 0, null and leaving it out are all no support (the session as ever)", async () => {
    const event = await paidEvent();
    for (const extra of [{}, { supportCents: 0 }, { supportCents: null }]) {
      const res = await checkout(event.eventId, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }], ...extra });
      expect(res.status).toBe(201);
      expect(lastParams().line_items).toHaveLength(2); // the ticket and its booking fee
      expect(lastParams().payment_intent_data.application_fee_amount).toBe(230);
      expect(await storedOrder(res.body.orderId)).toMatchObject({ support_cents: 0, total_cents: 3230 });
    }
  });

  it("a wholly free order can't carry support (400), and nothing is booked; 0 is fine", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    const body = { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "fan@example.com" };
    const refused = await checkout(event.eventId, { ...body, supportCents: 500 });
    expect(refused.status).toBe(400);
    expect(refused.body.fieldErrors).toEqual({ supportCents: "Support Sheltüh can only be added to an order with paid tickets." });
    expect(await api.db.query(`select id from public.orders`)).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();
    // No amount: the free booking goes ahead as ever (a guest gets the emailed link).
    const fine = await checkout(event.eventId, { ...body, supportCents: 0 });
    expect(fine.status).toBe(202);
  });

  it("free lines in a paid order are fine: the paid ticket carries it", async () => {
    const event = await paidEvent(MIXED_TICKETS);
    const res = await checkout(event.eventId, {
      lineItems: [{ ticketTypeId: "ga", quantity: 1 }, { ticketTypeId: "rsvp", quantity: 2 }],
      supportCents: 200,
    });
    expect(res.status).toBe(201);
    expect(await storedOrder(res.body.orderId)).toMatchObject({ subtotal_cents: 3000, support_cents: 200, total_cents: 3430 });
  });

  it("seated: a bad amount, or any amount on free seats, is 400 fieldErrors.supportCents, nothing held", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const seats = { mapVersion: map.version, seatIds: ["A1"] };
    const bad = await checkout(event.eventId, { seats, supportCents: 50_001 });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fieldErrors)).toEqual(["supportCents"]);

    const free = await seatedEvent(api, organiser, admin, {
      tiers: [{ id: "prem", name: "Premium", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 1 }],
      rows: [{ label: "A", tier: "prem", seats: 2 }],
    });
    const refused = await checkout(free.event.eventId, {
      seats: { mapVersion: free.map.version, seatIds: ["A1"] },
      buyerEmail: "fan@example.com",
      supportCents: 500,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.fieldErrors).toEqual({ supportCents: "Support Sheltüh can only be added to an order with paid tickets." });
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await api.db.query(`select id from public.orders`)).toEqual([]);
    expect(await api.db.query(`select id from public.event_seats where hold_order_id is not null`)).toEqual([]);
  });

  it("client money fields are ignored: only supportCents is read, and only as an amount to validate", async () => {
    const event = await paidEvent();
    const res = await checkout(event.eventId, {
      lineItems: BASKET,
      supportCents: 500,
      totalCents: 1,
      applicationFeeCents: 0,
      buyerFeeCents: 0,
      subtotalCents: 1,
    });
    expect(res.status).toBe(201);
    expect(await storedOrder(res.body.orderId)).toMatchObject({
      subtotal_cents: 14_000,
      buyer_fee_cents: 460,
      application_fee_cents: BASKET_FEES,
      support_cents: 500,
      total_cents: BASKET_TOTAL + 500,
    });
  });
});

// ---------------------------------------------------------------------------
// Stripe: its own line, and all of it the platform's
// ---------------------------------------------------------------------------

describe("the Checkout Session", () => {
  it("general admission: a Support Sheltüh line after the tickets, added to the application fee", async () => {
    const event = await paidEvent();
    const res = await checkout(event.eventId, { lineItems: BASKET, buyerEmail: "fan@example.com", supportCents: 500 });
    expect(res.status).toBe(201);
    const params = lastParams();
    const orderId = params.client_reference_id as string;
    expect(params).toStrictEqual({
      mode: "payment",
      client_reference_id: orderId,
      customer_email: "fan@example.com",
      expires_at: expect.any(Number),
      line_items: [
        { price_data: { currency: "aud", product_data: { name: "GA — Neon Static" }, unit_amount: 3000 }, quantity: 2 },
        { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: 230 }, quantity: 2 },
        { price_data: { currency: "aud", product_data: { name: "VIP — Neon Static" }, unit_amount: 8000 }, quantity: 1 },
        { price_data: { currency: "aud", product_data: { name: "Support Sheltüh" }, unit_amount: 500 }, quantity: 1 },
      ],
      payment_intent_data: { application_fee_amount: BASKET_FEES + 500, transfer_data: { destination: "acct_test_1" } },
      ui_mode: "embedded_page",
      return_url: `${SITE_URL}/checkout/success?session_id=${orderId}`,
      metadata: { orderId, eventId: event.eventId },
      adaptive_pricing: { enabled: false },
    });
    // Stored before Stripe was called: the booking fee alone in application_fee_cents, the total with support.
    expect(await storedOrder(orderId)).toEqual({
      status: "pending",
      subtotal_cents: 14_000,
      buyer_fee_cents: 460,
      total_cents: BASKET_TOTAL + 500,
      application_fee_cents: BASKET_FEES,
      support_cents: 500,
      amount_refunded_cents: 0,
    });
    // What Stripe charges is the stored total.
    expect(money(params).charged).toBe(BASKET_TOTAL + 500);
  });

  it("seated: the same line and fee, after the seats", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const res = await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1", "B2"] }, supportCents: 1000 });
    expect(res.status).toBe(201);
    const params = lastParams();
    expect(params.line_items.map((l: { price_data: { product_data: { name: string }; unit_amount: number } }) => [
      l.price_data.product_data.name,
      l.price_data.unit_amount,
    ])).toEqual([
      ["Premium — Neon Static", 5000],
      ["Booking fee", 350],
      ["Standard — Neon Static", 3000],
      ["Booking fee", 230],
      ["Support Sheltüh", 1000],
    ]);
    expect(params.line_items.at(-1).quantity).toBe(1);
    expect(params.payment_intent_data).toStrictEqual({ application_fee_amount: 580 + 1000, transfer_data: { destination: "acct_test_1" } });
    expect(await storedOrder(res.body.orderId)).toMatchObject({
      subtotal_cents: 8000,
      buyer_fee_cents: 580,
      total_cents: 9580,
      application_fee_cents: 580,
      support_cents: 1000,
    });
  });

  it("the organiser's transfer (total − application fee) is identical with and without support: general admission", async () => {
    const event = await paidEvent();
    await checkout(event.eventId, { lineItems: BASKET });
    const without = money(lastParams());
    await checkout(event.eventId, { lineItems: BASKET, supportCents: 1000 });
    const withSupport = money(lastParams());
    expect(withSupport.transfer).toBe(without.transfer);
    expect(withSupport.transfer).toBe(14_000 - 530); // face value less the absorbed VIP fee
    expect(withSupport.charged - without.charged).toBe(1000);
    expect(withSupport.fee - without.fee).toBe(1000);
  });

  it("the organiser's transfer is identical with and without support: seated", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1", "B2"] } });
    const without = money(lastParams());
    await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A2", "B3"] }, supportCents: 50_000 });
    const withSupport = money(lastParams());
    expect(withSupport.transfer).toBe(without.transfer);
    expect(withSupport.transfer).toBe(8000);
    expect(withSupport.charged - without.charged).toBe(50_000);
  });
});

describe("idempotency", () => {
  const KEY = "3b0c3c1e-6f0a-4b8e-9d4c-2f5e7a1b9c0d";

  it("the same key and amount replays the same order (200); another amount, or none, is 422", async () => {
    const event = await paidEvent();
    const headers = { "idempotency-key": KEY };
    const first = await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 }, headers);
    expect(first.status).toBe(201);
    const again = await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 }, headers);
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body).toEqual(first.body);

    for (const supportCents of [1000, 0, undefined]) {
      const other = await checkout(event.eventId, { lineItems: BASKET, ...(supportCents === undefined ? {} : { supportCents }) }, headers);
      expect(other.status, String(supportCents)).toBe(422);
      expect(other.body.code).toBe("idempotency_key_reused");
    }
    expect(api.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(await api.db.query(`select support_cents from public.orders`)).toEqual([{ support_cents: 500 }]);
  });

  it("a key first used without support is refused with support (422)", async () => {
    const event = await paidEvent();
    const headers = { "idempotency-key": KEY };
    expect((await checkout(event.eventId, { lineItems: BASKET }, headers)).status).toBe(201);
    const other = await checkout(event.eventId, { lineItems: BASKET, supportCents: 200 }, headers);
    expect(other.status).toBe(422);
    expect(other.body.code).toBe("idempotency_key_reused");
  });

  it("seated: the same, without holding the seats twice", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const headers = { "idempotency-key": KEY };
    const body = { seats: { mapVersion: map.version, seatIds: ["A1"] }, supportCents: 500 };
    const first = await checkout(event.eventId, body, headers);
    expect(first.status).toBe(201);
    expect((await checkout(event.eventId, body, headers)).status).toBe(200);
    const other = await checkout(event.eventId, { ...body, supportCents: 200 }, headers);
    expect(other.status).toBe(422);
    expect(await api.db.query(`select count(*)::int as n from public.orders`)).toEqual([{ n: 1 }]);
  });

  it("a retry after Stripe didn't answer sends the very same parameters, support included", async () => {
    const event = await paidEvent();
    const headers = { "idempotency-key": KEY };
    const { default: Stripe } = await import("stripe");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    api.stripe.checkout.sessions.create.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: "timeout" }));
    const failed = await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 }, headers);
    expect(failed.status).toBe(503);
    const retried = await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 }, headers);
    expect(retried.status).toBe(201);
    const [firstCall, secondCall] = api.stripe.checkout.sessions.create.mock.calls;
    expect(secondCall[0]).toStrictEqual(firstCall[0]);
    expect(secondCall[1]).toStrictEqual(firstCall[1]);
    expect(secondCall[0].payment_intent_data.application_fee_amount).toBe(BASKET_FEES + 500);
  });
});

// ---------------------------------------------------------------------------
// Fulfilment, buyer-facing output, refunds
// ---------------------------------------------------------------------------

describe("after payment", () => {
  it("the webhook fulfils it as any order; the ticket page and email show Support Sheltüh, the total including it", async () => {
    const event = await paidEvent();
    const orderId = await paidOrder(event.eventId, 500);
    expect(await storedOrder(orderId)).toMatchObject({ status: "paid", total_cents: BASKET_TOTAL + 500, support_cents: 500 });
    const issued = await api.db.query(`select code from public.tickets where order_id = $1`, [orderId]);
    expect(issued).toHaveLength(3);

    const page = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(page.body).toMatchObject({
      status: "paid",
      subtotalCents: 14_000,
      buyerFeeCents: 460,
      supportCents: 500,
      totalCents: BASKET_TOTAL + 500,
    });

    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const email = api.sendEmail.mock.calls[0][0];
    expect(email.text).toContain("Support Sheltüh: A$5\nTotal paid: A$149.60 (incl. booking fees and Support Sheltüh)");
    expect(email.html).toContain(">Support Sheltüh</td>");
    expect(email.html).toContain(">A$5</td>");
    expect(email.html).toContain("A$149.60");
    expect(email.html).toContain("incl. booking fees and Support Sheltüh");
  });

  it("without support the ticket page has no supportCents and the email no line", async () => {
    const event = await paidEvent();
    const orderId = await paidOrder(event.eventId);
    const page = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(page.body).not.toHaveProperty("supportCents");
    expect(page.body.totalCents).toBe(BASKET_TOTAL);
    await api.runDeferred();
    const email = api.sendEmail.mock.calls[0][0];
    expect(email.text).not.toContain("Support Sheltüh");
    expect(email.html).not.toContain("Support Sheltüh");
    expect(email.text).toContain("Total paid: A$144.60 (incl. booking fees)");
  });

  it("the payment page's summary has supportCents (only when there's some) and a total including it", async () => {
    const event = await paidEvent();
    const withSupport = await checkout(event.eventId, { lineItems: BASKET, supportCents: 1000 });
    const without = await checkout(event.eventId, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] });
    const read = (orderId: string) =>
      api.call(getOrderPayment, { params: { sessionId: orderId }, headers: { "x-forwarded-for": IP } });

    const a = await read(withSupport.body.orderId);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ status: "open", subtotalCents: 14_000, buyerFeeCents: 460, supportCents: 1000, totalCents: BASKET_TOTAL + 1000 });
    // The lines are the tickets only: support is its own field, never a ticket line.
    expect(a.body.lines.map((l: { ticketTypeName: string }) => l.ticketTypeName)).toEqual(["GA", "VIP"]);

    const b = await read(without.body.orderId);
    expect(b.body).not.toHaveProperty("supportCents");
    expect(b.body.totalCents).toBe(3230);
  });

  it("a full refund in Stripe (the whole charge, support included) voids the order and records it all", async () => {
    const event = await paidEvent();
    const orderId = await paidOrder(event.eventId, 500);
    const res = await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        id: "evt_refund_full",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_1",
            object: "charge",
            payment_intent: `pi_${orderId}`,
            amount: BASKET_TOTAL + 500,
            amount_refunded: BASKET_TOTAL + 500,
            refunded: true,
            transfer_data: { destination: "acct_test_1" },
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await storedOrder(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: BASKET_TOTAL + 500 });
  });

  it("an oversold order's automatic refund is the whole payment, with the transfer reversed and the application fee (support included) refunded", async () => {
    const event = await paidEvent();
    const res = await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 });
    const orderId = res.body.orderId as string;
    // The last GA tickets went to someone else before this payment came through.
    await api.db.query(`update public.ticket_types set quantity_sold = quantity_available where event_id = $1 and id = 'ga'`, [
      event.eventId,
    ]);
    const hook = await api.send(stripeWebhook, completed(orderId, "cs_test_1", "pi_oversold"));
    expect(hook.status).toBe(200);
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    // No amount: Stripe refunds the whole charge, Support Sheltüh included.
    expect(api.stripe.refunds.create.mock.calls[0]).toStrictEqual([
      {
        payment_intent: "pi_oversold",
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: { orderId, reason: "could_not_fulfil_after_payment" },
      },
      { idempotencyKey: `oversold-refund-${orderId}` },
    ]);
    expect(await storedOrder(orderId)).toMatchObject({ status: "refunded", support_cents: 500 });
  });

  it("a payment for a failed order is refunded the same way, in full", async () => {
    const event = await paidEvent();
    const res = await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 });
    const orderId = res.body.orderId as string;
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await api.send(stripeWebhook, completed(orderId, "cs_test_1", "pi_late"));
    expect(api.stripe.refunds.create.mock.calls[0]).toStrictEqual([
      {
        payment_intent: "pi_late",
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: { orderId, reason: "paid_after_order_failed" },
      },
      { idempotencyKey: `failed-order-refund-${orderId}` },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Refunding everything but the support (supabase/migrations/20261110000200_support_ticket_refund.sql)
// ---------------------------------------------------------------------------

/** charge.refunded for `pi_<orderId>`: Stripe's cumulative amount refunded and whether the charge is now fully refunded. */
function chargeRefunded(paymentIntent: string, amountRefunded: number, refunded: boolean, eventId: string) {
  return stripeWebhookRequest({
    id: eventId,
    type: "charge.refunded",
    data: {
      object: {
        id: `ch_${paymentIntent}`,
        object: "charge",
        payment_intent: paymentIntent,
        amount_refunded: amountRefunded,
        refunded,
        transfer_data: { destination: "acct_test_1" },
      },
    },
  });
}

async function soldOf(eventId: string) {
  const rows = await api.db.query<{ id: string; quantity_sold: number }>(
    `select id, quantity_sold from public.ticket_types where event_id = $1 order by id`,
    [eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.quantity_sold]));
}

/** Tickets that would still check in or show (check-ins.ts and the ticket page read only paid orders' tickets). */
async function validTickets(orderId: string) {
  const [{ n }] = await api.db.query<{ n: number }>(
    `select count(*)::int as n from public.tickets t join public.orders o on o.id = t.order_id and o.status = 'paid' where t.order_id = $1`,
    [orderId],
  );
  return n;
}

describe("a tickets-only refund (everything but the support) voids the order", () => {
  it("total − support refunded: the order is refunded, its tickets void and its stock back; the support kept is recorded", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const event = await paidEvent();
    const orderId = await paidOrder(event.eventId, 500);
    expect(await soldOf(event.eventId)).toEqual({ ga: 2, vip: 1 });
    expect(await validTickets(orderId)).toBe(3);

    const res = await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, BASKET_TOTAL, false, "evt_tickets_only"));
    expect(res.status).toBe(200);
    // Refunded with less than its total: what's left (the support) is what Sheltüh kept.
    expect(await storedOrder(orderId)).toMatchObject({
      status: "refunded",
      total_cents: BASKET_TOTAL + 500,
      support_cents: 500,
      amount_refunded_cents: BASKET_TOTAL,
    });
    expect(await validTickets(orderId)).toBe(0);
    expect(await soldOf(event.eventId)).toEqual({ ga: 0, vip: 0 });
    const page = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(page.body).toMatchObject({ status: "refunded", refundReason: "refunded", tickets: [] });
    // Nothing for a person: no exception, no alert.
    expect(await exceptionsOf(orderId)).toEqual([]);
    expect(await opsAlertJobs()).toEqual([]);
    const logged = info.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toContain(`Order ${orderReference(orderId)}'s tickets were refunded in Stripe (Support Sheltüh kept)`);
    expect(logged).not.toContain(orderId);

    // A redelivery, and a later refund of the support, change nothing: the stock is given back exactly once.
    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, BASKET_TOTAL, false, "evt_tickets_only"));
    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, BASKET_TOTAL + 500, true, "evt_support_later"));
    expect(await soldOf(event.eventId)).toEqual({ ga: 0, vip: 0 });
    expect(await storedOrder(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: BASKET_TOTAL });
  });

  it("after an earlier partial refund: the open partial_refund exception is resolved, noting the support kept", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const event = await paidEvent();
    const orderId = await paidOrder(event.eventId, 500);
    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, 1000, false, "evt_part"));
    expect(await storedOrder(orderId)).toMatchObject({ status: "paid", amount_refunded_cents: 1000 });
    expect((await exceptionsOf(orderId)).map((e) => [e.kind, e.status])).toEqual([["partial_refund", "open"]]);

    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, BASKET_TOTAL, false, "evt_rest_of_tickets"));
    expect(await storedOrder(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: BASKET_TOTAL });
    expect(await soldOf(event.eventId)).toEqual({ ga: 0, vip: 0 });
    const [ex] = await api.db.query<{ status: string; resolution: string; resolution_note: string; details: Record<string, unknown> }>(
      `select status, resolution, resolution_note, details from private.payment_exceptions where order_id = $1`,
      [orderId],
    );
    expect(ex).toMatchObject({
      status: "resolved",
      resolution: "auto",
      resolution_note: "Tickets refunded in Stripe, Support Sheltüh kept: the order was voided.",
      details: { amountRefundedCents: BASKET_TOTAL, orderStatus: "refunded", supportKeptCents: 500, supportCents: 500 },
    });
    const list = await api.call(adminListPaymentExceptions, { token: admin.token, query: { status: "resolved" } });
    expect(list.body.items[0].details).toMatchObject({ supportKeptCents: 500, amountRefundedCents: BASKET_TOTAL });
  });

  it("seated: the seats are freed as for a full refund", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { event, map } = await seatedEvent(api, organiser, admin);
    const res = await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1", "A2"] }, supportCents: 300 });
    expect(res.status).toBe(201);
    const orderId = res.body.orderId as string;
    await api.send(stripeWebhook, completed(orderId, "cs_test_1", `pi_${orderId}`));
    const { total_cents: total } = (await storedOrder(orderId)) as { total_cents: number };
    expect((await seatStates(api, event.eventId)).A1).toBe(`sold:${orderId}`);

    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, total - 300, false, "evt_seated_tickets"));
    expect(await storedOrder(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: total - 300 });
    expect(await seatStates(api, event.eventId)).toMatchObject({ A1: "free", A2: "free" });
    expect(await api.db.query(`select seat_id from public.tickets where order_id = $1`, [orderId])).toEqual([
      { seat_id: null },
      { seat_id: null },
    ]);
  });

  it("a smaller refund (a cent short of total − support) stays partial: paid, tickets valid, flagged", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const event = await paidEvent();
    const orderId = await paidOrder(event.eventId, 500);
    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, BASKET_TOTAL - 1, false, "evt_short"));
    expect(await storedOrder(orderId)).toMatchObject({ status: "paid", amount_refunded_cents: BASKET_TOTAL - 1 });
    expect(await validTickets(orderId)).toBe(3);
    expect(await soldOf(event.eventId)).toEqual({ ga: 2, vip: 1 });
    expect((await exceptionsOf(orderId)).map((e) => [e.kind, e.status])).toEqual([["partial_refund", "open"]]);
  });

  it("a full refund is as before: refunded, and an open partial_refund resolved with the full-refund note (no supportKeptCents)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const event = await paidEvent();
    const orderId = await paidOrder(event.eventId, 500);
    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, 500, false, "evt_support_only"));
    expect(await storedOrder(orderId)).toMatchObject({ status: "paid", amount_refunded_cents: 500 });
    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, BASKET_TOTAL + 500, true, "evt_all"));
    expect(await storedOrder(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: BASKET_TOTAL + 500 });
    expect(await soldOf(event.eventId)).toEqual({ ga: 0, vip: 0 });
    const [ex] = await api.db.query<{ status: string; resolution_note: string; details: Record<string, unknown> }>(
      `select status, resolution_note, details from private.payment_exceptions where order_id = $1`,
      [orderId],
    );
    expect(ex.status).toBe("resolved");
    expect(ex.resolution_note).toBe("Refunded in full in Stripe: the order was voided.");
    expect(ex.details).not.toHaveProperty("supportKeptCents");
  });

  it("orders without support are unchanged: only Stripe's full refund voids them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const event = await paidEvent();
    const orderId = await paidOrder(event.eventId);
    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, BASKET_TOTAL - 1, false, "evt_nearly"));
    expect(await storedOrder(orderId)).toMatchObject({ status: "paid", support_cents: 0, amount_refunded_cents: BASKET_TOTAL - 1 });
    expect(await validTickets(orderId)).toBe(3);
    expect((await exceptionsOf(orderId)).map((e) => e.kind)).toEqual(["partial_refund"]);
    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, BASKET_TOTAL, true, "evt_whole"));
    expect(await storedOrder(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: BASKET_TOTAL });
    expect(await soldOf(event.eventId)).toEqual({ ga: 0, vip: 0 });
  });

  it("the documented limit: when the support is at least the tickets' amount, refunding just the support voids the tickets too", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const event = await paidEvent();
    const res = await checkout(event.eventId, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }], supportCents: 5000 });
    const orderId = res.body.orderId as string;
    await api.send(stripeWebhook, completed(orderId, "cs_test_1", `pi_${orderId}`));
    expect(await storedOrder(orderId)).toMatchObject({ status: "paid", total_cents: 3230 + 5000 });
    // A$50 refunded ≥ A$81.70 − A$50: the amount alone reads as the tickets refunded (docs/supabase-setup.md).
    await api.send(stripeWebhook, chargeRefunded(`pi_${orderId}`, 5000, false, "evt_support_back"));
    expect(await storedOrder(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: 5000 });
  });
});

// ---------------------------------------------------------------------------
// The webhook's amount check (defence in depth)
// ---------------------------------------------------------------------------

describe("the webhook fulfils a paid order only for exactly its total, in AUD", () => {
  it("a session that charged the stored total (support included) in AUD: fulfilled, no exception", async () => {
    const event = await paidEvent();
    const res = await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 });
    const orderId = res.body.orderId as string;
    const hook = await api.send(stripeWebhook, paidWithMoney(orderId, { amount_total: BASKET_TOTAL + 500, currency: "aud" }));
    expect(hook.status).toBe(200);
    expect(await storedOrder(orderId)).toMatchObject({ status: "paid", total_cents: BASKET_TOTAL + 500 });
    expect(await api.db.query(`select code from public.tickets where order_id = $1`, [orderId])).toHaveLength(3);
    expect(await exceptionsOf(orderId)).toEqual([]);
    expect(await opsAlertJobs()).toEqual([]);
  });

  it("another amount (the support left out): no tickets, the order failed, refunded in full once, an urgent amount_mismatch exception and one alert, however often it's redelivered", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = await paidEvent();
    const res = await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 });
    const orderId = res.body.orderId as string;
    const payable = async () =>
      (await api.db.query<{ p: boolean }>(`select private.event_has_payable_orders($1::uuid) as p`, [event.eventId]))[0].p;
    // A pending order with a Checkout Session can still be paid: it counts (private.event_has_payable_orders).
    expect(await payable()).toBe(true);

    const deliveries = [
      paidWithMoney(orderId, { amount_total: BASKET_TOTAL, currency: "aud" }, "pi_short"),
      paidWithMoney(orderId, { amount_total: BASKET_TOTAL, currency: "aud" }, "pi_short"),
      stripeWebhookRequest({
        id: "evt_async",
        type: "checkout.session.async_payment_succeeded",
        data: {
          object: {
            id: "cs_test_1",
            object: "checkout.session",
            client_reference_id: orderId,
            payment_status: "paid",
            payment_intent: "pi_short",
            amount_total: BASKET_TOTAL,
            currency: "aud",
          },
        },
      }),
    ];
    for (const delivery of deliveries) {
      const hook = await api.send(stripeWebhook, delivery);
      expect(hook.status).toBe(200);
    }
    // Refunded once, in full (no amount), as a failed order's payment is: transfer reversed, application fee refunded.
    expect(api.stripe.refunds.create.mock.calls).toStrictEqual([
      [
        {
          payment_intent: "pi_short",
          reverse_transfer: true,
          refund_application_fee: true,
          metadata: { orderId, reason: "amount_mismatch" },
        },
        { idempotencyKey: `failed-order-refund-${orderId}` },
      ],
    ]);
    const [stored] = await api.db.query<Record<string, unknown>>(
      `select status::text as status, support_cents, stripe_payment_intent_id, stripe_refund_id from public.orders where id = $1`,
      [orderId],
    );
    expect(stored).toEqual({ status: "failed", support_cents: 500, stripe_payment_intent_id: "pi_short", stripe_refund_id: "re_test_1" });
    expect(await api.db.query(`select code from public.tickets where order_id = $1`, [orderId])).toEqual([]);
    expect(await soldOf(event.eventId)).toEqual({ ga: 0, vip: 0 });
    expect(await payable()).toBe(false);
    expect(await exceptionsOf(orderId)).toEqual([
      {
        kind: "amount_mismatch",
        status: "open",
        payment_intent_id: "pi_short",
        stripe_event_id: "evt_paid",
        details: {
          reason: "amount_mismatch",
          amountChargedCents: BASKET_TOTAL,
          currency: "aud",
          totalCents: BASKET_TOTAL + 500,
          supportCents: 500,
          orderStatus: "failed",
        },
      },
    ]);
    expect(await opsAlertJobs()).toEqual([{ status: "pending" }]);
    // Logged by short reference only.
    const logged = [...error.mock.calls, ...warn.mock.calls].map((args) => args.join(" ")).join("\n");
    expect(logged).toContain(`Order ${orderReference(orderId)} was paid with a different amount from its total: no tickets issued;`);
    expect(logged).toContain(`Order ${orderReference(orderId)} was paid with a different amount or currency from its total: refunding the payment.`);
    expect(logged).not.toContain(orderId);
    expect(logged).not.toContain("buyer@example.com");

    // The refund's own charge.refunded then finds the order (failed, so nothing changes): never held as an early refund.
    const refunded = await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        id: "evt_mismatch_refunded",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_short",
            object: "charge",
            payment_intent: "pi_short",
            amount_refunded: BASKET_TOTAL,
            refunded: true,
            transfer_data: { destination: "acct_test_1" },
          },
        },
      }),
    );
    expect(refunded.status).toBe(200);
    expect(await api.db.query(`select payment_intent_id from private.early_charge_refunds`)).toEqual([]);
    expect(warn.mock.calls.flat().join("\n")).not.toContain("arrived before its payment was recorded");
    expect(await storedOrder(orderId)).toMatchObject({ status: "failed", amount_refunded_cents: 0 });

    // After the response: the ops alert (urgent), and no ticket email.
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const alert = api.sendEmail.mock.calls[0][0];
    expect(alert.to).toBe(OPS_ALERT_EMAIL);
    expect(alert.subject).toBe(`URGENT: Sheltüh payment exception: Payment amount mismatch ${orderReference(orderId)}`);
    expect(alert.text).toContain("URGENT: a payment didn't match its order.");
    expect(alert.text).toContain("Order status: failed");
    expect(alert.text).toContain("Amount charged: A$144.60");
    expect(alert.text).toContain("Order total: A$149.60");
    expect(alert.text).toContain("Support Sheltüh (in the total, Sheltüh's): A$5.00");
    expect(alert.text).toContain("no tickets were issued, the order was marked failed and the payment is being refunded in full automatically");
    for (const part of [alert.subject, alert.text, alert.html]) {
      expect(part).not.toContain(orderId);
      expect(part).not.toContain("pi_short");
      expect(part).not.toContain("buyer@example.com");
    }

    // The admin list has it, urgent, with the known details only.
    const list = await api.call(adminListPaymentExceptions, { token: admin.token });
    expect(list.body.items).toEqual([
      expect.objectContaining({
        kind: "amount_mismatch",
        status: "open",
        urgent: true,
        orderReference: orderReference(orderId),
        orderStatus: "failed",
        paymentIntentId: "pi_short",
        details: {
          reason: "amount_mismatch",
          amountChargedCents: BASKET_TOTAL,
          currency: "aud",
          totalCents: BASKET_TOTAL + 500,
          supportCents: 500,
          orderStatus: "failed",
        },
      }),
    ]);
  });

  it("the refund's charge.refunded arriving while Stripe is still answering our refund call finds the order", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = await paidEvent();
    const orderId = (await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 })).body.orderId as string;
    let early: { status: number } | undefined;
    api.stripe.refunds.create.mockImplementationOnce(async () => {
      early = await api.send(
        stripeWebhook,
        stripeWebhookRequest({
          id: "evt_refunded_first",
          type: "charge.refunded",
          data: {
            object: {
              id: "ch_fast",
              object: "charge",
              payment_intent: "pi_fast",
              amount_refunded: BASKET_TOTAL,
              refunded: true,
              transfer_data: { destination: "acct_test_1" },
            },
          },
        }),
      );
      return { id: "re_fast", status: "succeeded" };
    });
    await api.send(stripeWebhook, paidWithMoney(orderId, { amount_total: BASKET_TOTAL, currency: "aud" }, "pi_fast"));
    expect(early?.status).toBe(200);
    expect(await api.db.query(`select payment_intent_id from private.early_charge_refunds`)).toEqual([]);
    expect(warn.mock.calls.flat().join("\n")).not.toContain("arrived before its payment was recorded");
    expect(await storedOrder(orderId)).toMatchObject({ status: "failed" });
  });

  it("a Stripe error on the refund is a 500; the redelivery asks again with the very same parameters, then never again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = await paidEvent();
    const orderId = (await checkout(event.eventId, { lineItems: BASKET, supportCents: 500 })).body.orderId as string;
    api.stripe.refunds.create.mockRejectedValueOnce(new Error("stripe down"));
    const send = () => api.send(stripeWebhook, paidWithMoney(orderId, { amount_total: BASKET_TOTAL, currency: "aud" }, "pi_retry"));
    expect((await send()).status).toBe(500);
    // Failed and flagged already: the retry only refunds.
    expect(await storedOrder(orderId)).toMatchObject({ status: "failed" });
    expect((await exceptionsOf(orderId)).map((e) => e.kind)).toEqual(["amount_mismatch"]);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(2);
    expect(api.stripe.refunds.create.mock.calls[1]).toStrictEqual(api.stripe.refunds.create.mock.calls[0]);
    expect(api.stripe.refunds.create.mock.calls[0][0].metadata).toEqual({ orderId, reason: "amount_mismatch" });
    expect(await opsAlertJobs()).toEqual([{ status: "pending" }]);
  });

  it("the right amount in another currency, or no amount and currency at all: not fulfilled (fail closed), failed and refunded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = await paidEvent();
    const usd = (await checkout(event.eventId, { lineItems: BASKET })).body.orderId as string;
    await api.send(stripeWebhook, paidWithMoney(usd, { amount_total: BASKET_TOTAL, currency: "usd" }));
    const bare = (await checkout(event.eventId, { lineItems: BASKET })).body.orderId as string;
    await api.send(stripeWebhook, paidWithMoney(bare, { amount_total: null, currency: null }));

    for (const orderId of [usd, bare]) {
      expect(await storedOrder(orderId)).toMatchObject({ status: "failed" });
      expect(await api.db.query(`select code from public.tickets where order_id = $1`, [orderId])).toEqual([]);
    }
    expect(api.stripe.refunds.create.mock.calls.map(([params]) => params.payment_intent)).toEqual([`pi_${usd}`, `pi_${bare}`]);
    expect((await exceptionsOf(usd))[0]).toMatchObject({
      kind: "amount_mismatch",
      details: { reason: "currency_mismatch", amountChargedCents: BASKET_TOTAL, currency: "usd", totalCents: BASKET_TOTAL, supportCents: 0 },
    });
    expect((await exceptionsOf(bare))[0].details).toEqual({
      reason: "currency_mismatch",
      totalCents: BASKET_TOTAL,
      supportCents: 0,
      orderStatus: "failed",
    });
    await api.runDeferred();
    const usdAlert = api.sendEmail.mock.calls.map(([m]) => m).find((m) => m.subject.includes(orderReference(usd)))!;
    expect(usdAlert.text).toContain("Amount charged: 144.60 USD");
  });

  it("seated: another amount takes no seats, releases the holds, issues nothing and refunds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { event, map } = await seatedEvent(api, organiser, admin);
    await enablePayouts(api, organiser.organiserId);
    const res = await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1"] }, supportCents: 200 });
    expect(res.status).toBe(201);
    const orderId = res.body.orderId as string;
    expect((await seatStates(api, event.eventId)).A1).toBe(`held:${orderId}`);
    const [{ total_cents: total }] = await api.db.query<{ total_cents: number }>(`select total_cents from public.orders where id = $1`, [orderId]);
    await api.send(stripeWebhook, paidWithMoney(orderId, { amount_total: total - 200, currency: "aud" }));
    expect(await storedOrder(orderId)).toMatchObject({ status: "failed" });
    expect((await seatStates(api, event.eventId)).A1).toBe("free");
    expect(await api.db.query(`select id from public.event_seats where event_id = $1 and hold_order_id = $2`, [event.eventId, orderId])).toEqual([]);
    expect(await api.db.query(`select code from public.tickets where order_id = $1`, [orderId])).toEqual([]);
    expect((await exceptionsOf(orderId)).map((e) => e.kind)).toEqual(["amount_mismatch"]);
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("paths that don't fulfil a session are unchanged: a failed order's payment is still refunded, and a member's free booking is issued at once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = await paidEvent();
    const failed = (await checkout(event.eventId, { lineItems: BASKET })).body.orderId as string;
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [failed]);
    // Even with an amount that isn't the order's: the money goes back in full, as before.
    await api.send(stripeWebhook, paidWithMoney(failed, { amount_total: 1, currency: "aud" }, "pi_late_failed"));
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    // No amount_mismatch exception on it: the reason is the order having failed, as before.
    expect(api.stripe.refunds.create.mock.calls[0][0]).toMatchObject({
      payment_intent: "pi_late_failed",
      metadata: { orderId: failed, reason: "paid_after_order_failed" },
    });
    expect(await exceptionsOf(failed)).toEqual([]);

    const free = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    const member = await api.signUp({ email: "mia@example.com" });
    const booked = await api.call(createCheckout, {
      token: member.token,
      params: { eventId: free.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "mia@example.com" },
    });
    expect(booked.status).toBe(201);
    const [order] = await api.db.query<{ id: string; status: string }>(
      `select id, status::text as status from public.orders where event_id = $1`,
      [free.eventId],
    );
    expect(order.status).toBe("paid");
    expect(await api.db.query(`select code from public.tickets where order_id = $1`, [order.id])).toHaveLength(1);
    expect(await api.db.query(`select id from private.payment_exceptions`)).toEqual([]);
  });
});

describe("payment exceptions carry the order's Support Sheltüh amount", () => {
  it("a partial refund's exception and alert say how much of the total is support", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const event = await paidEvent();
    const orderId = await paidOrder(event.eventId, 500);
    await api.runDeferred();
    api.sendEmail.mockClear();
    await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        id: "evt_refund_support",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_s",
            object: "charge",
            payment_intent: `pi_${orderId}`,
            amount: BASKET_TOTAL + 500,
            amount_refunded: 500,
            refunded: false,
            transfer_data: { destination: "acct_test_1" },
          },
        },
      }),
    );
    expect((await exceptionsOf(orderId))[0]).toMatchObject({
      kind: "partial_refund",
      details: { amountRefundedCents: 500, totalCents: BASKET_TOTAL + 500, supportCents: 500, orderStatus: "paid" },
    });
    await api.runDeferred();
    const alert = api.sendEmail.mock.calls.find(([m]) => m.to === OPS_ALERT_EMAIL)![0];
    expect(alert.text).toContain("Support Sheltüh (in the total, Sheltüh's): A$5.00");
    const list = await api.call(adminListPaymentExceptions, { token: admin.token });
    expect(list.body.items[0].details).toMatchObject({ supportCents: 500, totalCents: BASKET_TOTAL + 500 });
  });
});

// ---------------------------------------------------------------------------
// Organisers never see it
// ---------------------------------------------------------------------------

describe("organiser figures exclude support", () => {
  it("analytics gross, fees and net, per-ticket sales and tracking links are the same with or without support", async () => {
    const event = await paidEvent();
    const link = await api.call(createTrackingLink, { token: organiser.token, params: { eventId: event.eventId }, body: { label: "Instagram" } });
    expect(link.status).toBe(201);
    const code = link.body.code as string;
    await paidOrder(event.eventId, 1000, { trackingCode: code });
    await paidOrder(event.eventId, undefined, { trackingCode: code });

    // Two identical baskets: gross is what buyers paid for the event, never the A$10 support.
    const gross = 2 * BASKET_TOTAL;
    const fees = 2 * BASKET_FEES;
    const expected = { grossCents: gross, feesCents: fees, netCents: gross - fees };

    const analytics = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: event.eventId } });
    expect(analytics.status).toBe(200);
    expect(analytics.body.totals).toMatchObject({ orders: 2, ticketsSold: 6, ...expected });
    const byDay = analytics.body.byDay.filter((d: { orders: number }) => d.orders > 0);
    expect(byDay).toHaveLength(1);
    expect(byDay[0]).toMatchObject(expected);
    // Per ticket type: the rows add up to the totals, none carrying support.
    const types = analytics.body.byTicketType as { grossCents: number; feesCents: number }[];
    expect(types.reduce((s, t) => s + t.grossCents, 0)).toBe(gross);
    expect(types.reduce((s, t) => s + t.feesCents, 0)).toBe(fees);
    expect(analytics.body.trackingLinks[0]).toMatchObject({ code, orders: 2, ...expected });

    const overview = await api.call(getAnalyticsOverview, { token: organiser.token });
    expect(overview.body.totals).toMatchObject(expected);
    expect(overview.body.events.find((e: { eventId: string }) => e.eventId === event.eventId).totals).toMatchObject(expected);

    const links = await api.call(listTrackingLinks, { token: organiser.token, params: { eventId: event.eventId } });
    expect(links.body.items[0]).toMatchObject({ code, orders: 2, grossCents: gross });

    // The net is exactly the transfers Stripe was told to make.
    const transfers = api.stripe.checkout.sessions.create.mock.calls.map(([p]) => money(p).transfer);
    expect(transfers.reduce((s, t) => s + t, 0)).toBe(expected.netCents);
  });
});

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

describe("the database", () => {
  async function insert(values: { subtotal: number; fee: number; total: number; support: number }) {
    const event = (await api.db.query<{ id: string; organiser_id: string }>(`select id, organiser_id from public.events limit 1`))[0];
    return api.db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents, buyer_fee_cents,
         total_cents, application_fee_cents, support_cents)
       values ($1, $2, $3, 'x', '[]'::jsonb, $4, $5, $6, $5, $7)`,
      [`ord_${crypto.randomUUID().replace(/-/g, "")}`, event.id, event.organiser_id, values.subtotal, values.fee, values.total, values.support],
    );
  }

  it("refuses support on a free order, beyond A$500 or below 0, and a total that leaves it out", async () => {
    await paidEvent();
    await expect(insert({ subtotal: 0, fee: 0, total: 500, support: 500 })).rejects.toThrow(/orders_support_paid_only/);
    await expect(insert({ subtotal: 3000, fee: 230, total: 3230 + 50_001, support: 50_001 })).rejects.toThrow(
      /orders_support_cents_check/,
    );
    await expect(insert({ subtotal: 3000, fee: 230, total: 3230, support: -1 })).rejects.toThrow(/orders_support_cents_check/);
    await expect(insert({ subtotal: 3000, fee: 230, total: 3230, support: 500 })).rejects.toThrow(/orders_support_in_total/);
    await insert({ subtotal: 3000, fee: 230, total: 3730, support: 500 });
    await insert({ subtotal: 3000, fee: 230, total: 3230, support: 0 });
  });

  it("hold_seats has one form, its new argument defaulting to 0, so the previous app's 18-argument call still holds seats", async () => {
    const [fn] = await api.db.query<{ forms: number; args: string }>(
      `select count(*)::int as forms, min(pg_get_function_identity_arguments(p.oid)) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'hold_seats'`,
    );
    expect(fn.forms).toBe(1);
    expect(fn.args).toMatch(/p_cap_share numeric, p_support_cents integer, OUT result text/);

    const { event, map } = await seatedEvent(api, organiser, admin);
    const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
    const lines = [{ ticketTypeId: "prem", ticketTypeName: "Premium", unitPriceCents: 5000, feePolicy: "buyer-pays", quantity: 1 }];
    const [held] = await api.db.query<{ result: string }>(
      `select result from private.hold_seats($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::text[],
                                             $14::interval, $15, $16::interval, $17, $18)`,
      [orderId, event.eventId, event.organiserId, event.title, JSON.stringify(lines), 5000, 350, 5350, 350, null, null, map.version, ["A1"],
        "35 minutes", 120, "10 minutes", 20, 0.3],
    );
    expect(held.result).toBe("held");
    expect(await storedOrder(orderId)).toMatchObject({ status: "pending", total_cents: 5350, support_cents: 0 });
  });
});

describe("ticket email (unit)", () => {
  const event = {
    title: "Neon Static",
    venueName: "The Tote",
    venueAddress: "71 Johnston St",
    suburb: "Collingwood",
    startsAt: "2027-03-06T09:00:00.000Z",
    endsAt: "2027-03-06T12:00:00.000Z",
    status: "published",
  } as EventRecord;
  const order = {
    orderId: "ord_abc",
    buyerEmail: "fan@example.com",
    totalCents: 3730,
    supportCents: 500,
    tickets: [{ ticketCode: "ABCD-EFGH", ticketTypeId: "ga", ticketTypeName: "GA" }],
  } as OrderRecord;

  it("a Support Sheltüh row above the total (HTML and text); none for an order without it", () => {
    const email = buildTicketEmail(order, event, "https://sheltuh.com.au");
    expect(email.text).toContain("Order reference: #");
    expect(email.text).toContain("\nSupport Sheltüh: A$5\nTotal paid: A$37.30 (incl. booking fees and Support Sheltüh)\n");
    const row = email.html.indexOf(">Support Sheltüh</td>");
    expect(row).toBeGreaterThan(email.html.indexOf(">Order reference</td>"));
    expect(row).toBeLessThan(email.html.indexOf(">Total paid</td>"));

    const plain = buildTicketEmail({ ...order, totalCents: 3230, supportCents: undefined }, event, "https://sheltuh.com.au");
    expect(plain.text).toContain("Total paid: A$32.30 (incl. booking fees)");
    expect(plain.text).not.toContain("Support Sheltüh");
    expect(plain.html).not.toContain("Support Sheltüh");
  });

  it("with support, the refund terms say it's refunded only with the whole order (HTML and text); not without it", () => {
    const withPolicy = { ...event, refundPolicy: "no_change_of_mind" } as EventRecord;
    const email = buildTicketEmail(order, withPolicy, "https://sheltuh.com.au");
    expect(SUPPORT_REFUND_NOTE).toBe("Support Sheltüh is refunded only if your whole order is refunded.");
    // Right after the policy line, before the ACL statement.
    expect(email.text).toContain(`Refund policy: No refunds for change of mind.\n${SUPPORT_REFUND_NOTE}\nYou're always entitled`);
    const at = email.html.indexOf(`>${SUPPORT_REFUND_NOTE}</p>`);
    expect(at).toBeGreaterThan(email.html.indexOf("Refund policy:</span>"));
    expect(at).toBeLessThan(email.html.indexOf("You&#39;re always entitled"));

    for (const without of [{ ...order, totalCents: 3230, supportCents: undefined }, { ...order, totalCents: 3230, supportCents: 0 }]) {
      const plain = buildTicketEmail(without as OrderRecord, withPolicy, "https://sheltuh.com.au");
      expect(plain.text).toContain("Refund policy: No refunds for change of mind.");
      expect(plain.text).not.toContain(SUPPORT_REFUND_NOTE);
      expect(plain.html).not.toContain(SUPPORT_REFUND_NOTE);
    }
  });
});

describe("ops alert amounts and urgency (unit)", () => {
  const alert = (details: Record<string, unknown>, kind: "amount_mismatch" | "refund_not_completed" = "amount_mismatch", urgent = true) =>
    opsAlertLines({ kind, urgent, details, openedAt: new Date("2026-11-10T00:00:00Z") });

  it("the amount charged is in its currency's own minor unit: zero-decimal and three-decimal currencies aren't divided by 100", () => {
    expect(alert({ amountChargedCents: 14340, currency: "aud" })).toContain("Amount charged: A$143.40");
    expect(alert({ amountChargedCents: 14340, currency: "usd" })).toContain("Amount charged: 143.40 USD");
    expect(alert({ amountChargedCents: 14340, currency: "jpy" })).toContain("Amount charged: 14340 JPY");
    expect(alert({ amountChargedCents: 14340, currency: "krw" })).toContain("Amount charged: 14340 KRW");
    expect(alert({ amountChargedCents: 14340, currency: "kwd" })).toContain("Amount charged: 14.340 KWD");
    expect(alert({ amountChargedCents: 14340 })).toContain("Amount charged: A$143.40");
  });

  it("amount_mismatch is always urgent; refund_not_completed only once its order was voided; each says why", () => {
    expect(paymentExceptionUrgent("amount_mismatch", "failed")).toBe(true);
    expect(paymentExceptionUrgent("amount_mismatch", undefined)).toBe(true);
    expect(paymentExceptionUrgent("refund_not_completed", "refunded")).toBe(true);
    expect(paymentExceptionUrgent("refund_not_completed", "paid")).toBe(false);
    expect(paymentExceptionUrgent("partial_refund", "paid")).toBe(false);
    expect(paymentExceptionUrgent("manual_refund_required", "failed")).toBe(false);
    expect(alert({})[0]).toBe("URGENT: a payment didn't match its order. Check it, and its automatic refund, in Stripe.");
    expect(alert({}, "refund_not_completed")[0]).toBe("URGENT: the order was voided (its tickets are void) but the refund didn't complete.");
    expect(alert({}, "amount_mismatch", false)[0]).toBe("Order: not matched to an order yet");
  });
});
