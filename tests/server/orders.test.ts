import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { updateEventDraft } from "@/lib/server/handlers/events";
import { createCheckout, getOrderBySession, orderTotals, stripeWebhook } from "@/lib/server/handlers/orders";
import { orderReference } from "@/lib/server/order-reference";
import { expectSessionPaymentOptions, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, disablePayouts, enablePayouts, eventInput, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

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
});

const PAID_TICKETS = [
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 3 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 1 },
];
const FREE_TICKETS = [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 2 }];

async function sold(eventId: string) {
  const rows = await api.db.query<{ id: string; quantity_sold: number }>(
    `select id, quantity_sold from public.ticket_types where event_id = $1 order by id`,
    [eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.quantity_sold]));
}

/** The order's internal fields, read straight from the database (the by-session API never exposes them). */
async function internal(orderId: string) {
  const [row] = await api.db.query(
    `select status::text as status, buyer_email, stripe_checkout_session_id, stripe_payment_intent_id,
            total_cents, application_fee_cents
       from public.orders where id = $1`,
    [orderId],
  );
  return row;
}

function orderIdFromUrl(url: string) {
  return new URL(url).searchParams.get("session_id")!;
}

function completedSession(orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        client_reference_id: orderId,
        payment_status: "paid",
        payment_intent: "pi_test_1",
        customer_details: { email: "buyer@example.com" },
        ...overrides,
      },
    },
  };
}

describe("fee maths", () => {
  it("the platform keeps the booking fee whoever pays it; only buyer-pays fees reach the buyer's total", () => {
    const totals = orderTotals([
      { ticketTypeId: "ga", ticketTypeName: "GA", unitPriceCents: 3000, feePolicy: "buyer-pays", quantity: 2 },
      { ticketTypeId: "vip", ticketTypeName: "VIP", unitPriceCents: 8000, feePolicy: "organiser-absorbs", quantity: 1 },
    ]);
    // GA fee: 4% of 3000 + 50 = 170 each. VIP fee: 320 + 50 = 370.
    expect(totals).toEqual({ subtotalCents: 14000, buyerFeeCents: 340, totalCents: 14340, applicationFeeCents: 710 });
  });
});

// Free orders by a signed-in member booking with their own verified email:
// issued straight away. Guests confirm by email first (free-orders.test.ts).
describe("free checkout (member, own verified email)", () => {
  async function fan() {
    return api.signUp({ email: "fan@example.com" });
  }

  it("issues tickets immediately without touching Stripe", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    const { token } = await fan();
    const res = await api.call(createCheckout, {
      token,
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 2 }], buyerEmail: "fan@example.com" },
    });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^https:\/\/sheltuh\.test\/checkout\/success\?session_id=ord_/);
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();

    const orderId = orderIdFromUrl(res.body.url);
    const order = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(order.body).toMatchObject({
      status: "paid",
      totalCents: 0,
      eventTitle: "Neon Static",
      // So the confirmation page can link back to the event (and its Who's Going).
      eventSlug: event.slug,
    });
    expect(order.body.tickets).toHaveLength(2);
    expect(order.body.tickets[0].ticketCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(await sold(event.eventId)).toEqual({ rsvp: 2 });

    // Sent once the response has gone (Next's after()).
    expect(api.sendEmail).not.toHaveBeenCalled();
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const email = api.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("fan@example.com");
    expect(email.subject).toBe("Your tickets: Neon Static");
    for (const ticket of order.body.tickets) expect(email.text).toContain(ticket.ticketCode);
    expect(email.text).toContain(`https://sheltuh.test/checkout/success?session_id=${orderId}`);
  });

  it("needs an email address to send the tickets to", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    for (const buyerEmail of [undefined, "not-an-email"]) {
      const res = await api.call(createCheckout, {
        params: { eventId: event.eventId },
        body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail },
      });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.buyerEmail).toBeTruthy();
    }
    expect(await sold(event.eventId)).toEqual({ rsvp: 0 });
  });

  it("still issues the tickets if the email can't be sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    const { token } = await fan();
    api.sendEmail.mockRejectedValueOnce(new Error("SMTP down"));
    const res = await api.call(createCheckout, {
      token,
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "fan@example.com" },
    });
    expect(res.status).toBe(201);
    await api.runDeferred();
    const [row] = await api.db.query<{ status: string; tickets_emailed_at: Date | null }>(
      `select status::text, tickets_emailed_at from public.orders`,
    );
    expect(row).toEqual({ status: "paid", tickets_emailed_at: null });
    // ...and the email is queued to be tried again.
    const [job] = await api.db.query(`select status, attempts from private.email_outbox`);
    expect(job).toEqual({ status: "pending", attempts: 1 });
  });

  it("says so when the tickets are gone, and leaves no order behind", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    const { token } = await fan();
    const body = { lineItems: [{ ticketTypeId: "rsvp", quantity: 2 }], buyerEmail: "fan@example.com" };
    await api.call(createCheckout, { token, params: { eventId: event.eventId }, body });

    const other = await api.signUp({ email: "other@example.com" });
    const res = await api.call(createCheckout, {
      token: other.token,
      params: { eventId: event.eventId },
      body: { ...body, buyerEmail: "other@example.com" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/sold out/);
    const [{ count }] = await api.db.query<{ count: number }>(`select count(*)::int as count from public.orders`);
    expect(count).toBe(1);
  });
});

