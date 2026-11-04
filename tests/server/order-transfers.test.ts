import Stripe from "stripe";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { calculateBookingFeeCents } from "@/lib/fees";
import { drainEmailOutbox } from "@/lib/server/email-outbox";
import { runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import { adminListPaymentExceptions } from "@/lib/server/handlers/payment-exceptions";
import { adminListTransfers, adminTransferAction, getMyPayouts, runPayoutsCron } from "@/lib/server/handlers/payouts";
import {
  classifyTransferError,
  MAX_TRANSFER_ATTEMPTS,
  runOrderTransfers,
  TRANSFER_RUN,
  TRANSFER_STRIPE_REQUEST,
  transferIdempotencyKey,
  transferRetryDelaySeconds,
} from "@/lib/server/order-transfers";
import { orderReference } from "@/lib/server/order-reference";
import type { OrganiserPayoutEvent } from "@/lib/api/types";
import type { EventRecord } from "@/lib/server/types";
import {
  CRON_SECRET,
  embeddedSession,
  OPS_ALERT_EMAIL,
  sessionAmount,
  SITE_URL,
  stripeWebhookRequest,
  TestApi,
} from "./helpers/api";
import { approvedOrganiser, disablePayouts, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// Delayed payouts (supabase/migrations/20261119000000_delayed_payouts.sql,
// lib/server/order-transfers.ts, docs/architecture.md "Delayed payouts"):
// checkout's two shapes, what is due, the Stripe transfer and its safety
// (at most one per order), refunds before and after a transfer, the
// admin and organiser APIs, and the cron.

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let warn: MockInstance;
let error: MockInstance;

// GA: 3000 + the booking fee to the buyer. VIP: 8000, the fee comes out of the organiser's share.
const TICKETS = [
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 50 },
];
/** enablePayouts' account. */
const ACCOUNT = "acct_test_1";

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
  await enablePayouts(api, organiser.organiserId);
  let sessions = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => embeddedSession(`cs_test_${++sessions}`));
  api.delayedPayouts = true;
  paymentSeq = 0;
  // Support Sheltüh is paused unless the switch is on (lib/support.ts).
  vi.stubEnv("NEXT_PUBLIC_SUPPORT_SHELTUH", "1");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let paymentSeq = 0;

interface MadeOrder {
  orderId: string;
  pi: string;
  total: number;
  support: number;
  fee: number;
  /** total - support - fee: what the organiser is sent. */
  share: number;
}

async function orderRow(orderId: string) {
  const [row] = await api.db.query<{
    status: string;
    payout_method: string;
    total_cents: number;
    support_cents: number;
    application_fee_cents: number;
    amount_refunded_cents: number;
  }>(
    `select status::text as status, payout_method, total_cents, support_cents, application_fee_cents, amount_refunded_cents
       from public.orders where id = $1`,
    [orderId],
  );
  return row;
}

async function webhookPay(orderId: string, pi: string) {
  const res = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      id: `evt_paid_${pi}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${orderId}`,
          object: "checkout.session",
          client_reference_id: orderId,
          ...(await sessionAmount(api.db, orderId)),
          payment_status: "paid",
          payment_intent: pi,
          customer_details: { email: "buyer@example.com" },
        },
      },
    }),
  );
  expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { received: true } });
  // The buyer's ticket email isn't what these tests are about: what's deferred from here on is the ops alerts'.
  api.deferred.length = 0;
}

/** A checkout, paid through the webhook; `delayed: false` makes today's destination order. */
async function makeOrder(
  options: { lines?: { ticketTypeId: string; quantity: number }[]; support?: number; delayed?: boolean; paid?: boolean; on?: EventRecord } = {},
): Promise<MadeOrder> {
  api.delayedPayouts = options.delayed ?? true;
  const res = await api.call(createCheckout, {
    params: { eventId: (options.on ?? event).eventId },
    body: {
      lineItems: options.lines ?? [{ ticketTypeId: "ga", quantity: 2 }],
      ...(options.support ? { supportCents: options.support } : {}),
    },
  });
  expect(res.status).toBe(201);
  const orderId = res.body.orderId as string;
  const pi = `pi_t${++paymentSeq}`;
  const row = await orderRow(orderId);
  if (options.paid !== false) {
    await webhookPay(orderId, pi);
    // What Stripe would say about the payment when the job asks.
    api.stripe.payments.set(pi, { orderId: row.payout_method === "transfer" ? orderId : undefined, amount: row.total_cents });
  }
  return {
    orderId,
    pi,
    total: row.total_cents,
    support: row.support_cents,
    fee: row.application_fee_cents,
    share: row.total_cents - row.support_cents - row.application_fee_cents,
  };
}

/** The event ended this long ago (a number of hours; fractions allowed). */
async function endedHoursAgo(hours: number, eventId = event.eventId) {
  await api.db.query(
    `update public.events set starts_at = now() - interval '1 hour' * ($2::numeric + 24), ends_at = now() - interval '1 hour' * $2::numeric
      where id = $1`,
    [eventId, hours],
  );
}

const run = () => runOrderTransfers(api.deps);
/** A run with a single worker, for tests that lapse a lease by hand while it works. */
const runOne = () => runOrderTransfers(api.deps, { concurrency: 1 });

async function transfers() {
  return api.db.query<{
    id: string;
    order_id: string;
    status: string;
    attempts: number;
    key_version: number;
    amount_cents: number;
    stripe_transfer_id: string | null;
    last_error: string | null;
    destination_account_id: string;
  }>(
    `select id::text, order_id, status, attempts, key_version, amount_cents, stripe_transfer_id, last_error, destination_account_id
       from private.order_transfers order by id`,
  );
}

async function transferOf(orderId: string) {
  const rows = (await transfers()).filter((t) => t.order_id === orderId);
  return rows[0];
}

/** Every retrying transfer is due now. */
async function dueNow() {
  await api.db.query(`update private.order_transfers set next_attempt_at = now() - interval '1 second' where status = 'retry'`);
}

async function hoursUntilNextAttempt(orderId: string) {
  const [row] = await api.db.query<{ hours: string }>(
    `select (extract(epoch from next_attempt_at - now()) / 3600)::numeric(8,2)::text as hours from private.order_transfers where order_id = $1`,
    [orderId],
  );
  return Number(row.hours);
}

async function exceptions() {
  return api.db.query<{ kind: string; status: string; order_id: string; details: Record<string, unknown> }>(
    `select kind, status, order_id, details from private.payment_exceptions order by opened_at, id`,
  );
}

function chargeRefunded(
  pi: string,
  amountRefunded: number,
  refunded: boolean,
  options: { orderId?: string; eventId?: string; destination?: string } = {},
) {
  return stripeWebhookRequest({
    id: options.eventId ?? "evt_charge_refunded",
    type: "charge.refunded",
    data: {
      object: {
        id: `ch_${pi}`,
        object: "charge",
        payment_intent: pi,
        amount_refunded: amountRefunded,
        refunded,
        // A charge made for separate charges and transfers has no transfer_data; its metadata names the order.
        transfer_data: options.destination ? { amount: null, destination: options.destination } : null,
        metadata: options.orderId ? { orderId: options.orderId } : {},
      },
    },
  });
}

async function refund(order: MadeOrder, amount: number, options: { eventId?: string } = {}) {
  const res = await api.send(
    stripeWebhook,
    chargeRefunded(order.pi, amount, amount >= order.total, { orderId: order.orderId, eventId: options.eventId }),
  );
  expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { received: true } });
}

function originalTransferCreate() {
  return api.stripe.transfers.create.getMockImplementation()!;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

describe("checkout with DELAYED_PAYOUTS unset", () => {
  it("sends Stripe exactly today's session parameters, byte for byte, and records a destination order", async () => {
    api.delayedPayouts = false;
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] },
    });
    expect(res.status).toBe(201);
    const orderId = res.body.orderId as string;
    const [order] = await api.db.query<{ app_fee: number; event_title: string; created: number }>(
      `select application_fee_cents as app_fee, event_title, floor(extract(epoch from created_at))::int as created from public.orders where id = $1`,
      [orderId],
    );
    // Today's session, written out: a destination charge whose application fee is the booking fee.
    const expected = {
      mode: "payment",
      client_reference_id: orderId,
      expires_at: order.created + 3600,
      line_items: [
        { price_data: { currency: "aud", product_data: { name: `GA — ${order.event_title}` }, unit_amount: 3000 }, quantity: 2 },
        { price_data: { currency: "aud", product_data: { name: "Booking fee" }, unit_amount: calculateBookingFeeCents(3000) }, quantity: 2 },
      ],
      payment_intent_data: { application_fee_amount: order.app_fee, transfer_data: { destination: ACCOUNT } },
      ui_mode: "embedded_page",
      return_url: `${SITE_URL}/checkout/success?session_id=${orderId}`,
      metadata: { orderId, eventId: event.eventId },
      adaptive_pricing: { enabled: false },
    };
    const sent = api.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(JSON.stringify(sent)).toBe(JSON.stringify(expected));
    expect((await orderRow(orderId)).payout_method).toBe("destination");
  });

  it("with Support Sheltüh, the application fee still carries the support (as today)", async () => {
    api.delayedPayouts = false;
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }], supportCents: 500 },
    });
    const order = await orderRow(res.body.orderId);
    const sent = api.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(sent.payment_intent_data).toStrictEqual({
      application_fee_amount: order.application_fee_cents + 500,
      transfer_data: { destination: ACCOUNT },
    });
  });
});

