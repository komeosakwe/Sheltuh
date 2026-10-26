import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { drainEmailOutbox } from "@/lib/server/email-outbox";
import { createCheckout, getOrderBySession, stripeWebhook } from "@/lib/server/handlers/orders";
import { adminListPaymentExceptions, adminResolvePaymentException } from "@/lib/server/handlers/payment-exceptions";
import { orderReference } from "@/lib/server/order-reference";
import type { EventRecord } from "@/lib/server/types";
import { OPS_ALERT_EMAIL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, insertOrder, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent, seatStates, tierCounts } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// Payment reconciliation (supabase/migrations/20261104000000_payment_reconciliation.sql,
// docs/architecture.md "Refunds made in Stripe"): charge.refunded before the
// payment is recorded, refund status events and payment exceptions, ops
// alerts, and the admin API. Owner decisions (pending confirmation): D1 an
// early full refund leaves the order refunded with nothing issued; D2 an
// early partial refund still issues tickets and opens an exception; D3 a full
// charge.refunded voids even while the refund is pending; D4 a refund that
// fails after the void opens an exception and an alert, and nothing is
// restored or refunded again automatically; D5 alerts to OPS_ALERT_EMAIL, at
// most 20 a day, no buyer data; D11 retention.

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let info: MockInstance;
let warn: MockInstance;
let error: MockInstance;

// GA: 3000 + 170 buyer fee = 3170 to the buyer. VIP: 8000, fee absorbed.
const TICKETS = [
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 1 },
];
/** enablePayouts' account: the destination of every checkout here. */
const OUR_ACCOUNT = "acct_test_1";

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  serverUrl = testDb.url;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
  await enablePayouts(api, organiser.organiserId);
  let sessions = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    const id = `cs_test_${++sessions}`;
    return { id, url: `https://checkout.stripe.test/${id}` };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function checkout(lineItems: { ticketTypeId: string; quantity: number }[], eventId = event.eventId) {
  const res = await api.call(createCheckout, { params: { eventId }, body: { lineItems } });
  expect(res.status).toBe(201);
  return res.body.orderId as string;
}

function completed(orderId: string, paymentIntent: string | null) {
  return stripeWebhookRequest({
    id: `evt_paid_${paymentIntent}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${orderId}`,
        object: "checkout.session",
        client_reference_id: orderId,
        payment_status: "paid",
        payment_intent: paymentIntent,
        customer_details: { email: "buyer@example.com" },
      },
    },
  });
}

async function pay(orderId: string, paymentIntent: string | null) {
  const res = await api.send(stripeWebhook, completed(orderId, paymentIntent));
  expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { received: true } });
}

function chargeRefunded(
  paymentIntent: string,
  amountRefunded: number,
  refunded: boolean,
  options: { destination?: string | null; eventId?: string } = {},
) {
  const destination = options.destination === undefined ? OUR_ACCOUNT : options.destination;
  return stripeWebhookRequest({
    id: options.eventId ?? "evt_charge_refunded",
    type: "charge.refunded",
    data: {
      object: {
        id: `ch_${paymentIntent}`,
        object: "charge",
        payment_intent: paymentIntent,
        amount_refunded: amountRefunded,
        refunded,
        transfer_data: destination === null ? null : { amount: null, destination },
      },
    },
  });
}

async function refund(paymentIntent: string, amountRefunded: number, refunded: boolean, options: { destination?: string | null; eventId?: string } = {}) {
  const res = await api.send(stripeWebhook, chargeRefunded(paymentIntent, amountRefunded, refunded, options));
  expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { received: true } });
}

type RefundEventType = "refund.updated" | "refund.failed" | "charge.refund.updated";

function refundEvent(
  type: RefundEventType,
  refundId: string,
  status: string,
  paymentIntent: string | null,
  options: { created?: number; eventId?: string; orderId?: string; amount?: number } = {},
) {
  return stripeWebhookRequest({
    id: options.eventId ?? `evt_${type}_${status}`,
    created: options.created ?? 1_800_000_000,
    type,
    data: {
      object: {
        id: refundId,
        object: "refund",
        status,
        amount: options.amount ?? 3170,
        payment_intent: paymentIntent,
        metadata: options.orderId ? { orderId: options.orderId } : {},
      },
    },
  });
}

async function refundStatus(...args: Parameters<typeof refundEvent>) {
  const res = await api.send(stripeWebhook, refundEvent(...args));
  expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { received: true } });
}

async function internal(orderId: string) {
  const [row] = await api.db.query<{ status: string; amount_refunded_cents: number; tickets: number; payment_intent: string | null }>(
    `select status::text as status, amount_refunded_cents, stripe_payment_intent_id as payment_intent,
            (select count(*)::int from public.tickets t where t.order_id = o.id) as tickets
       from public.orders o where o.id = $1`,
    [orderId],
  );
  return row;
}

async function sold(eventId = event.eventId) {
  const rows = await api.db.query<{ id: string; quantity_sold: number }>(
    `select id, quantity_sold from public.ticket_types where event_id = $1 order by id`,
    [eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.quantity_sold]));
}

interface ExceptionRow {
  id: string;
  kind: string;
  status: string;
  order_id: string | null;
  refund_id: string | null;
  resolution: string | null;
  details: Record<string, unknown>;
  alerted: boolean;
}

async function exceptions(): Promise<ExceptionRow[]> {
  return api.db.query<ExceptionRow>(
    `select id, kind, status, order_id, refund_id, resolution, details, alerted_at is not null as alerted
       from private.payment_exceptions order by created_at, id`,
  );
}

async function alertJobs() {
  return api.db.query<{ status: string; payment_exception_id: string }>(
    `select status, payment_exception_id from private.email_outbox where kind = 'ops_alert' order by id`,
  );
}

async function ticketJobs(orderId: string) {
  return api.db.query(`select status from private.email_outbox where kind = 'ticket_email' and order_id = $1`, [orderId]);
}

async function earlyRows() {
  return api.db.query<{ payment_intent_id: string; amount_refunded_cents: number; fully_refunded: boolean; applied_order_id: string | null }>(
    `select payment_intent_id, amount_refunded_cents, fully_refunded, applied_order_id from private.early_charge_refunds order by 1`,
  );
}

const lookup = async (orderId: string) => (await api.call(getOrderBySession, { params: { sessionId: orderId } })).body;

const logged = (spy: MockInstance) => spy.mock.calls.flat().map(String).join("\n");

