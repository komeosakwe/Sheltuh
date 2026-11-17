import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DETAILS_VISIBLE_MONTHS } from "@/lib/buyer-details";
import { adminSuspendOrganiser } from "@/lib/server/handlers/admin";
import { adminCreateEvent, adminCreateOrganiser } from "@/lib/server/handlers/admin-authoring";
import {
  EVENT_ORDERS_LIMITS,
  getEventOrders,
  getEventOrdersCsv,
  MAX_EXPORT_ROWS,
  searchEventOrders,
} from "@/lib/server/handlers/event-orders";
import { confirmFreeOrder } from "@/lib/server/handlers/free-orders";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import { secondsUntilUtcMidnight } from "@/lib/server/http";
import { orderReference } from "@/lib/server/order-reference";
import { runHandler } from "@/lib/server/route";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, sessionAmount, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { application, approvedOrganiser, eventInput, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// The organiser's Orders view (lib/server/handlers/event-orders.ts; supabase/migrations/20261122000000_order_buyer_details.sql).

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

const TIERS = [
  { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 },
  { id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 },
];

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
  event = await publishedEvent(api, organiser, admin, { ticketTypes: TIERS });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A plain page (GET), or, when `q` is given, a search (POST with the text in the body: never in a URL). */
const list = (token: string | undefined, query: Record<string, string> = {}, eventId = event.eventId) => {
  const { q, cursor, limit } = query;
  if (q === undefined) return api.call(getEventOrders, { token, params: { eventId }, query });
  return api.call(searchEventOrders, {
    token,
    params: { eventId },
    body: { q, ...(cursor ? { cursor } : {}), ...(limit ? { limit: Number(limit) } : {}) },
  });
};

const search = (token: string | undefined, body: unknown, eventId = event.eventId) =>
  api.call(searchEventOrders, { token, params: { eventId }, body });

/** Rows served today, by the budget's aggregate. */
const served = async () =>
  (
    await api.db.query<{ rows_served: number; requests: number }>(
      `select rows_served, requests from private.order_detail_views where actor_id = $1 and event_id = $2 and day = (now() at time zone 'UTC')::date`,
      [organiser.userId, event.eventId],
    )
  )[0];

/** Today's served count for the organiser and event, set directly. */
const setServed = (rows: number, dayOffset = 0) =>
  api.db.query(
    `insert into private.order_detail_views (actor_id, event_id, organiser_id, day, rows_served, requests)
     values ($1, $2, $3, (now() at time zone 'UTC')::date + $5::int, $4, 1)
     on conflict (actor_id, event_id, day) do update set rows_served = excluded.rows_served`,
    [organiser.userId, event.eventId, organiser.organiserId, rows, dayOffset],
  );

async function csv(token: string | undefined, eventId = event.eventId) {
  const res = await runHandler(
    getEventOrdersCsv,
    new Request(`${SITE_URL}/api/test.csv`, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
    { eventId },
    api.deps,
  );
  // Keep the byte-order mark (Response.text() strips it).
  return { status: res.status, headers: res.headers, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer()) };
}

interface NewOrder {
  name?: string | null;
  email?: string | null;
  status?: "pending" | "paid" | "failed" | "oversold_refund_required" | "refunded";
  lines?: { ticketTypeName: string; quantity: number }[];
  subtotal?: number;
  fee?: number;
  support?: number;
  refunded?: number;
  /** Seconds ago. */
  age?: number;
  /** A tickets row (issued): default true for paid and refunded. */
  tickets?: boolean;
  eventId?: string;
}

let ticketCounter = 0;

/** An order row straight into the database (the trigger stamps details_notice_at for a name). */
async function addOrder(o: NewOrder = {}): Promise<string> {
  const id = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
  const status = o.status ?? "paid";
  const subtotal = o.subtotal ?? 3000;
  const fee = o.fee ?? 0;
  const support = o.support ?? 0;
  const lines = (o.lines ?? [{ ticketTypeName: "General admission", quantity: 1 }]).map((l) => ({
    ticketTypeId: "ga",
    unitPriceCents: 3000,
    feePolicy: "buyer-pays",
    ...l,
  }));
  await api.db.query(
    `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, buyer_name, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, support_cents, amount_refunded_cents, status, created_at)
     values ($1, $2, $3, 'T', $4, $5, $6::text::jsonb, $7, $8, $9, 0, $10, $11, $12::public.order_status, now() - ($13 || ' seconds')::interval)`,
    [
      id,
      o.eventId ?? event.eventId,
      event.organiserId,
      o.email === undefined ? "buyer@example.com" : o.email,
      o.name === undefined ? "Buyer Name" : o.name,
      JSON.stringify(lines),
      subtotal,
      fee,
      subtotal + fee + support,
      support,
      o.refunded ?? 0,
      status,
      String(o.age ?? 0),
    ],
  );
  if (o.tickets ?? (status === "paid" || status === "refunded")) {
    ticketCounter += 1;
    await api.db.query(
      `insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name) values ($1, $2, $3, 'ga', 'General admission')`,
      [`T${String(ticketCounter).padStart(7, "0")}`, id, o.eventId ?? event.eventId],
    );
  }
  return id;
}

/** The event ended `months` months ago (and started a day before that). */
async function endEventMonthsAgo(months: number, days = 0, eventId = event.eventId) {
  await api.db.query(
    `update public.events set starts_at = now() - make_interval(months => $2, days => $3 + 1),
                              ends_at = now() - make_interval(months => $2, days => $3) where id = $1`,
    [eventId, months, days],
  );
}

const refs = (items: { reference: string }[]) => items.map((i) => i.reference);

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe("who can see an event's orders", () => {
  it("the event's approved organiser can; 401 without a token, 403 for a user with no approved organiser", async () => {
    await addOrder();
    const res = await list(organiser.token);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect((await list(undefined)).status).toBe(401);
    expect((await csv(undefined)).status).toBe(401);
    expect((await search(undefined, { q: "buyer" })).status).toBe(401);
    const stranger = await api.signUp();
    expect((await list(stranger.token)).status).toBe(403);
    expect((await csv(stranger.token)).status).toBe(403);
    expect((await search(stranger.token, { q: "buyer" })).status).toBe(403);
    const pending = await api.signUp();
    await api.db.query(`insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, status)
      values ($1, 'Pending', 'p@example.com', 'x', '{live-music}', 'pending')`, [pending.userId]);
    expect((await list(pending.token)).status).toBe(403);
  });

  it("another organiser's event, a missing event and a malformed id are all 404 (also for the CSV)", async () => {
    await addOrder();
    const rival = await approvedOrganiser(api, admin, { displayName: "Rival Collective", contactEmail: "rival@example.com" });
    for (const [token, eventId] of [
      [rival.token, event.eventId],
      [organiser.token, crypto.randomUUID()],
      [organiser.token, "not-a-uuid"],
      [organiser.token, "1' or '1'='1"],
    ] as const) {
      const res = await list(token, {}, eventId);
      expect([res.status, res.body.error]).toEqual([404, "Event not found."]);
      expect((await search(token, { q: "buyer" }, eventId)).status).toBe(404);
      expect((await csv(token, eventId)).status).toBe(404);
    }
    expect(await api.db.query(`select 1 from private.order_detail_exports`)).toEqual([]);
    expect(await api.db.query(`select 1 from private.order_detail_views`)).toEqual([]);
  });

  it("an admin gets 404 for an organiser's event, and can see a platform-managed organiser's", async () => {
    await addOrder();
    expect((await list(admin.token)).status).toBe(404);
    expect((await csv(admin.token)).status).toBe(404);

    const created = await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: { ...application, displayName: "Neon Presents", contactEmail: "events@sheltuh.example" },
    });
    const platformOrganiserId = created.body.organiserId as string;
    const made = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ title: "Neon Presents", ticketTypes: TIERS.slice(1) }), organiserId: platformOrganiserId, publish: true },
    });
    expect(made.status).toBe(201);
    const platformEventId = made.body.eventId as string;
    await api.db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, buyer_name, line_items, subtotal_cents, buyer_fee_cents,
         total_cents, application_fee_cents, status)
       values ('ord_${"c".repeat(32)}', $1, $2, 'T', 'p@example.com', 'Platform Fan', '[{"ticketTypeName":"RSVP","quantity":2}]'::jsonb, 0, 0, 0, 0, 'paid')`,
      [platformEventId, platformOrganiserId],
    );
    const res = await list(admin.token, {}, platformEventId);
    expect(res.status).toBe(200);
    expect(res.body.items).toMatchObject([{ buyerName: "Platform Fan", tickets: [{ ticketTypeName: "RSVP", quantity: 2 }], paidCents: 0 }]);
    // A non-admin organiser still can't see it.
    expect((await list(organiser.token, {}, platformEventId)).status).toBe(404);
  });

  it("a suspended organiser is 403", async () => {
    await addOrder();
    expect((await api.call(adminSuspendOrganiser, { token: admin.token, params: { organiserId: organiser.organiserId }, body: { reason: "Impersonating a venue." } })).status).toBe(200);
    expect((await list(organiser.token)).status).toBe(403);
    expect((await search(organiser.token, { q: "x" })).status).toBe(403);
    expect((await csv(organiser.token)).status).toBe(403);
  });

  it("every response is private, no-store", async () => {
    await addOrder();
    expect((await list(organiser.token)).headers.get("cache-control")).toBe("private, no-store");
    expect((await list(organiser.token, { q: "buyer" })).headers.get("cache-control")).toBe("private, no-store");
    const file = await csv(organiser.token);
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect(file.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(file.headers.get("content-disposition")).toMatch(/^attachment; filename="sheltuh-orders-neon-static[\w-]*_\d{4}-\d{2}-\d{2}\.csv"$/);
  });
});

// ---------------------------------------------------------------------------
// What is listed
// ---------------------------------------------------------------------------

describe("which orders are listed, and what they show", () => {
  it("paid orders (free ones included) and refunded orders that had tickets; nothing pending, failed, oversold or ticketless", async () => {
    const paid = await addOrder({ name: "Paid One", age: 50 });
    const refunded = await addOrder({ name: "Refunded One", status: "refunded", refunded: 3000, age: 40 });
    await addOrder({ name: "Pending", status: "pending" });
    await addOrder({ name: "Failed", status: "failed" });
    await addOrder({ name: "Oversold", status: "oversold_refund_required", tickets: true });
    await addOrder({ name: "Oversold then refunded", status: "refunded", tickets: false });
    await addOrder({ name: "Other event", eventId: (await publishedEvent(api, organiser, admin, { title: "Other", ticketTypes: TIERS })).eventId });
    const res = await list(organiser.token);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((i: { buyerName: string }) => i.buyerName)).toEqual(["Refunded One", "Paid One"]);
    expect(res.body.items[0]).toMatchObject({ status: "refunded", refundedCents: 3000, paidCents: 3000 });
    expect(refs(res.body.items)).toEqual([orderReference(refunded), orderReference(paid)]);
  });

  it("the shape: reference, time, status, name, email, tickets, paid (support excluded) and refunded", async () => {
    await addOrder({
      name: "Dee Lee",
      email: "dee@example.com",
      lines: [
        { ticketTypeName: "General admission", quantity: 2 },
        { ticketTypeName: "VIP", quantity: 1 },
      ],
      subtotal: 9000,
      fee: 200,
      support: 100,
      refunded: 1500,
    });
    const res = await list(organiser.token);
    expect(res.body).toMatchObject({
      event: { title: "Neon Static", slug: event.slug, timeZone: "Australia/Melbourne", endsAt: event.endsAt },
      total: 1,
    });
    expect(Object.keys(res.body).sort()).toEqual(["detailsVisibleUntil", "event", "items", "total"]);
    const [row] = res.body.items;
    expect(Object.keys(row).sort()).toEqual(["buyerEmail", "buyerName", "paidCents", "placedAt", "reference", "refundedCents", "status", "tickets"]);
    expect(row).toMatchObject({
      status: "paid",
      buyerName: "Dee Lee",
      buyerEmail: "dee@example.com",
      tickets: [
        { ticketTypeName: "General admission", quantity: 2 },
        { ticketTypeName: "VIP", quantity: 1 },
      ],
      // total 9300 less Support Sheltüh 100: the support amount is the platform's, not part of the sale.
      paidCents: 9200,
      refundedCents: 1500,
    });
    expect(row.reference).toMatch(/^#[0-9A-F]{8}$/);
    expect(Date.parse(row.placedAt)).not.toBeNaN();
    const yearAfter = new Date(event.endsAt);
    yearAfter.setUTCFullYear(yearAfter.getUTCFullYear() + 1);
    expect(res.body.detailsVisibleUntil).toBe(yearAfter.toISOString());
  });

  it("never carries an order id (ord_…) in the JSON or the CSV, nor the full random part", async () => {
    const ids = [await addOrder({ name: "A" }), await addOrder({ name: "B" })];
    const json = JSON.stringify((await list(organiser.token)).body);
    const file = (await csv(organiser.token)).text;
    for (const text of [json, file]) {
      expect(text).not.toMatch(/ord_/);
      for (const id of ids) {
        expect(text).not.toContain(id);
        expect(text).not.toContain(id.slice(4, 20));
      }
    }
  });

  it("orders made without a name (before this release) are listed with no details", async () => {
    await addOrder({ name: null, email: "old@example.com" });
    const res = await list(organiser.token);
    expect(res.body.items).toMatchObject([{ buyerName: null, buyerEmail: null, status: "paid" }]);
    expect((await csv(organiser.token)).text).not.toContain("old@example.com");
  });

  it("a guest's paid order shows the name, and the email Stripe's form collected", async () => {
    api.stripe.checkout.sessions.create.mockResolvedValueOnce(embeddedSession("cs_test_g"));
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }], buyerName: "Guest Payer" },
    });
    expect(res.status).toBe(201);
    // Pending: not listed.
    expect((await list(organiser.token)).body.items).toEqual([]);
    const orderId = api.stripe.checkout.sessions.create.mock.calls[0][0].client_reference_id as string;
    expect(
      (
        await api.send(
          stripeWebhook,
          stripeWebhookRequest({
            type: "checkout.session.completed",
            data: {
              object: {
                id: "cs_test_g",
                object: "checkout.session",
                client_reference_id: orderId,
                ...(await sessionAmount(api.db, orderId)),
                payment_status: "paid",
                payment_intent: "pi_g",
                customer_details: { email: "stripe-form@example.com" },
              },
            },
          }),
        )
      ).status,
    ).toBe(200);
    const listed = await list(organiser.token);
    expect(listed.body.items).toMatchObject([
      { buyerName: "Guest Payer", buyerEmail: "stripe-form@example.com", tickets: [{ ticketTypeName: "General admission", quantity: 2 }], status: "paid" },
    ]);
    expect(listed.body.items[0].paidCents).toBe((await sessionAmount(api.db, orderId)).amount_total);
  });

  it("a guest's free booking is listed only once confirmed", async () => {
    await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com", buyerName: "Free Guest" },
    });
    await api.runDeferred();
    expect((await list(organiser.token)).body).toMatchObject({ items: [], total: 0 });
    const token = api.sendEmail.mock.calls[0][0].text.match(/#token=([A-Za-z0-9_-]+)/)![1];
    expect((await api.call(confirmFreeOrder, { body: { token } })).status).toBe(200);
    expect((await list(organiser.token)).body.items).toMatchObject([
      { buyerName: "Free Guest", buyerEmail: "guest@example.com", paidCents: 0, status: "paid" },
    ]);
  });
});

describe("how long the details are shown", () => {
  it("until DETAILS_VISIBLE_MONTHS (12) months after the event ends; then both are null (the order stays)", async () => {
    await addOrder({ name: "Dee Lee", email: "dee@example.com" });
    const before = await list(organiser.token);
    expect(before.body.items[0]).toMatchObject({ buyerName: "Dee Lee", buyerEmail: "dee@example.com" });

    await endEventMonthsAgo(DETAILS_VISIBLE_MONTHS - 1, 25);
    expect((await list(organiser.token)).body.items[0]).toMatchObject({ buyerName: "Dee Lee", buyerEmail: "dee@example.com" });

    await endEventMonthsAgo(DETAILS_VISIBLE_MONTHS, 1);
    const after = await list(organiser.token);
    expect(after.body.items).toMatchObject([{ buyerName: null, buyerEmail: null, status: "paid", paidCents: 3000 }]);
    expect(Date.parse(after.body.detailsVisibleUntil)).toBeLessThan(Date.now());
    const file = (await csv(organiser.token)).text;
    expect(file).not.toContain("Dee Lee");
    expect(file).not.toContain("dee@example.com");
  });

  it("detailsVisibleUntil follows the event's end (DETAILS_VISIBLE_MONTHS later, exactly), and the shared constant is the owner's 12", async () => {
    expect(DETAILS_VISIBLE_MONTHS).toBe(12);
    await endEventMonthsAgo(2, 3);
    const res = await list(organiser.token);
    const [{ until }] = await api.db.query<{ until: string }>(
      `select to_char((ends_at at time zone 'UTC') + make_interval(months => $2), 'YYYY-MM-DD"T"HH24:MI:SS') as until from public.events where id = $1`,
      [event.eventId, DETAILS_VISIBLE_MONTHS],
    );
    expect(res.body.detailsVisibleUntil.slice(0, 19)).toBe(until);
    expect(res.body.event.endsAt).not.toBe(event.endsAt);
  });

  it("hidden details can't be found by searching for them; the reference still can", async () => {
    const id = await addOrder({ name: "Zed Hidden", email: "zed@example.com" });
    await endEventMonthsAgo(DETAILS_VISIBLE_MONTHS + 1);
    for (const q of ["Zed", "zed@example.com", "example.com"]) {
      expect((await list(organiser.token, { q })).body).toMatchObject({ items: [], total: 0 });
    }
    expect(refs((await list(organiser.token, { q: orderReference(id) })).body.items)).toEqual([orderReference(id)]);
  });
});

// ---------------------------------------------------------------------------
// Paging and search
// ---------------------------------------------------------------------------

describe("paging", () => {
  it("newest first, a page at a time, with the total and a cursor", async () => {
    for (let i = 0; i < 5; i++) await addOrder({ name: `Buyer ${i}`, age: (5 - i) * 100 }); // Buyer 4 is newest
    const first = await list(organiser.token, { limit: "2" });
    expect(first.body.total).toBe(5);
    expect(first.body.items.map((i: { buyerName: string }) => i.buyerName)).toEqual(["Buyer 4", "Buyer 3"]);
    const second = await list(organiser.token, { limit: "2", cursor: first.body.nextCursor });
    expect(second.body.items.map((i: { buyerName: string }) => i.buyerName)).toEqual(["Buyer 2", "Buyer 1"]);
    const third = await list(organiser.token, { limit: "2", cursor: second.body.nextCursor });
    expect(third.body.items.map((i: { buyerName: string }) => i.buyerName)).toEqual(["Buyer 0"]);
    expect(third.body.nextCursor).toBeUndefined();
    expect((await list(organiser.token, { cursor: "garbage" })).status).toBe(400);
  });

  it("20 by default and 50 at most", async () => {
    await api.db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, buyer_name, line_items, subtotal_cents, buyer_fee_cents,
         total_cents, application_fee_cents, status, created_at)
       select 'ord_' || md5(i::text), $1, $2, 'T', 'b' || i || '@example.com', 'Buyer ' || i, '[{"ticketTypeName":"GA","quantity":1}]'::jsonb,
         0, 0, 0, 0, 'paid', now() - (i || ' seconds')::interval
       from generate_series(1, 60) i`,
      [event.eventId, event.organiserId],
    );
    await api.db.query(
      `insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name)
       select 'G' || lpad(i::text, 7, '0'), 'ord_' || md5(i::text), $1, 'ga', 'GA' from generate_series(1, 60) i`,
      [event.eventId],
    );
    const res = await list(organiser.token);
    expect([res.body.items.length, res.body.total]).toEqual([20, 60]);
    expect((await list(organiser.token, { limit: "500" })).body.items).toHaveLength(50);
  });
});