describe("checkout with DELAYED_PAYOUTS on", () => {
  it("charges on the platform: no transfer_data and no application fee, the order id in the payment intent's group and metadata", async () => {
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }], supportCents: 700 },
    });
    expect(res.status).toBe(201);
    const orderId = res.body.orderId as string;
    const sent = api.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(sent.payment_intent_data).toStrictEqual({
      transfer_group: orderId,
      metadata: { orderId, eventId: event.eventId },
    });
    // The rest of the session is today's: same lines (support included), same options.
    expect(sent.line_items.at(-1)).toMatchObject({ price_data: { unit_amount: 700 } });
    expect(sent).toMatchObject({ mode: "payment", ui_mode: "embedded_page", adaptive_pricing: { enabled: false } });
    expect((await orderRow(orderId)).payout_method).toBe("transfer");
  });

  it("a seated checkout is a transfer order too", async () => {
    const { event: seated, map } = await seatedEvent(api, organiser, admin);
    const res = await api.call(createCheckout, {
      params: { eventId: seated.eventId },
      body: { seats: { mapVersion: map.version, seatIds: ["A1", "A2"] } },
    });
    expect(res.status).toBe(201);
    const orderId = res.body.orderId as string;
    const sent = api.stripe.checkout.sessions.create.mock.lastCall![0];
    expect(sent.payment_intent_data).toStrictEqual({ transfer_group: orderId, metadata: { orderId, eventId: seated.eventId } });
    expect((await orderRow(orderId)).payout_method).toBe("transfer");
  });

  it("an order keeps the method it was made with: a retry after the switch is turned off still sends the transfer shape", async () => {
    const key = "6f0d7a52-3b1c-4e8f-9a2d-1c5b7e9f0a11";
    const body = { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] };
    api.stripe.checkout.sessions.create.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: "timeout" }));
    const first = await api.call(createCheckout, { params: { eventId: event.eventId }, body, headers: { "idempotency-key": key } });
    expect(first.status).toBe(503);
    api.delayedPayouts = false;
    const retry = await api.call(createCheckout, { params: { eventId: event.eventId }, body, headers: { "idempotency-key": key } });
    expect(retry.status).toBe(201);
    const calls = api.stripe.checkout.sessions.create.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toStrictEqual(calls[0][0]);
    expect(calls[1][0].payment_intent_data).not.toHaveProperty("transfer_data");
  });

  it("the method can't change once the order isn't pending, in either direction", async () => {
    const destination = await makeOrder({ delayed: false });
    await expect(api.db.query(`update public.orders set payout_method = 'transfer' where id = $1`, [destination.orderId])).rejects.toThrow(
      /cannot change/,
    );
    const transfer = await makeOrder({ delayed: true });
    await expect(api.db.query(`update public.orders set payout_method = 'destination' where id = $1`, [transfer.orderId])).rejects.toThrow(
      /cannot change/,
    );
  });

  it("one UPDATE that marks a pending destination order paid and a transfer order together is refused", async () => {
    const pending = await makeOrder({ delayed: false, paid: false });
    await expect(
      api.db.query(`update public.orders set status = 'paid', payout_method = 'transfer' where id = $1`, [pending.orderId]),
    ).rejects.toThrow(/cannot change/);
    expect(await orderRow(pending.orderId)).toMatchObject({ status: "pending", payout_method: "destination" });
    // A status change alone (what the webhook does) is not affected.
    await expect(api.db.query(`update public.orders set status = 'paid' where id = $1`, [pending.orderId])).resolves.toBeDefined();
    expect(await orderRow(pending.orderId)).toMatchObject({ status: "paid", payout_method: "destination" });
    // The choice itself, made while pending (what checkout does), is still allowed.
    const next = await makeOrder({ delayed: false, paid: false });
    await api.db.query(`update public.orders set payout_method = 'transfer' where id = $1 and status = 'pending'`, [next.orderId]);
    expect((await orderRow(next.orderId)).payout_method).toBe("transfer");
  });
});

// ---------------------------------------------------------------------------
// What is due
// ---------------------------------------------------------------------------

describe("what is due", () => {
  it("an order is sent 48 hours after its event ends: not a minute before", async () => {
    const order = await makeOrder();
    await endedHoursAgo(47.98);
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(await transfers()).toEqual([]);

    await endedHoursAgo(48.02);
    expect(await run()).toMatchObject({ claimed: 1, sent: 1 });
    expect((await transferOf(order.orderId)).status).toBe("sent");
  });

  it("nothing is due while the event is running or soon", async () => {
    await makeOrder();
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("a destination order is never transferred, however old", async () => {
    const order = await makeOrder({ delayed: false });
    await endedHoursAgo(24 * 30);
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(await transfers()).toEqual([]);
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    expect(api.stripe.transfers.list).not.toHaveBeenCalled();
    expect((await orderRow(order.orderId)).payout_method).toBe("destination");
  });

  it("only paid orders: pending, failed and refunded ones are skipped", async () => {
    const pending = await makeOrder({ paid: false });
    const failed = await makeOrder({ paid: false });
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [failed.orderId]);
    const refunded = await makeOrder();
    await refund(refunded, refunded.total);
    expect((await orderRow(refunded.orderId)).status).toBe("refunded");
    await endedHoursAgo(72);
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(await transfers()).toEqual([]);
    expect(pending.orderId).toBeTruthy();
  });

  it("a partly refunded order is not sent: it waits for a person", async () => {
    const order = await makeOrder();
    await refund(order, 500);
    expect(await orderRow(order.orderId)).toMatchObject({ status: "paid", amount_refunded_cents: 500 });
    await endedHoursAgo(72);
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("an unpublished event, a rejected organiser and an organiser without payouts hold their orders back; they go out when it's right again", async () => {
    const order = await makeOrder();
    await endedHoursAgo(72);

    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    expect(await run()).toMatchObject({ claimed: 0 });
    await api.db.query(`update public.events set status = 'published' where id = $1`, [event.eventId]);

    await api.db.query(`update public.organisers set status = 'rejected' where id = $1`, [organiser.organiserId]);
    expect(await run()).toMatchObject({ claimed: 0 });
    await api.db.query(`update public.organisers set status = 'approved' where id = $1`, [organiser.organiserId]);

    await disablePayouts(api, organiser.organiserId);
    expect(await run()).toMatchObject({ claimed: 0 });
    await api.db.query(`update public.organisers set payouts_enabled = true where id = $1`, [organiser.organiserId]);

    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    expect(await run()).toMatchObject({ claimed: 1, sent: 1 });
    expect((await transferOf(order.orderId)).status).toBe("sent");
  });

  it("an order with nothing left for the organiser makes no transfer", async () => {
    // A direct write the checkout never makes: the booking fee takes the whole total.
    const order = await makeOrder();
    await api.db.query(`update public.orders set application_fee_cents = total_cents where id = $1`, [order.orderId]);
    await endedHoursAgo(72);
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(await transfers()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The transfer
// ---------------------------------------------------------------------------

describe("the transfer", () => {
  it("is the order's total less Support Sheltüh and the booking fee, asked of Stripe with the charge, the group and a per-order key", async () => {
    const withSupport = await makeOrder({ support: 700 });
    expect(withSupport.support).toBe(700);
    expect(withSupport.share).toBe(withSupport.total - 700 - withSupport.fee);
    await endedHoursAgo(49);

    const summary = await run();
    expect(summary).toEqual({ claimed: 1, sent: 1, retrying: 0, held: 0, failed: 0, leaseLost: 0 });
    expect(api.stripe.transfers.create).toHaveBeenCalledTimes(1);
    const [params, options] = api.stripe.transfers.create.mock.calls[0];
    expect(params).toStrictEqual({
      amount: withSupport.share,
      currency: "aud",
      destination: ACCOUNT,
      source_transaction: `ch_${withSupport.pi}`,
      transfer_group: withSupport.orderId,
      metadata: { orderId: withSupport.orderId, eventId: event.eventId },
    });
    expect(options).toEqual({ idempotencyKey: `order-transfer-${withSupport.orderId}-1`, timeout: 10_000, maxNetworkRetries: 0 });
    expect(transferIdempotencyKey(withSupport.orderId, 3)).toBe(`order-transfer-${withSupport.orderId}-3`);
    expect(await transfers()).toEqual([
      expect.objectContaining({
        order_id: withSupport.orderId,
        status: "sent",
        amount_cents: withSupport.share,
        stripe_transfer_id: "tr_test_1",
        attempts: 1,
        key_version: 1,
        destination_account_id: ACCOUNT,
      }),
    ]);
  });

  it("Support Sheltüh and the booking fee stay with the platform: transfer + fee + support = what the buyer paid, for buyer-pays and absorbed fees", async () => {
    const mixed = await makeOrder({
      lines: [
        { ticketTypeId: "ga", quantity: 1 },
        { ticketTypeId: "vip", quantity: 1 },
      ],
      support: 300,
    });
    await endedHoursAgo(49);
    await run();
    const [sent] = api.stripe.transfers.create.mock.calls.map(([p]) => p.amount as number);
    expect(sent + mixed.fee + mixed.support).toBe(mixed.total);
    expect(sent).toBeLessThan(mixed.total - mixed.support);
    // The absorbed fee (VIP) came out of the organiser's share, the buyer-paid one (GA) was on top of the price.
    expect(mixed.total).toBe(3000 + calculateBookingFeeCents(3000) + 8000 + 300);
    expect(sent).toBe(3000 + 8000 - calculateBookingFeeCents(8000));
  });

  it("a second run, and a rerun after a restart, make no second transfer", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await run();
    await run();
    await run();
    expect(api.stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(api.stripe.madeTransfers).toHaveLength(1);
    expect((await transfers()).filter((t) => t.order_id === order.orderId)).toHaveLength(1);
  });

  it("two runs at once send each order once", async () => {
    const orders: MadeOrder[] = [];
    for (let i = 0; i < 6; i += 1) orders.push(await makeOrder({ lines: [{ ticketTypeId: "ga", quantity: 1 }] }));
    await endedHoursAgo(49);
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.sent + b.sent).toBe(6);
    expect(api.stripe.transfers.create).toHaveBeenCalledTimes(6);
    expect(api.stripe.madeTransfers).toHaveLength(6);
    const rows = await transfers();
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.order_id))).toEqual(new Set(orders.map((o) => o.orderId)));
    expect(rows.every((r) => r.status === "sent" && r.attempts === 1)).toBe(true);
  });

  it("parallel claims of newly due orders each get a different order: none comes away empty-handed while work remains", async () => {
    const orders: MadeOrder[] = [];
    for (let i = 0; i < 6; i += 1) orders.push(await makeOrder({ lines: [{ ticketTypeId: "ga", quantity: 1 }] }));
    await endedHoursAgo(49);
    const claims = await Promise.all(
      orders.map(() =>
        api.db.query<{ transfer_order_id: string }>(`select * from private.claim_due_transfers(1, interval '2 minutes', 5)`),
      ),
    );
    expect(claims.map((rows) => rows.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(new Set(claims.flat().map((row) => row.transfer_order_id))).toEqual(new Set(orders.map((o) => o.orderId)));
    // A seventh finds nothing: every order has its row.
    expect(await api.db.query(`select * from private.claim_due_transfers(1, interval '2 minutes', 5)`)).toEqual([]);
  });

  it("stops at its limit and picks up the rest next time", async () => {
    for (let i = 0; i < 3; i += 1) await makeOrder({ lines: [{ ticketTypeId: "ga", quantity: 1 }] });
    await endedHoursAgo(49);
    expect(await runOrderTransfers(api.deps, { maxTransfers: 2 })).toMatchObject({ claimed: 2, sent: 2 });
    expect(await run()).toMatchObject({ claimed: 1, sent: 1 });
  });

  it("logs the order by its short reference only", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: `timeout for ${order.orderId}` }));
    await run();
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().map(String).join("\n");
    expect(logged).toContain(orderReference(order.orderId));
    expect(logged).not.toContain(order.orderId);
    expect(logged).not.toContain(ACCOUNT);
    expect(logged).not.toContain(order.pi);
  });
});

describe("Stripe is asked about the payment first", () => {
  async function dueOrder() {
    const order = await makeOrder();
    await endedHoursAgo(49);
    return order;
  }

  it.each([
    ["refunded in Stripe", { refunded: true, amount_refunded: 1 }, "refunded"],
    ["partly refunded in Stripe", { amount_refunded: 100 }, "refunded"],
    ["disputed", { disputed: true }, "disputed"],
    ["not paid", { paid: false }, "charge_not_successful"],
    ["a charge that failed", { status: "failed" }, "charge_not_successful"],
    ["another currency", { currency: "usd" }, "amount_mismatch"],
    ["another amount", { amount: 1 }, "amount_mismatch"],
    ["a destination charge (it already paid its organiser)", { transfer_data: { destination: ACCOUNT } }, "destination_charge"],
    ["on behalf of an account", { on_behalf_of: ACCOUNT }, "destination_charge"],
  ])("%s: held, nothing sent", async (_name, charge, code) => {
    const order = await dueOrder();
    api.stripe.payments.set(order.pi, { orderId: order.orderId, amount: order.total, charge });
    expect(await run()).toMatchObject({ claimed: 1, held: 1, sent: 0 });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", last_error: code });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("a payment intent that isn't succeeded is held", async () => {
    const order = await dueOrder();
    api.stripe.payments.set(order.pi, { orderId: order.orderId, amount: order.total, status: "processing" });
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", last_error: "charge_not_successful" });
  });

  it("a payment intent that doesn't name an order is held, not paid", async () => {
    const order = await dueOrder();
    api.stripe.payments.set(order.pi, { amount: order.total });
    expect(await run()).toMatchObject({ claimed: 1, held: 1, sent: 0 });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", last_error: "metadata_mismatch" });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    // Released once Stripe's record is right (the metadata names the order).
    api.stripe.payments.set(order.pi, { orderId: order.orderId, amount: order.total });
    await api.call(adminTransferAction, { token: admin.token, params: { transferId: (await transferOf(order.orderId)).id }, body: { action: "release" } });
    expect(await run()).toMatchObject({ sent: 1 });
  });

  it("a payment intent for another order is held", async () => {
    const order = await dueOrder();
    api.stripe.payments.set(order.pi, { orderId: "ord_00000000000000000000000000000000", amount: order.total });
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", last_error: "metadata_mismatch" });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("a payment Stripe doesn't know, or Stripe unreachable, is retried (without moving the key on)", async () => {
    const order = await dueOrder();
    api.stripe.payments.intents.delete(order.pi);
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", last_error: "rejected_resource_missing", key_version: 1 });

    await dueNow();
    api.stripe.paymentIntents.retrieve.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: "down" }));
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", last_error: "stripe_unreachable", attempts: 2, key_version: 1 });
  });

  it("asks with an expanded charge, a 10-second timeout and no automatic retry", async () => {
    const order = await dueOrder();
    await run();
    expect(api.stripe.paymentIntents.retrieve).toHaveBeenCalledWith(order.pi, { expand: ["latest_charge"] }, { timeout: 10_000, maxNetworkRetries: 0 });
    expect(api.stripe.transfers.list).toHaveBeenCalledWith(
      { transfer_group: order.orderId, destination: ACCOUNT, limit: 10 },
      { timeout: 10_000, maxNetworkRetries: 0 },
    );
  });
});

