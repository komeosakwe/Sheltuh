import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgConstraint, pgErrorCode } from "@/lib/server/db";
import { adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { getEventAnalytics } from "@/lib/server/handlers/analytics";
import { checkInTicket, getCheckInSummary } from "@/lib/server/handlers/check-ins";
import { getMyEvent, updateEventDraft } from "@/lib/server/handlers/events";
import { createCheckout, getOrderBySession, getOrderPayment, stripeWebhook } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug } from "@/lib/server/handlers/public-events";
import { putSeatMap } from "@/lib/server/handlers/seating";
import { releaseTickets } from "@/lib/server/handlers/ticket-release";
import { getAppleWalletPass } from "@/lib/server/handlers/wallet";
import { findEventById } from "@/lib/server/handlers/event-queries";
import { ORDER_SELECT, toOrder } from "@/lib/server/records";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import { appleWalletConfigFromEnv, type AppleWalletConfig } from "@/lib/server/wallet/config";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, sessionAmount, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, eventInput, publishedEvent, setUpPayouts, signUpAdmin } from "./helpers/fixtures";
import { gridTemplate } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";
import { appleWalletEnv, readZip } from "./helpers/wallet";

// Group tickets: docs/architecture.md, "Group tickets";
// supabase/migrations/20261120000000_group_tickets.sql.

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

// A single A$35 ticket (buyer pays: 35 + 2.10 + 0.50 = A$37.60) and a "Group of 4" for A$120 (buyer pays: A$127.70).
const SINGLE = { id: "ga", name: "General admission", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 20 };
const GROUP = { id: "grp", name: "Group of 4", priceCents: 12000, feePolicy: "buyer-pays", quantityAvailable: 12, admits: 4 };
const GROUP_TOTAL = 12000 + 720 + 50;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  vi.stubEnv("NEXT_PUBLIC_GROUP_TICKETS", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: [SINGLE, GROUP] });
  await setUpPayouts(api, organiser.organiserId);
  let sessions = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => embeddedSession(`cs_group_${++sessions}`));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Line = { ticketTypeId: string; quantity: number };

const checkout = (lineItems: Line[], eventId = event.eventId) =>
  api.call(createCheckout, { params: { eventId }, body: { lineItems } });

/** A pending paid order, as checkout leaves it. */
async function pendingOrder(lineItems: Line[]) {
  const res = await checkout(lineItems);
  expect(res.status).toBe(201);
  return api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
}