describe("search", () => {
  beforeEach(async () => {
    await addOrder({ name: "José Núñez", email: "jose@example.com", age: 400 });
    await addOrder({ name: "100% Real_Name", email: "pct@example.com", age: 300 });
    await addOrder({ name: "Dee Lee", email: "Dee.Lee+shows@Example.com", age: 200 });
    await addOrder({ name: "Other Person", email: "other@example.net", age: 100 });
  });
  const names = async (q: string) =>
    ((await list(organiser.token, { q })).body.items as { buyerName: string }[]).map((i) => i.buyerName);

  it("matches the name or the email, ignoring case and accents", async () => {
    expect(await names("jose nunez")).toEqual(["José Núñez"]);
    expect(await names("JOSÉ")).toEqual(["José Núñez"]);
    expect(await names("núñez")).toEqual(["José Núñez"]);
    expect(await names("dee.lee+shows")).toEqual(["Dee Lee"]);
    expect(await names("@EXAMPLE.COM")).toEqual(["Dee Lee", "100% Real_Name", "José Núñez"]);
    expect(await names("  lee  ")).toEqual(["Dee Lee"]);
  });

  it("% and _ are literal", async () => {
    expect(await names("%")).toEqual(["100% Real_Name"]);
    expect(await names("_")).toEqual(["100% Real_Name"]);
    expect(await names("0% r")).toEqual(["100% Real_Name"]);
    expect(await names("real_n")).toEqual(["100% Real_Name"]);
    expect(await names("real n")).toEqual([]);
    expect(await names("\\")).toEqual([]);
    expect(await names("' or '1'='1")).toEqual([]);
  });

  it("matches the short reference, with or without the #, in any case", async () => {
    const id = await addOrder({ name: "Findable" });
    const ref = orderReference(id);
    expect(await names(ref)).toEqual(["Findable"]);
    expect(await names(ref.slice(1).toLowerCase())).toEqual(["Findable"]);
    expect(await names(ref.slice(0, 5))).toContain("Findable");
    // The id's own prefix isn't searchable, only the reference.
    expect(await names(`ord_${id.slice(4, 12)}`)).toEqual([]);
    expect(await names(id)).toEqual([]);
  });

  it("the total follows the search; no match is an empty page", async () => {
    expect((await list(organiser.token, { q: "example.com" })).body.total).toBe(3);
    expect((await list(organiser.token, { q: "zzz" })).body).toMatchObject({ items: [], total: 0 });
    expect((await list(organiser.token, { q: "" })).body.total).toBe(4);
  });

  it("long text is cut at 100 characters and control characters are ignored", async () => {
    expect((await list(organiser.token, { q: "x".repeat(1500) })).status).toBe(200);
    expect(await names("dee\u0000 lee")).toEqual(["Dee Lee"]);
  });
});