// ---------------------------------------------------------------------------
// When the outcome is unknown, and when Stripe says no
// ---------------------------------------------------------------------------

describe("an unknown outcome", () => {
  it("Stripe made the transfer but the answer was lost: the next attempt adopts it, and makes no second", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const original = originalTransferCreate();
    api.stripe.transfers.create.mockImplementationOnce(async (params, options) => {
      await original(params, options);
      throw new Stripe.errors.StripeConnectionError({ message: "Request aborted due to timeout being reached (10000ms)" });
    });
    expect(await run()).toMatchObject({ claimed: 1, retrying: 1, sent: 0 });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", key_version: 1, last_error: "stripe_unreachable" });
    expect(api.stripe.madeTransfers).toHaveLength(1);

    await dueNow();
    expect(await run()).toMatchObject({ claimed: 1, sent: 1 });
    expect(api.stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(api.stripe.madeTransfers).toHaveLength(1);
    expect(await transferOf(order.orderId)).toMatchObject({ status: "sent", stripe_transfer_id: "tr_test_1", attempts: 2 });
  });

  it("a worker that died after Stripe accepted the request: the lapsed lease is taken over and the transfer adopted", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const [claimed] = await api.db.query<{ transfer_amount_cents: number }>(
      `select * from private.claim_due_transfers(1, interval '2 minutes', 5)`,
    );
    expect(claimed.transfer_amount_cents).toBe(order.share);
    await originalTransferCreate()(
      { amount: order.share, currency: "aud", destination: ACCOUNT, source_transaction: `ch_${order.pi}`, transfer_group: order.orderId, metadata: { orderId: order.orderId } },
      { idempotencyKey: transferIdempotencyKey(order.orderId, 1) },
    );
    // Still leased: nothing to take.
    expect(await run()).toMatchObject({ claimed: 0 });
    await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);

    expect(await run()).toMatchObject({ claimed: 1, sent: 1 });
    expect(api.stripe.transfers.create).toHaveBeenCalledTimes(0);
    expect(api.stripe.madeTransfers).toHaveLength(1);
    expect(await transferOf(order.orderId)).toMatchObject({ status: "sent", stripe_transfer_id: "tr_test_1", attempts: 2 });
  });

  it("a transfer that was reversed since, or made for another amount, is held for a person, never replaced", async () => {
    const reversed = await makeOrder();
    const other = await makeOrder();
    await endedHoursAgo(49);
    const create = originalTransferCreate();
    const base = { currency: "aud", destination: ACCOUNT };
    const first = (await create({ ...base, amount: reversed.share, transfer_group: reversed.orderId, metadata: {} }, undefined)) as { id: string };
    await api.stripe.transfers.createReversal(first.id, {});
    await create({ ...base, amount: other.share + 1, transfer_group: other.orderId, metadata: {} }, undefined);
    const createdBefore = api.stripe.madeTransfers.length;

    await run();
    expect(await transferOf(reversed.orderId)).toMatchObject({ status: "held", last_error: "transfer_reversed" });
    expect(await transferOf(other.orderId)).toMatchObject({ status: "held", last_error: "transfer_mismatch" });
    expect(api.stripe.madeTransfers).toHaveLength(createdBefore);
  });

  it("a failure to even ask whether a transfer exists is retried without sending", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.list.mockRejectedValueOnce(new Stripe.errors.StripeAPIError({ message: "boom", statusCode: 500 }));
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", key_version: 1 });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("an attempt whose lease lapsed on the last allowed attempt fails and opens a transfer_failed exception", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await api.db.query(`select * from private.claim_due_transfers(1, interval '2 minutes', 5)`);
    await api.db.query(`update private.order_transfers set attempts = 5, lease_expires_at = now() - interval '1 second'`);
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "failed", last_error: "last_attempt_unfinished" });
    expect(await exceptions()).toEqual([
      expect.objectContaining({ kind: "transfer_failed", status: "open", order_id: order.orderId }),
    ]);
  });
});

describe("Stripe says no", () => {
  const invalid = (code: string, statusCode = 400) =>
    new Stripe.errors.StripeInvalidRequestError({ message: "nope", type: "invalid_request_error", code, statusCode });

  it("a definite rejection moves the idempotency key on, and retries in an hour", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(invalid("resource_missing"));
    expect(await run()).toMatchObject({ retrying: 1 });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", key_version: 2, last_error: "rejected_resource_missing", attempts: 1 });
    expect(await hoursUntilNextAttempt(order.orderId)).toBeGreaterThan(0.98);
    expect(await hoursUntilNextAttempt(order.orderId)).toBeLessThan(1.01);

    await dueNow();
    await run();
    expect(api.stripe.transfers.create.mock.calls.map(([, o]) => o?.idempotencyKey)).toEqual([
      `order-transfer-${order.orderId}-1`,
      `order-transfer-${order.orderId}-2`,
    ]);
    expect((await transferOf(order.orderId)).status).toBe("sent");
  });

  it("retries after 1 hour, 6 hours, 24 hours and 24 hours; the fifth failure is final, with an exception and an ops alert", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValue(invalid("resource_missing"));
    const waits: number[] = [];
    for (let attempt = 1; attempt < MAX_TRANSFER_ATTEMPTS; attempt += 1) {
      await run();
      waits.push(Math.round(await hoursUntilNextAttempt(order.orderId)));
      expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", attempts: attempt });
      await dueNow();
    }
    expect(waits).toEqual([1, 6, 24, 24]);
    expect([1, 2, 3, 4, 5].map(transferRetryDelaySeconds)).toEqual([3600, 21_600, 86_400, 86_400, null]);

    expect(await exceptions()).toEqual([]);
    expect(await run()).toMatchObject({ claimed: 1, failed: 1 });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "failed", attempts: 5 });
    expect(await exceptions()).toEqual([
      expect.objectContaining({ kind: "transfer_failed", status: "open", order_id: order.orderId }),
    ]);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0]).toMatchObject({ to: OPS_ALERT_EMAIL });
    expect(api.sendEmail.mock.calls[0][0].subject).toContain("Organiser payout failed");
    expect(api.sendEmail.mock.calls[0][0].text).not.toContain(order.orderId);

    // Nothing more is tried on its own.
    await dueNow();
    expect(await run()).toMatchObject({ claimed: 0 });
  });

  it("balance_insufficient is retried with an ops alert straight away; the exception resolves itself when the transfer goes", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(invalid("balance_insufficient"));
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", last_error: "balance_insufficient", key_version: 2 });
    expect(await exceptions()).toEqual([expect.objectContaining({ kind: "transfer_failed", status: "open" })]);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);

    await dueNow();
    await run();
    expect((await transferOf(order.orderId)).status).toBe("sent");
    expect(await exceptions()).toEqual([expect.objectContaining({ kind: "transfer_failed", status: "resolved" })]);
    const [resolved] = await api.db.query<{ resolution: string }>(`select resolution from private.payment_exceptions`);
    expect(resolved.resolution).toBe("auto");
  });

  it("an account Stripe won't pay is held, not retried; an admin releases it once it's fixed", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(invalid("account_invalid"));
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", last_error: "destination_account" });
    await dueNow();
    expect(await run()).toMatchObject({ claimed: 0 });

    const row = await transferOf(order.orderId);
    const released = await api.call(adminTransferAction, { token: admin.token, params: { transferId: row.id }, body: { action: "release" } });
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ status: "retry", attempts: 0, lastAdminAction: { action: "release" } });
    await run();
    expect((await transferOf(order.orderId)).status).toBe("sent");
  });

  it("Stripe being unreachable or erroring keeps the same key (the outcome is unknown); the platform's credentials failing alerts", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(new Stripe.errors.StripeAPIError({ message: "Something went wrong", statusCode: 500 }));
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", key_version: 1, last_error: "stripe_unknown_outcome" });
    expect(await exceptions()).toEqual([]);

    await dueNow();
    api.stripe.transfers.create.mockRejectedValueOnce(new Stripe.errors.StripePermissionError({ message: "restricted key", statusCode: 403 }));
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", key_version: 1, last_error: "stripe_access" });
    expect(await exceptions()).toEqual([expect.objectContaining({ kind: "transfer_failed" })]);
  });

  it("classifies errors", () => {
    expect(classifyTransferError(invalid("balance_insufficient"))).toMatchObject({ outcome: "retry", bumpKey: true, alert: true });
    expect(classifyTransferError(invalid("account_invalid"))).toMatchObject({ outcome: "held" });
    expect(classifyTransferError(invalid("parameter_invalid_empty"))).toMatchObject({ outcome: "retry", bumpKey: true, error: "rejected_parameter_invalid_empty" });
    expect(classifyTransferError(invalid("x-y"))).toMatchObject({ error: "rejected_by_stripe" });
    expect(classifyTransferError(invalid("resource_missing", 409))).toMatchObject({ bumpKey: false });
    expect(classifyTransferError(new Stripe.errors.StripeConnectionError({ message: "x" }))).toMatchObject({ bumpKey: false });
    expect(classifyTransferError(new Stripe.errors.StripeRateLimitError({ message: "x" }))).toMatchObject({ bumpKey: false, error: "rate_limited" });
    expect(classifyTransferError(new Stripe.errors.StripeIdempotencyError({ message: "x", type: "idempotency_error" }))).toMatchObject({ outcome: "held" });
    expect(classifyTransferError("nonsense")).toMatchObject({ outcome: "retry", bumpKey: false });
  });
});

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

