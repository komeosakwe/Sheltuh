import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { updateEventDraft } from "@/lib/server/handlers/events";
import { createCheckout, getOrderBySession, orderTotals, stripeWebhook } from "@/lib/server/handlers/orders";
import { stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, eventInput, publishedEvent, signUpAdmin } from "./helpers/fixtures";
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
    // GA fee: 5% of 3000 + 50 = 200 each. VIP fee: 400 + 50 = 450.
    expect(totals).toEqual({ subtotalCents: 14000, buyerFeeCents: 400, totalCents: 14400, applicationFeeCents: 850 });
  });
});

describe("free checkout", () => {
  it("issues tickets immediately without touching Stripe", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 2 }], buyerEmail: "fan@example.com" },
    });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^https:\/\/sheltuh\.test\/checkout\/success\?session_id=ord_/);
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();

    const order = await api.call(getOrderBySession, { params: { sessionId: orderIdFromUrl(res.body.url) } });
    expect(order.body).toMatchObject({ status: "paid", totalCents: 0, eventTitle: "Neon Static" });
    expect(order.body.tickets).toHaveLength(2);
    expect(order.body.tickets[0].ticketCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(await sold(event.eventId)).toEqual({ rsvp: 2 });

    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const email = api.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("fan@example.com");
    expect(email.subject).toBe("Your tickets: Neon Static");
    for (const ticket of order.body.tickets) expect(email.text).toContain(ticket.ticketCode);
    expect(email.text).toContain(`https://sheltuh.test/checkout/success?session_id=${order.body.orderId}`);
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
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    api.sendEmail.mockRejectedValueOnce(new Error("SMTP down"));
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "fan@example.com" },
    });
    expect(res.status).toBe(201);
    const [row] = await api.db.query<{ status: string; tickets_emailed_at: Date | null }>(
      `select status::text, tickets_emailed_at from public.orders`,
    );
    expect(row).toEqual({ status: "paid", tickets_emailed_at: null });
  });

  it("says so when the tickets are gone, and leaves no order behind", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    const body = { lineItems: [{ ticketTypeId: "rsvp", quantity: 2 }], buyerEmail: "fan@example.com" };
    await api.call(createCheckout, { params: { eventId: event.eventId }, body });

    const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/sold out/);
    const [{ count }] = await api.db.query<{ count: number }>(`select count(*)::int as count from public.orders`);
    expect(count).toBe(1);
  });
});

describe("paid checkout", () => {
  it("won't sell until the organiser can be paid out", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID_TICKETS });
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
    expect(res.body.url).toBe("https://checkout.stripe.test/cs_test_1");

    const params = api.stripe.checkout.sessions.create.mock.calls[0][0];
    const orderId = params.client_reference_id;
    expect(orderId).toMatch(/^ord_[0-9a-f]{32}$/);
    expect(params.payment_intent_data).toEqual({
      application_fee_amount: 850,
      transfer_data: { destination: "acct_test_1" },
    });
    expect(params.success_url).toBe(`https://sheltuh.test/checkout/success?session_id=${orderId}`);
    expect(params.customer_email).toBeUndefined(); // Stripe collects it unless the buyer already gave one
    expect(params.line_items.map((l: { price_data: { unit_amount: number } }) => l.price_data.unit_amount)).toEqual([
      3000, 200, 8000,
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

    const order = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(order.body).toMatchObject({
      status: "paid",
      buyerEmail: "buyer@example.com",
      stripeCheckoutSessionId: "cs_test_1",
      stripePaymentIntentId: "pi_test_1",
      totalCents: 6400,
      applicationFeeCents: 400,
    });
    expect(order.body.tickets).toHaveLength(2);
    expect(await sold(event.eventId)).toEqual({ ga: 2, vip: 0 });

    // Emailed to the address the buyer gave Stripe, exactly once.
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0].to).toBe("buyer@example.com");
    await api.send(stripeWebhook, stripeWebhookRequest(completedSession(orderId)));
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
    expect(lost.body).toMatchObject({ status: "refunded", stripePaymentIntentId: "pi_test_2" });
    expect(lost.body.tickets).toEqual([]);
    expect(await sold(event.eventId)).toEqual({ ga: 2, vip: 0 });

    // Refunded in full: the buyer's money, Sheltüh's fee and the organiser's transfer.
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(api.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_test_2", reverse_transfer: true, refund_application_fee: true }),
      { idempotencyKey: `oversold-refund-${second}` },
    );
    // Only the winner got a ticket email.
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
    const ignored = await api.send(stripeWebhook, stripeWebhookRequest({ type: "charge.refunded", data: { object: {} } }));
    expect(ignored).toEqual({ status: 200, body: { received: true } });
    const unknown = await api.send(stripeWebhook, stripeWebhookRequest(completedSession("ord_unknown")));
    expect(unknown.status).toBe(200);
  });
});

describe("ticket types with sales", () => {
  async function soldEvent() {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE_TICKETS });
    await api.call(createCheckout, {
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
