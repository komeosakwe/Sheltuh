import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_NO_MAIL_MESSAGE, EMAIL_TYPO_MESSAGE } from "@/lib/server/email-domain";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import type { EventRecord, SeatMapRecord } from "@/lib/server/types";
import { embeddedSession, sessionAmount, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// The checkout's buyer email checks (lib/server/email-domain.ts) and the Stripe prefill / webhook rule
// (docs/architecture.md, "Buyer email checks").

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

const TIERS = [
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 },
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
  await enablePayouts(api, organiser.organiserId);
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    n += 1;
    return embeddedSession(`cs_test_${n}`);
  });
  api.mailDomainAnswers.set("nomail.example.net", "no_mail");
});

const checkout = (eventId: string, body: Record<string, unknown>, options: { token?: string; key?: string } = {}) =>
  api.call(createCheckout, {
    params: { eventId },
    body,
    token: options.token,
    headers: options.key ? { "idempotency-key": options.key } : undefined,
  });

const PAID = { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] };
const FREE = { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }] };

async function nothingWritten() {
  const [counts] = await api.db.query<{ orders: number; attempts: number; refusals: number; jobs: number }>(
    `select (select count(*)::int from public.orders) as orders,
            (select count(*)::int from private.checkout_attempts) as attempts,
            (select count(*)::int from private.free_order_refusals) as refusals,
            (select count(*)::int from private.email_outbox) as jobs`,
  );
  expect(counts).toEqual({ orders: 0, attempts: 0, refusals: 0, jobs: 0 });
  expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  expect(api.sendEmail).not.toHaveBeenCalled();
}

describe("checkout email checks", () => {
  it("a paid checkout with a listed typo: 400 email_typo with the correction, nothing written, DNS not asked", async () => {
    const res = await checkout(event.eventId, { ...PAID, buyerEmail: "Mia@gmial.com" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: EMAIL_TYPO_MESSAGE,
      fieldErrors: { buyerEmail: EMAIL_TYPO_MESSAGE },
      code: "email_typo",
      suggestion: "Mia@gmail.com",
    });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(api.mailDomainLookups).toEqual([]);
    await nothingWritten();
  });

  it("a paid checkout to a domain that can't receive email: 400 email_no_mail, nothing written", async () => {
    const res = await checkout(event.eventId, { ...PAID, buyerEmail: "fan@nomail.example.net" });
    expect([res.status, res.body.code, res.body.fieldErrors]).toEqual([400, "email_no_mail", { buyerEmail: EMAIL_NO_MAIL_MESSAGE }]);
    expect(res.body).not.toHaveProperty("suggestion");
    await nothingWritten();
  });

  it("a checkout to a special-use name (.test, .local, .onion …): 400 email_no_mail without any DNS lookup, nothing written", async () => {
    for (const buyerEmail of ["fan@inbox.test", "fan@nas.local", "fan@abcdefgh.onion"]) {
      const res = await checkout(event.eventId, { ...PAID, buyerEmail });
      expect([res.status, res.body.code, res.body.fieldErrors], buyerEmail).toEqual([400, "email_no_mail", { buyerEmail: EMAIL_NO_MAIL_MESSAGE }]);
    }
    expect(api.mailDomainLookups).toEqual([]);
    await nothingWritten();
  });

  it("free bookings get the same checks (guest and member alike), before any refusal is counted", async () => {
    const guest = await checkout(event.eventId, { ...FREE, buyerEmail: "fan@hotmial.com" });
    expect([guest.status, guest.body.code, guest.body.suggestion]).toEqual([400, "email_typo", "fan@hotmail.com"]);
    const member = await api.signUp({ email: "member@nomail.example.net" });
    const own = await checkout(event.eventId, { ...FREE, buyerEmail: "member@nomail.example.net" }, { token: member.token });
    expect([own.status, own.body.code]).toEqual([400, "email_no_mail"]);
    await nothingWritten();
  });

  it("the format is still checked first, and a paid checkout without an email is still taken (Stripe asks for one)", async () => {
    const bad = await checkout(event.eventId, { ...PAID, buyerEmail: "not an email" });
    expect([bad.status, bad.body.fieldErrors]).toEqual([400, { buyerEmail: "Enter a valid email address." }]);
    expect(bad.body).not.toHaveProperty("code");
    const none = await checkout(event.eventId, PAID);
    expect(none.status).toBe(201);
    expect(api.mailDomainLookups).toEqual([]);
    const params = api.stripe.checkout.sessions.create.mock.lastCall![0];
    expect(params).not.toHaveProperty("customer_email");
  });

  it("EMAIL_DOMAIN_CHECKS=off: a typo domain goes through as typed", async () => {
    api.emailDomainChecks = false;
    expect((await checkout(event.eventId, { ...PAID, buyerEmail: "fan@gmial.com" })).status).toBe(201);
    expect(api.stripe.checkout.sessions.create.mock.lastCall![0].customer_email).toBe("fan@gmial.com");
  });

  it("a replay is answered before the checks: it never depends on DNS", async () => {
    const key = crypto.randomUUID();
    const body = { ...PAID, buyerEmail: "fan@slow.example.net" };
    expect((await checkout(event.eventId, body, { key })).status).toBe(201);
    expect(api.mailDomainLookups).toEqual(["slow.example.net"]);
    // Had DNS changed its mind since, the replay would still be the same order.
    api.mailDomainAnswers.set("slow.example.net", "no_mail");
    const again = await checkout(event.eventId, body, { key });
    expect(again.status).toBe(200);
    expect(api.mailDomainLookups).toEqual(["slow.example.net"]);
  });

  describe("seated", () => {
    let map: SeatMapRecord;
    beforeEach(async () => {
      ({ event, map } = await seatedEvent(api, organiser, admin, { overrides: { title: "Hall" } }));
    });

    it("a paid seated checkout with a typo: 400 email_typo, no hold, no order", async () => {
      const res = await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1"] }, buyerEmail: "fan@gmail.con" });
      expect([res.status, res.body.code, res.body.suggestion]).toEqual([400, "email_typo", "fan@gmail.com"]);
      const held = await api.db.query(`select id from public.event_seats where event_id = $1 and hold_order_id is not null`, [event.eventId]);
      expect(held).toEqual([]);
      await nothingWritten();
    });

    it("the typed address prefills Stripe's form (customer_email), and the webhook keeps it over Stripe's", async () => {
      const res = await checkout(event.eventId, { seats: { mapVersion: map.version, seatIds: ["A1"] }, buyerEmail: "Fan@Example.com" });
      expect(res.status).toBe(201);
      expect(api.stripe.checkout.sessions.create.mock.lastCall![0].customer_email).toBe("Fan@Example.com");
      await pay(res.body.orderId, "someone.else@example.org");
      expect(await buyerEmail(res.body.orderId)).toBe("Fan@Example.com");
    });
  });
});