describe("refunds before the transfer", () => {
  it("a full refund of a transfer order voids it as for any order, and no transfer is ever made", async () => {
    const order = await makeOrder();
    await refund(order, order.total);
    expect((await orderRow(order.orderId)).status).toBe("refunded");
    await endedHoursAgo(72);
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("a queued transfer Stripe was never asked to create is cancelled by a full refund, and held by a partial one", async () => {
    const full = await makeOrder();
    const partial = await makeOrder();
    await endedHoursAgo(49);
    // Both are waiting for a retry, after Stripe couldn't be reached to look for an existing transfer: no create was ever sent.
    api.stripe.transfers.list.mockRejectedValue(new Stripe.errors.StripeConnectionError({ message: "x" }));
    await run();
    expect((await transfers()).map((t) => t.status)).toEqual(["retry", "retry"]);
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();

    await refund(full, full.total, { eventId: "evt_full" });
    await refund(partial, 100, { eventId: "evt_part" });
    expect(await transferOf(full.orderId)).toMatchObject({ status: "cancelled", last_error: "refunded" });
    expect(await transferOf(partial.orderId)).toMatchObject({ status: "held", last_error: "partly_refunded" });

    api.stripe.transfers.create.mockReset();
    api.stripe.transfers.create.mockRejectedValue(new Error("no transfer may be made"));
    await dueNow();
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    // The partial refund is for a person (the usual exception), not inferred.
    expect((await exceptions()).map((e) => e.kind)).toEqual(["partial_refund"]);
  });

  it("a transfer Stripe may have made (its create request was sent) is never cancelled by a full refund", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(new Stripe.errors.StripeAPIError({ message: "x", statusCode: 500 }));
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", last_error: "stripe_unknown_outcome" });
    await refund(order, order.total);
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", last_error: "refunded_outcome_unknown" });
  });

  it("attempts = 0 does not prove nothing was created: an admin's retry resets it, the create_started record stays", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(new Stripe.errors.StripeAPIError({ message: "x", statusCode: 500 }));
    await run();
    const row = await transferOf(order.orderId);
    const retried = await api.call(adminTransferAction, { token: admin.token, params: { transferId: row.id }, body: { action: "retry" } });
    expect(retried.body).toMatchObject({ status: "retry", attempts: 0 });
    await refund(order, order.total);
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", attempts: 0, last_error: "refunded_outcome_unknown" });
  });

  it("a full refund of a row an admin reset to attempts = 0, with no create ever sent, is cancelled", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.list.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: "x" }));
    await run();
    const row = await transferOf(order.orderId);
    expect(row).toMatchObject({ status: "retry", attempts: 1 });
    await api.call(adminTransferAction, { token: admin.token, params: { transferId: row.id }, body: { action: "retry" } });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", attempts: 0 });
    await refund(order, order.total);
    expect(await transferOf(order.orderId)).toMatchObject({ status: "cancelled", last_error: "refunded" });
    expect(await exceptions()).toEqual([]);
  });

  it("an admin can't release or retry a transfer whose order was refunded; cancelling is fine", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(new Stripe.errors.StripeAPIError({ message: "x", statusCode: 500 }));
    await run();
    await refund(order, 100);
    const row = await transferOf(order.orderId);
    expect(row.status).toBe("held");
    const released = await api.call(adminTransferAction, { token: admin.token, params: { transferId: row.id }, body: { action: "release" } });
    expect(released.status).toBe(409);
    expect(released.body.code).toBe("transfer_not_payable");
    const cancelled = await api.call(adminTransferAction, { token: admin.token, params: { transferId: row.id }, body: { action: "cancel" } });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
  });
});

describe("a full refund while Stripe may already have the transfer (its response was lost)", () => {
  const act = (transferId: string, action: unknown) => api.call(adminTransferAction, { token: admin.token, params: { transferId }, body: { action } });

  /** A due order whose create request Stripe accepted (or not: `reachesStripe`) and whose response was lost: the row waits for a retry. */
  async function lostResponse(reachesStripe: boolean) {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const original = originalTransferCreate();
    api.stripe.transfers.create.mockImplementationOnce(async (params, options) => {
      if (reachesStripe) await original(params, options);
      throw new Stripe.errors.StripeConnectionError({ message: "Request aborted due to timeout being reached (10000ms)" });
    });
    await run();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", last_error: "stripe_unreachable" });
    expect(api.stripe.madeTransfers).toHaveLength(reachesStripe ? 1 : 0);
    api.deferred.length = 0;
    return order;
  }

  async function createStarted(orderId: string) {
    const [row] = await api.db.query<{ create_started: boolean }>(`select create_started from private.order_transfers where order_id = $1`, [orderId]);
    return row.create_started;
  }

  it("holds the row (nothing is cancelled) and opens an urgent exception with an ops alert, once however often Stripe redelivers", async () => {
    const order = await lostResponse(true);
    expect(await createStarted(order.orderId)).toBe(true);

    await refund(order, order.total, { eventId: "evt_unknown_1" });
    await refund(order, order.total, { eventId: "evt_unknown_1" });
    await refund(order, order.total, { eventId: "evt_unknown_2" });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", last_error: "refunded_outcome_unknown", stripe_transfer_id: null });
    expect(await exceptions()).toEqual([
      expect.objectContaining({
        kind: "transfer_reversal_required",
        status: "open",
        order_id: order.orderId,
        details: expect.objectContaining({ reason: "refunded_outcome_unknown", transferAmountCents: order.share, totalCents: order.total }),
      }),
    ]);
    expect(error.mock.calls.flat().map(String).join("\n")).toContain("may already exist in Stripe");
    expect(error.mock.calls.flat().map(String).join("\n")).not.toContain(order.orderId);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0].subject).toContain("URGENT");
    expect(api.sendEmail.mock.calls[0][0].text).not.toContain(order.orderId);

    // The claim skips the held row, and an admin can't release it: it is for the cancel's look at Stripe.
    await dueNow();
    expect(await run()).toMatchObject({ claimed: 0 });
    const row = await transferOf(order.orderId);
    expect((await act(row.id, "release")).body.code).toBe("transfer_not_payable");
    expect((await act(row.id, "retry")).body.code).toBe("transfer_state_conflict");
  });

  it("the admin cancel finds the transfer in Stripe: it is recorded as sent, and the same exception now asks for the reversal", async () => {
    const order = await lostResponse(true);
    await refund(order, order.total);
    const row = await transferOf(order.orderId);
    api.stripe.transfers.list.mockClear();

    const res = await act(row.id, "cancel");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "sent", stripeTransferId: "tr_test_1", amountCents: order.share });
    expect(api.stripe.transfers.list).toHaveBeenCalledTimes(1);
    expect(await transferOf(order.orderId)).toMatchObject({ status: "sent", stripe_transfer_id: "tr_test_1" });
    // One exception, still open, now about a transfer that exists.
    expect(await exceptions()).toEqual([
      expect.objectContaining({
        kind: "transfer_reversal_required",
        status: "open",
        order_id: order.orderId,
        details: expect.objectContaining({ reason: "refunded_after_transfer", transferAmountCents: order.share }),
      }),
    ]);
    expect(api.stripe.madeTransfers).toHaveLength(1);
    await dueNow();
    expect(await run()).toMatchObject({ claimed: 0 });
  });

  it("the admin cancel finding nothing in Stripe cancels the row cleanly and resolves the exception", async () => {
    const order = await lostResponse(false);
    await refund(order, order.total);
    const row = await transferOf(order.orderId);
    expect(row).toMatchObject({ status: "held", last_error: "refunded_outcome_unknown" });

    const res = await act(row.id, "cancel");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "cancelled", lastError: "cancelled_by_admin" });
    expect(api.stripe.transfers.list).toHaveBeenCalled();
    const [ex] = await api.db.query<{ status: string; resolution: string; resolved_by: string; resolution_note: string }>(
      `select status, resolution, resolved_by, resolution_note from private.payment_exceptions where order_id = $1`,
      [order.orderId],
    );
    expect(ex).toMatchObject({ status: "resolved", resolution: "admin", resolved_by: admin.userId });
    expect(ex.resolution_note).toContain("no transfer");
    expect(api.stripe.madeTransfers).toHaveLength(0);
    await dueNow();
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(api.stripe.transfers.create).toHaveBeenCalledTimes(1);
    // Redelivery of the refund leaves the cancelled row, and the resolved exception, alone.
    await refund(order, order.total, { eventId: "evt_again" });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "cancelled" });
    expect((await exceptions()).map((e) => e.status)).toEqual(["resolved"]);
  });

  it("with Stripe unreachable the cancel is refused (503) and the held row stays", async () => {
    const order = await lostResponse(true);
    await refund(order, order.total);
    const row = await transferOf(order.orderId);
    api.stripe.transfers.list.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: "down" }));
    expect((await act(row.id, "cancel")).status).toBe(503);
    expect((await transferOf(order.orderId)).status).toBe("held");
    expect((await exceptions()).map((e) => e.status)).toEqual(["open"]);
  });

  it("a row leased but never taken to the create step (no create_started) is cancelled by a full refund, even while still `sending`", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await api.db.query(`select * from private.claim_due_transfers(1, interval '2 minutes', 5)`);
    expect(await transferOf(order.orderId)).toMatchObject({ status: "sending" });
    expect(await createStarted(order.orderId)).toBe(false);
    await refund(order, order.total);
    expect(await transferOf(order.orderId)).toMatchObject({ status: "cancelled", last_error: "refunded" });
    expect(await exceptions()).toEqual([]);
  });

  it("a worker that died after asking Stripe (a lapsed `sending` row with create_started) is held, not cancelled, by a full refund", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const [claimed] = await api.db.query<{ transfer_id: string; transfer_lease_token: string }>(
      `select * from private.claim_due_transfers(1, interval '2 minutes', 5)`,
    );
    const [begun] = await api.db.query<{ result: string }>(`select result from private.begin_transfer_create($1::bigint, $2::uuid)`, [
      claimed.transfer_id,
      claimed.transfer_lease_token,
    ]);
    expect(begun.result).toBe("ok");
    await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);
    await refund(order, order.total);
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", last_error: "refunded_outcome_unknown" });
    expect((await exceptions()).map((e) => e.details.reason)).toEqual(["refunded_outcome_unknown"]);
  });

  it("begin_transfer_create refuses a refunded order, a lost lease and a lapsed lease, and changes nothing", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const [claimed] = await api.db.query<{ transfer_id: string; transfer_lease_token: string }>(
      `select * from private.claim_due_transfers(1, interval '2 minutes', 5)`,
    );
    const begin = async (token: string) =>
      (await api.db.query<{ result: string }>(`select result from private.begin_transfer_create($1::bigint, $2::uuid)`, [claimed.transfer_id, token]))[0].result;
    expect(await begin(crypto.randomUUID())).toBe("lease_lost");
    await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);
    expect(await begin(claimed.transfer_lease_token)).toBe("lapsed");
    await api.db.query(`update private.order_transfers set lease_expires_at = now() + interval '1 minute'`);
    await api.db.query(`update public.orders set amount_refunded_cents = 100 where id = $1`, [order.orderId]);
    expect(await begin(claimed.transfer_lease_token)).toBe("refunded");
    expect(await createStarted(order.orderId)).toBe(false);
    await api.db.query(`update public.orders set amount_refunded_cents = 0 where id = $1`, [order.orderId]);
    expect(await begin(claimed.transfer_lease_token)).toBe("ok");
    expect(await createStarted(order.orderId)).toBe(true);
    expect((await api.db.query<{ result: string }>(`select result from private.begin_transfer_create(999999, null)`))[0].result).toBe("not_found");
  });
});