describe("the search request", () => {
  beforeEach(async () => {
    await addOrder({ name: "Dee Lee", email: "dee@example.com", age: 200 });
    await addOrder({ name: "Eve Fox", email: "eve@example.com", age: 100 });
  });

  it("a search text in the URL of the GET is a 400 and serves nothing (it would reach request logs)", async () => {
    const res = await api.call(getEventOrders, { token: organiser.token, params: { eventId: event.eventId }, query: { q: "dee" } });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.q).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("dee@example.com");
    expect(await served()).toBeUndefined();
  });

  it("no body, or no q, is the plain list; q, cursor and limit come from the JSON body", async () => {
    expect((await search(organiser.token, {})).body.total).toBe(2);
    const first = await search(organiser.token, { q: "example.com", limit: 1 });
    expect(first.body.items.map((i: { buyerName: string }) => i.buyerName)).toEqual(["Eve Fox"]);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await search(organiser.token, { q: "example.com", limit: 1, cursor: first.body.nextCursor });
    expect(second.body.items.map((i: { buyerName: string }) => i.buyerName)).toEqual(["Dee Lee"]);
    expect(second.body.nextCursor).toBeUndefined();
    expect((await search(organiser.token, { q: null })).body.total).toBe(2);
  });

  it("a malformed body is a 400: q, cursor and limit must be a string, a string and a number", async () => {
    for (const [body, field] of [
      [{ q: 5 }, "q"],
      [{ q: { $ne: "" } }, "q"],
      [{ limit: "20" }, "limit"],
    ] as const) {
      const res = await search(organiser.token, body);
      expect([res.status, Object.keys(res.body.fieldErrors ?? {})], JSON.stringify(body)).toEqual([400, [field]]);
    }
    expect((await search(organiser.token, { cursor: 7 })).status).toBe(400);
    expect((await search(organiser.token, { cursor: "not-a-cursor" })).status).toBe(400);
    expect(await served()).toBeUndefined();
  });

  it("a body over 2 KB is refused", async () => {
    expect((await search(organiser.token, { q: "x".repeat(5000) })).status).toBe(413);
  });
});