describe("paid checkout", () => {
  it("won't sell until the organiser can be paid out", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    // Payouts turned off (Stripe restricted the account) after the event was published.
    await disablePayouts(api, organiser.organiserId);
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/payouts/);
  });

  it("creates a Checkout Session priced from the database, paying out to the organiser", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);

    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      // A client-sent price is ignored — only ids and quantities are read.
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 2, priceCents: 1 }, { ticketTypeId: "vip", quantity: 1 }] },
    });
    expect(res.status).toBe(201);

    const params = api.stripe.checkout.sessions.create.mock.calls[0][0];
    const orderId = params.client_reference_id;
    expect(orderId).toMatch(/^ord_[0-9a-f]{32}$/);
    // Our payment page, never Stripe's: the client secret is read from GET …/payment.
    expect(res.body).toStrictEqual({ url: `/checkout/pay?order=${orderId}`, orderId });
    expect(params.payment_intent_data).toEqual({
      application_fee_amount: 710,
      transfer_data: { destination: "acct_test_1" },
    });
    expect(params.return_url).toBe(`https://sheltuh.test/checkout/success?session_id=${orderId}`);
    expect(params.customer_email).toBeUndefined(); // Stripe collects it unless the buyer already gave one
    // Exactly the A$ total (Adaptive Pricing off); the Dashboard's wallets and Link; nothing saved.
    expectSessionPaymentOptions(params);
    expect(params.line_items.map((l: { price_data: { unit_amount: number } }) => l.price_data.unit_amount)).toEqual([
      3000, 170, 8000,
    ]);

    // Pending orders reveal nothing but their status, and hold no inventory.
    const order = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(order.body).toEqual({ status: "pending" });
    expect(await sold(event.eventId)).toEqual({ ga: 0, vip: 0 });
  });

  it("rejects unknown ticket types, excessive quantities and sold-out requests", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    const params = { eventId: event.eventId };

    expect((await api.call(createCheckout, { params, body: { lineItems: [{ ticketTypeId: "nope", quantity: 1 }] } })).status).toBe(400);
    expect((await api.call(createCheckout, { params, body: { lineItems: [{ ticketTypeId: "ga", quantity: 0 }] } })).status).toBe(400);
    const tooMany = await api.call(createCheckout, { params, body: { lineItems: [{ ticketTypeId: "vip", quantity: 2 }] } });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error).toBe('Only 1 of "VIP" left.');
  });

  it("names the exact number left only when it's 10 or fewer (as public payloads do); otherwise a generic 409", async () => {
    const event = await publishedEvent(api, organiser, admin, {
      ticketTypes: [{ id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 15 }],
    });
    await enablePayouts(api, organiser.organiserId);
    const params = { eventId: event.eventId };
    const big = await api.call(createCheckout, { params, body: { lineItems: [{ ticketTypeId: "ga", quantity: 16 }] } });
    expect(big.status).toBe(409);
    expect(big.body.error).toBe(`There aren't that many "GA" tickets left. Choose fewer.`);
    expect(big.body.error).not.toMatch(/\d/);
    await api.db.query(`update public.ticket_types set quantity_sold = 5 where event_id = $1`, [event.eventId]);
    const small = await api.call(createCheckout, { params, body: { lineItems: [{ ticketTypeId: "ga", quantity: 11 }] } });
    expect(small.body.error).toBe('Only 10 of "GA" left.');
  });

  it("isn't available for an event that isn't published", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] },
    });
    expect(res.status).toBe(404);
    expect((await api.call(createCheckout, { params: { eventId: "nope" }, body: {} })).status).toBe(404);
  });

  describe("free lines in a paid order", () => {
    const MIXED = [
      { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 20 },
      { id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 },
      { id: "kids", name: "Kids", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 },
    ];
    const checkout = (eventId: string, lineItems: { ticketTypeId: string; quantity: number }[]) =>
      api.call(createCheckout, { params: { eventId }, body: { lineItems } });

    it("are capped at 4 free tickets per order across free types: 400, no order, no Stripe", async () => {
      const event = await publishedEvent(api, organiser, admin, { ticketTypes: MIXED });
      await enablePayouts(api, organiser.organiserId);
      for (const lineItems of [
        [{ ticketTypeId: "ga", quantity: 1 }, { ticketTypeId: "rsvp", quantity: 5 }],
        [{ ticketTypeId: "ga", quantity: 1 }, { ticketTypeId: "rsvp", quantity: 3 }, { ticketTypeId: "kids", quantity: 2 }],
      ]) {
        const res = await checkout(event.eventId, lineItems);
        expect(res.status).toBe(400);
        expect(res.body.fieldErrors).toEqual({ lineItems: "You can book up to 4 free tickets at a time." });
      }
      expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
      expect(await api.db.query(`select id from public.orders`)).toEqual([]);
      const refusals = await api.db.query(`select reason, refusals from private.free_order_refusals`);
      expect(refusals).toEqual([{ reason: "order_too_large", refusals: 2 }]);
    });

    it("4 free tickets with paid ones go to Stripe as usual, with no email confirmation", async () => {
      const event = await publishedEvent(api, organiser, admin, { ticketTypes: MIXED });
      await enablePayouts(api, organiser.organiserId);
      const res = await checkout(event.eventId, [
        { ticketTypeId: "ga", quantity: 6 },
        { ticketTypeId: "rsvp", quantity: 2 },
        { ticketTypeId: "kids", quantity: 2 },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.url).toBe(`/checkout/pay?order=${res.body.orderId}`);
      expect(api.sendEmail).not.toHaveBeenCalled();
      const [order] = await api.db.query(
        `select status::text as status, total_cents, buyer_email_key, confirmation_token_hash from public.orders`,
      );
      expect(order).toEqual({ status: "pending", total_cents: 6 * 3170, buyer_email_key: null, confirmation_token_hash: null });
    });
  });

  it("marks the order failed if Stripe itself errors", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    api.stripe.checkout.sessions.create.mockRejectedValueOnce(new Error("Stripe is down"));
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] },
    });
    expect(res.status).toBe(500);
    const [row] = await api.db.query<{ status: string }>(`select status::text from public.orders`);
    expect(row.status).toBe("failed");
  });
});