describe("a refund after the transfer", () => {
  it("opens a transfer_reversal_required exception and an ops alert, once however often Stripe redelivers", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await run();
    expect((await transferOf(order.orderId)).status).toBe("sent");

    await refund(order, order.total, { eventId: "evt_late_1" });
    await refund(order, order.total, { eventId: "evt_late_1" });
    await refund(order, order.total, { eventId: "evt_late_2" });
    expect(await exceptions()).toEqual([
      expect.objectContaining({
        kind: "transfer_reversal_required",
        status: "open",
        order_id: order.orderId,
        details: expect.objectContaining({ transferAmountCents: order.share, totalCents: order.total, reason: "refunded_after_transfer" }),
      }),
    ]);
    expect((await transferOf(order.orderId)).status).toBe("sent");
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const mail = api.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe(OPS_ALERT_EMAIL);
    expect(mail.subject).toContain("URGENT");
    expect(mail.subject).toContain("Transfer to reverse");
    expect(mail.text).toContain(orderReference(order.orderId));
    expect(mail.text).not.toContain(order.orderId);
    expect(mail.text).not.toContain(order.pi);

    // The admin list says it needs a person first.
    const listed = await api.call(adminListPaymentExceptions, { token: admin.token });
    expect(listed.body.items).toEqual([
      expect.objectContaining({ kind: "transfer_reversal_required", urgent: true, orderReference: orderReference(order.orderId), details: expect.objectContaining({ transferAmountCents: order.share }) }),
    ]);
  });

  it("a partial refund after the transfer is flagged too", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await run();
    await refund(order, 500);
    expect((await exceptions()).map((e) => e.kind).sort()).toEqual(["partial_refund", "transfer_reversal_required"]);
  });

  it("a refund that lands while the transfer is being made: the transfer is recorded and flagged for reversal", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const original = originalTransferCreate();
    api.stripe.transfers.create.mockImplementationOnce(async (params, options) => {
      // The dashboard refund's webhook is handled between Stripe accepting the transfer and the job recording it.
      await refund(order, order.total, { eventId: "evt_mid" });
      return original(params, options);
    });
    expect(await run()).toMatchObject({ claimed: 1, sent: 1 });
    expect(await transferOf(order.orderId)).toMatchObject({ status: "sent", stripe_transfer_id: "tr_test_1" });
    expect(await exceptions()).toEqual([
      expect.objectContaining({ kind: "transfer_reversal_required", status: "open", order_id: order.orderId }),
    ]);
  });

  it("a refund recorded before the job's own check is caught by Stripe's answer, whatever the database says", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    // Refunded in Stripe, the webhook not yet processed.
    api.stripe.payments.set(order.pi, { orderId: order.orderId, amount: order.total, charge: { refunded: true, amount_refunded: order.total } });
    expect(await run()).toMatchObject({ held: 1 });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    // Then the webhook arrives: the held row is cancelled.
    await refund(order, order.total);
    expect((await transferOf(order.orderId)).status).toBe("cancelled");
  });
});