describe("the daily budget of buyer details", () => {
  beforeEach(async () => {
    await addOrder({ name: "Dee Lee", email: "dee@example.com", age: 200 });
    await addOrder({ name: "Eve Fox", email: "eve@example.com", age: 100 });
  });

  it("is 25,000 rows per account per event per day, shared by the list, the search and the export", () => {
    expect(EVENT_ORDERS_LIMITS.dailyRows).toBe(25_000);
    // One full export fits with room for paging.
    expect(EVENT_ORDERS_LIMITS.dailyRows).toBeGreaterThan(MAX_EXPORT_ROWS);
  });

  it("every page adds the rows it served, and the request, to one aggregate row", async () => {
    await list(organiser.token);
    expect(await served()).toEqual({ rows_served: 2, requests: 1 });
    await list(organiser.token, { q: "dee" });
    expect(await served()).toEqual({ rows_served: 3, requests: 2 });
    await list(organiser.token, { limit: "1" });
    expect(await served()).toEqual({ rows_served: 4, requests: 3 });
    // An empty page serves nothing and writes nothing.
    await list(organiser.token, { q: "nobody" });
    expect(await served()).toEqual({ rows_served: 4, requests: 3 });
    expect(await api.db.query(`select count(*)::int as n from private.order_detail_views`)).toEqual([{ n: 1 }]);
  });

  it("holds no buyer data", async () => {
    await list(organiser.token);
    const cols = await api.db.query<{ c: string[] }>(
      `select array_agg(column_name::text order by ordinal_position) as c from information_schema.columns
        where table_schema = 'private' and table_name = 'order_detail_views'`,
    );
    expect(cols[0].c).toEqual(["actor_id", "event_id", "organiser_id", "day", "rows_served", "requests"]);
    const [row] = await api.db.query(`select row_to_json(v)::text as j from private.order_detail_views v`);
    expect(JSON.stringify(row)).not.toMatch(/Dee|dee@|Eve|eve@/);
  });

  /** A daily_limit's Retry-After: the seconds to the next UTC midnight (the budget's day), as the clock read around the request. */
  function expectUntilUtcMidnight(retryAfter: string | null, before: number, after: number) {
    const seconds = Number(retryAfter);
    expect(Number.isInteger(seconds)).toBe(true);
    // Either side of a midnight that passed mid-request, it's one of the two.
    expect(seconds).toBeGreaterThanOrEqual(Math.min(before, after));
    expect(seconds).toBeLessThanOrEqual(Math.max(before, after));
    expect(seconds).toBeLessThanOrEqual(86_400);
  }

  it("a page that would pass the day's budget is a 429 daily_limit with no details and nothing counted", async () => {
    await setServed(EVENT_ORDERS_LIMITS.dailyRows - 1);
    const before = secondsUntilUtcMidnight();
    const res = await list(organiser.token);
    expect([res.status, res.body.code]).toEqual([429, "daily_limit"]);
    expectUntilUtcMidnight(res.headers.get("retry-after"), before, secondsUntilUtcMidnight());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(res.body)).not.toMatch(/Dee|dee@|Eve|eve@/);
    expect(await served()).toMatchObject({ rows_served: EVENT_ORDERS_LIMITS.dailyRows - 1 });
    // The search is shared, and a page that fits still goes.
    expect((await list(organiser.token, { q: "dee" })).status).toBe(200);
    expect(await served()).toMatchObject({ rows_served: EVENT_ORDERS_LIMITS.dailyRows });
    expect((await list(organiser.token, { q: "eve" })).body.code).toBe("daily_limit");
  });

  it("the export is counted too, and refused when the day's budget can't take its rows: no file, no audit row", async () => {
    await setServed(EVENT_ORDERS_LIMITS.dailyRows - 1);
    const before = secondsUntilUtcMidnight();
    const refused = await csv(organiser.token);
    expect(refused.status).toBe(429);
    expect(JSON.parse(refused.text).code).toBe("daily_limit");
    expectUntilUtcMidnight(refused.headers.get("retry-after"), before, secondsUntilUtcMidnight());
    expect(refused.text).not.toMatch(/Dee|dee@|Eve|eve@/);
    expect(await api.db.query(`select 1 from private.order_detail_exports`)).toEqual([]);

    await setServed(EVENT_ORDERS_LIMITS.dailyRows - 2);
    expect((await csv(organiser.token)).status).toBe(200);
    expect(await served()).toMatchObject({ rows_served: EVENT_ORDERS_LIMITS.dailyRows });
    expect(await api.db.query(`select row_count from private.order_detail_exports`)).toEqual([{ row_count: 2 }]);
  });

  it("is per day, per event and per account", async () => {
    await setServed(EVENT_ORDERS_LIMITS.dailyRows, -1); // yesterday's use doesn't count
    expect((await list(organiser.token)).status).toBe(200);
    expect(await served()).toEqual({ rows_served: 2, requests: 1 });

    await setServed(EVENT_ORDERS_LIMITS.dailyRows);
    expect((await list(organiser.token)).status).toBe(429);
    // Another event of the same organiser.
    const other = await publishedEvent(api, organiser, admin, { ticketTypes: TIERS, title: "Second Night" });
    await addOrder({ eventId: other.eventId });
    expect((await list(organiser.token, {}, other.eventId)).status).toBe(200);
    // Another account (an admin acting for a platform-managed organiser has its own row).
    expect(await api.db.query(`select count(*)::int as n from private.order_detail_views where actor_id <> $1`, [organiser.userId])).toEqual([{ n: 0 }]);
  });

  it("fails closed: if the count can't be recorded, nothing is served", async () => {
    await api.db.query(`alter table private.order_detail_views rename to order_detail_views_away`);
    try {
      const res = await list(organiser.token);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toMatch(/Dee|dee@|Eve|eve@/);
      const exported = await csv(organiser.token);
      expect(exported.status).toBe(500);
      expect(exported.text).not.toMatch(/Dee|dee@|Eve|eve@/);
      expect(await api.db.query(`select 1 from private.order_detail_exports`)).toEqual([]);
    } finally {
      await api.db.query(`alter table private.order_detail_views_away rename to order_detail_views`);
    }
  });

  it("concurrent pages can't overshoot the budget", async () => {
    await setServed(EVENT_ORDERS_LIMITS.dailyRows - 6);
    const results = await Promise.all(Array.from({ length: 6 }, () => list(organiser.token)));
    // Each page serves 2 rows: three fit, three don't.
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(3);
    expect((await served()).rows_served).toBe(EVENT_ORDERS_LIMITS.dailyRows);
  });
});

