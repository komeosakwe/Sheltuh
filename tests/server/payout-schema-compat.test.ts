import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import { adminSummary } from "@/lib/server/handlers/admin";
import { payoutsSchemaMissing, resetPayoutSchemaWarning } from "@/lib/server/payout-schema";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, sessionAmount, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// The new app on the old schema: the app is deployed before
// 20261119000000_delayed_payouts.sql is applied (the documented order is the
// reverse, but a deploy window or a rollback of the database can produce it).
// Paid checkouts and refunds must work as they did before the feature, with
// the switch off or on, and the admin summary must not fail. The old schema is
// the real one with what that migration added taken away again.

let api: TestApi;
let event: EventRecord;
let warn: MockInstance;
let seq = 0;

beforeAll(async () => {
  const testDb = await createTestDb();
  api = new TestApi(testDb.db);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const admin = await signUpAdmin(api);
  const organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, {
    ticketTypes: [{ id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 500 }],
  });
  await enablePayouts(api, organiser.organiserId);
  // Back to the schema before the migration.
  await api.db.query(`drop table private.order_transfers`);
  await api.db.query(`alter table public.orders drop column payout_method cascade`);
  await api.db.query(`drop function private.flag_transfer_after_refund(text, text)`);
  vi.restoreAllMocks();
  adminToken = admin.token;
});

let adminToken: string;

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetPayoutSchemaWarning();
  api.stripe.checkout.sessions.create.mockReset();
  api.stripe.checkout.sessions.create.mockImplementation(async () => embeddedSession(`cs_old_${++seq}`));
  api.stripe.refunds.create.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function checkout(): Promise<string> {
  const res = await api.call(createCheckout, {
    params: { eventId: event.eventId },
    body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] },
  });
  expect(res.status).toBe(201);
  return res.body.orderId as string;
}

async function pay(orderId: string, pi: string) {
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
  expect(res.status).toBe(200);
}

function chargeRefunded(pi: string, amount: number, refunded: boolean, extra: Record<string, unknown> = {}) {
  return stripeWebhookRequest({
    id: `evt_refund_${pi}`,
    type: "charge.refunded",
    data: { object: { id: `ch_${pi}`, object: "charge", payment_intent: pi, amount_refunded: amount, refunded, ...extra } },
  });
}

const orderStatus = async (orderId: string) =>
  (await api.db.query<{ status: string }>(`select status::text as status from public.orders where id = $1`, [orderId]))[0].status;

describe("the old schema really lacks the migration", () => {
  it("has no payout_method column, transfer table or flag function", async () => {
    await expect(api.db.query(`select payout_method from public.orders limit 1`)).rejects.toThrow(/payout_method/);
    await expect(api.db.query(`select 1 from private.order_transfers`)).rejects.toThrow(/order_transfers/);
    await expect(api.db.query(`select * from private.flag_transfer_after_refund('pi_x', null)`)).rejects.toThrow(/flag_transfer_after_refund/);
  });
});

describe.each([
  ["DELAYED_PAYOUTS off", false],
  ["DELAYED_PAYOUTS on", true],
])("the new app on the old schema, %s", (_name, switchOn) => {
  beforeEach(() => {
    api.delayedPayouts = switchOn;
  });

  it("a paid checkout works and is a destination charge, exactly as before the feature", async () => {
    const orderId = await checkout();
    const [params] = api.stripe.checkout.sessions.create.mock.calls[0];
    expect(params.payment_intent_data).toEqual({
      application_fee_amount: expect.any(Number),
      transfer_data: { destination: "acct_test_1" },
    });
    expect(await orderStatus(orderId)).toBe("pending");
    await pay(orderId, `pi_old_${++seq}`);
    expect(await orderStatus(orderId)).toBe("paid");
  });

  it("a refund made in Stripe is recorded: the order is voided, and nothing needs the missing function", async () => {
    const orderId = await checkout();
    const total = (await sessionAmount(api.db, orderId)).amount_total as number;
    const pi = `pi_old_${++seq}`;
    await pay(orderId, pi);
    const res = await api.send(stripeWebhook, chargeRefunded(pi, total, true, { transfer_data: { amount: null, destination: "acct_test_1" } }));
    expect(res.status).toBe(200);
    expect(await orderStatus(orderId)).toBe("refunded");
  });

  it("a partial refund is recorded too (the order stays paid)", async () => {
    const orderId = await checkout();
    const pi = `pi_old_${++seq}`;
    await pay(orderId, pi);
    const res = await api.send(stripeWebhook, chargeRefunded(pi, 100, false, { transfer_data: { amount: null, destination: "acct_test_1" } }));
    expect(res.status).toBe(200);
    expect(await orderStatus(orderId)).toBe("paid");
  });

  it("the automatic refund of a payment for a failed order still reverses the transfer and refunds the fee", async () => {
    const orderId = await checkout();
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [orderId]);
    await pay(orderId, `pi_old_${++seq}`);
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(api.stripe.refunds.create.mock.calls[0][0]).toMatchObject({ reverse_transfer: true, refund_application_fee: true });
  });

  it("a refund for a payment that isn't recorded and isn't a destination charge is dropped as not ours (200)", async () => {
    const res = await api.send(
      stripeWebhook,
      chargeRefunded(`pi_unknown_${++seq}`, 500, true, { metadata: { orderId: "ord_00000000000000000000000000000000" } }),
    );
    expect(res.status).toBe(200);
  });

  it("the admin summary answers, with no open transfers", async () => {
    const res = await api.call(adminSummary, { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.body.transfersOpen).toEqual({ count: 0 });
  });

  it("says so once in the log", async () => {
    await checkout();
    await checkout();
    const said = warn.mock.calls.filter(([message]) => String(message).includes("isn't applied"));
    expect(said).toHaveLength(1);
    expect(String(said[0][0])).toContain("20261119000000_delayed_payouts.sql");
  });
});

describe("payoutsSchemaMissing", () => {
  it("is true only for an undefined column, function or table error while the migration is really missing", async () => {
    for (const code of ["42703", "42883", "42P01"]) {
      expect(await payoutsSchemaMissing(api.db, Object.assign(new Error("x"), { code }))).toBe(true);
    }
    for (const code of ["23505", "57014", undefined]) {
      expect(await payoutsSchemaMissing(api.db, Object.assign(new Error("x"), { code }))).toBe(false);
    }
    expect(await payoutsSchemaMissing(api.db, "not an error")).toBe(false);
  });

  it("is false when the catalogue can't be read: the original error is the one to throw", async () => {
    const broken = { query: vi.fn().mockRejectedValue(new Error("down")) };
    expect(await payoutsSchemaMissing(broken, Object.assign(new Error("x"), { code: "42703" }))).toBe(false);
  });
});