describe("refunds Sheltüh makes itself, and refunds that come early", () => {
  it("a payment for an order that had already failed is refunded without reversing a transfer that doesn't exist", async () => {
    api.delayedPayouts = true;
    const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    const orderId = res.body.orderId as string;
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    await webhookPay(orderId, "pi_late");
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    const [params, options] = api.stripe.refunds.create.mock.calls[0];
    expect(params).toStrictEqual({ payment_intent: "pi_late", metadata: { orderId, reason: "paid_after_order_failed" } });
    expect(options).toEqual({ idempotencyKey: `failed-order-refund-${orderId}` });
  });

  it("the same for a destination order still reverses its transfer and refunds the fee (as today)", async () => {
    api.delayedPayouts = false;
    const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    const orderId = res.body.orderId as string;
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    await webhookPay(orderId, "pi_late");
    expect(api.stripe.refunds.create.mock.calls[0][0]).toStrictEqual({
      payment_intent: "pi_late",
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: { orderId, reason: "paid_after_order_failed" },
    });
  });

  it("an oversold transfer order is refunded by the platform's balance: no reversal flags", async () => {
    const small = await publishedEvent(api, organiser, admin, {
      ticketTypes: [{ id: "one", name: "One", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 1 }],
    });
    const first = await makeOrder({ lines: [{ ticketTypeId: "one", quantity: 1 }], on: small, paid: false });
    const second = await makeOrder({ lines: [{ ticketTypeId: "one", quantity: 1 }], on: small, paid: false });
    await webhookPay(first.orderId, first.pi);
    await webhookPay(second.orderId, second.pi);
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(api.stripe.refunds.create.mock.calls[0][0]).toStrictEqual({
      payment_intent: second.pi,
      metadata: { orderId: second.orderId, reason: "could_not_fulfil_after_payment" },
    });
  });

  it("a refund before the payment is recorded is matched to a transfer order by its metadata, and applied when the payment arrives", async () => {
    api.delayedPayouts = true;
    const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    const orderId = res.body.orderId as string;
    const total = (await orderRow(orderId)).total_cents;
    const early = await api.send(stripeWebhook, chargeRefunded("pi_early", total, true, { orderId }));
    expect(early.status).toBe(200);
    const [held] = await api.db.query<{ destination_account_id: string; fully_refunded: boolean }>(
      `select destination_account_id, fully_refunded from private.early_charge_refunds where payment_intent_id = 'pi_early'`,
    );
    expect(held).toEqual({ destination_account_id: ACCOUNT, fully_refunded: true });

    await webhookPay(orderId, "pi_early");
    expect(await orderRow(orderId)).toMatchObject({ status: "refunded", payout_method: "transfer" });
    await endedHoursAgo(72);
    expect(await run()).toMatchObject({ claimed: 0 });
  });

  it("an early refund whose charge lacks the metadata asks Stripe for the payment intent's; one that can't be matched is dropped as not ours", async () => {
    api.delayedPayouts = true;
    const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    const orderId = res.body.orderId as string;
    const total = (await orderRow(orderId)).total_cents;
    api.stripe.payments.set("pi_early", { orderId, amount: total });
    expect((await api.send(stripeWebhook, chargeRefunded("pi_early", total, true))).status).toBe(200);
    expect(api.stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_early");
    const held = await api.db.query(`select 1 from private.early_charge_refunds where payment_intent_id = 'pi_early'`);
    expect(held).toHaveLength(1);

    // A payment of someone else's: no metadata anywhere.
    api.stripe.payments.set("pi_other", { amount: 1000 });
    expect((await api.send(stripeWebhook, chargeRefunded("pi_other", 1000, true))).status).toBe(200);
    expect(await api.db.query(`select 1 from private.early_charge_refunds where payment_intent_id = 'pi_other'`)).toHaveLength(0);
  });

  it.each([
    ["Stripe unreachable", () => new Stripe.errors.StripeConnectionError({ message: "down" })],
    ["a Stripe server error", () => new Stripe.errors.StripeAPIError({ message: "boom", statusCode: 500 })],
    ["rate limiting", () => new Stripe.errors.StripeRateLimitError({ message: "slow down", statusCode: 429 })],
    ["our key failing", () => new Stripe.errors.StripeAuthenticationError({ message: "bad key", statusCode: 401 })],
  ])("an early refund whose payment intent can't be read (%s) is answered 500 so Stripe sends it again, not dropped", async (_name, failure) => {
    api.delayedPayouts = true;
    const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    const orderId = res.body.orderId as string;
    const total = (await orderRow(orderId)).total_cents;
    api.stripe.payments.set("pi_early", { orderId, amount: total });
    api.stripe.paymentIntents.retrieve.mockRejectedValueOnce(failure());
    const failed = await api.send(stripeWebhook, chargeRefunded("pi_early", total, true, { eventId: "evt_early_refund" }));
    expect(failed.status).toBe(500);
    expect(await api.db.query(`select 1 from private.early_charge_refunds where payment_intent_id = 'pi_early'`)).toHaveLength(0);

    // Stripe's redelivery, once it can answer: held for the payment, as for any early refund.
    const again = await api.send(stripeWebhook, chargeRefunded("pi_early", total, true, { eventId: "evt_early_refund" }));
    expect(again.status).toBe(200);
    expect(await api.db.query(`select 1 from private.early_charge_refunds where payment_intent_id = 'pi_early'`)).toHaveLength(1);
    expect(error.mock.calls.flat().map(String).join("\n")).not.toContain(orderId);
  });

  it("only Stripe saying there's no such payment intent drops an early refund as not ours (200)", async () => {
    api.stripe.payments.intents.delete("pi_unknown");
    const res = await api.send(stripeWebhook, chargeRefunded("pi_unknown", 1000, true));
    expect(res.status).toBe(200);
    expect(await api.db.query(`select 1 from private.early_charge_refunds where payment_intent_id = 'pi_unknown'`)).toHaveLength(0);
  });

  it("a recorded payment needs no Stripe lookup for its refund", async () => {
    const order = await makeOrder();
    api.stripe.paymentIntents.retrieve.mockClear();
    await refund(order, 100);
    expect(api.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The database's own guards
// ---------------------------------------------------------------------------

describe("the database refuses what must never happen", () => {
  it("a transfer row for a destination order, for a pending order, or for the wrong amount", async () => {
    const destination = await makeOrder({ delayed: false });
    const pending = await makeOrder({ paid: false });
    const real = await makeOrder();
    const insert = (orderId: string, amount: number) =>
      api.db.query(
        `insert into private.order_transfers (order_id, destination_account_id, amount_cents, status, next_attempt_at)
         values ($1, $2, $3, 'retry', now())`,
        [orderId, ACCOUNT, amount],
      );
    await expect(insert(destination.orderId, destination.share)).rejects.toThrow(/not a paid transfer order/);
    await expect(insert(pending.orderId, 100)).rejects.toThrow(/not a paid transfer order/);
    await expect(insert(real.orderId, real.share + 1)).rejects.toThrow(/not the order's share/);
    await insert(real.orderId, real.share);
    // One row per order, ever; and the amount and order can't be edited afterwards.
    await expect(insert(real.orderId, real.share)).rejects.toThrow(/duplicate key/);
    await expect(api.db.query(`update private.order_transfers set amount_cents = amount_cents + 1`)).rejects.toThrow(/cannot change/);
  });

  it("the due list never contains a destination order", async () => {
    await makeOrder({ delayed: false });
    await endedHoursAgo(72);
    expect(await api.db.query(`select * from private.due_transfer_orders(interval '48 hours')`)).toEqual([]);
  });

  it("a transfer id is recorded for one order only", async () => {
    const a = await makeOrder();
    const b = await makeOrder();
    await endedHoursAgo(49);
    await run();
    const taken = (await transferOf(a.orderId)).stripe_transfer_id;
    expect(taken).toEqual(expect.any(String));
    await expect(
      api.db.query(`update private.order_transfers set stripe_transfer_id = $2 where order_id = $1`, [b.orderId, taken]),
    ).rejects.toThrow(/duplicate key/);
  });
});

// ---------------------------------------------------------------------------
// The admin API
// ---------------------------------------------------------------------------

describe("GET /api/admin/transfers", () => {
  it("needs an admin", async () => {
    expect((await api.call(adminListTransfers)).status).toBe(401);
    const member = await api.signUp();
    expect((await api.call(adminListTransfers, { token: member.token })).status).toBe(403);
    expect((await api.call(adminListTransfers, { token: organiser.token })).status).toBe(403);
  });

  it("counts by status, what the platform holds for organisers, the last run and the open queue", async () => {
    const sent = await makeOrder();
    const stuck = await makeOrder();
    const later = await makeOrder({ on: await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS }) });
    await endedHoursAgo(49);
    const create = originalTransferCreate();
    api.stripe.transfers.create.mockImplementation(async (params, options) => {
      if (params.transfer_group === stuck.orderId) throw new Stripe.errors.StripeAPIError({ message: "x", statusCode: 500 });
      return create(params, options);
    });
    const cron = await api.call(runPayoutsCron, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(cron.status).toBe(200);

    const page = await api.call(adminListTransfers, { token: admin.token });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(page.body.counts).toEqual({ failed: 0, held: 0, retry: 1, sending: 0, sent: 1, cancelled: 0 });
    // Everything not sent: the stuck one and the one whose event hasn't ended.
    expect(page.body.owedToOrganisersCents).toBe(stuck.share + later.share);
    expect(page.body.lastRun).toMatchObject({ claimed: 2, sent: 1, retrying: 1, failed: 0 });
    expect(page.body.items).toEqual([
      expect.objectContaining({
        orderReference: orderReference(stuck.orderId),
        status: "retry",
        amountCents: stuck.share,
        attempts: 1,
        lastError: "stripe_unknown_outcome",
        organiserName: expect.any(String),
        eventTitle: expect.any(String),
        orderStatus: "paid",
        nextAttemptAt: expect.any(String),
      }),
    ]);
    expect(JSON.stringify(page.body)).not.toContain(stuck.orderId);
    expect(JSON.stringify(page.body)).not.toContain(stuck.pi);

    const sentPage = await api.call(adminListTransfers, { token: admin.token, query: { status: "sent" } });
    expect(sentPage.body.items).toEqual([
      expect.objectContaining({ orderReference: orderReference(sent.orderId), status: "sent", stripeTransferId: "tr_test_1", sentAt: expect.any(String) }),
    ]);
  });

  it("rejects an unknown status and pages with a cursor", async () => {
    expect((await api.call(adminListTransfers, { token: admin.token, query: { status: "nope" } })).status).toBe(400);
    expect((await api.call(adminListTransfers, { token: admin.token, query: { cursor: "bad" } })).status).toBe(400);
    for (let i = 0; i < 3; i += 1) await makeOrder({ lines: [{ ticketTypeId: "ga", quantity: 1 }] });
    await endedHoursAgo(49);
    await run();
    const first = await api.call(adminListTransfers, { token: admin.token, query: { status: "sent", limit: "2" } });
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await api.call(adminListTransfers, { token: admin.token, query: { status: "sent", limit: "2", cursor: first.body.nextCursor } });
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeUndefined();
  });
});

describe("POST /api/admin/transfers/{id}/action", () => {
  /** A transfer that failed for good, on an event of its own (so other orders can still be made on the main one). */
  async function failedTransfer() {
    const own = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
    const order = await makeOrder({ on: own });
    await endedHoursAgo(49, own.eventId);
    const original = originalTransferCreate();
    api.stripe.transfers.create.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({ message: "x", type: "invalid_request_error", code: "resource_missing", statusCode: 400 }),
    );
    for (let i = 0; i < MAX_TRANSFER_ATTEMPTS; i += 1) {
      await run();
      await dueNow();
    }
    api.stripe.transfers.create.mockReset();
    api.stripe.transfers.create.mockImplementation(original);
    const row = await transferOf(order.orderId);
    expect(row.status).toBe("failed");
    return { order, row };
  }
  const act = (transferId: string, action: unknown, token = admin.token) =>
    api.call(adminTransferAction, { token, params: { transferId }, body: { action } });

  it("needs an admin; 404 for an unknown or malformed id; 400 for another action", async () => {
    expect((await api.call(adminTransferAction, { params: { transferId: "1" }, body: { action: "retry" } })).status).toBe(401);
    const member = await api.signUp();
    expect((await act("1", "retry", member.token)).status).toBe(403);
    expect((await act("999999", "retry")).status).toBe(404);
    expect((await act("abc", "retry")).status).toBe(404);
    expect((await act("0", "retry")).status).toBe(404);
    const order = await makeOrder();
    await endedHoursAgo(49);
    await run();
    const { id } = await transferOf(order.orderId);
    for (const bad of ["resend", undefined, 7]) {
      const res = await act(id, bad);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.action).toEqual(expect.any(String));
    }
  });

  it("retry: a failed transfer is due again with a fresh set of attempts, and goes out on the next run", async () => {
    const { order, row } = await failedTransfer();
    // A failed one isn't claimed on its own.
    expect(await run()).toMatchObject({ claimed: 0 });
    const res = await act(row.id, "retry");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "retry", attempts: 0, lastAdminAction: { action: "retry", at: expect.any(String) } });
    expect(await run()).toMatchObject({ sent: 1 });
    expect((await transferOf(order.orderId)).status).toBe("sent");
    // The failure's exception resolved itself.
    expect((await exceptions()).map((e) => e.status)).toEqual(["resolved"]);
  });

  it("cancel: never sent; and cancelled or sent transfers can't be acted on again (409)", async () => {
    const { order, row } = await failedTransfer();
    const cancelled = await act(row.id, "cancel");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: "cancelled", lastError: "cancelled_by_admin" });
    expect(await run()).toMatchObject({ claimed: 0 });
    for (const action of ["retry", "release", "cancel"]) {
      const again = await act(row.id, action);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("transfer_state_conflict");
    }
    expect(api.stripe.madeTransfers).toHaveLength(0);
    expect(order.orderId).toBeTruthy();

    const sentOrder = await makeOrder();
    await endedHoursAgo(49);
    await run();
    const sent = await transferOf(sentOrder.orderId);
    expect(sent.status).toBe("sent");
    expect((await act(sent.id, "cancel")).status).toBe(409);
    expect((await act(sent.id, "retry")).body.code).toBe("transfer_state_conflict");
  });

  it("release applies to held transfers only", async () => {
    const { row } = await failedTransfer();
    const res = await act(row.id, "release");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("transfer_state_conflict");
  });

  it("a transfer a worker has right now is a 409 transfer_in_progress", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await api.db.query(`select * from private.claim_due_transfers(1, interval '2 minutes', 5)`);
    const row = await transferOf(order.orderId);
    expect(row.status).toBe("sending");
    const res = await act(row.id, "cancel");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("transfer_in_progress");
    expect((await transferOf(order.orderId)).status).toBe("sending");
  });

  it("a transfer stuck in sending with a lapsed lease (its worker died, and its order is no longer due) can be cancelled or retried", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await api.db.query(`select * from private.claim_due_transfers(1, interval '2 minutes', 5)`);
    await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    expect(await run()).toMatchObject({ claimed: 0 });
    const row = await transferOf(order.orderId);
    expect(row.status).toBe("sending");
    expect((await act(row.id, "release")).body.code).toBe("transfer_state_conflict");
    const cancelled = await act(row.id, "cancel");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
  });

  it("a worker whose lease lapsed (or isn't its own) records nothing", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const [claimed] = await api.db.query<{ transfer_id: string; transfer_lease_token: string }>(
      `select * from private.claim_due_transfers(1, interval '2 minutes', 5)`,
    );
    await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);
    // Another worker takes it over and is held up; this one finishes late.
    const [late] = await api.db.query<{ result: string }>(
      `select result from private.finish_order_transfer($1::bigint, $2::uuid, 'held', 'x', null, null, false, false)`,
      [claimed.transfer_id, crypto.randomUUID()],
    );
    expect(late.result).toBe("lease_lost");
    expect((await transferOf(order.orderId)).status).toBe("sending");
  });
});

