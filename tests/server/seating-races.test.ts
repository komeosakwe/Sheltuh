import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent, seatStates } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// Reserved seating under real concurrency (docs/SEATING_PLAN.md: "Real-Postgres
// race tests are required"). PGlite is one connection, so these run only with
// TEST_DATABASE_URL (CLAUDE.md, "Quality gates"); the API's postgres.js pool
// runs up to 5 requests at once.

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
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async (params: { client_reference_id: string }) => {
    n += 1;
    return { id: `cs_race_${n}_${params.client_reference_id}`, url: `https://checkout.stripe.test/${n}` };
  });
});

const TIERS = [
  { id: "prem", name: "Premium", priceCents: 5000, feePolicy: "buyer-pays", quantityAvailable: 1 },
  { id: "free", name: "Free seat", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 1 },
];

async function bigEvent(): Promise<EventRecord> {
  const { event } = await seatedEvent(api, organiser, admin, {
    tiers: TIERS,
    rows: [
      { label: "A", tier: "prem", seats: 15 },
      { label: "B", tier: "prem", seats: 15 },
      { label: "F", tier: "free", seats: 4 },
    ],
  });
  return event;
}

const hold = (event: EventRecord, seatIds: string[], extra: Record<string, unknown> = {}, token?: string) =>
  api.call(createCheckout, {
    token,
    params: { eventId: event.eventId },
    body: { seats: { mapVersion: event.seating!.version, seatIds }, ...extra },
  });

