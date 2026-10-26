import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pgConstraint, pgErrorCode, type Db } from "@/lib/server/db";
import { EVENT_ENDED } from "@/lib/server/handlers/event-queries";
import { confirmFreeOrder } from "@/lib/server/handlers/free-orders";
import { createCheckout, getOrderBySession, stripeWebhook } from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, sessionAmount, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent, seatStates } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// No new orders or seat holds once an event has ended, at every entry point,
// in the API and in the database (orders_not_ended, private.confirm_free_order:
// supabase/migrations/20261103000100_refuse_ended_event_orders.sql). A payment
// for an order made before the end is still fulfilled.

let db: Db;
let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

const PAID = [{ id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 5 }];
const FREE = [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }];
const FREE_SEATS = [{ id: "free", name: "Free seat", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 4 }];

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  db = testDb.db;
});

beforeEach(async () => {
  await reset();
  api = new TestApi(db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  await enablePayouts(api, organiser.organiserId);
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    n += 1;
    return embeddedSession(`cs_test_${n}`);
  });
});

const END_SQL = `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 second' where id = $1`;

/** The event ended a second ago. */
async function endEvent(eventId: string) {
  await db.query(END_SQL, [eventId]);
}

/** The event ends in a minute: still on sale. */
async function endSoon(eventId: string) {
  await db.query(
    `update public.events set starts_at = now() - interval '3 hours', ends_at = now() + interval '1 minute' where id = $1`,
    [eventId],
  );
}

/**
 * An API whose database ends the event just before the statement matching
 * `pattern` runs: the event was read as on sale, then ended before its order
 * was written (a race the early check can't see).
 */
function apiEndingBefore(pattern: RegExp, eventId: string): TestApi {
  const racing: Db = {
    async query<T>(text: string, params?: unknown[]) {
      if (pattern.test(text)) await db.query(END_SQL, [eventId]);
      return db.query<T>(text, params);
    },
  };
  const raced = new TestApi(racing);
  raced.stripe.checkout.sessions.create.mockImplementation(api.stripe.checkout.sessions.create);
  return raced;
}

async function orders(eventId: string) {
  return db.query<{ id: string; status: string; tickets: number }>(
    `select o.id, o.status::text as status, (select count(*)::int from public.tickets t where t.order_id = o.id) as tickets
       from public.orders o where o.event_id = $1 order by o.created_at, o.id`,
    [eventId],
  );
}

async function sold(eventId: string) {
  const rows = await db.query<{ id: string; quantity_sold: number }>(
    `select id, quantity_sold from public.ticket_types where event_id = $1 order by id`,
    [eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.quantity_sold]));
}

async function completed(orderId: string) {
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        client_reference_id: orderId,
        ...(await sessionAmount(api.db, orderId)),
        payment_status: "paid",
        payment_intent: `pi_${orderId}`,
        customer_details: { email: "buyer@example.com" },
      },
    },
  });
}

function tokenFromEmail(): string {
  const match = api.sendEmail.mock.calls.at(-1)![0].text.match(/\/checkout\/confirm#token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("no confirmation link in the email");
  return match[1];
}

const checkout = (event: EventRecord, body: Record<string, unknown>, token?: string, client = api) =>
  client.call(createCheckout, { token, params: { eventId: event.eventId }, body });

const ended = (res: { status: number; body: { error?: string } }) => [res.status, res.body.error];

describe("paid general admission checkout", () => {
  it("refuses an ended event: 409, no order, Stripe never called", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID });
    await endEvent(event.eventId);
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] });
    expect(ended(res)).toEqual([409, EVENT_ENDED]);
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await orders(event.eventId)).toEqual([]);
  });

  it("still sells a minute before the end", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID });
    await endSoon(event.eventId);
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(await orders(event.eventId)).toEqual([{ id: res.body.orderId, status: "pending", tickets: 0 }]);
  });

  it("an event that ends between the early check and the order's insert: the database refuses it, 409", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID });
    const raced = apiEndingBefore(/^\s*insert into public\.orders/, event.eventId);
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] }, undefined, raced);
    expect(ended(res)).toEqual([409, EVENT_ENDED]);
    expect(raced.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await orders(event.eventId)).toEqual([]);
  });

  it("a payment confirmed after the end, for an order made before it, is still fulfilled", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID });
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "ga", quantity: 2 }] });
    expect(res.status).toBe(201);
    await endEvent(event.eventId);

    expect((await api.send(stripeWebhook, completed(res.body.orderId))).status).toBe(200);
    expect(await orders(event.eventId)).toEqual([{ id: res.body.orderId, status: "paid", tickets: 2 }]);
    expect(await sold(event.eventId)).toEqual({ ga: 2 });
    // The buyer was charged and gets their tickets: nothing refunded.
    expect(api.stripe.refunds.create).not.toHaveBeenCalled();
    const order = await api.call(getOrderBySession, { params: { sessionId: res.body.orderId } });
    expect(order.body.status).toBe("paid");
    expect(order.body.tickets).toHaveLength(2);
  });
});