// ---------------------------------------------------------------------------
// Cancelling a transfer, when Stripe may already have made it
// ---------------------------------------------------------------------------

describe("cancelling a transfer asks Stripe first (the organiser could be paid twice)", () => {
  const act = (transferId: string, action: unknown, token = admin.token) =>
    api.call(adminTransferAction, { token, params: { transferId }, body: { action } });

  /** A due order whose transfer Stripe accepted, with the answer lost: the row waits for a retry. */
  async function unknownOutcome() {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const original = originalTransferCreate();
    api.stripe.transfers.create.mockImplementationOnce(async (params, options) => {
      await original(params, options);
      throw new Stripe.errors.StripeConnectionError({ message: "Request aborted due to timeout being reached (10000ms)" });
    });
    await run();
    const row = await transferOf(order.orderId);
    expect(row).toMatchObject({ status: "retry", last_error: "stripe_unreachable" });
    expect(api.stripe.madeTransfers).toHaveLength(1);
    return { order, row };
  }

  it("after an unknown outcome the transfer Stripe made is recorded as sent, and the cancel does not happen", async () => {
    const { order, row } = await unknownOutcome();
    api.stripe.transfers.list.mockClear();
    const res = await act(row.id, "cancel");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "sent", stripeTransferId: "tr_test_1", amountCents: order.share });
    expect(api.stripe.transfers.list).toHaveBeenCalledWith(
      { transfer_group: order.orderId, destination: ACCOUNT, limit: 100 },
      { timeout: 10_000, maxNetworkRetries: 0 },
    );
    expect(await transferOf(order.orderId)).toMatchObject({ status: "sent", stripe_transfer_id: "tr_test_1" });
    // Nothing more is sent, and the organiser isn't paid again by a run.
    await dueNow();
    expect(await run()).toMatchObject({ claimed: 0 });
    expect(api.stripe.madeTransfers).toHaveLength(1);
    // The row is final: a second cancel is a plain conflict, with no look at Stripe.
    api.stripe.transfers.list.mockClear();
    expect((await act(row.id, "cancel")).body.code).toBe("transfer_state_conflict");
    expect(api.stripe.transfers.list).not.toHaveBeenCalled();
  });

  it("a worker that died after Stripe accepted the request (a lapsed sending row) is adopted, not cancelled", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await api.db.query(`select * from private.claim_due_transfers(1, interval '2 minutes', 5)`);
    await originalTransferCreate()(
      { amount: order.share, currency: "aud", destination: ACCOUNT, source_transaction: `ch_${order.pi}`, transfer_group: order.orderId, metadata: {} },
      { idempotencyKey: transferIdempotencyKey(order.orderId, 1) },
    );
    await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);
    // Not due any more, so nobody takes the row over: only the admin can act on it.
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    const row = await transferOf(order.orderId);
    expect(row.status).toBe("sending");
    const res = await act(row.id, "cancel");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "sent", stripeTransferId: "tr_test_1" });
    expect(api.stripe.madeTransfers).toHaveLength(1);
  });

  it.each([
    ["failed after an unfinished last attempt", "failed", "last_attempt_unfinished"],
    ["held", "held", "idempotency_conflict"],
  ])("a %s row whose transfer exists in Stripe is adopted too", async (_name, status, lastError) => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await run();
    // Put the row in the state it would be in had the worker lost the answer: the transfer exists in Stripe only.
    const sent = await transferOf(order.orderId);
    await api.db.query(
      `update private.order_transfers set status = $2, last_error = $3, stripe_transfer_id = null, sent_at = null where id = $1`,
      [sent.id, status, lastError],
    );
    const res = await act(sent.id, "cancel");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "sent", stripeTransferId: "tr_test_1" });
  });

  it("with no transfer in Stripe the cancel goes ahead (a transfer reversed in full doesn't count)", async () => {
    const order = await makeOrder();
    const reversed = await makeOrder();
    await endedHoursAgo(49);
    // Stripe fails for the first order only (the run takes the two in no particular order).
    const create = originalTransferCreate();
    api.stripe.transfers.create.mockImplementation(async (params, options) => {
      if (params.transfer_group === order.orderId) throw new Stripe.errors.StripeAPIError({ message: "boom", statusCode: 500 });
      return create(params, options);
    });
    await run();
    const row = await transferOf(order.orderId);
    expect(row.status).toBe("retry");
    const res = await act(row.id, "cancel");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "cancelled", lastError: "cancelled_by_admin" });
    expect(api.stripe.transfers.list).toHaveBeenCalled();

    const second = await transferOf(reversed.orderId);
    expect(second.status).toBe("sent");
    // Back to a held row whose transfer was reversed in Stripe: the money came back, paying by hand is right.
    await api.db.query(
      `update private.order_transfers set status = 'held', last_error = 'transfer_reversed', stripe_transfer_id = null, sent_at = null where id = $1`,
      [second.id],
    );
    await api.stripe.transfers.createReversal(api.stripe.madeTransfers.find((t) => t.transfer_group === reversed.orderId)!.id, {});
    expect((await act(second.id, "cancel")).body).toMatchObject({ status: "cancelled" });
  });

  it("a transfer for another amount is a 409 for a person to check in Stripe: nothing is cancelled", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(new Stripe.errors.StripeAPIError({ message: "boom", statusCode: 500 }));
    await run();
    await originalTransferCreate()(
      { amount: order.share + 1, currency: "aud", destination: ACCOUNT, transfer_group: order.orderId, metadata: {} },
      undefined,
    );
    const row = await transferOf(order.orderId);
    const res = await act(row.id, "cancel");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("transfer_exists_in_stripe");
    expect((await transferOf(order.orderId)).status).toBe("retry");
  });

  it("when Stripe can't be asked nothing is cancelled (503), and the log has no order id or Stripe message", async () => {
    const { order, row } = await unknownOutcome();
    api.stripe.transfers.list.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: "secret detail" }));
    const res = await act(row.id, "cancel");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("transfer_stripe_unavailable");
    expect((await transferOf(order.orderId)).status).toBe("retry");
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain(orderReference(order.orderId));
    expect(logged).not.toContain(order.orderId);
    expect(logged).not.toContain("secret detail");
    // And once Stripe answers, the transfer it already made is adopted.
    expect((await act(row.id, "cancel")).body.status).toBe("sent");
  });

  it("retry and release don't look at Stripe (the job's own look-before-create covers them)", async () => {
    const { row } = await unknownOutcome();
    api.stripe.transfers.list.mockClear();
    expect((await act(row.id, "retry")).status).toBe(200);
    expect(api.stripe.transfers.list).not.toHaveBeenCalled();
  });
});

describe("a transfer that reaches Stripe after an admin cancelled the row", () => {
  const act = (transferId: string, action: unknown) => api.call(adminTransferAction, { token: admin.token, params: { transferId }, body: { action } });

  it("a worker stalled past its lease: the row stays cancelled but records the transfer, with an urgent exception and an alert", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const original = originalTransferCreate();
    let cancel: { status: number; body: Record<string, unknown> } | undefined;
    api.stripe.transfers.create.mockImplementationOnce(async (params, options) => {
      // The worker is held up: its lease lapses, and an admin cancels the row (Stripe has no transfer yet) ...
      await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);
      cancel = await act((await transferOf(order.orderId)).id, "cancel");
      // ... then Stripe accepts the worker's request after all.
      return original(params, options);
    });
    // One worker: this lapses the lease by hand mid-run, which a real run can't (a 2-minute lease, a 25 s budget), and
    // with the run's other workers still looping one of them would rightly take the lapsed row (claimed: 2).
    expect(await runOne()).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(cancel?.status).toBe(200);
    expect(cancel?.body).toMatchObject({ status: "cancelled" });

    const row = await transferOf(order.orderId);
    expect(row).toMatchObject({ status: "cancelled", stripe_transfer_id: "tr_test_1", last_error: "cancelled_by_admin" });
    const [times] = await api.db.query<{ sent_at: Date | null }>(`select sent_at from private.order_transfers where id = $1`, [row.id]);
    expect(times.sent_at).not.toBeNull();
    expect(await exceptions()).toEqual([
      expect.objectContaining({
        kind: "transfer_reversal_required",
        status: "open",
        order_id: order.orderId,
        details: expect.objectContaining({ reason: "transfer_after_cancel", transferAmountCents: order.share }),
      }),
    ]);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0].subject).toContain("URGENT");
    expect(api.sendEmail.mock.calls[0][0].text).not.toContain(order.orderId);
    expect(error.mock.calls.flat().map(String).join("\n")).toContain("sent after an admin cancelled it");

    // Nothing is sent again, and the admin view shows the transfer id.
    expect(await run()).toMatchObject({ claimed: 0 });
    const listed = await api.call(adminListTransfers, { token: admin.token, query: { status: "cancelled" } });
    expect(listed.body.items[0]).toMatchObject({ status: "cancelled", stripeTransferId: "tr_test_1" });
    // The organiser has that money: it counts as sent for them, and the platform no longer owes it.
    expect(listed.body.owedToOrganisersCents).toBe(0);
  });

  it("is idempotent: the same transfer again changes nothing; another transfer is a duplicate", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await api.db.query(`select * from private.claim_due_transfers(1, interval '2 minutes', 5)`);
    const row = await transferOf(order.orderId);
    await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    expect((await act(row.id, "cancel")).body.status).toBe("cancelled");

    const finish = async (transferId: string) =>
      (
        await api.db.query<{ result: string }>(
          `select result from private.finish_order_transfer($1::bigint, null, 'sent', null, null, $2, false, false)`,
          [row.id, transferId],
        )
      )[0].result;
    expect(await finish("tr_late_1")).toBe("cancelled_paid");
    expect(await finish("tr_late_1")).toBe("cancelled_paid");
    expect(await finish("tr_late_2")).toBe("duplicate");
    expect(await transferOf(order.orderId)).toMatchObject({ status: "cancelled", stripe_transfer_id: "tr_late_1" });
    expect((await exceptions()).map((e) => [e.kind, e.details.reason])).toEqual([["transfer_reversal_required", "duplicate_transfer"]]);
  });

  it("a refund after that is flagged for reversal too", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await api.db.query(`select * from private.claim_due_transfers(1, interval '2 minutes', 5)`);
    const row = await transferOf(order.orderId);
    await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    expect((await act(row.id, "cancel")).body.status).toBe("cancelled");
    await api.db.query(`select * from private.finish_order_transfer($1::bigint, null, 'sent', null, null, 'tr_late_1', false, false)`, [row.id]);
    expect((await exceptions()).map((e) => e.details.reason)).toEqual(["transfer_after_cancel"]);
    await refund(order, order.total);
    expect((await exceptions()).map((e) => e.details.reason)).toEqual(["refunded_after_transfer"]);
    expect((await transferOf(order.orderId)).status).toBe("cancelled");
  });

  it("a transfer id is only ever kept on a sent or cancelled row", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.create.mockRejectedValueOnce(new Stripe.errors.StripeAPIError({ message: "boom", statusCode: 500 }));
    await run();
    const row = await transferOf(order.orderId);
    expect(row.status).toBe("retry");
    await expect(
      api.db.query(`update private.order_transfers set stripe_transfer_id = 'tr_x', sent_at = now() where id = $1`, [row.id]),
    ).rejects.toThrow(/order_transfers_sent_state/);
    await expect(api.db.query(`update private.order_transfers set status = 'sent' where id = $1`, [row.id])).rejects.toThrow(
      /order_transfers_sent_state|order_transfers_lease_only_while_sending/,
    );
  });
});