/** Every console line: nothing in them may name the buyer, the order id or a payment intent. */
function expectLogHygiene(orderId: string, paymentIntent: string) {
  const all = [logged(info), logged(warn), logged(error)].join("\n");
  expect(all).not.toContain(orderId);
  expect(all).not.toContain(paymentIntent);
  expect(all).not.toContain("buyer@example.com");
}

/** A paid order (fulfilled by the webhook) with this payment intent. */
async function paidOrder(lineItems: { ticketTypeId: string; quantity: number }[], paymentIntent: string) {
  const orderId = await checkout(lineItems);
  await pay(orderId, paymentIntent);
  expect((await internal(orderId)).status).toBe("paid");
  return orderId;
}

// ---------------------------------------------------------------------------
// Item 1: charge.refunded before the payment is recorded
// ---------------------------------------------------------------------------

describe("a full refund that arrives before the payment is recorded (D1)", () => {
  it("is held, then the payment leaves the order refunded: nothing taken, issued, emailed or refunded again", async () => {
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 2 }]);

    await refund("pi_early", 6340, true);
    expect(await internal(orderId)).toMatchObject({ status: "pending", tickets: 0 });
    expect(await earlyRows()).toEqual([
      { payment_intent_id: "pi_early", amount_refunded_cents: 6340, fully_refunded: true, applied_order_id: null },
    ]);
    expect(logged(warn)).toContain("evt_charge_refunded: charge.refunded arrived before its payment was recorded");

    await pay(orderId, "pi_early");
    expect(await internal(orderId)).toEqual({ status: "refunded", amount_refunded_cents: 6340, tickets: 0, payment_intent: "pi_early" });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
    expect(await ticketJobs(orderId)).toEqual([]);
    expect(api.stripe.refunds.create).not.toHaveBeenCalled();
    expect((await earlyRows())[0].applied_order_id).toBe(orderId);
    // The buyer's page: refunded (not "sold out"), and no codes.
    expect(await lookup(orderId)).toMatchObject({ status: "refunded", refundReason: "refunded", tickets: [] });
    expect(await exceptions()).toEqual([]);

    // Redelivered: nothing more happens.
    await pay(orderId, "pi_early");
    await refund("pi_early", 6340, true);
    await api.runDeferred();
    expect(await internal(orderId)).toMatchObject({ status: "refunded", tickets: 0 });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect(logged(info)).toContain(`Order ${orderReference(orderId)} is refunded in Stripe: nothing issued for this payment.`);
    expectLogHygiene(orderId, "pi_early");
  });

  it("a seated order: its holds are cleared, no seat is sold and no ticket issued", async () => {
    const { event: seated } = await seatedEvent(api, organiser, admin);
    const res = await api.call(createCheckout, {
      params: { eventId: seated.eventId },
      body: { seats: { mapVersion: seated.seating!.version, seatIds: ["A1", "A2"] } },
    });
    expect(res.status).toBe(201);
    const orderId = res.body.orderId as string;
    expect((await seatStates(api, seated.eventId)).A1).toBe(`held:${orderId}`);

    await refund("pi_seated_early", 10500, true);
    await pay(orderId, "pi_seated_early");

    expect(await internal(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: 10500, tickets: 0 });
    const states = await seatStates(api, seated.eventId);
    expect([states.A1, states.A2]).toEqual(["free", "free"]);
    expect((await tierCounts(api, seated.eventId)).prem.sold).toBe(0);
  });
});

describe("a partial refund that arrives before the payment is recorded (D2)", () => {
  it("tickets are issued, the amount recorded and a partial_refund exception opened with an alert; a later full refund voids and closes it", async () => {
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 2 }]);
    await refund("pi_part_early", 3170, false, { eventId: "evt_partial" });
    await pay(orderId, "pi_part_early");

    expect(await internal(orderId)).toMatchObject({ status: "paid", amount_refunded_cents: 3170, tickets: 2 });
    expect(await sold()).toEqual({ ga: 2, vip: 0 });
    const [exception] = await exceptions();
    expect(exception).toMatchObject({ kind: "partial_refund", status: "open", order_id: orderId, alerted: true });
    expect(exception.details).toEqual({ amountRefundedCents: 3170, totalCents: 6340, orderStatus: "paid" });
    expect(await alertJobs()).toEqual([{ status: "pending", payment_exception_id: exception.id }]);

    // After the response: the ticket email and the ops alert.
    await api.runDeferred();
    const recipients = api.sendEmail.mock.calls.map(([message]) => message.to).sort();
    expect(recipients).toEqual(["buyer@example.com", OPS_ALERT_EMAIL]);
    const alert = api.sendEmail.mock.calls.find(([message]) => message.to === OPS_ALERT_EMAIL)![0];
    expect(alert.subject).toBe(`Sheltüh payment exception: Partial refund ${orderReference(orderId)}`);
    expect(alert.text).toContain("Refunded so far: A$31.70");
    expect(alert.text).toContain("Order total: A$63.40");
    expect(alert.text).toContain("Stripe event: evt_partial");
    for (const part of [alert.subject, alert.text, alert.html]) {
      expect(part).not.toContain(orderId);
      expect(part).not.toContain("pi_part_early");
      expect(part).not.toContain("buyer@example.com");
    }
    expect((await alertJobs())[0].status).toBe("sent");

    // The rest refunded later: the order is voided and the exception closes itself.
    await refund("pi_part_early", 6340, true);
    expect(await internal(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: 6340, tickets: 2 });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
    expect(await exceptions()).toEqual([expect.objectContaining({ status: "resolved", resolution: "auto" })]);
    expectLogHygiene(orderId, "pi_part_early");
  });

  it("a seated order gets its seats and tickets, with the exception", async () => {
    const { event: seated } = await seatedEvent(api, organiser, admin);
    const res = await api.call(createCheckout, {
      params: { eventId: seated.eventId },
      body: { seats: { mapVersion: seated.seating!.version, seatIds: ["A3"] } },
    });
    const orderId = res.body.orderId as string;
    await refund("pi_seated_part", 1000, false);
    await pay(orderId, "pi_seated_part");

    expect(await internal(orderId)).toMatchObject({ status: "paid", amount_refunded_cents: 1000, tickets: 1 });
    expect((await seatStates(api, seated.eventId)).A3).toBe(`sold:${orderId}`);
    expect(await exceptions()).toEqual([expect.objectContaining({ kind: "partial_refund", status: "open", order_id: orderId })]);
  });
});