describe("Stripe webhook", () => {
  async function pendingOrder(quantity = 2) {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity }] },
    });
    const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    return { event, orderId };
  }

  it("rejects a request without a valid signature", async () => {
    const { orderId } = await pendingOrder();
    const forged = stripeWebhookRequest(completedSession(orderId), "whsec_wrong");
    expect((await api.send(stripeWebhook, forged)).status).toBe(400);

    const unsigned = new Request("https://sheltuh.test/api/stripe/webhook", { method: "POST", body: "{}" });
    expect((await api.send(stripeWebhook, unsigned)).status).toBe(400);
    expect((await api.call(getOrderBySession, { params: { sessionId: orderId } })).body.status).toBe("pending");
  });

  it("marks the order paid, takes inventory and issues one ticket per unit", async () => {
    const { event, orderId } = await pendingOrder(2);
    const res = await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)));
    expect(res.status).toBe(200);

    expect(await internal(orderId)).toEqual({
      status: "paid",
      buyer_email: "buyer@example.com",
      stripe_checkout_session_id: "cs_test_1",
      stripe_payment_intent_id: "pi_test_1",
      total_cents: 6340,
      application_fee_cents: 340,
    });
    const order = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(order.body.tickets).toHaveLength(2);
    expect(await sold(event.eventId)).toEqual({ ga: 2, vip: 0 });

    // Emailed to the address the buyer gave Stripe, exactly once.
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0].to).toBe("buyer@example.com");
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)));
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — Stripe's redelivery doesn't take inventory or issue tickets twice", async () => {
    const { event, orderId } = await pendingOrder(1);
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)));
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)));
    expect(await sold(event.eventId)).toEqual({ ga: 1, vip: 0 });
    expect((await api.call(getOrderBySession, { params: { sessionId: orderId } })).body.tickets).toHaveLength(1);
  });

  it("never oversells: a payment for tickets that went to someone else is flagged for refund", async () => {
    // Two buyers both start checkout for the last 2 GA tickets...
    const { event, orderId: first } = await pendingOrder(2);
    await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] } });
    const second = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;

    // ...but there were only 3. Whoever pays second loses the race.
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(first)));
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(second, { payment_intent: "pi_test_2" })));

    const lost = await api.call(getOrderBySession, { params: { sessionId: second } });
    expect(lost.body).toMatchObject({ status: "refunded", tickets: [] });
    expect(await internal(second)).toMatchObject({ status: "refunded", stripe_payment_intent_id: "pi_test_2" });
    expect(await sold(event.eventId)).toEqual({ ga: 2, vip: 0 });

    // Refunded in full: the buyer's money, Sheltüh's fee and the organiser's transfer.
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(api.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_test_2", reverse_transfer: true, refund_application_fee: true }),
      { idempotencyKey: `oversold-refund-${second}` },
    );
    // Only the winner got a ticket email.
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("retries a failed refund when Stripe redelivers the event", async () => {
    const { event, orderId: first } = await pendingOrder(2);
    await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] } });
    const second = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(first)));

    api.stripe.refunds.create.mockRejectedValueOnce(new Error("Stripe is down"));
    const failed = await api.send(stripeWebhook, stripeWebhookRequest(completedSession(second)));
    expect(failed.status).toBe(500); // so Stripe retries
    expect((await api.call(getOrderBySession, { params: { sessionId: second } })).body.status).toBe(
      "oversold_refund_required",
    );

    const retried = await api.send(stripeWebhook, stripeWebhookRequest(completedSession(second)));
    expect(retried.status).toBe(200);
    expect((await api.call(getOrderBySession, { params: { sessionId: second } })).body.status).toBe("refunded");
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(2);
    expect(await sold(event.eventId)).toEqual({ ga: 2, vip: 0 });
  });

  it("refunds a payment for an event that was unpublished while the buyer was on Stripe", async () => {
    const { event, orderId } = await pendingOrder(1);
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });

    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)));

    const order = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(order.body).toMatchObject({ status: "refunded", tickets: [] });
    expect(await sold(event.eventId)).toEqual({ ga: 0, vip: 0 });
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("only marks an order refunded once Stripe confirms the refund", async () => {
    const { event, orderId: first } = await pendingOrder(2);
    await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] } });
    const second = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(first)));

    api.stripe.refunds.create.mockResolvedValueOnce({ id: "re_pending", status: "pending" });
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(second)));
    const status = async () => (await api.call(getOrderBySession, { params: { sessionId: second } })).body.status;
    expect(await status()).toBe("oversold_refund_required");

    const refundEvent = (type: string, refundStatus: string) =>
      stripeWebhookRequest({
        type,
        data: { object: { id: "re_pending", object: "refund", status: refundStatus, metadata: { orderId: second } } },
      });

    // Still pending: no change.
    await api.send(stripeWebhook, refundEvent("refund.updated", "pending"));
    expect(await status()).toBe("oversold_refund_required");
    // Settled: now it's refunded.
    await api.send(stripeWebhook, refundEvent("refund.updated", "succeeded"));
    expect(await status()).toBe("refunded");
  });

  it("leaves an order flagged for manual action when its refund fails", async () => {
    const { event, orderId: first } = await pendingOrder(2);
    await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] } });
    const second = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(first)));
    api.stripe.refunds.create.mockResolvedValueOnce({ id: "re_x", status: "pending" });
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(second)));

    const failed = await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "refund.failed",
        data: { object: { id: "re_x", object: "refund", status: "failed", metadata: { orderId: second } } },
      }),
    );
    expect(failed.status).toBe(200);
    expect((await api.call(getOrderBySession, { params: { sessionId: second } })).body.status).toBe(
      "oversold_refund_required",
    );
    const [row] = await api.db.query<{ stripe_refund_id: string }>(
      `select stripe_refund_id from public.orders where id = $1`,
      [second],
    );
    expect(row.stripe_refund_id).toBe("re_x");
  });

  it("reserves every line of an order or none of them", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    const checkout = (lineItems: { ticketTypeId: string; quantity: number }[]) =>
      api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems } });

    await checkout([{ ticketTypeId: "ga", quantity: 1 }, { ticketTypeId: "vip", quantity: 1 }]);
    const both = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id;
    await checkout([{ ticketTypeId: "vip", quantity: 1 }]);
    const vipOnly = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id;

    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(vipOnly)));
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(both)));

    // The VIP line failed, so the GA line in the same order wasn't taken either.
    expect(await sold(event.eventId)).toEqual({ ga: 0, vip: 1 });
    expect((await api.call(getOrderBySession, { params: { sessionId: both } })).body.status).toBe("refunded");
  });

  it("waits for delayed payment methods, and fails expired sessions", async () => {
    const { event, orderId } = await pendingOrder(1);
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId, { payment_status: "unpaid" })));
    expect((await api.call(getOrderBySession, { params: { sessionId: orderId } })).body.status).toBe("pending");

    await api.send(stripeWebhook, stripeWebhookRequest({ ...completedSession(orderId), type: "checkout.session.async_payment_succeeded" }));
    expect((await api.call(getOrderBySession, { params: { sessionId: orderId } })).body.status).toBe("paid");

    const { orderId: abandoned } = await pendingOrder(1);
    await api.send(stripeWebhook, stripeWebhookRequest({ ...completedSession(abandoned), type: "checkout.session.expired" }));
    expect((await api.call(getOrderBySession, { params: { sessionId: abandoned } })).body.status).toBe("failed");
    expect((await sold(event.eventId)).ga).toBe(1);
  });

  it("acknowledges events it doesn't act on, and unknown orders", async () => {
    // Disputes aren't handled (docs/architecture.md, "Refunds made in Stripe"). charge.refunded is: payment-refunds.test.ts.
    const ignored = await api.send(
      stripeWebhook,
      stripeWebhookRequest({ type: "charge.dispute.created", data: { object: { id: "dp_test_1", object: "dispute" } } }),
    );
    expect({ status: ignored.status, body: ignored.body }).toEqual({ status: 200, body: { received: true } });
    const unknown = await api.send(stripeWebhook, stripeWebhookRequest(completedSession("ord_unknown")));
    expect(unknown.status).toBe(200);
  });
});