describe("free orders", () => {
  it("a member's own verified email: 409 for an ended event, nothing issued", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    const { token } = await api.signUp({ email: "fan@example.com" });
    await endEvent(event.eventId);
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "fan@example.com" }, token);
    expect(ended(res)).toEqual([409, EVENT_ENDED]);
    expect(await orders(event.eventId)).toEqual([]);
    expect(await sold(event.eventId)).toEqual({ rsvp: 0 });
  });

  it("a member's free order racing the end: place_free_order is refused by the database, 409, nothing kept", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    const raced = apiEndingBefore(/private\.place_free_order\(/, event.eventId);
    const { token } = await raced.signUp({ email: "fan@example.com" });
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "fan@example.com" }, token, raced);
    expect(ended(res)).toEqual([409, EVENT_ENDED]);
    expect(await orders(event.eventId)).toEqual([]);
    // The member's daily allowance hit was undone with the order.
    expect(await db.query(`select * from private.rate_limits where bucket = 'free_claims'`)).toEqual([]);
  });

  it("a member just before the end still gets their tickets", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    const { token } = await api.signUp({ email: "fan@example.com" });
    await endSoon(event.eventId);
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "fan@example.com" }, token);
    expect(res.status).toBe(201);
    expect(await sold(event.eventId)).toEqual({ rsvp: 1 });
  });

  it("a guest: 409 for an ended event, no link emailed, nothing recorded", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    await endEvent(event.eventId);
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" });
    expect(ended(res)).toEqual([409, EVENT_ENDED]);
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect(await orders(event.eventId)).toEqual([]);
    // The free-order caps' counters (the setup's submission takes an admin_review_emails_daily hit).
    expect(await db.query(`select * from private.platform_rate_limits where bucket like 'free\\_order\\_%'`)).toEqual([]);
  });

  it("a guest's request racing the end: request_free_order is refused by the database, 409, no cap used", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    const raced = apiEndingBefore(/private\.request_free_order\(/, event.eventId);
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" }, undefined, raced);
    expect(ended(res)).toEqual([409, EVENT_ENDED]);
    await raced.runDeferred();
    expect(raced.sendEmail).not.toHaveBeenCalled();
    expect(await orders(event.eventId)).toEqual([]);
    // The free-order caps' counters (the setup's submission takes an admin_review_emails_daily hit).
    expect(await db.query(`select * from private.platform_rate_limits where bucket like 'free\\_order\\_%'`)).toEqual([]);
  });

  it("a guest's link confirmed after the end issues nothing: 409, the order failed", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    expect((await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 2 }], buyerEmail: "guest@example.com" })).status).toBe(202);
    await api.runDeferred();
    const token = tokenFromEmail();
    await endEvent(event.eventId);

    const res = await api.call(confirmFreeOrder, { body: { token } });
    expect(ended(res)).toEqual([409, EVENT_ENDED]);
    expect((await orders(event.eventId)).map((o) => [o.status, o.tickets])).toEqual([["failed", 0]]);
    expect(await sold(event.eventId)).toEqual({ rsvp: 0 });
    // Only the confirmation link was ever emailed: no tickets.
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    // Clicking again changes nothing.
    expect((await api.call(confirmFreeOrder, { body: { token } })).status).toBe(409);
    expect(await sold(event.eventId)).toEqual({ rsvp: 0 });
  });

  it("a guest's link confirmed just before the end issues the tickets; clicked again after the end, the same answer", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" });
    await api.runDeferred();
    const token = tokenFromEmail();
    await endSoon(event.eventId);
    const first = await api.call(confirmFreeOrder, { body: { token } });
    expect(first.status).toBe(200);
    expect(await sold(event.eventId)).toEqual({ rsvp: 1 });

    await endEvent(event.eventId);
    const again = await api.call(confirmFreeOrder, { body: { token } });
    expect([again.status, again.body.url]).toEqual([200, first.body.url]);
    expect((await orders(event.eventId)).map((o) => [o.status, o.tickets])).toEqual([["paid", 1]]);
  });

  it("confirm_free_order itself refuses an ended event, whoever calls it", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" });
    await api.runDeferred();
    const tokenHash = (await db.query<{ h: string }>(`select confirmation_token_hash as h from public.orders`))[0].h;
    await endEvent(event.eventId);
    const [row] = await db.query(`select * from private.confirm_free_order($1, $2::text::jsonb, 4)`, [
      tokenHash,
      JSON.stringify([{ ticketCode: "AAAA-BBBB", ticketTypeId: "rsvp", ticketTypeName: "RSVP" }]),
    ]);
    expect(row).toEqual({ result: "ended", confirmed_order_id: null });
    expect(await sold(event.eventId)).toEqual({ rsvp: 0 });
  });
});