// ---------------------------------------------------------------------------
// Limits and the export audit
// ---------------------------------------------------------------------------

describe("rate limits", () => {
  it("reads: 240 per 10 minutes per account, then 429 rate_limited; other accounts are unaffected", async () => {
    await addOrder();
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'event_orders', now(), $2)`,
      [organiser.userId, EVENT_ORDERS_LIMITS.reads.hits - 1],
    );
    expect((await list(organiser.token)).status).toBe(200);
    const limited = await list(organiser.token);
    expect([limited.status, limited.body.code]).toEqual([429, "rate_limited"]);
    expect(limited.headers.get("retry-after")).toBe("600"); // the 10-minute window
    expect(JSON.stringify(limited.body)).not.toContain("Buyer Name");
    expect((await csv(organiser.token)).status).toBe(429);
    const rival = await approvedOrganiser(api, admin, { displayName: "Rival", contactEmail: "rival@example.com" });
    expect((await list(rival.token)).status).toBe(404); // not limited: authorised first, then refused as theirs not to see
  });

  it("exports: 10 an hour per account, each logged; the 11th is 429 and gets no file", async () => {
    await addOrder({ name: "Dee Lee" });
    await addOrder({ name: "Eve Fox", status: "refunded", refunded: 3000 });
    for (let i = 0; i < EVENT_ORDERS_LIMITS.exports.hits; i++) {
      const file = await csv(organiser.token);
      expect(file.status, `export ${i + 1}`).toBe(200);
    }
    const refused = await csv(organiser.token);
    expect(refused.status).toBe(429);
    expect(refused.text).not.toContain("Dee Lee");
    expect(JSON.parse(refused.text).code).toBe("rate_limited");
    expect(refused.headers.get("retry-after")).toBe("3600"); // the hourly window
    const log = await api.db.query<{ event_id: string; organiser_id: string; actor_id: string; row_count: number }>(
      `select event_id, organiser_id, actor_id, row_count from private.order_detail_exports order by id`,
    );
    expect(log).toHaveLength(EVENT_ORDERS_LIMITS.exports.hits);
    expect(log[0]).toEqual({ event_id: event.eventId, organiser_id: organiser.organiserId, actor_id: organiser.userId, row_count: 2 });
  });

  it("the audit row holds no buyer data, and viewing the page logs nothing", async () => {
    await addOrder({ name: "Dee Lee", email: "dee@example.com" });
    await list(organiser.token);
    expect(await api.db.query(`select 1 from private.order_detail_exports`)).toEqual([]);
    await csv(organiser.token);
    const [row] = await api.db.query(`select row_to_json(x)::text as j from private.order_detail_exports x`);
    expect(JSON.stringify(row)).not.toMatch(/Dee|dee@/);
  });

  it("an export that can't be logged is not served", async () => {
    await addOrder({ name: "Dee Lee", email: "dee@example.com" });
    await api.db.query(`alter table private.order_detail_exports rename to order_detail_exports_away`);
    try {
      const file = await csv(organiser.token);
      expect(file.status).toBe(500);
      expect(file.text).not.toContain("dee@example.com");
      expect(file.text).not.toContain("Dee Lee");
    } finally {
      await api.db.query(`alter table private.order_detail_exports_away rename to order_detail_exports`);
    }
  });

  it("more than 20,000 orders is a 409: nothing is served or logged", { timeout: 60_000 }, async () => {
    await api.db.query(`alter table public.orders disable trigger user`);
    try {
      await api.db.query(
        `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items, subtotal_cents, buyer_fee_cents,
           total_cents, application_fee_cents, status)
         select 'ord_' || md5(i::text), $1, $2, 'T', 'b@example.com', '[]'::jsonb, 0, 0, 0, 0, 'paid' from generate_series(1, $3::int) i`,
        [event.eventId, event.organiserId, MAX_EXPORT_ROWS + 1],
      );
      await api.db.query(
        `insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name)
         select 'M' || lpad(i::text, 7, '0'), 'ord_' || md5(i::text), $1, 'ga', 'GA' from generate_series(1, $2::int) i`,
        [event.eventId, MAX_EXPORT_ROWS + 1],
      );
    } finally {
      await api.db.query(`alter table public.orders enable trigger user`);
    }
    const file = await csv(organiser.token);
    expect(file.status).toBe(409);
    expect(await api.db.query(`select 1 from private.order_detail_exports`)).toEqual([]);
    // Refused on the count alone: before the export's rate limit was taken, and before any row was read or counted.
    expect(await api.db.query(`select 1 from private.rate_limits where bucket = 'order_exports'`)).toEqual([]);
    expect(await api.db.query(`select 1 from private.order_detail_views`)).toEqual([]);
    // The page still works.
    expect((await list(organiser.token)).body.total).toBe(MAX_EXPORT_ROWS + 1);
  });
});

// ---------------------------------------------------------------------------
// The CSV
// ---------------------------------------------------------------------------

describe("the CSV", () => {
  it("one row per order with the details the page shows, money in dollars, times in the event's zone", async () => {
    const id = await addOrder({
      name: "Dee Lee",
      email: "dee@example.com",
      lines: [
        { ticketTypeName: "General admission", quantity: 2 },
        { ticketTypeName: "VIP", quantity: 1 },
      ],
      subtotal: 9000,
      fee: 300,
      support: 100,
      refunded: 500,
      age: 60,
    });
    await addOrder({ name: null, email: null, status: "refunded", subtotal: 3000, refunded: 3000, age: 30 });
    const file = await csv(organiser.token);
    expect(file.status).toBe(200);
    expect(file.text.startsWith("\uFEFF")).toBe(true);
    const lines = file.text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe('"Reference","Placed","Name","Email","Tickets","Paid (A$)","Refunded (A$)","Status"');
    expect(lines).toHaveLength(3);
    // Newest first: the refunded order with no details, then Dee's.
    expect(lines[1]).toMatch(/^"#[0-9A-F]{8}","\d{4}-\d\d-\d\d \d\d:\d\d","","","1 × General admission","30\.00","30\.00","Refunded"$/);
    expect(lines[2]).toMatch(
      new RegExp(`^"${orderReference(id)}","\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d","Dee Lee","dee@example.com","2 × General admission; 1 × VIP","93\\.00","5\\.00","Part refunded"$`),
    );
  });

  it("does not apply the search, and includes every listed order", async () => {
    for (let i = 0; i < 3; i++) await addOrder({ name: `Buyer ${i}` });
    const file = await csv(organiser.token);
    expect(file.text.trimEnd().split("\r\n")).toHaveLength(4);
  });

  it("buyer-typed text can't become a formula in a spreadsheet", async () => {
    // Names are cleaned by the API, but the database check allows these; emails can start with + or -.
    const hostile = [
      ["=HYPERLINK(\"http://x.example\")", "a@example.com"],
      ["+61 400 000 000", "+plus@example.com"],
      ["-1", "-minus@example.com"],
      ["@SUM(1)", "=cmd@example.com"],
      ['Quote "Q", Comma', "q@example.com"],
    ] as const;
    for (const [name, email] of hostile) await addOrder({ name, email });
    const text = (await csv(organiser.token)).text;
    expect(text).toContain(`"'=HYPERLINK(""http://x.example"")"`);
    expect(text).toContain(`"'+61 400 000 000","'+plus@example.com"`);
    expect(text).toContain(`"'-1","'-minus@example.com"`);
    expect(text).toContain(`"'@SUM(1)","'=cmd@example.com"`);
    expect(text).toContain(`"Quote ""Q"", Comma"`);
    // No cell starts with a bare formula character.
    expect(text).not.toMatch(/(^|,)"[=+\-@]/m);
  });
});