describe("guest order lookup (GET /api/orders/by-session/{orderId})", () => {
  async function paidOrderId() {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] } });
    const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    return { event, orderId };
  }

  it("returns only what the confirmation page shows: no ids, fee split, Stripe ids, line items, order timestamps, street address or full email", async () => {
    const { event, orderId } = await paidOrderId();
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId, { customer_details: { email: "mia@example.com" } })));

    const res = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const codes = await api.db.query<{ code: string }>(`select code from public.tickets where order_id = $1 order by code`, [orderId]);
    expect(res.body).toEqual({
      status: "paid",
      reference: orderReference(orderId),
      eventTitle: "Neon Static",
      eventSlug: event.slug,
      // The event's public details, for the tickets (8:00 pm – 11:30 pm AEDT), while it's published.
      eventListed: true,
      eventStartsAt: "2027-03-06T09:00:00.000Z",
      eventEndsAt: "2027-03-06T12:30:00.000Z",
      venueName: "The Tote",
      suburb: "Collingwood",
      refundPolicy: "no_change_of_mind",
      maskedEmail: "m***@example.com",
      subtotalCents: 6000,
      buyerFeeCents: 340,
      totalCents: 6340,
      tickets: codes.map((c) => ({ ticketCode: c.code, ticketTypeName: "GA", checkedInAt: null })),
    });
    const raw = JSON.stringify(res.body);
    const [{ created_at: createdAt }] = await api.db.query<{ created_at: Date | string }>(
      `select created_at from public.orders where id = $1`,
      [orderId],
    );
    for (const secret of [
      orderId,
      organiser.organiserId,
      event.eventId,
      "mia@example.com",
      "cs_test_1",
      "pi_test_1",
      "71 Johnston St", // the venue's street address
      new Date(createdAt).toISOString(),
      "applicationFee",
      "lineItems",
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("reveals nothing but the status of a pending order, uncached", async () => {
    const { orderId } = await paidOrderId();
    const res = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "pending" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("a malformed id is a 404 without touching the database; an unknown one is a 404 too", async () => {
    const query = vi.spyOn(api.db, "query");
    try {
      for (const sessionId of ["cs_test_1", "ord_", "ord_XYZ", `ord_${"a".repeat(31)}`, `ord_${"A".repeat(32)}`, "' or 1=1 --", ""]) {
        const res = await api.call(getOrderBySession, { params: { sessionId } });
        expect(res.status).toBe(404);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      }
      expect(query).not.toHaveBeenCalled();

      const unknown = await api.call(getOrderBySession, { params: { sessionId: `ord_${"0".repeat(32)}` } });
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual({ error: "Order not found." });
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      query.mockRestore();
    }
  });
});

describe("log hygiene", () => {
  it("a failed refund is logged by order reference, never by order id (the page's credential)", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    const checkout = () =>
      api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "vip", quantity: 1 }] } });
    await checkout();
    const first = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    await checkout();
    const second = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(first)));
    api.stripe.refunds.create.mockResolvedValueOnce({ id: "re_x", status: "failed" });

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await api.send(stripeWebhook, stripeWebhookRequest(completedSession(second)));
      const logged = error.mock.calls.flat().map(String).join("\n");
      expect(logged).toContain(orderReference(second));
      expect(logged).not.toContain(second);
      expect(logged).not.toContain("buyer@example.com");
    } finally {
      error.mockRestore();
    }
  });
});

