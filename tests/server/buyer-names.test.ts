import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmFreeOrder } from "@/lib/server/handlers/free-orders";
import { createCheckout, getOrderBySession, stripeWebhook } from "@/lib/server/handlers/orders";
import { hasInvisibleOrControl } from "@/lib/server/profile-input";
import { issueTickets } from "@/lib/server/ticket-issuance";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, sessionAmount, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { orderIdFromUrl, seatedEvent } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// The buyer's name on the order (supabase/migrations/20261122000000_order_buyer_details.sql):
// stored, with details_notice_at stamped by the database, on every way an order is made.

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

const TIERS = [
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 20 },
  { id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 },
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
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    n += 1;
    return embeddedSession(`cs_test_${n}`);
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Stored {
  id: string;
  status: string;
  buyer_name: string | null;
  noticed: boolean;
  notice_age_seconds: number | null;
}

async function stored(eventId: string): Promise<Stored[]> {
  return api.db.query<Stored>(
    `select id, status::text as status, buyer_name, details_notice_at is not null as noticed,
            extract(epoch from now() - details_notice_at)::float8 as notice_age_seconds
       from public.orders where event_id = $1 order by created_at, id`,
    [eventId],
  );
}

const checkout = (event: EventRecord, body: Record<string, unknown>, token?: string) =>
  api.call(createCheckout, { token, params: { eventId: event.eventId }, body });