describe("early deliveries are idempotent", () => {
  it("redeliveries and late older deliveries converge: the greatest amount, full once seen, applied once", async () => {
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 2 }]);
    await refund("pi_steps", 1000, false);
    await refund("pi_steps", 3000, false);
    await refund("pi_steps", 1000, false); // an older delivery arriving late
    await refund("pi_steps", 6340, true);
    await refund("pi_steps", 3000, false); // older again
    expect(await earlyRows()).toEqual([
      { payment_intent_id: "pi_steps", amount_refunded_cents: 6340, fully_refunded: true, applied_order_id: null },
    ]);

    await pay(orderId, "pi_steps");
    await pay(orderId, "pi_steps");
    expect(await internal(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: 6340, tickets: 0 });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
    expect(await exceptions()).toEqual([]);
  });

  it("a refund recorded after fulfilment goes the usual way (no early row, inventory released once)", async () => {
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }], "pi_after");
    for (let i = 0; i < 3; i++) await refund("pi_after", 6340, true);
    expect(await internal(orderId)).toMatchObject({ status: "refunded", tickets: 2 });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
    expect(await earlyRows()).toEqual([]);
  });
});

describe("payments that aren't ours write nothing", () => {
  it("another account's destination, no destination, or no transfer: not_found, no row", async () => {
    await refund("pi_foreign", 5000, true, { destination: "acct_someone_else" });
    await refund("pi_platform_only", 5000, true, { destination: null });
    const expanded = await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "charge.refunded",
        data: { object: { id: "ch_x", object: "charge", payment_intent: "pi_obj", amount_refunded: 10, refunded: false, transfer_data: { destination: { id: "acct_other" } } } },
      }),
    );
    expect(expanded.status).toBe(200);
    expect(await earlyRows()).toEqual([]);
    expect(await exceptions()).toEqual([]);
    expect(logged(warn)).toContain("charge.refunded for a payment with no order on record; ignored.");
    // Refund status events for them too.
    for (const type of ["refund.updated", "refund.failed", "charge.refund.updated"] as const) {
      await refundStatus(type, "re_foreign", "failed", "pi_foreign");
    }
    await refundStatus("refund.failed", "re_none", "failed", null);
    expect(await exceptions()).toEqual([]);
    expect(await alertJobs()).toEqual([]);
  });

  it("an early refund row for our destination is still never applied to another payment", async () => {
    await refund("pi_one", 3170, true);
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    await pay(orderId, "pi_two");
    expect(await internal(orderId)).toMatchObject({ status: "paid", tickets: 1, amount_refunded_cents: 0 });
    expect((await earlyRows())[0].applied_order_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Item 2: refund status events and payment exceptions
// ---------------------------------------------------------------------------

/** A paid order refunded in full in the dashboard (charge.refunded, D3): voided. */
async function voidedOrder(paymentIntent: string) {
  const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], paymentIntent);
  await refund(paymentIntent, 3170, true);
  expect(await internal(orderId)).toMatchObject({ status: "refunded" });
  return orderId;
}

describe("a dashboard refund that doesn't complete after its order was voided (D4)", () => {
  it.each(["failed", "canceled", "requires_action"])(
    "%s, reported by all three event types: exactly one urgent exception and one alert; nothing restored or refunded",
    async (status) => {
      const orderId = await voidedOrder("pi_void");
      for (const type of ["refund.failed", "refund.updated", "charge.refund.updated"] as const) {
        await refundStatus(type, "re_dash", status, "pi_void", { eventId: `evt_${type}` });
        await refundStatus(type, "re_dash", status, "pi_void", { eventId: `evt_${type}` }); // redelivered
      }
      const rows = await exceptions();
      expect(rows).toEqual([expect.objectContaining({ kind: "refund_not_completed", status: "open", order_id: orderId, refund_id: "re_dash", alerted: true })]);
      expect(rows[0].details).toEqual({ refundStatus: status, refundAmountCents: 3170, orderStatus: "refunded", source: "stripe" });
      expect(await alertJobs()).toHaveLength(1);
      // Never restored, never refunded again.
      expect(await internal(orderId)).toMatchObject({ status: "refunded", tickets: 1 });
      expect(await sold()).toEqual({ ga: 0, vip: 0 });
      expect(api.stripe.refunds.create).not.toHaveBeenCalled();
      // One error line per event, by event id and short reference.
      expect(error).toHaveBeenCalledTimes(6);
      expect(logged(error)).toContain(`Stripe evt_refund.failed: a refund of order ${orderReference(orderId)} (made outside Sheltüh) has status ${status}`);
      expect(logged(error)).toContain("The order was already voided");

      // The alert says so, urgently.
      await api.runDeferred();
      const alert = api.sendEmail.mock.calls.find(([message]) => message.to === OPS_ALERT_EMAIL)![0];
      expect(alert.subject).toBe(`URGENT: Sheltüh payment exception: Refund not completed ${orderReference(orderId)}`);
      expect(alert.text).toContain(`Refund status: ${status}`);
      expect(alert.text).not.toContain("re_dash");
      expectLogHygiene(orderId, "pi_void");

      // The admin list flags it.
      const list = await api.call(adminListPaymentExceptions, { token: admin.token });
      expect(list.body.items).toEqual([expect.objectContaining({ kind: "refund_not_completed", urgent: true, orderReference: orderReference(orderId) })]);
    },
  );

  it("pending and succeeded open nothing", async () => {
    await voidedOrder("pi_fine");
    await refundStatus("refund.updated", "re_fine", "pending", "pi_fine");
    await refundStatus("charge.refund.updated", "re_fine", "succeeded", "pi_fine");
    expect(await exceptions()).toEqual([]);
    expect(logged(info)).toContain("has status pending; charge.refunded records it.");
  });

  it("a later success for the same refund closes it; failing again reopens it with a new alert; an older event is ignored", async () => {
    await voidedOrder("pi_flip");
    await refundStatus("refund.updated", "re_flip", "requires_action", "pi_flip", { created: 100, eventId: "evt_a" });
    await refundStatus("refund.updated", "re_flip", "succeeded", "pi_flip", { created: 200, eventId: "evt_b" });
    expect(await exceptions()).toEqual([expect.objectContaining({ status: "resolved", resolution: "auto" })]);

    // An older failure delivered late doesn't reopen it.
    await refundStatus("refund.failed", "re_flip", "failed", "pi_flip", { created: 150, eventId: "evt_late" });
    expect(await exceptions()).toEqual([expect.objectContaining({ status: "resolved" })]);

    // Its first alert was skipped: resolved before it went out.
    await api.runDeferred();
    expect(api.sendEmail.mock.calls.filter(([message]) => message.to === OPS_ALERT_EMAIL)).toEqual([]);
    // A card refund can go from succeeded to failed: reopened, alerted again.
    await refundStatus("refund.failed", "re_flip", "failed", "pi_flip", { created: 300, eventId: "evt_c" });
    const rows = await exceptions();
    expect(rows).toEqual([expect.objectContaining({ status: "open", resolution: null })]);
    expect(rows[0].details.refundStatus).toBe("failed");
    expect(await alertJobs()).toEqual([
      { status: "failed", payment_exception_id: rows[0].id },
      { status: "pending", payment_exception_id: rows[0].id },
    ]);

    // A succeeded event no newer than the failure doesn't close it.
    await refundStatus("refund.updated", "re_flip", "succeeded", "pi_flip", { created: 300, eventId: "evt_same" });
    expect((await exceptions())[0].status).toBe("open");
    await refundStatus("refund.updated", "re_flip", "succeeded", "pi_flip", { created: 400, eventId: "evt_d" });
    expect((await exceptions())[0].status).toBe("resolved");
  });

  it("one an admin resolved stays resolved, whatever arrives later", async () => {
    await voidedOrder("pi_admin");
    await refundStatus("refund.failed", "re_admin", "failed", "pi_admin", { created: 100 });
    const [row] = await exceptions();
    const res = await api.call(adminResolvePaymentException, {
      token: admin.token,
      params: { exceptionId: row.id },
      body: { note: "Refunded again in the Stripe dashboard (re_new)." },
    });
    expect(res.status).toBe(200);
    await refundStatus("charge.refund.updated", "re_admin", "failed", "pi_admin", { created: 500 });
    expect(await exceptions()).toEqual([expect.objectContaining({ status: "resolved", resolution: "admin" })]);
    expect(await alertJobs()).toHaveLength(1);
  });

  it("a failure reported before the payment had an order is kept, and matched to the order at fulfilment", async () => {
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    await refund("pi_pre", 3170, true);
    await refundStatus("refund.failed", "re_pre", "failed", "pi_pre");
    expect(await exceptions()).toEqual([expect.objectContaining({ kind: "refund_not_completed", order_id: null, status: "open" })]);
    expect(logged(error)).toContain("a refund of a payment not yet matched to an order");

    await pay(orderId, "pi_pre");
    // D3: still voided; the exception now names the order, and it's urgent.
    expect(await internal(orderId)).toMatchObject({ status: "refunded", tickets: 0 });
    const [row] = await exceptions();
    expect(row).toMatchObject({ order_id: orderId });
    expect(row.details.orderStatus).toBe("refunded");
    const list = await api.call(adminListPaymentExceptions, { token: admin.token });
    expect(list.body.items[0]).toMatchObject({ urgent: true, orderReference: orderReference(orderId), orderStatus: "refunded" });
  });
});

async function marks() {
  return api.db.query<{ refund_id: string; status: string; stripe_event_id: string | null }>(
    `select refund_id, status, stripe_event_id from private.refund_status_marks order by refund_id`,
  );
}

describe("refund statuses out of order, and confirmed with Stripe before a failure is reported", () => {
  it("a succeeded delivered before an older requires_action or failed opens nothing and alerts no one (Stripe unreachable)", async () => {
    const orderId = await voidedOrder("pi_ooo");
    // The newest first: nothing open to resolve, but the refund's mark remembers it.
    await refundStatus("refund.updated", "re_ooo", "succeeded", "pi_ooo", { created: 300, eventId: "evt_new" });
    expect(await marks()).toEqual([{ refund_id: "re_ooo", status: "succeeded", stripe_event_id: "evt_new" }]);
    // Then the older ones, delivered late. Stripe can't be asked (the fake's default), so the database decides.
    await refundStatus("refund.updated", "re_ooo", "requires_action", "pi_ooo", { created: 100, eventId: "evt_old_a" });
    await refundStatus("refund.failed", "re_ooo", "failed", "pi_ooo", { created: 200, eventId: "evt_old_b" });
    await refundStatus("charge.refund.updated", "re_ooo", "failed", "pi_ooo", { created: 299, eventId: "evt_old_c" });
    expect(api.stripe.refunds.retrieve).toHaveBeenCalledTimes(3);
    expect(api.stripe.refunds.retrieve).toHaveBeenCalledWith("re_ooo");

    expect(await exceptions()).toEqual([]);
    expect(await alertJobs()).toEqual([]);
    expect(await marks()).toEqual([{ refund_id: "re_ooo", status: "succeeded", stripe_event_id: "evt_new" }]);
    expect(error).not.toHaveBeenCalled();
    expect(logged(info)).toContain("Stripe evt_old_b: an older refund status (failed) than one already recorded for the refund; ignored.");
    expect(logged(warn)).toContain("couldn't confirm the refund's status with Stripe (StripeConnectionError)");
    expect(await internal(orderId)).toMatchObject({ status: "refunded" });
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();

    // A genuinely newer failure still opens one (a card refund can fail after succeeding).
    await refundStatus("refund.failed", "re_ooo", "failed", "pi_ooo", { created: 400, eventId: "evt_newer" });
    expect(await exceptions()).toEqual([expect.objectContaining({ kind: "refund_not_completed", status: "open", refund_id: "re_ooo" })]);
    expectLogHygiene(orderId, "pi_ooo");
  });

  it("a reported failure that Stripe says has since succeeded is recorded as succeeded: no exception, no alert", async () => {
    await voidedOrder("pi_confirm");
    api.stripe.refunds.retrieve.mockResolvedValue({ id: "re_confirm", object: "refund", status: "succeeded", amount: 3170 });
    await refundStatus("refund.updated", "re_confirm", "requires_action", "pi_confirm", { created: 100, eventId: "evt_ra" });
    expect(await exceptions()).toEqual([]);
    expect(await alertJobs()).toEqual([]);
    expect(await marks()).toEqual([{ refund_id: "re_confirm", status: "succeeded", stripe_event_id: "evt_ra" }]);

    // Stripe confirms a failure: it's reported.
    api.stripe.refunds.retrieve.mockResolvedValue({ id: "re_confirm", object: "refund", status: "failed", amount: 3170 });
    await refundStatus("refund.failed", "re_confirm", "failed", "pi_confirm", { created: 200, eventId: "evt_f" });
    expect(await exceptions()).toEqual([expect.objectContaining({ status: "open", refund_id: "re_confirm" })]);
    expect(await alertJobs()).toHaveLength(1);
    // A Stripe answer about another refund isn't used.
    api.stripe.refunds.retrieve.mockResolvedValue({ id: "re_other", object: "refund", status: "succeeded" });
    await refundStatus("refund.failed", "re_confirm", "failed", "pi_confirm", { created: 300, eventId: "evt_g" });
    expect((await exceptions())[0].status).toBe("open");
    expect(logged(warn)).toContain("Stripe's answer for the refund had no usable status");
  });

  it("our own refund call's answer (no event): confirmed with Stripe, and recorded with no Stripe event id", async () => {
    const { second, pay: paySecond } = await oversold();
    // Stripe's idempotent replay of an older answer; the refund has since succeeded.
    api.stripe.refunds.create.mockResolvedValue({ id: "re_mine", status: "requires_action", payment_intent: "pi_second", amount: 8000 });
    api.stripe.refunds.retrieve.mockResolvedValue({ id: "re_mine", object: "refund", status: "succeeded", amount: 8000 });
    await paySecond();
    expect(await internal(second)).toMatchObject({ status: "refunded", tickets: 0 });
    expect(await exceptions()).toEqual([]);
    // Our call's answer has no event time: it leaves no mark (a later event isn't judged against it).
    expect(await marks()).toEqual([]);

  });

  it("our own refund call's unconfirmed failure opens an exception without the checkout webhook's event id (L1)", async () => {
    const { pay: paySecond } = await oversold();
    // Stripe unreachable for the confirmation (the fake's default).
    api.stripe.refunds.create.mockResolvedValue({ id: "re_mine_2", status: "failed", payment_intent: "pi_second", amount: 8000 });
    await paySecond();
    const [row] = await api.db.query<{ stripe_event_id: string | null; last_event_at: string | null }>(
      `select stripe_event_id, last_event_at from private.payment_exceptions where refund_id = 're_mine_2'`,
    );
    expect(row).toEqual({ stripe_event_id: null, last_event_at: null });
    expect(await marks()).toEqual([]);
  });

  it("a refund's metadata.orderId is trusted only for an order paid with that refund's own payment", async () => {
    const { first, second } = await oversold();
    api.stripe.refunds.create.mockRejectedValue(Object.assign(new Error("down"), { code: "api_connection_error" }));
    await api.send(stripeWebhook, completed(second, "pi_second"));
    expect(await internal(second)).toMatchObject({ status: "oversold_refund_required" });

    // A refund of another payment (the first order's) claiming to be the second order's: not ours, nothing settled.
    await refundStatus("refund.updated", "re_forged", "succeeded", "pi_first", { orderId: second, created: 100 });
    expect(await internal(second)).toMatchObject({ status: "oversold_refund_required" });
    expect(await internal(first)).toMatchObject({ status: "paid" });
    // A failure for it lands on the order its payment belongs to, as a dashboard refund (source stripe).
    await refundStatus("refund.failed", "re_forged", "failed", "pi_first", { orderId: second, created: 200 });
    const [row] = await exceptions();
    expect(row).toMatchObject({ order_id: first, refund_id: "re_forged" });
    expect(row.details).toMatchObject({ source: "stripe", orderStatus: "paid" });
    // With no payment intent at all, the metadata alone settles nothing.
    await refundStatus("refund.updated", "re_none", "succeeded", null, { orderId: second, created: 300 });
    expect(await internal(second)).toMatchObject({ status: "oversold_refund_required" });
  });

  it("a stale event changes nothing on our oversold order either", async () => {
    const { second } = await oversold();
    api.stripe.refunds.create.mockRejectedValue(Object.assign(new Error("down"), { code: "api_connection_error" }));
    await api.send(stripeWebhook, completed(second, "pi_second"));
    await refundStatus("refund.failed", "re_auto2", "failed", "pi_second", { orderId: second, created: 500 });
    // An older `succeeded`, delivered late: the order isn't marked refunded.
    await refundStatus("refund.updated", "re_auto2", "succeeded", "pi_second", { orderId: second, created: 400 });
    expect(await internal(second)).toMatchObject({ status: "oversold_refund_required" });
    expect(await exceptions()).toEqual([expect.objectContaining({ status: "open", refund_id: "re_auto2" })]);
  });
});

describe("early refunds meeting other outcomes at fulfilment", () => {
  it("an early partial refund, then the order oversold: refunded in full by us, no partial_refund exception or alert", async () => {
    const { second, pay: paySecond } = await oversold();
    await refund("pi_second", 3000, false, { eventId: "evt_early_part" });
    expect(await earlyRows()).toEqual([
      { payment_intent_id: "pi_second", amount_refunded_cents: 3000, fully_refunded: false, applied_order_id: null },
    ]);
    api.deferred.length = 0;
    await paySecond();

    // Oversold: our automatic refund (of what's left) settles it.
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(api.stripe.refunds.create.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_second", reverse_transfer: true });
    expect(await internal(second)).toMatchObject({ status: "refunded", tickets: 0 });
    expect(await sold()).toEqual({ ga: 0, vip: 1 });
    expect((await earlyRows())[0].applied_order_id).toBe(second);
    expect(await exceptions()).toEqual([]);
    expect(await alertJobs()).toEqual([]);
    // L2: no alert was queued, so no ops-alert run was deferred either.
    expect(api.deferred).toHaveLength(0);
    expect(await lookup(second)).toMatchObject({ status: "refunded" });
    expectLogHygiene(second, "pi_second");
  });

  it("a normal payment defers the ticket email only, not an ops-alert run", async () => {
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    api.deferred.length = 0;
    await pay(orderId, "pi_plain");
    expect(api.deferred).toHaveLength(1);
    await api.runDeferred();
    expect(api.sendEmail.mock.calls.map(([m]) => m.to)).toEqual(["buyer@example.com"]);
  });

  it("an early full refund for an order that had already failed: it stays failed, nothing issued, no exception", async () => {
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    await refund("pi_failed_early", 3170, true);
    expect(await earlyRows()).toHaveLength(1);

    // The payment arrives: our refund finds it already refunded in full (done, not a 500).
    api.stripe.refunds.create.mockRejectedValue(Object.assign(new Error("already"), { code: "charge_already_refunded" }));
    await pay(orderId, "pi_failed_early");
    await pay(orderId, "pi_failed_early"); // redelivered
    expect(await internal(orderId)).toMatchObject({ status: "failed", tickets: 0, payment_intent: "pi_failed_early" });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
    expect(await ticketJobs(orderId)).toEqual([]);
    expect(await exceptions()).toEqual([]);
    expect(await alertJobs()).toEqual([]);
    // The early row is never applied to a failed order (it's purged with the rest after 35 days).
    expect((await earlyRows())[0].applied_order_id).toBeNull();
    expectLogHygiene(orderId, "pi_failed_early");
  });

  it("an early partial refund for an order that had already failed: the rest is refunded once, it stays failed", async () => {
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    await refund("pi_failed_part", 1000, false);
    api.stripe.refunds.create.mockResolvedValue({ id: "re_rest", status: "succeeded", payment_intent: "pi_failed_part", amount: 2170 });
    await pay(orderId, "pi_failed_part");
    await pay(orderId, "pi_failed_part");
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(await internal(orderId)).toMatchObject({ status: "failed", tickets: 0, payment_intent: "pi_failed_part" });
    expect(await exceptions()).toEqual([]);
    // The full charge.refunded that follows changes nothing (only paid orders are voided).
    await refund("pi_failed_part", 3170, true);
    expect(await internal(orderId)).toMatchObject({ status: "failed" });
    expect(await exceptions()).toEqual([]);
  });
});

/** Two buyers for the one VIP: the second payment can't be fulfilled and is refunded automatically. */
async function oversold(paymentIntent: string | null = "pi_second") {
  const first = await checkout([{ ticketTypeId: "vip", quantity: 1 }]);
  const second = await checkout([{ ticketTypeId: "vip", quantity: 1 }]);
  await pay(first, "pi_first");
  return { first, second, pay: () => pay(second, paymentIntent) };
}

describe("our own automatic refunds", () => {
  it("one that fails: the order stays oversold_refund_required with one exception; a later success settles both", async () => {
    const { second, pay: paySecond } = await oversold();
    api.stripe.refunds.create.mockResolvedValue({ id: "re_auto", status: "failed", payment_intent: "pi_second", amount: 8000 });
    await paySecond();
    expect(await internal(second)).toMatchObject({ status: "oversold_refund_required", tickets: 0 });
    let rows = await exceptions();
    expect(rows).toEqual([expect.objectContaining({ kind: "refund_not_completed", status: "open", order_id: second, refund_id: "re_auto" })]);
    expect(rows[0].details).toMatchObject({ refundStatus: "failed", orderStatus: "oversold_refund_required", source: "sheltuh" });
    expect(logged(error)).toContain(`refund for order ${orderReference(second)} failed — refund it manually. Payment exception opened.`);

    // Stripe's own event for it, then a redelivered payment (the same refund, by idempotency key): still one.
    await refundStatus("refund.failed", "re_auto", "failed", "pi_second", { orderId: second });
    await paySecond();
    expect(await exceptions()).toHaveLength(1);
    expect(await alertJobs()).toHaveLength(1);

    await refundStatus("refund.updated", "re_auto", "succeeded", "pi_second", { orderId: second, created: 1_900_000_000 });
    expect(await internal(second)).toMatchObject({ status: "refunded" });
    rows = await exceptions();
    expect(rows).toEqual([expect.objectContaining({ status: "resolved", resolution: "auto" })]);
    // Not urgent at any point: no tickets were ever issued.
    expect(await lookup(second)).toMatchObject({ status: "refunded", refundReason: "oversold" });
  });

  it("charge_already_refunded (e.g. refunded in the dashboard first) is done, not a 500: the oversold order is marked refunded", async () => {
    const { second, pay: paySecond } = await oversold();
    api.stripe.refunds.create.mockRejectedValue(
      Object.assign(new Error("Charge ch_x has already been refunded."), { type: "StripeInvalidRequestError", code: "charge_already_refunded" }),
    );
    await paySecond();
    await paySecond(); // redelivered
    expect(await internal(second)).toMatchObject({ status: "refunded", tickets: 0 });
    expect(await exceptions()).toEqual([]);
  });

  it("charge_already_refunded for a payment to a failed order is done too: it stays failed, the payment recorded", async () => {
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    api.stripe.refunds.create.mockRejectedValue(Object.assign(new Error("already"), { code: "charge_already_refunded" }));
    await pay(orderId, "pi_failed_paid");
    expect(await internal(orderId)).toMatchObject({ status: "failed", payment_intent: "pi_failed_paid" });
  });

  it("any other Stripe error is still a 500, so Stripe redelivers", async () => {
    const { second } = await oversold();
    api.stripe.refunds.create.mockRejectedValue(Object.assign(new Error("Stripe is down"), { code: "api_connection_error" }));
    const res = await api.send(stripeWebhook, completed(second, "pi_second"));
    expect(res.status).toBe(500);
    expect(await internal(second)).toMatchObject({ status: "oversold_refund_required" });
  });

  it("a payment with no payment intent on record: one manual_refund_required exception, however often it's redelivered", async () => {
    const { second, pay: paySecond } = await oversold(null);
    await paySecond();
    await paySecond();
    const rows = await exceptions();
    expect(rows).toEqual([expect.objectContaining({ kind: "manual_refund_required", status: "open", order_id: second })]);
    expect(rows[0].details).toEqual({ reason: "no_payment_intent", orderStatus: "oversold_refund_required" });
    expect(await alertJobs()).toHaveLength(1);
    expect(api.stripe.refunds.create).not.toHaveBeenCalled();

    // The same for a payment to an order that had already failed.
    const failed = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [failed]);
    await pay(failed, null);
    expect((await exceptions()).map((r) => [r.kind, r.order_id])).toEqual([
      ["manual_refund_required", second],
      ["manual_refund_required", failed],
    ]);
  });
});

describe("partial refunds of paid orders", () => {
  it("open one exception per order, updated as the amount grows", async () => {
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }], "pi_partly");
    await refund("pi_partly", 1000, false);
    await refund("pi_partly", 1000, false);
    await refund("pi_partly", 2000, false);
    const rows = await exceptions();
    expect(rows).toEqual([expect.objectContaining({ kind: "partial_refund", status: "open", order_id: orderId })]);
    expect(rows[0].details).toMatchObject({ amountRefundedCents: 2000 });
    expect(await alertJobs()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Ops alerts (D5)
// ---------------------------------------------------------------------------

/** Opens a manual_refund_required exception for a fresh order, straight through the database function. */
async function openException() {
  const orderId = await insertOrder(api, event, "fan@example.com", "oversold_refund_required");
  const [row] = await api.db.query<{ exception_id: string; outcome: string }>(
    `select * from private.raise_payment_exception('manual_refund_required', $1, null, null, null, null, '{}'::jsonb)`,
    [orderId],
  );
  return { orderId, exceptionId: row.exception_id };
}

describe("ops alerts", () => {
  it("OPS_ALERT_EMAIL unset: logged loudly and skipped; the exception stays open", async () => {
    api.opsAlertEmail = undefined;
    const { exceptionId } = await openException();
    await drainEmailOutbox(api.deps, { kind: "ops_alert" });
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect(logged(error)).toContain("OPS_ALERT_EMAIL isn't set");
    expect(await alertJobs()).toEqual([{ status: "failed", payment_exception_id: exceptionId }]);
    expect(await exceptions()).toEqual([expect.objectContaining({ id: exceptionId, status: "open" })]);
  });

  it("at most 20 a day; the exceptions are recorded either way", async () => {
    for (let i = 0; i < 21; i++) await openException();
    const rows = await exceptions();
    expect(rows).toHaveLength(21);
    expect(rows.filter((r) => r.alerted)).toHaveLength(20);
    expect(await alertJobs()).toHaveLength(20);
    // The next window takes alerts again.
    await api.db.query(`update private.platform_rate_limits set window_started_at = now() - interval '25 hours' where bucket = 'ops_alerts'`);
    await openException();
    expect(await alertJobs()).toHaveLength(21);
  });

  it("an exception resolved before its alert goes out isn't emailed", async () => {
    const { exceptionId } = await openException();
    await api.db.query(`select private.resolve_payment_exception($1, $2, 'Handled.')`, [exceptionId, admin.userId]);
    await drainEmailOutbox(api.deps, { kind: "ops_alert" });
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("the previous app version's claim (no kind) never takes an alert; this version's cron sends it", async () => {
    await openException();
    const claimed = await api.db.query(`select * from private.claim_email_outbox(10, '2 minutes', 6, null, null)`);
    expect(claimed).toEqual([]);
    const summary = await drainEmailOutbox(api.deps);
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
    expect(api.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: OPS_ALERT_EMAIL }));
  });

  it("isn't listed among the admin's ticket emails, and can't be resent as one", async () => {
    await openException();
    const [job] = await api.db.query<{ id: string }>(`select id::text as id from private.email_outbox where kind = 'ops_alert'`);
    const [resent] = await api.db.query<{ result: string }>(`select result from private.resend_email_job($1::bigint, '5 minutes')`, [job.id]);
    expect(resent.result).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

describe("GET /api/admin/payment-exceptions and POST …/{id}/resolve", () => {
  it("are admin only", async () => {
    const { exceptionId } = await openException();
    const member = await api.signUp();
    expect((await api.call(adminListPaymentExceptions)).status).toBe(401);
    expect((await api.call(adminListPaymentExceptions, { token: member.token })).status).toBe(403);
    const resolve = (token?: string) =>
      api.call(adminResolvePaymentException, { token, params: { exceptionId }, body: { note: "Done." } });
    expect((await resolve()).status).toBe(401);
    expect((await resolve(member.token)).status).toBe(403);
    expect((await exceptions())[0].status).toBe("open");
  });

  it("lists open ones oldest first, resolved ones newest resolution first, with no buyer data", async () => {
    const one = await openException();
    const two = await openException();
    await api.db.query(`update private.payment_exceptions set opened_at = now() - interval '1 hour' where id = $1`, [two.exceptionId]);
    const open = await api.call(adminListPaymentExceptions, { token: admin.token });
    expect(open.status).toBe(200);
    expect(open.headers.get("cache-control")).toBe("private, no-store");
    expect(open.body.items.map((i: { exceptionId: string }) => i.exceptionId)).toEqual([two.exceptionId, one.exceptionId]);
    expect(open.body.items[0]).toMatchObject({
      kind: "manual_refund_required",
      status: "open",
      urgent: false,
      orderReference: orderReference(two.orderId),
      orderStatus: "oversold_refund_required",
      eventTitle: "Test event",
    });
    const text = JSON.stringify(open.body);
    expect(text).not.toContain(two.orderId);
    expect(text).not.toContain("fan@example.com");

    for (const { exceptionId } of [one, two]) {
      await api.call(adminResolvePaymentException, { token: admin.token, params: { exceptionId }, body: { note: "Refunded in Stripe." } });
    }
    const resolved = await api.call(adminListPaymentExceptions, { token: admin.token, query: { status: "resolved" } });
    expect(resolved.body.items.map((i: { exceptionId: string }) => i.exceptionId)).toEqual([two.exceptionId, one.exceptionId]);
    expect((await api.call(adminListPaymentExceptions, { token: admin.token })).body.items).toEqual([]);
    expect((await api.call(adminListPaymentExceptions, { token: admin.token, query: { status: "all" } })).status).toBe(400);
  });

  it("resolve: a note is required; 404 unknown; 409 the second time; the order is never changed", async () => {
    const { orderId, exceptionId } = await openException();
    const call = (body: unknown, id = exceptionId) =>
      api.call(adminResolvePaymentException, { token: admin.token, params: { exceptionId: id }, body });

    for (const body of [{}, { note: "" }, { note: "   " }, { note: 5 }, { note: "x".repeat(501) }, { note: "bad‮text" }]) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toHaveProperty("note");
    }
    expect((await call({ note: "Done." }, "not-a-uuid")).status).toBe(404);
    expect((await call({ note: "Done." }, crypto.randomUUID())).status).toBe(404);

    const res = await call({ note: "Refunded again in the Stripe dashboard." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      exceptionId,
      status: "resolved",
      resolution: "admin",
      resolvedBy: admin.userId,
      resolutionNote: "Refunded again in the Stripe dashboard.",
    });
    expect((await call({ note: "Again." })).status).toBe(409);
    expect(await internal(orderId)).toMatchObject({ status: "oversold_refund_required" });
  });
});

// ---------------------------------------------------------------------------
// Retention (D11)
// ---------------------------------------------------------------------------

describe("retention (purge_operational_data)", () => {
  it("early refunds and refund status marks after 35 days, resolved exceptions after 2 years; open exceptions never", async () => {
    await api.db.query(
      `insert into private.early_charge_refunds (payment_intent_id, destination_account_id, amount_refunded_cents, fully_refunded, updated_at)
       values ('pi_old', 'acct_test_1', 100, true, now() - interval '36 days'), ('pi_recent', 'acct_test_1', 100, true, now() - interval '34 days')`,
    );
    await api.db.query(
      `insert into private.refund_status_marks (refund_id, status, last_event_at, updated_at)
       values ('re_old', 'succeeded', now() - interval '40 days', now() - interval '36 days'),
              ('re_recent', 'succeeded', now() - interval '40 days', now() - interval '34 days')`,
    );
    const old = await openException();
    const recent = await openException();
    const ancient = await openException();
    await api.db.query(
      `update private.payment_exceptions set status = 'resolved', resolution = 'admin', resolution_note = 'x',
              resolved_at = now() - interval '2 years 1 day' where id = $1`,
      [old.exceptionId],
    );
    await api.db.query(
      `update private.payment_exceptions set status = 'resolved', resolution = 'admin', resolution_note = 'x',
              resolved_at = now() - interval '1 year' where id = $1`,
      [recent.exceptionId],
    );
    await api.db.query(`update private.payment_exceptions set opened_at = now() - interval '5 years', created_at = now() - interval '5 years' where id = $1`, [
      ancient.exceptionId,
    ]);

    const [counts] = await api.db.query(
      `select early_charge_refunds_deleted, payment_exceptions_deleted, refund_status_marks_deleted from private.purge_operational_data()`,
    );
    expect(counts).toEqual({ early_charge_refunds_deleted: 1, payment_exceptions_deleted: 1, refund_status_marks_deleted: 1 });
    expect(await api.db.query(`select refund_id from private.refund_status_marks`)).toEqual([{ refund_id: "re_recent" }]);
    expect((await earlyRows()).map((r) => r.payment_intent_id)).toEqual(["pi_recent"]);
    expect((await exceptions()).map((r) => r.id).sort()).toEqual([recent.exceptionId, ancient.exceptionId].sort());
  });
});

// ---------------------------------------------------------------------------
// Real Postgres: concurrency
// ---------------------------------------------------------------------------

// Two sessions at once: only a real server (PGlite is one connection). Run
// with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates"); the API's
// postgres.js pool runs up to 5 requests at once.
describe.skipIf(!process.env.TEST_DATABASE_URL)("races (real Postgres only)", () => {
  function connections() {
    return [
      postgres(serverUrl as string, { max: 1, onnotice: () => {} }),
      postgres(serverUrl as string, { max: 1, onnotice: () => {} }),
    ];
  }

  async function waitUntilBlocked(conn: postgres.Sql) {
    const [{ pid }] = await conn.unsafe("select pg_backend_pid() as pid");
    return async () => {
      for (let i = 0; ; i++) {
        const [row] = await api.db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (row?.wait_event_type === "Lock") return;
        if (i > 200) throw new Error("never blocked");
        await new Promise((r) => setTimeout(r, 25));
      }
    };
  }

  const recordRefund = (conn: postgres.Sql, paymentIntent: string, amount: number, full: boolean) =>
    conn.unsafe(`select result from private.record_payment_refund($1, $2, $3, 'ch_1', $4, 'evt_race')`, [
      paymentIntent,
      amount,
      full,
      OUR_ACCOUNT,
    ]);

  let codes = 0;
  const fulfil = (conn: postgres.Sql, orderId: string, paymentIntent: string, n: number) =>
    conn.unsafe(`select private.fulfil_order($1, 'buyer@example.com', $2, $3::text::jsonb)::text as status`, [
      orderId,
      paymentIntent,
      JSON.stringify(
        Array.from({ length: n }, () => ({ ticketCode: `RR${String(codes++).padStart(2, "0")}-RRRR`, ticketTypeId: "ga", ticketTypeName: "GA" })),
      ),
    ]);

  it("a refund first (uncommitted): the fulfilment waits on the payment intent, then leaves the order refunded with nothing taken", async () => {
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 2 }]);
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await recordRefund(one, "pi_rf", 6340, true))[0].result).toBe("deferred");
      const blocked = await waitUntilBlocked(two);
      const pending = fulfil(two, orderId, "pi_rf", 2).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].status).toBe("refunded");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await internal(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: 6340, tickets: 0 });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
  });

  it("two early deliveries at once: one row, the greatest amount, full", async () => {
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await recordRefund(one, "pi_twice", 3000, false))[0].result).toBe("deferred");
      const blocked = await waitUntilBlocked(two);
      const pending = recordRefund(two, "pi_twice", 6340, true).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("deferred");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await earlyRows()).toEqual([
      { payment_intent_id: "pi_twice", amount_refunded_cents: 6340, fully_refunded: true, applied_order_id: null },
    ]);
  });

  it("duplicate payment and refund deliveries all at once: tickets issued and inventory released at most once", async () => {
    for (let round = 0; round < 5; round++) {
      const orderId = await checkout([{ ticketTypeId: "ga", quantity: 2 }]);
      const pi = `pi_storm_${round}`;
      const requests = [
        ...Array.from({ length: 3 }, () => api.send(stripeWebhook, completed(orderId, pi))),
        ...Array.from({ length: 3 }, () => api.send(stripeWebhook, chargeRefunded(pi, 6340, true))),
      ];
      const results = await Promise.all(requests);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
      const row = await internal(orderId);
      expect(row.status).toBe("refunded");
      // Either the refund came first (nothing issued) or the payment did (issued, then voided): never twice.
      expect([0, 2]).toContain(row.tickets);
      expect(await sold()).toEqual({ ga: 0, vip: 0 });
      expect((await ticketJobs(orderId)).length).toBe(row.tickets === 0 ? 0 : 1);
    }
  });

  it("a seated order's payment and refund at once: its seats end up free, never sold to a refunded order", async () => {
    const { event: seated } = await seatedEvent(api, organiser, admin);
    for (const seat of ["A1", "A2", "A3"]) {
      const res = await api.call(createCheckout, {
        params: { eventId: seated.eventId },
        body: { seats: { mapVersion: seated.seating!.version, seatIds: [seat] } },
      });
      const orderId = res.body.orderId as string;
      const pi = `pi_seat_${seat}`;
      await Promise.all([
        api.send(stripeWebhook, completed(orderId, pi)),
        api.send(stripeWebhook, chargeRefunded(pi, 5250, true)),
        api.send(stripeWebhook, completed(orderId, pi)),
      ]);
      expect(await internal(orderId)).toMatchObject({ status: "refunded" });
      expect((await seatStates(api, seated.eventId))[seat]).toBe("free");
    }
    expect((await tierCounts(api, seated.eventId)).prem.sold).toBe(0);
  });

  it("the same failed refund reported by three events at once: exactly one exception and one alert", async () => {
    await voidedOrder("pi_trio");
    const results = await Promise.all(
      (["refund.failed", "refund.updated", "charge.refund.updated"] as const).flatMap((type) => [
        api.send(stripeWebhook, refundEvent(type, "re_trio", "failed", "pi_trio", { eventId: `evt_${type}` })),
        api.send(stripeWebhook, refundEvent(type, "re_trio", "failed", "pi_trio", { eventId: `evt_${type}` })),
      ]),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await exceptions()).toHaveLength(1);
    expect(await alertJobs()).toHaveLength(1);
  });
});
