import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout, getOrderBySession, stripeWebhook } from "@/lib/server/handlers/orders";
import { orderReference } from "@/lib/server/order-reference";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, insertOrder, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// charge.refunded: a refund made outside the app (usually the Stripe
// dashboard). private.record_payment_refund, supabase/migrations/20261020000000_payment_refunds.sql.

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

// GA: 3000 + 170 buyer fee = 3170 to the buyer. VIP: 8000, fee absorbed.
const TICKETS = [
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 1 },
];

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  serverUrl = testDb.url;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
  await enablePayouts(api, organiser.organiserId);
  // A fresh Checkout Session per checkout (stripe_checkout_session_id is unique).
  let sessions = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    const id = `cs_test_${++sessions}`;
    return embeddedSession(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function sold() {
  const rows = await api.db.query<{ id: string; quantity_sold: number }>(
    `select id, quantity_sold from public.ticket_types where event_id = $1 order by id`,
    [event.eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.quantity_sold]));
}

async function internal(orderId: string) {
  const [row] = await api.db.query<{ status: string; amount_refunded_cents: number; tickets: number }>(
    `select status::text as status, amount_refunded_cents,
            (select count(*)::int from public.tickets t where t.order_id = o.id) as tickets
       from public.orders o where o.id = $1`,
    [orderId],
  );
  return row;
}

/** A pending paid order, as checkout leaves it. */
async function checkout(lineItems: { ticketTypeId: string; quantity: number }[]) {
  const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems } });
  expect(res.status).toBe(201);
  return api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
}