async function pay(orderId: string, n: number) {
  const res = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_test_${n}`,
          object: "checkout.session",
          client_reference_id: orderId,
          ...(await sessionAmount(api.db, orderId)),
          payment_status: "paid",
          payment_intent: `pi_${orderId}`,
          customer_details: { email: "stripe-form@example.com" },
        },
      },
    }),
  );
  expect(res.status).toBe(200);
}

function confirmationToken(): string {
  const message = api.sendEmail.mock.calls.at(-1)![0];
  return message.text.match(/\/checkout\/confirm#token=([A-Za-z0-9_-]+)/)![1];
}

describe("general admission", () => {
  let event: EventRecord;
  beforeEach(async () => {
    event = await publishedEvent(api, organiser, admin, { ticketTypes: TIERS });
  });

  it("a paid checkout stores the cleaned name, stamped by the database, and the buyer's page never shows it", async () => {
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }], buyerName: "  Zoë   Smith " });
    expect(res.status).toBe(201);
    const [order] = await stored(event.eventId);
    expect(order).toMatchObject({ status: "pending", buyer_name: "Zoë Smith", noticed: true });
    expect(order.notice_age_seconds).toBeLessThan(30);

    await pay(order.id, 1);
    const page = await api.call(getOrderBySession, { params: { sessionId: order.id } });
    expect(page.status).toBe(200);
    expect(JSON.stringify(page.body)).not.toContain("Smith");
    expect(page.body).not.toHaveProperty("buyerName");
    expect(page.body).not.toHaveProperty("detailsNoticeAt");
    expect(JSON.stringify(res.body)).not.toContain("Smith");
  });

  it("a member's free checkout (own verified email) stores it", async () => {
    const fan = await api.signUp({ email: "fan@example.com" });
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 2 }], buyerEmail: "fan@example.com", buyerName: "Fan One" }, fan.token);
    expect(res.status).toBe(201);
    expect(await stored(event.eventId)).toMatchObject([{ status: "paid", buyer_name: "Fan One", noticed: true }]);
  });

  it("a guest's free checkout stores it on the pending order and keeps it after the emailed link is confirmed", async () => {
    const res = await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com", buyerName: "Guest Two" });
    expect(res.status).toBe(202);
    expect(await stored(event.eventId)).toMatchObject([{ status: "pending", buyer_name: "Guest Two", noticed: true }]);
    await api.runDeferred();
    // The confirmation email says nothing about the name.
    expect(JSON.stringify(api.sendEmail.mock.calls[0][0])).not.toContain("Guest Two");
    const confirmed = await api.call(confirmFreeOrder, { body: { token: confirmationToken() } });
    expect(confirmed.status).toBe(200);
    expect(await stored(event.eventId)).toMatchObject([{ status: "paid", buyer_name: "Guest Two", noticed: true }]);
  });

  it("no name (omitted, null or empty): both columns stay null, on paid and free checkouts", async () => {
    const fan = await api.signUp({ email: "fan@example.com" });
    for (const extra of [{}, { buyerName: null }, { buyerName: "" }]) {
      expect((await checkout(event, { lineItems: [{ ticketTypeId: "ga", quantity: 1 }], ...extra })).status).toBe(201);
      expect(
        (await checkout(event, { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "fan@example.com", ...extra }, fan.token)).status,
      ).toBe(201);
    }
    const rows = await stored(event.eventId);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.buyer_name === null && !r.noticed)).toBe(true);
  });

  it("a bad name is a 400 fieldErrors.buyerName on any checkout and writes nothing", async () => {
    const fan = await api.signUp({ email: "fan@example.com" });
    const bad = ["a".repeat(81), "   ", "a@b.co", "https://spam.example", "A‮B", "A\nB", 7, "---"];
    for (const buyerName of bad) {
      for (const [lineItems, extra, token] of [
        [[{ ticketTypeId: "ga", quantity: 1 }], {}, undefined],
        [[{ ticketTypeId: "rsvp", quantity: 1 }], { buyerEmail: "fan@example.com" }, fan.token],
        [[{ ticketTypeId: "rsvp", quantity: 1 }], { buyerEmail: "guest@example.com" }, undefined],
      ] as const) {
        const res = await checkout(event, { lineItems, ...extra, buyerName }, token);
        expect([res.status, typeof res.body.fieldErrors?.buyerName]).toEqual([400, "string"]);
      }
    }
    expect(await stored(event.eventId)).toEqual([]);
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(api.sendEmail).not.toHaveBeenCalled();
  });
});

describe("reserved seating", () => {
  it("a paid seated checkout stores the name through hold_seats", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const res = await checkout(event, { seats: { mapVersion: map.version, seatIds: ["A1"] }, buyerName: "Seat Buyer" });
    expect(res.status).toBe(201);
    expect(await stored(event.eventId)).toMatchObject([{ status: "pending", buyer_name: "Seat Buyer", noticed: true }]);
    const bad = await checkout(event, { seats: { mapVersion: map.version, seatIds: ["A2"] }, buyerName: "x@y.co" });
    expect([bad.status, typeof bad.body.fieldErrors?.buyerName]).toEqual([400, "string"]);
    // The refused request held nothing.
    const held = await api.db.query(`select id from public.event_seats where event_id = $1 and hold_order_id is not null`, [event.eventId]);
    expect(held).toHaveLength(1);
  });

  describe("free seats", () => {
    let event: EventRecord;
    let map: { version: number };
    beforeEach(async () => {
      ({ event, map } = await seatedEvent(api, organiser, admin, {
        tiers: [{ id: "free", name: "Free seat", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 1 }],
        rows: [{ label: "A", tier: "free", seats: 6 }],
      }));
    });

    it("a member's order (place_free_seated_order) stores it", async () => {
      const fan = await api.signUp({ email: "fan@example.com" });
      const res = await checkout(
        event,
        { seats: { mapVersion: map.version, seatIds: ["A1"] }, buyerEmail: "fan@example.com", buyerName: "Seated Member" },
        fan.token,
      );
      expect(res.status).toBe(201);
      expect(orderIdFromUrl(res.body.url)).toMatch(/^ord_/);
      expect(await stored(event.eventId)).toMatchObject([{ status: "paid", buyer_name: "Seated Member", noticed: true }]);
    });

    it("a guest's order (request_free_seated_order) stores it, and it survives confirmation", async () => {
      const res = await checkout(event, { seats: { mapVersion: map.version, seatIds: ["A3"] }, buyerEmail: "guest@example.com", buyerName: "Seated Guest" });
      expect(res.status).toBe(202);
      expect(await stored(event.eventId)).toMatchObject([{ status: "pending", buyer_name: "Seated Guest", noticed: true }]);
      await api.runDeferred();
      expect((await api.call(confirmFreeOrder, { body: { token: confirmationToken() } })).status).toBe(200);
      expect(await stored(event.eventId)).toMatchObject([{ status: "paid", buyer_name: "Seated Guest", noticed: true }]);
    });
  });
});

describe("the database", () => {
  let event: EventRecord;
  beforeEach(async () => {
    event = await publishedEvent(api, organiser, admin, { ticketTypes: TIERS });
  });

  const insertWith = (columns: string, values: unknown[]) =>
    api.db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents, buyer_fee_cents,
         total_cents, application_fee_cents, ${columns})
       values ($1, $2, $3, 'T', '[]'::jsonb, 0, 0, 0, 0, ${values.map((_, i) => `$${i + 4}`).join(", ")})`,
      [`ord_${crypto.randomUUID().replace(/-/g, "")}`, event.eventId, event.organiserId, ...values],
    );

  it("stamps details_notice_at itself: a name gets now(), a client-supplied stamp is overwritten, no name means none", async () => {
    await insertWith("buyer_name, details_notice_at", ["Dee", "2020-01-01T00:00:00Z"]);
    await insertWith("details_notice_at", ["2020-01-01T00:00:00Z"]);
    await insertWith("buyer_email", ["x@example.com"]);
    const rows = await api.db.query<{ buyer_name: string | null; age: number | null }>(
      `select buyer_name, extract(epoch from now() - details_notice_at)::float8 as age from public.orders order by buyer_name nulls last, created_at`,
    );
    expect(rows[0].buyer_name).toBe("Dee");
    expect(rows[0].age).toBeLessThan(30);
    expect(rows.slice(1).map((r) => [r.buyer_name, r.age])).toEqual([[null, null], [null, null]]);
  });

  it("refuses bad names itself: empty, untrimmed, too long, control or invisible characters", async () => {
    for (const bad of ["", " a", "a ", "a".repeat(81), "a\nb", "a\u0000b".replace("\u0000", "\u0001"), "a​b", "a‮b", "a b", "a﻿b", "a­b", "a\u0085b"]) {
      await expect(insertWith("buyer_name", [bad]), JSON.stringify(bad)).rejects.toThrow(/orders_buyer_name_check/);
    }
    await insertWith("buyer_name", ["a".repeat(80)]);
    await insertWith("buyer_name", ["😀".repeat(80)]);
  });

  it("keeps the pair: a name can't be set or cleared without its notice stamp", async () => {
    await insertWith("buyer_name", ["Dee"]);
    await expect(api.db.query(`update public.orders set details_notice_at = null`)).rejects.toThrow(/can only be cleared/);
    await expect(api.db.query(`update public.orders set buyer_name = null`)).rejects.toThrow(/can only be cleared/);
    // The runbook's withdrawal clears both.
    await api.db.query(`update public.orders set buyer_name = null, details_notice_at = null`);
  });

  describe("orders_details_immutable: details can only be cleared", () => {
    const stamp = () =>
      api.db.query<{ buyer_name: string | null; has_stamp: boolean }>(
        `select buyer_name, details_notice_at is not null as has_stamp from public.orders order by created_at`,
      );

    it("refuses changing a name, changing the stamp, and adding a name to an order without one", async () => {
      await insertWith("buyer_name", ["Dee"]);
      await insertWith("buyer_email", ["x@example.com"]);
      await expect(api.db.query(`update public.orders set buyer_name = 'Eve' where buyer_name = 'Dee'`)).rejects.toThrow(/can only be cleared/);
      await expect(
        api.db.query(`update public.orders set details_notice_at = now() - interval '2 years' where buyer_name = 'Dee'`),
      ).rejects.toThrow(/can only be cleared/);
      await expect(
        api.db.query(`update public.orders set buyer_name = 'Eve', details_notice_at = now() where buyer_name is null`),
      ).rejects.toThrow(/can only be cleared/);
      await expect(api.db.query(`update public.orders set buyer_name = 'Eve' where buyer_name is null`)).rejects.toThrow();
      expect(await stamp()).toEqual([
        { buyer_name: "Dee", has_stamp: true },
        { buyer_name: null, has_stamp: false },
      ]);
    });

    it("allows clearing both (the withdrawal runbook), and updates that leave them alone", async () => {
      await insertWith("buyer_name", ["Dee"]);
      await insertWith("buyer_name", ["Eve"]);
      await api.db.query(`update public.orders set status = 'failed' where buyer_name = 'Dee'`);
      await api.db.query(`update public.orders set buyer_name = buyer_name, details_notice_at = details_notice_at`);
      await api.db.query(`update public.orders set buyer_name = null, details_notice_at = null where buyer_name = 'Dee'`);
      expect(await stamp()).toEqual([
        { buyer_name: null, has_stamp: false },
        { buyer_name: "Eve", has_stamp: true },
      ]);
    });
  });

  describe("orders_buyer_name_check", () => {
    // The regex as it is written in the migration (a plain string there: standard_conforming_strings is on).
    const migration = readFileSync(
      path.resolve(import.meta.dirname, "../../supabase/migrations/20261122000000_order_buyer_details.sql"),
      "utf8",
    );
    const REGEX = /buyer_name !~ '(\[[^']+\])'/.exec(migration)![1];

    it("is written with escapes only: the migration file is pure ASCII", () => {
      expect([...migration].filter((c) => c.codePointAt(0)! > 0x7e || (c.codePointAt(0)! < 0x20 && c !== "\n" && c !== "\r" && c !== "\t"))).toEqual([]);
    });

    it("rejects exactly the control, C1, format (Cf), line and paragraph separator characters and U+034F, except the two joiners", async () => {
      const [{ cps }] = await api.db.query<{ cps: number[] }>(
        `select coalesce(array_agg(i order by i), '{}') as cps
           from generate_series(1, 1114111) i where i not between 55296 and 57343 and chr(i) ~ $1`,
        [REGEX],
      );
      const expected: number[] = [];
      for (let cp = 1; cp <= 0x10ffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        if (cp === 0x200c || cp === 0x200d) continue;
        if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(String.fromCodePoint(cp)) || cp === 0x34f) expected.push(cp);
      }
      expect(cps).toEqual(expected);
    });

    it("never refuses what the API would accept (the API is the stricter)", async () => {
      const [{ cps }] = await api.db.query<{ cps: number[] }>(
        `select array_agg(i order by i) as cps from generate_series(1, 1114111) i where i not between 55296 and 57343 and chr(i) ~ $1`,
        [REGEX],
      );
      const lenient = cps.filter((cp) => !hasInvisibleOrControl(String.fromCodePoint(cp)));
      expect(lenient).toEqual([]);
    });

    it("the table enforces it, on the bidi isolates, the Arabic letter mark and the Mongolian vowel separator too, and allows the joiners", async () => {
      const event = await publishedEvent(api, organiser, admin, { ticketTypes: TIERS });
      const insert = (name: string) =>
        api.db.query(
          `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents, buyer_fee_cents,
             total_cents, application_fee_cents, buyer_name)
           values ($1, $2, $3, 'T', '[]'::jsonb, 0, 0, 0, 0, $4)`,
          [`ord_${crypto.randomUUID().replace(/-/g, "")}`, event.eventId, event.organiserId, name],
        );
      for (const cp of [0x2066, 0x2067, 0x2068, 0x2069, 0x61c, 0x180e, 0x34f, 0x2028, 0x2029, 0xfeff, 0xe0041]) {
        await expect(insert(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).rejects.toThrow(/orders_buyer_name_check/);
      }
      await insert(`a${String.fromCodePoint(0x200c)}b`);
      await insert(`a${String.fromCodePoint(0x200d)}b`);
    });
  });

  it("the old argument lists still work (the name defaults to none)", async () => {
    const user = await api.signUp({ email: "old@example.com" });
    const lines = [{ ticketTypeId: "rsvp", ticketTypeName: "RSVP", unitPriceCents: 0, feePolicy: "buyer-pays" as const, quantity: 1 }];
    const items = JSON.stringify(lines);
    const ticket = () => JSON.stringify(issueTickets(lines));
    const [placed] = await api.db.query<{ result: string }>(
      `select private.place_free_order($1, $2, $3, 'T', $4::text::jsonb, 'old@example.com', null, $5, $6::text::jsonb, 4, 10, '24 hours'::interval) as result`,
      [`ord_${"a".repeat(32)}`, event.eventId, event.organiserId, items, user.userId, ticket()],
    );
    expect(placed.result).toBe("paid");
    // The 13-argument request_free_order (the previous release's) and the 15-argument one.
    for (const [id, email, thirteen] of [
      ["b", "g1@example.com", true],
      ["c", "g2@example.com", false],
    ] as const) {
      const [requested] = await api.db.query<{ result: string }>(
        thirteen
          ? `select private.request_free_order($1, $2, $3, 'T', $4::text::jsonb, $5, null, $6, '24 hours'::interval, 3, '1 hour'::interval, 60, '1 hour'::interval) as result`
          : `select private.request_free_order($1, $2, $3, 'T', $4::text::jsonb, $5, null, $6, '24 hours'::interval, 3, '1 hour'::interval, 60, '1 hour'::interval, 400, '24 hours'::interval) as result`,
        [`ord_${id.repeat(32)}`, event.eventId, event.organiserId, items, email, id.repeat(64).replace(/[^0-9a-f]/g, "0")],
      );
      expect(requested.result).toBe("requested");
    }
    const rows = await api.db.query<{ buyer_name: string | null; details_notice_at: string | null }>(
      `select buyer_name, details_notice_at from public.orders where event_id = $1`,
      [event.eventId],
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.buyer_name === null && r.details_notice_at === null)).toBe(true);
  });
});