// ---------------------------------------------------------------------------
// The last look before the transfer is created
// ---------------------------------------------------------------------------

describe("a refund while the job is working up to the transfer", () => {
  it("a full refund recorded after the job read Stripe, before it creates: nothing is sent, and the row ends cancelled", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    // The refund's webhook is handled between the job's look at Stripe and its create (inside the look for an existing transfer).
    api.stripe.transfers.list.mockImplementationOnce(async () => {
      await refund(order, order.total, { eventId: "evt_before_create" });
      return { object: "list", has_more: false, data: [] } as never;
    });
    expect(await run()).toMatchObject({ claimed: 1, sent: 0 });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "cancelled", last_error: "refunded" });
    expect(await exceptions()).toEqual([]);
  });

  it("a refund recorded but not yet applied to the transfer row is held by the job itself", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.list.mockImplementationOnce(async () => {
      // record_payment_refund has run; flag_transfer_after_refund has not.
      await api.db.query(`update public.orders set amount_refunded_cents = 100 where id = $1`, [order.orderId]);
      return { object: "list", has_more: false, data: [] } as never;
    });
    expect(await run()).toMatchObject({ claimed: 1, held: 1, sent: 0 });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "held", last_error: "refunded" });
  });

  it("an order that is no longer paid is not transferred either", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.list.mockImplementationOnce(async () => {
      await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [order.orderId]);
      return { object: "list", has_more: false, data: [] } as never;
    });
    await run();
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    expect((await transferOf(order.orderId)).status).not.toBe("sent");
  });

  it("a row another worker took over is not created for by the first", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.list.mockImplementationOnce(async () => {
      await api.db.query(`update private.order_transfers set lease_token = gen_random_uuid()`);
      return { object: "list", has_more: false, data: [] } as never;
    });
    expect(await run()).toMatchObject({ claimed: 1, sent: 0, leaseLost: 1 });
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    expect((await transferOf(order.orderId)).status).toBe("sending");
  });

  it("a worker stalled past its lease sends nothing and leaves the row for the next attempt", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    api.stripe.transfers.list.mockImplementationOnce(async () => {
      await api.db.query(`update private.order_transfers set lease_expires_at = now() - interval '1 second'`);
      return { object: "list", has_more: false, data: [] } as never;
    });
    expect(await runOne()).toMatchObject({ claimed: 1, sent: 0, retrying: 1 }); // one worker: see the test above
    expect(api.stripe.transfers.create).not.toHaveBeenCalled();
    expect(await transferOf(order.orderId)).toMatchObject({ status: "retry", last_error: "lease_lapsed", key_version: 1 });
  });
});

// ---------------------------------------------------------------------------
// The run's time budget
// ---------------------------------------------------------------------------

describe("the run's time budget", () => {
  it("leaves room for the three Stripe calls of the last transfer inside the route's maxDuration", async () => {
    const { maxDuration } = await import("@/app/api/cron/payouts/route");
    expect(TRANSFER_RUN.budgetMs + 3 * TRANSFER_STRIPE_REQUEST.timeout).toBeLessThan(maxDuration * 1000);
    expect(TRANSFER_RUN.budgetMs).toBeLessThanOrEqual(25_000);
  });

  it("starts no new transfer once the budget is spent", async () => {
    await makeOrder();
    await makeOrder();
    await endedHoursAgo(49);
    expect(await runOrderTransfers(api.deps, { budgetMs: 0 })).toMatchObject({ claimed: 0 });
    expect(await run()).toMatchObject({ claimed: 2, sent: 2 });
  });
});

// ---------------------------------------------------------------------------
// The organiser's payouts
// ---------------------------------------------------------------------------

describe("GET /api/organisers/me/payouts", () => {
  it("needs an organiser", async () => {
    expect((await api.call(getMyPayouts)).status).toBe(401);
    const member = await api.signUp();
    expect((await api.call(getMyPayouts, { token: member.token })).status).toBe(404);
  });

  it("splits each event's money into paid out with the payment, waiting and sent; never another organiser's", async () => {
    const paidOut = await makeOrder({ delayed: false, support: 200 });
    const sent = await makeOrder();
    const second = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
    const pending = await makeOrder({ on: second, lines: [{ ticketTypeId: "vip", quantity: 1 }] });
    await endedHoursAgo(49, event.eventId);
    await run();

    const otherOrganiser = await approvedOrganiser(api, admin, { contactEmail: "other-org@example.com" });
    expect(otherOrganiser.organiserId).not.toBe(organiser.organiserId);

    const res = await api.call(getMyPayouts, { token: organiser.token });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.delayedPayouts).toBe(true);
    expect(res.body.payoutDelayHours).toBe(48);
    expect(res.body.totals).toEqual({ paidOutCents: paidOut.share, pendingCents: pending.share, sentCents: sent.share });
    const byEvent = Object.fromEntries((res.body.items as OrganiserPayoutEvent[]).map((i) => [i.eventId, i]));
    expect(byEvent[event.eventId]).toMatchObject({ paidOutCents: paidOut.share, pendingCents: 0, sentCents: sent.share });
    expect(byEvent[event.eventId].dueAt).toBeUndefined();
    expect(byEvent[second.eventId]).toMatchObject({ paidOutCents: 0, pendingCents: pending.share, sentCents: 0, dueAt: expect.any(String) });
    expect(new Date(byEvent[second.eventId].dueAt!).getTime() - new Date(byEvent[second.eventId].endsAt).getTime()).toBe(48 * 3600_000);

    const theirs = await api.call(getMyPayouts, { token: otherOrganiser.token });
    expect(theirs.body.items).toEqual([]);
    expect(theirs.body.totals).toEqual({ paidOutCents: 0, pendingCents: 0, sentCents: 0 });
  });

  it("says whether payouts are delayed, and pages", async () => {
    api.delayedPayouts = false;
    const off = await api.call(getMyPayouts, { token: organiser.token });
    expect(off.body.delayedPayouts).toBe(false);
    for (let i = 0; i < 3; i += 1) {
      const e = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
      await makeOrder({ on: e, lines: [{ ticketTypeId: "ga", quantity: 1 }] });
    }
    const first = await api.call(getMyPayouts, { token: organiser.token, query: { limit: "2" } });
    expect(first.body.items).toHaveLength(2);
    const second = await api.call(getMyPayouts, { token: organiser.token, query: { limit: "2", cursor: first.body.nextCursor } });
    expect(second.body.items).toHaveLength(1);
    // Totals cover every event, not the page.
    expect(first.body.totals.pendingCents).toBe(second.body.totals.pendingCents);
    expect(first.body.totals.pendingCents).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The cron
// ---------------------------------------------------------------------------

describe("GET /api/cron/payouts", () => {
  const cron = (secret?: string) =>
    api.send(runPayoutsCron, new Request(`${SITE_URL}/api/cron/payouts`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

  it("refuses without the cron secret, and when it isn't configured", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("wrong")).status).toBe(401);
    api.cronSecret = undefined;
    expect((await cron(CRON_SECRET)).status).toBe(401);
    expect(await api.db.query(`select * from private.cron_runs`)).toEqual([]);
  });

  it("sends what's due, answers with counts only and records the run", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    const res = await cron(CRON_SECRET);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({ claimed: 1, sent: 1, retrying: 0, held: 0, failed: 0, leaseLost: 0 });
    expect(JSON.stringify(res.body)).not.toContain(order.orderId);
    const [row] = await api.db.query<{ name: string; claimed: number; sent: number }>(`select name, claimed, sent from private.cron_runs`);
    expect(row).toEqual({ name: "payouts", claimed: 1, sent: 1 });

    // Nothing left: zeros, and the run is recorded again.
    expect((await cron(CRON_SECRET)).body).toEqual({ claimed: 0, sent: 0, retrying: 0, held: 0, failed: 0, leaseLost: 0 });
  });

  it("still pays out orders already made when the switch has been turned off", async () => {
    const order = await makeOrder();
    api.delayedPayouts = false;
    await endedHoursAgo(49);
    expect((await cron(CRON_SECRET)).body).toMatchObject({ sent: 1 });
    expect((await transferOf(order.orderId)).status).toBe("sent");
  });

  it("the email outbox's cron refreshes trending now, and a failure there never fails the run", async () => {
    const queries: string[] = [];
    const counting = new TestApi({
      query: async (text, params) => {
        queries.push(text);
        return api.db.query(text, params);
      },
    });
    const req = () => new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    const res = await counting.send(runEmailOutboxCron, req());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claimed: 0, sent: 0, retrying: 0, failed: 0 });
    expect(queries.filter((q) => q.includes("private.refresh_trending"))).toHaveLength(1);

    const failing = new TestApi({
      query: async (text, params) => {
        if (text.includes("refresh_trending")) throw Object.assign(new Error("the table is on fire: secret detail"), { code: "57014" });
        return api.db.query(text, params);
      },
    });
    const failed = await failing.send(runEmailOutboxCron, req());
    expect(failed.status).toBe(200);
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("57014");
    expect(logged).not.toContain("secret detail");
  });
});

describe("the drain of ops alerts sends the new kinds", () => {
  it("reads transfer exceptions like any other", async () => {
    const order = await makeOrder();
    await endedHoursAgo(49);
    await run();
    await refund(order, order.total);
    await drainEmailOutbox(api.deps, { kind: "ops_alert" });
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0].text).toContain("Reverse the transfer");
  });
});