describe("ticket types with sales", () => {
  async function soldEvent() {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    const { token } = await api.signUp({ email: "fan@example.com" });
    await api.call(createCheckout, {
      token,
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 2 }], buyerEmail: "fan@example.com" },
    });
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });
    return event;
  }

  it("the database itself refuses a paid price under A$1.00", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await expect(
      api.db.query(`update public.ticket_types set price_cents = 50 where event_id = $1`, [event.eventId]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("can't be removed from the event", async () => {
    const event = await soldEvent();
    const res = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId: event.eventId },
      method: "PATCH",
      body: eventInput({ ticketTypes: PAID_TICKETS }),
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already sold/);
  });

  it("can't have its quantity cut below what's sold", async () => {
    const event = await soldEvent();
    const res = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId: event.eventId },
      method: "PATCH",
      body: eventInput({ ticketTypes: [{ ...FREE_TICKETS[0], quantityAvailable: 1 }] }),
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/below the number already sold/);

    const raised = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId: event.eventId },
      method: "PATCH",
      body: eventInput({ ticketTypes: [{ ...FREE_TICKETS[0], quantityAvailable: 10 }] }),
    });
    expect(raised.status).toBe(200);
    expect(await sold(event.eventId)).toEqual({ rsvp: 2 });
  });
});