async function pay(orderId: string, stripeEmail: string | null) {
  const res = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_paid_${orderId}`,
          object: "checkout.session",
          client_reference_id: orderId,
          ...(await sessionAmount(api.db, orderId)),
          payment_status: "paid",
          payment_intent: `pi_${orderId}`,
          customer_details: stripeEmail ? { email: stripeEmail } : null,
        },
      },
    }),
  );
  expect(res.status).toBe(200);
}

async function buyerEmail(orderId: string) {
  const [row] = await api.db.query<{ buyer_email: string | null; status: string }>(
    `select buyer_email, status::text as status from public.orders where id = $1`,
    [orderId],
  );
  expect(row.status).toBe("paid");
  return row.buyer_email;
}

describe("Stripe prefill and the webhook (general admission)", () => {
  it("customer_email is the address typed on our page, and the webhook keeps ours even if the buyer changed it in Stripe", async () => {
    const res = await checkout(event.eventId, { ...PAID, buyerEmail: "fan@example.com" });
    expect(res.status).toBe(201);
    expect(api.stripe.checkout.sessions.create.mock.lastCall![0].customer_email).toBe("fan@example.com");
    await pay(res.body.orderId, "typo@exampel.com");
    expect(await buyerEmail(res.body.orderId)).toBe("fan@example.com");
    await api.runDeferred();
    expect(api.sendEmail.mock.calls.map(([message]) => message.to)).toEqual(["fan@example.com"]);
  });

  it("an order without an address (an older client) still takes Stripe's", async () => {
    const res = await checkout(event.eventId, PAID);
    await pay(res.body.orderId, "fan@example.com");
    expect(await buyerEmail(res.body.orderId)).toBe("fan@example.com");
  });
});