describe("reserved seating", () => {
  it("a paid seated checkout for an ended event: 409, no order, no hold, no hold attempt counted", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    await endEvent(event.eventId);
    const res = await checkout(event, { seats: { mapVersion: map.version, seatIds: ["A1"] } });
    expect(ended(res)).toEqual([409, EVENT_ENDED]);
    expect((await seatStates(api, event.eventId)).A1).toBe("free");
    expect(await orders(event.eventId)).toEqual([]);
    expect(await db.query(`select * from private.event_rate_limits`)).toEqual([]);
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a hold racing the end: hold_seats is refused by the database, 409, nothing held", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const raced = apiEndingBefore(/private\.hold_seats\(/, event.eventId);
    const res = await checkout(event, { seats: { mapVersion: map.version, seatIds: ["A1"] } }, undefined, raced);
    expect(ended(res)).toEqual([409, EVENT_ENDED]);
    expect((await seatStates(api, event.eventId)).A1).toBe("free");
    expect(await orders(event.eventId)).toEqual([]);
    expect(await db.query(`select * from private.event_rate_limits`)).toEqual([]);
    expect(raced.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("holds seats a minute before the end, and a payment confirmed after the end still gets them", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    await endSoon(event.eventId);
    const res = await checkout(event, { seats: { mapVersion: map.version, seatIds: ["A1"] } });
    expect(res.status).toBe(201);
    expect((await seatStates(api, event.eventId)).A1).toBe(`held:${res.body.orderId}`);

    await endEvent(event.eventId);
    expect((await api.send(stripeWebhook, completed(res.body.orderId))).status).toBe(200);
    expect(await orders(event.eventId)).toEqual([{ id: res.body.orderId, status: "paid", tickets: 1 }]);
    expect((await seatStates(api, event.eventId)).A1).toBe(`sold:${res.body.orderId}`);
    expect(api.stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("free seats: a member's and a guest's booking for an ended event are 409, nothing taken", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin, { tiers: FREE_SEATS, rows: [{ label: "A", tier: "free", seats: 4 }] });
    const { token } = await api.signUp({ email: "fan@example.com" });
    await endEvent(event.eventId);
    const seats = { mapVersion: map.version, seatIds: ["A1"] };
    expect(ended(await checkout(event, { seats, buyerEmail: "fan@example.com" }, token))).toEqual([409, EVENT_ENDED]);
    expect(ended(await checkout(event, { seats, buyerEmail: "guest@example.com" }))).toEqual([409, EVENT_ENDED]);
    expect((await seatStates(api, event.eventId)).A1).toBe("free");
    expect(await orders(event.eventId)).toEqual([]);
  });

  it("a guest's free seats confirmed after the end: 409, the seat stays free", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin, { tiers: FREE_SEATS, rows: [{ label: "A", tier: "free", seats: 4 }] });
    const res = await checkout(event, { seats: { mapVersion: map.version, seatIds: ["A1"] }, buyerEmail: "guest@example.com" });
    expect(res.status).toBe(202);
    await api.runDeferred();
    const token = tokenFromEmail();
    await endEvent(event.eventId);
    expect(ended(await api.call(confirmFreeOrder, { body: { token } }))).toEqual([409, EVENT_ENDED]);
    expect((await seatStates(api, event.eventId)).A1).toBe("free");
    expect((await orders(event.eventId)).map((o) => o.status)).toEqual(["failed"]);
  });
});

describe("the database, whoever the caller", () => {
  it("refuses any new order for an ended event (orders_not_ended); orders made before the end are untouched", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID });
    const insert = (id: string) =>
      db.query(
        `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents, buyer_fee_cents,
           total_cents, application_fee_cents) values ($1, $2, $3, 'x', '[]'::jsonb, 0, 0, 0, 0)`,
        [id, event.eventId, event.organiserId],
      );
    await insert(`ord_${"a".repeat(32)}`);
    await endEvent(event.eventId);
    const refused = await insert(`ord_${"b".repeat(32)}`).then(
      () => undefined,
      (err: unknown) => ({ code: pgErrorCode(err), constraint: pgConstraint(err) }),
    );
    expect(refused).toEqual({ code: "23514", constraint: "orders_not_ended" });
    expect((await orders(event.eventId)).map((o) => o.id)).toEqual([`ord_${"a".repeat(32)}`]);
    // The existing order can still change (e.g. be paid or fail).
    await db.query(`update public.orders set status = 'failed' where event_id = $1`, [event.eventId]);
  });
});