async function pay(orderId: string, paymentIntent: string) {
  return api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${paymentIntent}`,
          object: "checkout.session",
          client_reference_id: orderId,
          ...(await sessionAmount(api.db, orderId)),
          payment_status: "paid",
          payment_intent: paymentIntent,
          customer_details: { email: "buyer@example.com" },
        },
      },
    }),
  );
}

async function paidOrder(lineItems: Line[], paymentIntent: string) {
  const orderId = await pendingOrder(lineItems);
  expect((await pay(orderId, paymentIntent)).status).toBe(200);
  expect((await orderRow(orderId)).status).toBe("paid");
  return orderId;
}

async function orderRow(orderId: string) {
  const [row] = await api.db.query<{ status: string; line_items: Record<string, unknown>[]; total_cents: number; application_fee_cents: number }>(
    `select status::text as status, line_items, total_cents, application_fee_cents from public.orders where id = $1`,
    [orderId],
  );
  return row;
}

async function tier(id: string) {
  const [row] = await api.db.query<{ sold: number; available: number; admits: number }>(
    `select quantity_sold as sold, quantity_available as available, admits
       from public.ticket_types where event_id = $1 and id = $2`,
    [event.eventId, id],
  );
  return row;
}

const ticketRows = (orderId: string) =>
  api.db.query<{ code: string; ticket_type_id: string; group_size: number | null }>(
    `select code, ticket_type_id, group_size from public.tickets where order_id = $1 order by ticket_type_id, code`,
    [orderId],
  );

function chargeRefunded(paymentIntent: string, amountRefunded: number, refunded: boolean) {
  return stripeWebhookRequest({
    type: "charge.refunded",
    data: { object: { id: "ch_group_1", object: "charge", payment_intent: paymentIntent, amount_refunded: amountRefunded, refunded } },
  });
}

/** What a refused write raises: the SQLSTATE and constraint name. */
async function refusedBy(sql: string, params: unknown[] = []) {
  try {
    await api.db.query(sql, params);
  } catch (err) {
    return { code: pgErrorCode(err), constraint: pgConstraint(err) };
  }
  return null;
}

describe("the table's constraints (whatever the API let through)", () => {
  const setAdmits = (admits: number, extra = "") =>
    refusedBy(`update public.ticket_types set admits = $1 ${extra} where event_id = $2 and id = 'ga'`, [admits, event.eventId]);

  it("admits is 1 to 10", async () => {
    expect(await setAdmits(0)).toMatchObject({ constraint: "ticket_types_admits_range" });
    expect(await refusedBy(`update public.ticket_types set admits = 11, quantity_available = 22 where event_id = $1 and id = 'ga'`, [event.eventId])).toMatchObject({
      constraint: "ticket_types_admits_range",
    });
  });

  it("quantity_available must be a multiple of admits", async () => {
    expect(await setAdmits(3)).toMatchObject({ code: "23514", constraint: "ticket_types_admits_multiple" });
    // 20 is a multiple of 4 and 5: fine.
    expect(await setAdmits(4)).toBeNull();
    expect(await refusedBy(`update public.ticket_types set quantity_available = 13 where event_id = $1 and id = 'grp'`, [event.eventId])).toMatchObject({
      constraint: "ticket_types_admits_multiple",
    });
  });

  it("a group ticket can't be free, and can't be a seated tier", async () => {
    expect(await refusedBy(`update public.ticket_types set price_cents = 0 where event_id = $1 and id = 'grp'`, [event.eventId])).toMatchObject({
      constraint: "ticket_types_group_paid",
    });
    expect(await refusedBy(`update public.ticket_types set seated = true where event_id = $1 and id = 'grp'`, [event.eventId])).toMatchObject({
      constraint: "ticket_types_admits_ga_only",
    });
  });

  it("a ticket's group_size is null or 2 to 10", async () => {
    const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], "pi_gs");
    expect(await refusedBy(`update public.tickets set group_size = 1 where order_id = $1`, [orderId])).toMatchObject({
      constraint: "tickets_group_size_range",
    });
  });

  it("admits can't change once the tier has sold tickets, or while the event has an order that can be paid", async () => {
    // A pending order with a Stripe session: it can still be paid (private.event_has_payable_orders).
    const pending = await pendingOrder([{ ticketTypeId: "ga", quantity: 1 }]);
    expect(await setAdmits(2)).toMatchObject({ code: "23514", constraint: "ticket_types_admits_frozen" });
    // Setting the value it already has is no change.
    expect(await refusedBy(`update public.ticket_types set admits = 1 where event_id = $1 and id = 'ga'`, [event.eventId])).toBeNull();
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [pending]);
    expect(await setAdmits(2)).toBeNull();
    expect(await setAdmits(1)).toBeNull();

    // Sold: frozen even with no order left that can be paid.
    await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], "pi_frozen");
    await api.db.query(`update public.orders set status = 'refunded'`);
    expect(await setAdmits(2)).toMatchObject({ constraint: "ticket_types_admits_frozen" });
  });
});

describe("saving group tickets through the API", () => {
  const draftUpdate = (draft: EventRecord, ticketTypes: unknown[], token = organiser.token) =>
    api.call(updateEventDraft, {
      token,
      params: { eventId: draft.eventId },
      method: "PATCH",
      body: eventInput({ ticketTypes }),
    });

  it("a group ticket reads back with admits (only above 1), in the organiser's and the public shapes", async () => {
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    const [single, group] = mine.body.ticketTypes;
    expect(single.admits).toBeUndefined();
    expect(group).toMatchObject({ id: "grp", admits: 4, quantityAvailable: 12 });

    const pub = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(pub.body.ticketTypes[0].admits).toBeUndefined();
    expect(pub.body.ticketTypes[1]).toMatchObject({ admits: 4, soldOut: false });
  });

  it("400s: not a whole number from 1 to 10, free, or a quantity that isn't a multiple", async () => {
    const draft = await draftEvent(api, organiser);
    const bad = async (patch: Record<string, unknown>) => {
      const res = await draftUpdate(draft, [{ ...GROUP, ...patch }]);
      expect(res.status).toBe(400);
      return res.body.fieldErrors as Record<string, string>;
    };
    for (const admits of [0, 11, 2.5, "4", null, -1]) {
      expect(await bad({ admits })).toHaveProperty(["ticketTypes[0].admits"]);
    }
    expect(await bad({ priceCents: 0 })).toHaveProperty(["ticketTypes[0].admits"]);
    expect(await bad({ quantityAvailable: 10 })).toEqual({
      "ticketTypes[0].quantityAvailable": "A ticket for 4 people needs a quantity that's a multiple of 4.",
    });
    // A free ticket for one person is still fine, and 1 is a single ticket.
    expect((await draftUpdate(draft, [{ ...GROUP, priceCents: 0, admits: 1, quantityAvailable: 5 }])).status).toBe(200);
  });

  it("absent admits keeps the stored one; admits 1 makes it a single ticket again (no sales yet)", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: [GROUP] });
    expect(draft.ticketTypes[0].admits).toBe(4);
    const withoutAdmits: Record<string, unknown> = { ...GROUP };
    delete withoutAdmits.admits;
    const kept = await draftUpdate(draft, [{ ...withoutAdmits, name: "Crew" }]);
    expect(kept.status).toBe(200);
    expect(kept.body.ticketTypes[0]).toMatchObject({ name: "Crew", admits: 4 });
    // A quantity that isn't a multiple of the stored admits is the database's check, as a 400.
    const odd = await draftUpdate(draft, [{ ...withoutAdmits, quantityAvailable: 10 }]);
    expect(odd.status).toBe(400);
    const single = await draftUpdate(draft, [{ ...GROUP, admits: 1, quantityAvailable: 10 }]);
    expect(single.status).toBe(200);
    expect(single.body.ticketTypes[0].admits).toBeUndefined();
  });

  it("is switched off by NEXT_PUBLIC_GROUP_TICKETS: new group tickets are a 400, one that exists is still editable", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: [GROUP] });
    vi.stubEnv("NEXT_PUBLIC_GROUP_TICKETS", "");
    const created = await api.call((await import("@/lib/server/handlers/events")).createEventDraft, {
      token: organiser.token,
      body: eventInput({ ticketTypes: [GROUP] }),
    });
    expect(created.status).toBe(400);
    expect(created.body.fieldErrors["ticketTypes[0].admits"]).toBe("Group tickets aren't available yet.");
    // The stored value, sent back, is allowed (the editor sends admits for every ticket); another one isn't.
    expect((await draftUpdate(draft, [{ ...GROUP, name: "Renamed" }])).status).toBe(200);
    const other = await draftUpdate(draft, [{ ...GROUP, admits: 2 }]);
    expect(other.status).toBe(400);
    // Singles are unaffected.
    expect((await draftUpdate(draft, [{ ...SINGLE, admits: 1 }])).status).toBe(200);
  });

  it("an admin's edit carries admits and logs it only when above 1; a sold tier's admits is a 409", async () => {
    const current = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    const asAdmin = (updatedAt: string, ticketTypes: unknown[]) =>
      api.call(adminUpdateEvent, {
        token: admin.token,
        params: { eventId: event.eventId },
        method: "PATCH",
        body: { ...eventInput({ ticketTypes }), ticketingMode: "sheltuh", expectedUpdatedAt: updatedAt },
      });
    const groupWithout: Record<string, unknown> = { ...GROUP };
    delete groupWithout.admits;
    // Absent: the same as stored: no change at all.
    const same = await asAdmin(current.body.updatedAt, [SINGLE, groupWithout]);
    expect(same.status).toBe(200);
    expect(same.body.moderationLog.filter((e: { action: string }) => e.action === "edited")).toHaveLength(0);

    // A sale freezes admits: 409, nothing changed.
    await paidOrder([{ ticketTypeId: "grp", quantity: 1 }], "pi_admin");
    const frozen = await asAdmin(same.body.updatedAt, [SINGLE, { ...GROUP, admits: 2 }]);
    expect(frozen.status).toBe(409);
    expect((await tier("grp")).admits).toBe(4);
  });
});

describe("a group ticket next to a seat map (version 1: not together)", () => {
  it("a seat map is refused for an event with a group ticket, and a group ticket for an event with a seat map", async () => {
    const draft = await draftEvent(api, organiser, {
      ticketTypes: [{ ...SINGLE, id: "std", quantityAvailable: 1 }, { ...GROUP, id: "g2" }],
    });
    const rows = [{ label: "A", tier: "std", seats: 3 }];
    const map = await api.call(putSeatMap, {
      token: organiser.token,
      params: { eventId: draft.eventId },
      method: "PUT",
      body: { template: gridTemplate(rows) },
    });
    expect(map.status).toBe(400);
    expect(map.body.fieldErrors.template).toContain("is a group ticket");

    // Without the group ticket the map is fine; then a group ticket is refused.
    const plain = await draftEvent(api, organiser, { ticketTypes: [{ ...SINGLE, id: "std", quantityAvailable: 1 }] });
    const ok = await api.call(putSeatMap, {
      token: organiser.token,
      params: { eventId: plain.eventId },
      method: "PUT",
      body: { template: gridTemplate(rows) },
    });
    expect(ok.status).toBe(200);
    const res = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId: plain.eventId },
      method: "PATCH",
      body: eventInput({ ticketTypes: [{ ...SINGLE, id: "std", quantityAvailable: 1 }, { ...GROUP, id: "g2" }] }),
    });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors["ticketTypes[1].admits"]).toBe("Group tickets can't be used on an event with a seat map.");
  });
});

describe("checkout", () => {
  it("prices a group per group, snapshots admits from the database, and tells Stripe what it admits", async () => {
    const res = await checkout([{ ticketTypeId: "grp", quantity: 2 }]);
    expect(res.status).toBe(201);
    const params = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0];
    const order = await orderRow(params.client_reference_id);
    expect(order.line_items).toEqual([
      { ticketTypeId: "grp", ticketTypeName: "Group of 4", unitPriceCents: 12000, feePolicy: "buyer-pays", quantity: 2, admits: 4 },
    ]);
    // The fee is per group, once: A$120 -> 6% + A$0.50.
    expect(order.total_cents).toBe(2 * GROUP_TOTAL);
    expect(order.application_fee_cents).toBe(2 * 770);
    expect(params.line_items[0]).toMatchObject({
      price_data: { unit_amount: 12000, product_data: { name: expect.stringContaining("Group of 4"), description: "Admits 4" } },
      quantity: 2,
    });
    expect(params.line_items[1]).toMatchObject({ price_data: { unit_amount: 770, product_data: { name: "Booking fee" } }, quantity: 2 });
    expect(params.line_items.reduce((n: number, i: { price_data: { unit_amount: number }; quantity: number }) => n + i.price_data.unit_amount * i.quantity, 0)).toBe(
      2 * GROUP_TOTAL,
    );
  });

  it("never trusts a client's admits, and a single ticket's line has none", async () => {
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "grp", quantity: 1, admits: 1, unitPriceCents: 1 }, { ticketTypeId: "ga", quantity: 1, admits: 9 }] },
    });
    expect(res.status).toBe(201);
    const order = await orderRow(api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id);
    expect(order.line_items.map((l) => l.admits)).toEqual([4, undefined]);
    expect(order.total_cents).toBe(GROUP_TOTAL + 3500 + 210 + 50);
  });

  it("caps a type at 20 people per order: 5 groups of 4, never 6; singles stay at 20", async () => {
    await api.db.query(`update public.ticket_types set quantity_available = 40 where event_id = $1 and id = 'grp'`, [event.eventId]);
    expect((await checkout([{ ticketTypeId: "grp", quantity: 6 }])).status).toBe(400);
    expect((await checkout([{ ticketTypeId: "grp", quantity: 5 }])).status).toBe(201);
    expect((await checkout([{ ticketTypeId: "ga", quantity: 20 }])).status).toBe(201);
    const over = await checkout([{ ticketTypeId: "ga", quantity: 21 }]);
    expect(over.status).toBe(400);
    expect(over.body.fieldErrors["lineItems[0].quantity"]).toBe("Quantity can't exceed 20 per order.");
  });

  it("says what's left in groups, and refuses more groups than people remain for", async () => {
    // 12 people = 3 groups. Two are bought, one group (4 people) is left.
    await paidOrder([{ ticketTypeId: "grp", quantity: 2 }], "pi_two");
    const more = await checkout([{ ticketTypeId: "grp", quantity: 2 }]);
    expect(more.status).toBe(409);
    expect(more.body.error).toBe('Only 1 of "Group of 4" left.');
    expect((await checkout([{ ticketTypeId: "grp", quantity: 1 }])).status).toBe(201);
    await paidOrder([{ ticketTypeId: "grp", quantity: 1 }], "pi_three");
    const gone = await checkout([{ ticketTypeId: "grp", quantity: 1 }]);
    expect(gone.status).toBe(409);
    expect(gone.body.error).toBe('"Group of 4" is sold out.');
  });

  it("the payment page says how many people each group admits", async () => {
    const orderId = await pendingOrder([{ ticketTypeId: "grp", quantity: 2 }, { ticketTypeId: "ga", quantity: 1 }]);
    api.stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_group_1",
      status: "open",
      client_secret: "cs_secret_test",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    });
    const res = await api.call(getOrderPayment, { params: { sessionId: orderId } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("open");
    expect(res.body.lines).toEqual([
      expect.objectContaining({ ticketTypeName: "Group of 4", quantity: 2, admits: 4, unitTotalCents: GROUP_TOTAL, lineTotalCents: 2 * GROUP_TOTAL }),
      expect.not.objectContaining({ admits: expect.anything() }),
    ]);
  });
});

describe("fulfilment: capacity in people, a ticket per person", () => {
  it("2 groups of 4 take 8 people, issue 8 tickets stamped with the group's size, and number the people", async () => {
    const orderId = await paidOrder([{ ticketTypeId: "grp", quantity: 2 }, { ticketTypeId: "ga", quantity: 1 }], "pi_fulfil");
    expect(await tier("grp")).toMatchObject({ sold: 8, available: 12 });
    expect(await tier("ga")).toMatchObject({ sold: 1 });
    const tickets = await ticketRows(orderId);
    expect(tickets.map((t) => [t.ticket_type_id, t.group_size])).toEqual([["ga", null], ...Array(8).fill(["grp", 4])]);

    const lookup = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(lookup.status).toBe(200);
    expect(lookup.body.tickets).toHaveLength(9);
    const groups = lookup.body.tickets.map((t: { group?: unknown }) => t.group);
    expect(groups).toEqual([undefined, ...[1, 2, 3, 4, 1, 2, 3, 4].map((position) => ({ position, size: 4 }))]);
    // The buyer's page carries `group`, and none of the columns it's worked out from.
    expect(JSON.stringify(lookup.body)).not.toMatch(/groupSize|ticketTypeId|group_size/);
    // Every person has their own code.
    expect(new Set(lookup.body.tickets.map((t: { ticketCode: string }) => t.ticketCode)).size).toBe(9);
  });

  it("the last group goes to whoever pays first; the other is refunded in full, as any oversold order", async () => {
    // 3 groups: 12 people. Two orders for 2 groups each can't both be fulfilled.
    const first = await pendingOrder([{ ticketTypeId: "grp", quantity: 2 }]);
    const second = await pendingOrder([{ ticketTypeId: "grp", quantity: 2 }]);
    expect((await pay(first, "pi_first")).status).toBe(200);
    expect((await pay(second, "pi_second")).status).toBe(200);
    expect((await orderRow(first)).status).toBe("paid");
    // Refunded in full by the app (the fake Stripe's refund succeeds): nothing taken, no tickets.
    expect((await orderRow(second)).status).toBe("refunded");
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(await tier("grp")).toMatchObject({ sold: 8 });
    expect(await ticketRows(second)).toEqual([]);
  });

  it("concurrent payments for the last group: exactly one wins, sold never passes capacity", async () => {
    await api.db.query(`update public.ticket_types set quantity_available = 4 where event_id = $1 and id = 'grp'`, [event.eventId]);
    const orders: string[] = [];
    for (let i = 0; i < 3; i += 1) orders.push(await pendingOrder([{ ticketTypeId: "grp", quantity: 1 }]));
    const results = await Promise.all(orders.map((id, i) => pay(id, `pi_race_${i}`)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const statuses = (await Promise.all(orders.map(orderRow))).map((o) => o.status).sort();
    expect(statuses).toEqual(["paid", "refunded", "refunded"]);
    expect(await tier("grp")).toMatchObject({ sold: 4 });
  });

  it("a ticket type whose admits changed since the order was made isn't taken: the oversold refund path", async () => {
    const orderId = await pendingOrder([{ ticketTypeId: "grp", quantity: 1 }]);
    // The freeze normally prevents this; turn it off to prove fulfilment holds on its own.
    await api.db.query(`alter table public.ticket_types disable trigger ticket_types_admits_frozen`);
    await api.db.query(`update public.ticket_types set admits = 2 where event_id = $1 and id = 'grp'`, [event.eventId]);
    expect((await pay(orderId, "pi_changed")).status).toBe(200);
    expect((await orderRow(orderId)).status).toBe("refunded");
    expect(api.stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(await tier("grp")).toMatchObject({ sold: 0 });
    expect(await ticketRows(orderId)).toEqual([]);
  });

  it("refuses to fulfil a group line with the wrong number of tickets (a bug, not an oversold order)", async () => {
    const orderId = await pendingOrder([{ ticketTypeId: "grp", quantity: 1 }]);
    const tickets = JSON.stringify([{ ticketCode: "AAAA-BBBB", ticketTypeId: "grp", ticketTypeName: "Group of 4" }]);
    expect(
      await refusedBy(`select private.fulfil_order($1, 'buyer@example.com', 'pi_wrong', $2::text::jsonb)`, [orderId, tickets]),
    ).toMatchObject({ code: "22023" });
    expect((await orderRow(orderId)).status).toBe("pending");
    expect(await tier("grp")).toMatchObject({ sold: 0 });
  });
});

describe("refunds are whole-order: a full refund gives back every person", () => {
  it("a full refund of 2 groups returns 8 people", async () => {
    const orderId = await paidOrder([{ ticketTypeId: "grp", quantity: 2 }], "pi_refund");
    expect(await tier("grp")).toMatchObject({ sold: 8 });
    const res = await api.send(stripeWebhook, chargeRefunded("pi_refund", 2 * GROUP_TOTAL, true));
    expect(res.status).toBe(200);
    expect((await orderRow(orderId)).status).toBe("refunded");
    expect(await tier("grp")).toMatchObject({ sold: 0 });
  });

  it("a partial refund leaves the people sold (a person decides, as for any order)", async () => {
    const orderId = await paidOrder([{ ticketTypeId: "grp", quantity: 2 }], "pi_partial");
    const res = await api.send(stripeWebhook, chargeRefunded("pi_partial", GROUP_TOTAL, false));
    expect(res.status).toBe(200);
    expect((await orderRow(orderId)).status).toBe("paid");
    expect(await tier("grp")).toMatchObject({ sold: 8 });
  });

  it("a full refund of a mixed order gives back each tier by its own people", async () => {
    await paidOrder([{ ticketTypeId: "grp", quantity: 1 }, { ticketTypeId: "ga", quantity: 3 }], "pi_mixed");
    expect(await api.send(stripeWebhook, chargeRefunded("pi_mixed", GROUP_TOTAL + 3 * 3760, true))).toMatchObject({ status: 200 });
    expect(await tier("grp")).toMatchObject({ sold: 0 });
    expect(await tier("ga")).toMatchObject({ sold: 0 });
  });
});

describe("what a group does to the rest of the event", () => {
  it("a sold-out group tier opens the next tier that waits for it (people, not groups)", async () => {
    const waiting = await publishedEvent(api, organiser, admin, {
      ticketTypes: [
        { ...GROUP, id: "g", quantityAvailable: 8 },
        { ...SINGLE, id: "after", opensAfterPrevious: true },
      ],
    });
    const buy = (id: string, quantity: number) => checkout([{ ticketTypeId: id, quantity }], waiting.eventId);
    expect((await buy("after", 1)).status).toBe(409);
    expect((await buy("g", 2)).status).toBe(201);
    // Still waiting: nothing is sold yet (an order that isn't paid never opens the next tier).
    expect((await buy("after", 1)).status).toBe(409);
    const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    expect((await pay(orderId, "pi_open")).status).toBe(200);
    expect((await orderRow(orderId)).status).toBe("paid");
    expect((await buy("after", 1)).status).toBe(201);
    const pub = await api.call(getPublicEventBySlug, { params: { slug: waiting.slug } });
    expect(pub.body.ticketTypes[0]).toMatchObject({ admits: 4, soldOut: true, remaining: 0 });
    expect(pub.body.ticketTypes[1].opensAfter).toBeUndefined();
  });

  it("the public shape counts what's left in people (remaining), and the organiser's ticketsSold is people", async () => {
    await paidOrder([{ ticketTypeId: "grp", quantity: 2 }], "pi_left");
    const pub = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(pub.body.ticketTypes[1]).toMatchObject({ admits: 4, remaining: 4, soldOut: false });
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(mine.body.ticketsSold).toEqual({ ga: 0, grp: 8 });
  });

  it("sends remaining for a group tier up to 20 people (12 left = 3 groups), but a single only at 10 or fewer", async () => {
    const pub = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    // 12 people left on the group (more than the 10 a single shows), 20 on the single (not shown).
    expect(pub.body.ticketTypes[1]).toMatchObject({ admits: 4, remaining: 12, soldOut: false });
    expect(pub.body.ticketTypes[0].remaining).toBeUndefined();
    // The checkout's 409 then gives the same count in groups.
    const over = await checkout([{ ticketTypeId: "grp", quantity: 4 }]);
    expect(over.status).toBe(409);
    expect(over.body.error).toBe('Only 3 of "Group of 4" left.');
  });

  it("releasing more tickets takes people: a multiple of admits, else a 400", async () => {
    const release = (quantityAvailable: number) =>
      api.call(releaseTickets, {
        token: organiser.token,
        params: { eventId: event.eventId, ticketTypeId: "grp" },
        body: { quantityAvailable },
        method: "POST",
      });
    const odd = await release(14);
    expect(odd.status).toBe(400);
    expect(odd.body.fieldErrors.quantityAvailable).toBe("A ticket for 4 people needs a quantity that's a multiple of 4.");
    const ok = await release(16);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ quantityAvailable: 16, quantitySold: 0 });
    // The refused release spent nothing: the next one still works.
    expect((await release(20)).status).toBe(200);
  });

  it("analytics count tickets in people and money in groups", async () => {
    await paidOrder([{ ticketTypeId: "grp", quantity: 2 }, { ticketTypeId: "ga", quantity: 1 }], "pi_stats");
    const res = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: event.eventId } });
    expect(res.status).toBe(200);
    expect(res.body.totals.ticketsSold).toBe(9);
    expect(res.body.totals.orders).toBe(1);
    const byType = Object.fromEntries(res.body.byTicketType.map((t: { ticketTypeId: string }) => [t.ticketTypeId, t]));
    expect(byType.grp).toMatchObject({ ticketsSold: 8, faceValueCents: 24000, grossCents: 2 * GROUP_TOTAL });
    expect(byType.ga).toMatchObject({ ticketsSold: 1, grossCents: 3500 + 210 + 50 });
  });
});

describe("each person's ticket says which person of the group it is", () => {
  it("the ticket email: 'Group of 4 (2 of 4)', and nothing added to a single ticket", async () => {
    const orderId = await paidOrder([{ ticketTypeId: "grp", quantity: 1 }, { ticketTypeId: "ga", quantity: 1 }], "pi_email");
    const [row] = await api.db.query(`${ORDER_SELECT} where o.id = $1`, [orderId]);
    const order = toOrder(row);
    expect(order.tickets.map((t) => t.group)).toEqual([undefined, ...[1, 2, 3, 4].map((position) => ({ position, size: 4 }))]);
    expect(JSON.stringify(order.tickets)).not.toContain("groupSize");
    const found = await findEventById(api.db, order.eventId);
    const email = buildTicketEmail(order, found!, "https://sheltuh.test");
    expect(email.text).toContain("Ticket 2 of 5 - Group of 4 (1 of 4)");
    expect(email.text).toContain("Ticket 5 of 5 - Group of 4 (4 of 4)");
    expect(email.text).toContain("Ticket 1 of 5 - General admission\n");
    expect(email.html).toContain("Group of 4 (3 of 4)");
  });

  it("an Apple Wallet pass: the same words", async () => {
    const apple = appleWalletEnv();
    api.appleWallet = (appleWalletConfigFromEnv(apple.env) as { config: AppleWalletConfig }).config;
    const orderId = await paidOrder([{ ticketTypeId: "grp", quantity: 1 }], "pi_pass");
    const res = await api.callRaw(getAppleWalletPass, { params: { sessionId: orderId }, query: { ticket: "3" }, headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(res.status).toBe(200);
    const files = readZip(Buffer.from(await res.arrayBuffer()));
    const json = JSON.parse(files.get("pass.json")!.toString("utf8"));
    expect(json.eventTicket.auxiliaryFields[0].value).toBe("Group of 4 (3 of 4) · Ticket 3 of 4");
  });
});

describe("the door", () => {
  it("scans each person on their own code, and counts people against the capacity in people", async () => {
    const orderId = await paidOrder([{ ticketTypeId: "grp", quantity: 1 }], "pi_door");
    const lookup = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    const codes = lookup.body.tickets.map((t: { ticketCode: string }) => t.ticketCode) as string[];
    expect(codes).toHaveLength(4);
    const scan = (code: string) =>
      api.call(checkInTicket, { token: organiser.token, params: { eventId: event.eventId }, body: { code, requestId: crypto.randomUUID() } });
    const first = await scan(codes[1]);
    expect(first.body).toMatchObject({ outcome: "admitted", ticket: { ticketTypeName: "Group of 4", ticketNumber: 2, ticketCount: 4 } });
    expect((await scan(codes[1])).body.outcome).toBe("already_checked_in");
    expect((await scan(codes[3])).body.outcome).toBe("admitted");

    const summary = await api.call(getCheckInSummary, { token: organiser.token, params: { eventId: event.eventId } });
    expect(summary.body.byTicketType).toEqual(
      expect.arrayContaining([expect.objectContaining({ ticketTypeId: "grp", checkedIn: 2, ticketsSold: 4, capacity: 12 })]),
    );
  });
});