function completed(orderId: string) {
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${orderId}`,
        object: "checkout.session",
        client_reference_id: orderId,
        payment_status: "paid",
        payment_intent: `pi_${orderId}`,
        customer_details: { email: "buyer@example.com" },
      },
    },
  });
}

function refunded(orderId: string) {
  return stripeWebhookRequest({
    type: "charge.refunded",
    data: { object: { id: "ch_1", object: "charge", payment_intent: `pi_${orderId}`, amount_refunded: 5250, refunded: true } },
  });
}

/** The order id of the last session created. */
const lastOrderId = () => api.stripe.checkout.sessions.create.mock.lastCall![0].client_reference_id as string;

/** No seat is held by an order that isn't pending, or sold to one that isn't paid. */
async function expectConsistent(eventId: string) {
  const bad = await api.db.query(
    `select s.id from public.event_seats s
       left join public.orders so on so.id = s.sold_order_id
       left join public.orders ho on ho.id = s.hold_order_id
      where s.event_id = $1
        and ((s.sold_order_id is not null and so.status <> 'paid')
          or (s.hold_order_id is not null and s.hold_expires_at > now() and ho.status <> 'pending'))`,
    [eventId],
  );
  expect(bad).toEqual([]);
  const sold = await api.db.query<{ tier: string; seats: number; sold: number }>(
    `select t.id as tier,
            (select count(*)::int from public.event_seats s where s.event_id = t.event_id and s.ticket_type_id = t.id and s.sold_order_id is not null) as seats,
            t.quantity_sold as sold
       from public.ticket_types t where t.event_id = $1 and t.seated`,
    [eventId],
  );
  for (const row of sold) expect(row.sold).toBe(row.seats);
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("seat races (real Postgres only)", () => {
  it("overlapping holds at once: exactly one buyer gets each seat", async () => {
    const event = await bigEvent();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => hold(event, ["A1", `B${i + 1}`])));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
    const states = await seatStates(api, event.eventId);
    const holders = Object.entries(states).filter(([, s]) => s.startsWith("held:"));
    expect(holders).toHaveLength(2);
    expect(new Set(holders.map(([, s]) => s)).size).toBe(1);
    await expectConsistent(event.eventId);
  });

  it("the same seats in opposite orders never deadlock", async () => {
    const event = await bigEvent();
    for (let round = 0; round < 6; round++) {
      const a = `A${round * 2 + 1}`;
      const b = `A${round * 2 + 2}`;
      const results = await Promise.all([hold(event, [a, b]), hold(event, [b, a]), hold(event, [b]), hold(event, [a])]);
      const statuses = results.map((r) => r.status);
      expect(statuses).not.toContain(500);
      expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
      expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(2);
    }
    await expectConsistent(event.eventId);
  });

  it("a lapsed hold's late payment against a new hold: exactly one owns the seat", async () => {
    const event = await bigEvent();
    for (let round = 1; round <= 5; round++) {
      const seat = `A${round}`;
      expect((await hold(event, [seat])).status).toBe(201);
      const first = lastOrderId();
      await api.db.query(`update public.event_seats set hold_expires_at = now() - interval '1 second' where hold_order_id = $1`, [first]);
      const [paid, second] = await Promise.all([api.send(stripeWebhook, completed(first)), hold(event, [seat])]);
      expect(paid.status).toBe(200);
      const [order] = await api.db.query<{ status: string }>(`select status::text as status from public.orders where id = $1`, [first]);
      const state = (await seatStates(api, event.eventId))[seat];
      if (second.status === 201) {
        expect(order.status).toBe("refunded");
        expect(state).toMatch(/^held:/);
      } else {
        expect(second.status).toBe(409);
        expect(order.status).toBe("paid");
        expect(state).toBe(`sold:${first}`);
      }
    }
    await expectConsistent(event.eventId);
  });

  it("a refund racing a hold on the same seat: the seat is never owned twice", async () => {
    const event = await bigEvent();
    for (let round = 1; round <= 5; round++) {
      const seat = `B${round}`;
      await hold(event, [seat]);
      const buyer = lastOrderId();
      await api.send(stripeWebhook, completed(buyer));
      const [refund, next] = await Promise.all([api.send(stripeWebhook, refunded(buyer)), hold(event, [seat])]);
      expect(refund.status).toBe(200);
      expect([201, 409]).toContain(next.status);
      const state = (await seatStates(api, event.eventId))[seat];
      expect(state).toBe(next.status === 201 ? `held:${lastOrderId()}` : "free");
    }
    await expectConsistent(event.eventId);
  });

  it("a free member's seats and a paid hold on the same seat at once: exactly one wins", async () => {
    const event = await bigEvent();
    const fan = await api.signUp({ email: "fan@example.com" });
    for (let round = 1; round <= 4; round++) {
      const seat = `F${round}`;
      const [free, paid] = await Promise.all([
        hold(event, [seat], { buyerEmail: "fan@example.com" }, fan.token),
        hold(event, [seat, `A${10 + round}`]),
      ]);
      expect([free.status, paid.status].sort()).toEqual([201, 409]);
    }
    await expectConsistent(event.eventId);
  });

  it("the held-seat cap is never exceeded, however many checkouts arrive at once", async () => {
    const event = await bigEvent();
    // 30 premium seats: the cap is the larger of 20 and 30% (9), so 20.
    const pairs = Array.from({ length: 15 }, (_, i) => (i < 8 ? [`A${i * 2 + 1}`, `A${i * 2 + 2}`] : [`B${(i - 8) * 2 + 1}`, `B${(i - 8) * 2 + 2}`]));
    const results = await Promise.all(pairs.map((seats) => hold(event, seats.filter((s) => s !== "A16"))));
    expect(results.map((r) => r.status)).not.toContain(500);
    const [{ held }] = await api.db.query<{ held: number }>(
      `select count(*)::int as held from public.event_seats where event_id = $1 and hold_order_id is not null and hold_expires_at > now()`,
      [event.eventId],
    );
    expect(held).toBeLessThanOrEqual(20);
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThan(0);
    await expectConsistent(event.eventId);
  });

  it("a flood of attempts refused at the hold cap, at once, uses none of the event's hold allowance", async () => {
    const event = await bigEvent();
    const hits = async () =>
      (
        await api.db.query<{ hits: number }>(
          `select hits from private.event_rate_limits where event_id = $1 and bucket = 'seat_holds'`,
          [event.eventId],
        )
      )[0]?.hits ?? 0;
    // 30 premium seats: the cap is 20. Two holds reach it.
    expect((await hold(event, ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"])).status).toBe(201);
    expect((await hold(event, ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10"])).status).toBe(201);
    expect(await hits()).toBe(2);
    // More refused attempts than the whole allowance (120 per 10 minutes), concurrently.
    const flood = await Promise.all(
      Array.from({ length: 150 }, (_, i) => hold(event, [i % 2 ? `A${11 + (i % 5)}` : `B${11 + (i % 5)}`])),
    );
    expect(new Set(flood.map((r) => `${r.status}:${r.body.code}`))).toEqual(new Set(["429:hold_cap"]));
    expect(await hits()).toBe(2);
    // A real buyer still gets in as soon as a hold lapses.
    await api.db.query(
      `update public.event_seats set hold_expires_at = now() - interval '1 second' where event_id = $1 and id = 'A1'`,
      [event.eventId],
    );
    expect((await hold(event, ["A11"])).status).toBe(201);
    expect(await hits()).toBe(3);
    await expectConsistent(event.eventId);
  });

  it("duplicate payment webhooks at once: the seats are sold and ticketed once", async () => {
    const event = await bigEvent();
    await hold(event, ["A1", "A2", "A3"]);
    const orderId = lastOrderId();
    const results = await Promise.all(Array.from({ length: 5 }, () => api.send(stripeWebhook, completed(orderId))));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const tickets = await api.db.query(`select seat_id from public.tickets where order_id = $1 order by seat_id`, [orderId]);
    expect(tickets).toEqual([{ seat_id: "A1" }, { seat_id: "A2" }, { seat_id: "A3" }]);
    await expectConsistent(event.eventId);
  });
});