function completed(orderId: string, paymentIntent: string) {
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${paymentIntent}`,
        object: "checkout.session",
        client_reference_id: orderId,
        payment_status: "paid",
        payment_intent: paymentIntent,
        customer_details: { email: "buyer@example.com" },
      },
    },
  });
}

/** A paid order (fulfilled by the webhook) with this payment intent. */
async function paidOrder(lineItems: { ticketTypeId: string; quantity: number }[], paymentIntent: string) {
  const orderId = await checkout(lineItems);
  expect((await api.send(stripeWebhook, completed(orderId, paymentIntent))).status).toBe(200);
  expect((await internal(orderId)).status).toBe("paid");
  return orderId;
}

function chargeRefunded(paymentIntent: unknown, amountRefunded: number, refunded: boolean) {
  return stripeWebhookRequest({
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_test_1",
        object: "charge",
        payment_intent: paymentIntent,
        amount_refunded: amountRefunded,
        refunded,
      },
    },
  });
}

async function refund(paymentIntent: unknown, amountRefunded: number, refunded: boolean) {
  const res = await api.send(stripeWebhook, chargeRefunded(paymentIntent, amountRefunded, refunded));
  expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { received: true } });
}

const lookup = async (orderId: string) => (await api.call(getOrderBySession, { params: { sessionId: orderId } })).body;

describe("full refund (charge.refunded, refunded: true)", () => {
  it("voids a paid order: refunded, amount recorded, inventory released, no ticket codes returned", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const orderId = await paidOrder(
      [
        { ticketTypeId: "ga", quantity: 2 },
        { ticketTypeId: "vip", quantity: 1 },
      ],
      "pi_full",
    );
    expect(await sold()).toEqual({ ga: 2, vip: 1 });

    await refund("pi_full", 2 * 3170 + 8000, true);

    expect(await internal(orderId)).toEqual({ status: "refunded", amount_refunded_cents: 14340, tickets: 3 });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
    // The buyer's page: refunded after tickets were issued, and no codes (they're void).
    expect(await lookup(orderId)).toMatchObject({ status: "refunded", refundReason: "refunded", tickets: [], totalCents: 14340 });
    // The released VIP can be sold again.
    const next = await paidOrder([{ ticketTypeId: "vip", quantity: 1 }], "pi_next");
    expect(await lookup(next)).toMatchObject({ status: "paid", tickets: [{ ticketTypeName: "VIP" }] });
    expect(await lookup(next)).not.toHaveProperty("refundReason");
  });

  it("releases inventory exactly once, however often Stripe redelivers", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const kept = await paidOrder([{ ticketTypeId: "ga", quantity: 3 }], "pi_kept");
    const refunded = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }], "pi_refunded");
    expect(await sold()).toEqual({ ga: 5, vip: 0 });

    for (let i = 0; i < 3; i++) await refund("pi_refunded", 6340, true);

    // Another order's 3 tickets still count: a second release would have taken it to 1.
    expect(await sold()).toEqual({ ga: 3, vip: 0 });
    expect(await internal(refunded)).toMatchObject({ status: "refunded", amount_refunded_cents: 6340 });
    expect(await internal(kept)).toMatchObject({ status: "paid", amount_refunded_cents: 0 });
    expect((await lookup(kept)).tickets).toHaveLength(3);
  });

  it("accepts an expanded payment intent object", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], "pi_expanded");
    await refund({ id: "pi_expanded", object: "payment_intent" }, 3170, true);
    expect(await internal(orderId)).toMatchObject({ status: "refunded" });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
  });

  it("stops a ticket email that hasn't gone out yet", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], "pi_email");
    await refund("pi_email", 3170, true);
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();
    const [job] = await api.db.query(`select status from private.email_outbox where order_id = $1`, [orderId]);
    expect(job).toEqual({ status: "failed" });
  });

  it("logs the order by its short reference only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], "pi_log");
    await refund("pi_log", 3170, true);
    const logged = info.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain(orderReference(orderId));
    expect(logged).not.toContain(orderId);
    expect(logged).not.toContain("buyer@example.com");
  });
});

describe("partial refund (refunded: false)", () => {
  it("records the amount; the order stays paid and its tickets stay valid", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }], "pi_part");

    await refund("pi_part", 3170, false);

    expect(await internal(orderId)).toEqual({ status: "paid", amount_refunded_cents: 3170, tickets: 2 });
    expect(await sold()).toEqual({ ga: 2, vip: 0 });
    const page = await lookup(orderId);
    expect(page.status).toBe("paid");
    expect(page.tickets).toHaveLength(2);
    // Nothing about the refund reaches the buyer's page.
    expect(page).not.toHaveProperty("refundReason");
    expect(JSON.stringify(page)).not.toContain("3170");

    // Logged once, for manual follow-up, by reference only.
    expect(error).toHaveBeenCalledTimes(1);
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain(orderReference(orderId));
    expect(logged).not.toContain(orderId);
    expect(logged).not.toContain("buyer@example.com");
  });

  it("is idempotent, never lowers the amount, and a later full refund still voids the order", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }], "pi_steps");

    await refund("pi_steps", 3170, false);
    await refund("pi_steps", 3170, false); // redelivered
    await refund("pi_steps", 1000, false); // an older delivery arriving late
    expect(await internal(orderId)).toMatchObject({ status: "paid", amount_refunded_cents: 3170 });
    expect(error).toHaveBeenCalledTimes(1);

    await refund("pi_steps", 4000, false);
    expect(await internal(orderId)).toMatchObject({ status: "paid", amount_refunded_cents: 4000 });
    expect(error).toHaveBeenCalledTimes(2);

    // The rest refunded: Stripe now says the charge is fully refunded.
    await refund("pi_steps", 6340, true);
    expect(await internal(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: 6340 });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
  });
});

describe("orders a refund doesn't change", () => {
  it("leaves pending and failed orders alone, even with a payment intent on record", async () => {
    const pending = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    const failed = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [failed]);
    await api.db.query(`update public.orders set stripe_payment_intent_id = 'pi_' || right(id, 8) where id = any($1)`, [
      [pending, failed],
    ]);

    for (const orderId of [pending, failed]) {
      await refund(`pi_${orderId.slice(-8)}`, 3170, true);
      await refund(`pi_${orderId.slice(-8)}`, 100, false);
    }
    expect(await internal(pending)).toEqual({ status: "pending", amount_refunded_cents: 0, tickets: 0 });
    expect(await internal(failed)).toEqual({ status: "failed", amount_refunded_cents: 0, tickets: 0 });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
  });

  it("free orders have no payment intent, so no refund can reach them", async () => {
    const free = await insertOrder(api, event, "fan@example.com", "paid");
    await refund("pi_anything", 0, true);
    expect(await internal(free)).toMatchObject({ status: "paid", amount_refunded_cents: 0 });
  });

  it("an unknown payment intent, or a charge without one, is acknowledged and changes nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], "pi_ours");

    await refund("pi_not_ours", 3170, true);
    await refund(null, 3170, true);
    const empty = await api.send(stripeWebhook, stripeWebhookRequest({ type: "charge.refunded", data: { object: {} } }));
    expect({ status: empty.status, body: empty.body }).toEqual({ status: 200, body: { received: true } });
    // Nonsense amounts never reach the database.
    await refund("pi_ours", -1, true);
    await refund("pi_ours", 1.5, true);
    await refund("pi_ours", 2 ** 31, true);

    expect(await internal(orderId)).toEqual({ status: "paid", amount_refunded_cents: 0, tickets: 1 });
    expect(await sold()).toEqual({ ga: 1, vip: 0 });
    expect(warn).toHaveBeenCalled();
    // Logged by Stripe's event id, never anything about a buyer or the payment.
    const logged = warn.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain("pi_");
    expect(logged).not.toContain(orderId);
  });
});

describe("refund.updated / refund.failed for a refund made outside Sheltüh (no metadata.orderId)", () => {
  function refundEvent(type: "refund.updated" | "refund.failed", status: string, paymentIntent: unknown) {
    return stripeWebhookRequest({
      type,
      data: { object: { id: "re_dash", object: "refund", status, payment_intent: paymentIntent, metadata: {} } },
    });
  }

  it("a failed dashboard refund of a voided order is logged as an error by event id and short reference, and changes nothing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], "pi_dash");
    await refund("pi_dash", 3170, true);
    const before = await internal(orderId);

    for (const type of ["refund.failed", "refund.updated"] as const) {
      const res = await api.send(stripeWebhook, refundEvent(type, "failed", "pi_dash"));
      expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { received: true } });
    }
    expect(error).toHaveBeenCalledTimes(2);
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("evt_test");
    expect(logged).toContain(orderReference(orderId));
    expect(logged).toContain("failed");
    expect(logged).not.toContain(orderId);
    expect(logged).not.toContain("pi_dash");
    expect(logged).not.toContain("buyer@example.com");
    // Recorded state is untouched (charge.refunded owns it): nothing is restored automatically.
    expect(await internal(orderId)).toEqual(before);
    // One payment exception for that refund, for a person (tests/server/payment-reconciliation.test.ts).
    const exceptions = await api.db.query(`select kind, status, refund_id from private.payment_exceptions`);
    expect(exceptions).toEqual([{ kind: "refund_not_completed", status: "open", refund_id: "re_dash" }]);
  });

  it("an expanded payment intent object resolves too; a canceled one is an error, a pending one only info", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], "pi_obj");
    await api.send(stripeWebhook, refundEvent("refund.updated", "canceled", { id: "pi_obj", object: "payment_intent" }));
    expect(error.mock.calls.flat().map(String).join("\n")).toContain(`order ${orderReference(orderId)} (made outside Sheltüh) has status canceled`);

    info.mockClear();
    await api.send(stripeWebhook, refundEvent("refund.updated", "pending", "pi_obj"));
    expect(info.mock.calls.flat().map(String).join("\n")).toContain(`order ${orderReference(orderId)} (made outside Sheltüh) has status pending`);
    expect(await internal(orderId)).toMatchObject({ status: "paid", amount_refunded_cents: 0 });
  });

  it("a payment with no order on record (or none at all) is acknowledged and logged by event id only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const paymentIntent of ["pi_not_ours", null]) {
      const res = await api.send(stripeWebhook, refundEvent("refund.failed", "failed", paymentIntent));
      expect(res.status).toBe(200);
    }
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("Stripe evt_test: a refund of a payment with no order on record (made outside Sheltüh) has status failed");
    expect(logged).not.toContain("pi_");
  });
});

describe("the oversold refund path is unchanged", () => {
  async function oversold(refundStatus: "succeeded" | "pending") {
    // The single VIP goes to whoever pays first; the second payment is refunded by the webhook.
    const first = await checkout([{ ticketTypeId: "vip", quantity: 1 }]);
    const second = await checkout([
      { ticketTypeId: "ga", quantity: 1 },
      { ticketTypeId: "vip", quantity: 1 },
    ]);
    await api.send(stripeWebhook, completed(first, "pi_first"));
    api.stripe.refunds.create.mockResolvedValueOnce({ id: "re_auto", status: refundStatus });
    await api.send(stripeWebhook, completed(second, "pi_second"));
    return { first, second };
  }

  it("Stripe's charge.refunded for our own automatic refund changes nothing, and inventory isn't released twice", async () => {
    const { first, second } = await oversold("succeeded");
    expect(await internal(second)).toEqual({ status: "refunded", amount_refunded_cents: 0, tickets: 0 });
    expect(await sold()).toEqual({ ga: 0, vip: 1 });

    await refund("pi_second", 3170 + 8000, true);

    expect(await internal(second)).toEqual({ status: "refunded", amount_refunded_cents: 0, tickets: 0 });
    expect(await internal(first)).toMatchObject({ status: "paid" });
    expect(await sold()).toEqual({ ga: 0, vip: 1 });
    // The buyer's page says no tickets were ever issued.
    expect(await lookup(second)).toMatchObject({ status: "refunded", refundReason: "oversold", tickets: [] });
  });

  it("a pending automatic refund is still settled by refund.updated, not charge.refunded", async () => {
    const { second } = await oversold("pending");
    expect(await lookup(second)).toMatchObject({ status: "oversold_refund_required", refundReason: "oversold" });

    await refund("pi_second", 3170 + 8000, true);
    expect((await internal(second)).status).toBe("oversold_refund_required");

    await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "refund.updated",
        data: { object: { id: "re_auto", object: "refund", status: "succeeded", payment_intent: "pi_second", metadata: { orderId: second } } },
      }),
    );
    expect(await internal(second)).toEqual({ status: "refunded", amount_refunded_cents: 0, tickets: 0 });
    expect(await sold()).toEqual({ ga: 0, vip: 1 });
  });
});

describe("record_payment_refund guards", () => {
  it("refuses a negative amount or a missing flag outright", async () => {
    await expect(api.db.query(`select * from private.record_payment_refund('pi_x', -1, true)`)).rejects.toMatchObject({
      code: "22023",
    });
    await expect(api.db.query(`select * from private.record_payment_refund('pi_x', 1, null)`)).rejects.toMatchObject({
      code: "22023",
    });
  });

  it("the database refuses a negative recorded amount", async () => {
    const orderId = await insertOrder(api, event, "fan@example.com", "paid");
    await expect(
      api.db.query(`update public.orders set amount_refunded_cents = -1 where id = $1`, [orderId]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

// Two sessions at once: only a real server (PGlite is one connection). Run
// with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrency (real Postgres only)", () => {
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
    conn.unsafe(`select result from private.record_payment_refund($1, $2, $3)`, [paymentIntent, amount, full]);

  let codes = 0;
  const fulfil = (conn: postgres.Sql, orderId: string, paymentIntent: string, lines: { id: string; n: number }[]) =>
    conn.unsafe(`select private.fulfil_order($1, 'buyer@example.com', $2, $3::text::jsonb)::text as status`, [
      orderId,
      paymentIntent,
      JSON.stringify(
        lines.flatMap(({ id, n }) =>
          Array.from({ length: n }, () => ({ ticketCode: `CC${String(codes++).padStart(2, "0")}-CCCC`, ticketTypeId: id, ticketTypeName: id })),
        ),
      ),
    ]);

  it("two deliveries of one full refund at once: the second waits, then changes nothing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await paidOrder([{ ticketTypeId: "ga", quantity: 3 }], "pi_kept");
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }], "pi_twice");
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await recordRefund(one, "pi_twice", 6340, true))[0].result).toBe("refunded");
      const blocked = await waitUntilBlocked(two);
      const pending = recordRefund(two, "pi_twice", 6340, true).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("unchanged");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await internal(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: 6340 });
    expect(await sold()).toEqual({ ga: 3, vip: 0 });
  });

  it("a refund holding the ticket types: another order's fulfilment waits, then gets the released VIP", async () => {
    const both = [
      { ticketTypeId: "ga", quantity: 1 },
      { ticketTypeId: "vip", quantity: 1 },
    ];
    const refunded = await checkout(both);
    // Wants the only VIP, which order A holds until its refund commits.
    const waiting = await checkout(both);
    await api.send(stripeWebhook, completed(refunded, "pi_a"));
    expect(await sold()).toEqual({ ga: 1, vip: 1 });
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await recordRefund(one, "pi_a", 11170, true))[0].result).toBe("refunded");
      const blocked = await waitUntilBlocked(two);
      const pending = fulfil(two, waiting, "pi_b", [
        { id: "ga", n: 1 },
        { id: "vip", n: 1 },
      ]).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].status).toBe("paid");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await internal(refunded)).toMatchObject({ status: "refunded" });
    expect(await internal(waiting)).toMatchObject({ status: "paid", tickets: 2 });
    expect(await sold()).toEqual({ ga: 1, vip: 1 });
  });

  it("a fulfilment holding the ticket types: the refund waits, then releases exactly its own", async () => {
    const refunded = await paidOrder(
      [
        { ticketTypeId: "ga", quantity: 2 },
        { ticketTypeId: "vip", quantity: 1 },
      ],
      "pi_a",
    );
    const other = await checkout([{ ticketTypeId: "ga", quantity: 4 }]);
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await fulfil(one, other, "pi_b", [{ id: "ga", n: 4 }]))[0].status).toBe("paid");
      const blocked = await waitUntilBlocked(two);
      const pending = recordRefund(two, "pi_a", 14340, true).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("refunded");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await internal(refunded)).toMatchObject({ status: "refunded" });
    expect(await internal(other)).toMatchObject({ status: "paid", tickets: 4 });
    expect(await sold()).toEqual({ ga: 4, vip: 0 });
  });

  it("a refund delivered while its own order's fulfilment is uncommitted waits for it, then voids the order", async () => {
    // This was an accepted limit: fulfil_order records the payment intent, so a
    // refund processed before that committed found no order, was dropped, and
    // the order ended up paid with valid tickets. The expectation changes on
    // purpose (payment audit item 1, 20261109000200_payment_reconciliation.sql):
    // both functions now take the payment intent's advisory lock first, so the
    // refund waits for the fulfilment to commit, then finds the paid order and
    // voids it (inventory released). The 3-argument form (the previous app
    // version's, during the deploy window) delegates to the new one, lock included.
    vi.spyOn(console, "info").mockImplementation(() => {});
    const orderId = await checkout([{ ticketTypeId: "ga", quantity: 1 }]);
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await fulfil(one, orderId, "pi_same", [{ id: "ga", n: 1 }]))[0].status).toBe("paid");
      const blocked = await waitUntilBlocked(two);
      const pending = recordRefund(two, "pi_same", 3170, true).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("refunded");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await internal(orderId)).toMatchObject({ status: "refunded", amount_refunded_cents: 3170, tickets: 1 });
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
    // A redelivery changes nothing more.
    expect((await api.db.query<{ result: string }>(`select result from private.record_payment_refund('pi_same', 3170, true)`))[0].result).toBe(
      "unchanged",
    );
    expect(await sold()).toEqual({ ga: 0, vip: 0 });
  });
});