describe("a payment for an order that had already failed", () => {
  it("is logged and refunded in full, once, with a per-order idempotency key; the order stays failed", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] },
    });
    const orderId = api.stripe.checkout.sessions.create.mock.lastCall![0].client_reference_id as string;
    expect(res.status).toBe(201);
    // Cancelled or expired before Stripe reported the (late) payment.
    await api.send(stripeWebhook, stripeWebhookRequest({ type: "checkout.session.expired", data: completedSession(orderId).data }));
    expect((await internal(orderId)).status).toBe("failed");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.stripe.refunds.create.mockResolvedValueOnce({ id: "re_failed_1", status: "pending" });
    const paid = await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)));
    expect(paid.status).toBe(200);
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(api.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_test_1", reverse_transfer: true, refund_application_fee: true }),
      { idempotencyKey: `failed-order-refund-${orderId}` },
    );
    const logged = warn.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain(orderReference(orderId));
    expect(logged).not.toContain(orderId);
    const row = await internal(orderId);
    expect(row.status).toBe("failed");
    expect(row.stripe_payment_intent_id).toBe("pi_test_1");
    expect(await sold(event.eventId)).toEqual({ ga: 0, vip: 0 });

    // A redelivery (or the async success after the completed event) doesn't refund again.
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)));
    await api.send(stripeWebhook, stripeWebhookRequest({ type: "checkout.session.async_payment_succeeded", data: completedSession(orderId).data }));
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("a Stripe error returns 500 so Stripe redelivers; an unpaid completed session refunds nothing", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
    await enablePayouts(api, organiser.organiserId);
    await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    const orderId = api.stripe.checkout.sessions.create.mock.lastCall![0].client_reference_id as string;
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId, { payment_status: "unpaid" })));
    expect(api.stripe.refunds.create).not.toHaveBeenCalled();

    api.stripe.refunds.create.mockRejectedValueOnce(new Error("stripe down"));
    expect((await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)))).status).toBe(500);
    expect((await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)))).status).toBe(200);
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(2);
    expect(api.stripe.refunds.create.mock.calls.map(([, opts]) => opts.idempotencyKey)).toEqual([
      `failed-order-refund-${orderId}`,
      `failed-order-refund-${orderId}`,
    ]);
  });
});
