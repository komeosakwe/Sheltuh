import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_ACCESS_HEADER } from "@/lib/api/types";
import { pgConstraint, pgErrorCode } from "@/lib/server/db";
import { maskEmail } from "@/lib/server/email-address";
import { runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { putMyGoing } from "@/lib/server/handlers/going";
import { getMe } from "@/lib/server/handlers/me";
import { changeOrderEmail } from "@/lib/server/handlers/order-email";
import { checkInTicket } from "@/lib/server/handlers/check-ins";
import { createCheckout, getOrderBySession, stripeWebhook } from "@/lib/server/handlers/orders";
import {
  acceptTicketOffer,
  adminCancelTicketTransfer,
  adminListTicketTransfers,
  cancelTicketTransfer,
  declineTicketOffer,
  getReceivedTicket,
  OFFER_UNAVAILABLE,
  sendHeldTicket,
  TICKET_TRANSFER_LIMITS,
  viewTicketOffer,
} from "@/lib/server/handlers/ticket-transfers";
import { orderReference } from "@/lib/server/order-reference";
import { hashTransferToken, transferReference, TRANSFER_TOKEN_PATTERN } from "@/lib/server/ticket-transfers";
import { TICKET_CODE_PATTERN } from "@/lib/ticket-code";
import { generateTicketCode } from "@/lib/server/ticket-issuance";
import { CRON_SECRET, sessionAmount, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { seatedEvent } from "./helpers/seating";
import { member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";
import {
  accept,
  backdate,
  BUYER,
  checkIn,
  codesOf,
  freeOrder,
  jobsOf,
  mintToken,
  offer,
  OFFER,
  paidOrder,
  send,
  startEventIn,
  transferRow,
  transferWorld,
  type TransferWorld,
} from "./helpers/ticket-transfers";

// Ticket transfers ("Send ticket to a friend"): supabase/migrations/20261203000000_ticket_transfers.sql,
// lib/server/handlers/ticket-transfers.ts. The my-ticket.md §7.2 invariants are in ticket-transfer-invariants.test.ts,
// the races in ticket-transfer-races.test.ts (real Postgres).

// The rules, as a test may change one (each test starts from the real ones).
const rules = vi.hoisted(() => ({ overrides: {} as Record<string, unknown> }));
vi.mock("@/lib/ticket-transfer-rules", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ticket-transfer-rules")>();
  return {
    TICKET_TRANSFER_RULES: new Proxy(real.TICKET_TRANSFER_RULES, {
      get: (target, key) => (typeof key === "string" && key in rules.overrides ? rules.overrides[key] : Reflect.get(target, key)),
    }),
  };
});

let api: TestApi;
let reset: () => Promise<void>;
let world: TransferWorld;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  rules.overrides = {};
  vi.stubEnv("NEXT_PUBLIC_TICKET_TRANSFERS", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  world = await transferWorld(api);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const view = (orderId: string, headers: Record<string, string> = {}, token?: string) =>
  api.call(getOrderBySession, { params: { sessionId: orderId }, headers, token });

const viewOffer = (token: string, account?: { token: string }, ip?: string) =>
  api.call(viewTicketOffer, { body: { token }, token: account?.token, headers: ip ? { "x-forwarded-for": ip } : undefined });

const cancel = (orderId: string, transferId: string, options: { access?: string; token?: string } = {}) =>
  api.call(cancelTicketTransfer, {
    params: { sessionId: orderId, transferId },
    body: {},
    token: options.token,
    headers: options.access ? { [ORDER_ACCESS_HEADER]: options.access } : undefined,
  });

const decline = (token: string) => api.call(declineTicketOffer, { body: { token } });

/** The SQLSTATE and constraint a statement is refused with, or null when it isn't. */
async function refusedBy(sql: string, params: unknown[] = []) {
  try {
    await api.db.query(sql, params);
  } catch (err) {
    return { code: pgErrorCode(err), constraint: pgConstraint(err) };
  }
  return null;
}

/** A full refund made in Stripe (charge.refunded): the order is refunded, its tickets void. */
async function refundInFull(orderId: string) {
  const [{ total }] = await api.db.query<{ total: number }>(`select total_cents as total from public.orders where id = $1`, [orderId]);
  const res = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "charge.refunded",
      data: { object: { id: `ch_${orderId}`, object: "charge", payment_intent: `pi_${orderId}`, amount_refunded: total, refunded: true } },
    }),
  );
  expect(res.status).toBe(200);
  const [row] = await api.db.query<{ status: string }>(`select status::text as status from public.orders where id = $1`, [orderId]);
  expect(row.status).toBe("refunded");
}

/** A sent and accepted ticket 1 of a 2-ticket paid order. */
async function acceptedTransfer() {
  const order = await paidOrder(api, world.eventId);
  const transferId = await offer(api, order);
  const token = await mintToken(api, transferId);
  const recipient = await member(api, { email: "sam@example.com" });
  const res = await accept(api, token, recipient);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { order, transferId, token, recipient, row: await transferRow(api, transferId) };
}

describe("sending", () => {
  it("the paying browser sends a paid ticket: 201, an offer in progress on the page, and the offer email queued", async () => {
    const order = await paidOrder(api, world.eventId);
    const res = await send(api, order.orderId, OFFER, { access: order.access });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const transferId = res.body.transferId as string;
    expect(res.body.order.tickets[0]).toMatchObject({
      ticketNumber: 1,
      canSend: false,
      transfer: { transferId, status: "pending", toName: "Sam Lee", toMaskedEmail: "s***@example.com", canCancel: true },
    });
    expect(res.body.order.tickets[1]).toMatchObject({ ticketNumber: 2, canSend: true });
    expect(res.body.order.tickets[1]).not.toHaveProperty("transfer");
    expect(res.body.order.transfers).toMatchObject({ canSend: true });
    const row = await transferRow(api, transferId);
    expect(row).toMatchObject({ status: "pending", sender_kind: "buyer", sender_user_id: null });
    expect(row.ticket_code).toBe((await codesOf(api, order.orderId))[0]);
    expect(await jobsOf(api, transferId)).toEqual(["transfer_offer"]);
    // Nothing leases a transfer job yet (PR-1): no email is sent.
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("a free ticket can be sent too", async () => {
    const buyer = await member(api, { email: "rsvp@example.com" });
    const orderId = await freeOrder(api, world.eventId, buyer);
    const res = await send(api, orderId, OFFER, { token: buyer.token });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await transferRow(api, res.body.transferId)).sender_user_id).toBe(buyer.userId);
  });

  it("refuses a type the rules don't allow: 409 ticket_type_not_transferable", async () => {
    rules.overrides = { allowPaid: false };
    const order = await paidOrder(api, world.eventId);
    const res = await send(api, order.orderId, OFFER, { access: order.access });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ticket_type_not_transferable");
    const buyer = await member(api, { email: "rsvp@example.com" });
    const free = await freeOrder(api, world.eventId, buyer);
    expect((await send(api, free, OFFER, { token: buyer.token })).status).toBe(201);
    rules.overrides = { allowFree: false };
    expect((await send(api, free, { ...OFFER, email: "other@example.com" }, { token: buyer.token })).status).toBe(409);
  });

  it("expires 72 hours from now, or at the cut-off (2 hours before the start) when that's sooner", async () => {
    const order = await paidOrder(api, world.eventId);
    const far = await transferRow(api, await offer(api, order));
    expect(far.expires_at.getTime() - far.created_at.getTime()).toBe(72 * 3600 * 1000);
    await startEventIn(api, world.eventId, "10 hours");
    const near = await transferRow(api, await offer(api, order, { ticket: 2 }));
    const [event] = await api.db.query<{ starts_at: Date }>(`select starts_at from public.events where id = $1`, [world.eventId]);
    expect(near.expires_at.getTime()).toBe(event.starts_at.getTime() - 2 * 3600 * 1000);
  });

  it("closes 2 hours before the start: 409 transfers_closed, and the page says so", async () => {
    const order = await paidOrder(api, world.eventId);
    await startEventIn(api, world.eventId, "1 hour");
    const res = await send(api, order.orderId, OFFER, { access: order.access });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("transfers_closed");
    expect((await view(order.orderId, { [ORDER_ACCESS_HEADER]: order.access })).body.transfers).toMatchObject({
      canSend: false,
      reason: "closed",
    });
  });

  describe("who may send (owner decision D1)", () => {
    it("the order's link alone may not: 403 order_owner_only, naming the buying address masked; nothing written", async () => {
      const order = await paidOrder(api, world.eventId);
      const res = await send(api, order.orderId);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: "order_owner_only",
        error: `Sign in with the email you bought with (${maskEmail(BUYER)}) to send this ticket.`,
      });
      expect(await api.db.query(`select 1 from private.ticket_transfers`)).toEqual([]);
      // The page says why.
      expect((await view(order.orderId)).body.transfers).toEqual(expect.objectContaining({ canSend: false, reason: "sign_in" }));
    });

    it("once the order's email has changed, the 403 no longer names an address (as the order's link shows none)", async () => {
      const order = await paidOrder(api, world.eventId);
      const changed = await api.call(changeOrderEmail, {
        params: { sessionId: order.orderId },
        body: { email: "alex.new@example.com" },
        headers: { [ORDER_ACCESS_HEADER]: order.access },
      });
      expect(changed.status).toBe(200);
      const res = await send(api, order.orderId);
      expect(res.body).toMatchObject({ code: "order_owner_only", error: "Sign in with the email you bought with to send this ticket." });
      expect(JSON.stringify(res.body)).not.toContain("a***@example.com");
      // The buyer's own change keeps the paying browser in control.
      expect((await send(api, order.orderId, OFFER, { access: order.access })).status).toBe(201);
    });

    it("after support changes the order's email, the paying browser's token can't send or cancel; the new address's account can", async () => {
      const order = await paidOrder(api, world.eventId);
      const transferId = await offer(api, order);
      const [job] = await api.db.query<{ id: string }>(
        `select id::text as id from private.email_outbox where order_id = $1 and kind = 'ticket_email'`,
        [order.orderId],
      );
      const [change] = await api.db.query<{ result: string }>(
        `select result from private.admin_change_order_email($1, $2::bigint, 'alex.new@example.com', 'Checked with the buyer', 20, '1 hour')`,
        [world.admin.userId, job.id],
      );
      expect(change.result).toBe("changed");
      const sent = await send(api, order.orderId, { ...OFFER, ticket: 2 }, { access: order.access });
      expect([sent.status, sent.body.code, sent.body.error]).toEqual([
        403,
        "order_owner_only",
        "Sign in with the email you bought with to send this ticket.",
      ]);
      expect((await cancel(order.orderId, transferId, { access: order.access })).status).toBe(403);
      // The page no longer offers the token anything either.
      const page = await view(order.orderId, { [ORDER_ACCESS_HEADER]: order.access });
      expect(page.body.tickets[0].transfer).toEqual({ status: "pending", expiresAt: expect.any(String), canCancel: false });
      expect(page.body.transfers).toMatchObject({ canSend: false, reason: "sign_in" });
      // The database refuses it too, under the order's lock.
      const [direct] = await api.db.query<{ result: string }>(
        `select result from private.create_ticket_transfer($1, 2, null, 'Alex', 'Sam', 'kim@example.com', true, true, '2 hours',
           '72 hours', 1, 5, 20, 10, '1 day', 3, '1 day', 300, '1 day')`,
        [order.orderId],
      );
      expect(direct.result).toBe("owner_only");
      const [directCancel] = await api.db.query<{ result: string }>(
        `select result from private.cancel_ticket_transfer($1, $2, 'sender', null, null, null)`,
        [transferId, order.orderId],
      );
      expect(directCancel.result).toBe("owner_only");
      const buyer = await member(api, { email: "alex.new@example.com" });
      expect((await send(api, order.orderId, { ...OFFER, ticket: 2, email: "kim@example.com" }, { token: buyer.token })).status).toBe(201);
      expect((await cancel(order.orderId, transferId, { token: buyer.token })).status).toBe(200);
    });

    it("a signed-in account with the buying email, in any case: 201, recorded as the sender", async () => {
      const order = await paidOrder(api, world.eventId);
      const buyer = await member(api, { email: "ALEX@Example.com" });
      const res = await send(api, order.orderId, OFFER, { token: buyer.token });
      expect(res.status).toBe(201);
      expect((await transferRow(api, res.body.transferId)).sender_user_id).toBe(buyer.userId);
      expect(res.body.order.tickets[0].transfer.canCancel).toBe(true);
    });

    it("not a +tag or Gmail-dot variant, an unverified account, or another account: 403", async () => {
      const order = await paidOrder(api, world.eventId, "alex.chen@gmail.com");
      for (const account of [
        await member(api, { email: "alex.chen+tix@gmail.com" }),
        await member(api, { email: "alexchen@gmail.com" }),
        await member(api, { email: "Alex.Chen@gmail.com", emailVerified: false }),
        await member(api, { email: "someone@example.com" }),
      ]) {
        const res = await send(api, order.orderId, OFFER, { token: account.token });
        expect([account.email, res.status, res.body.code]).toEqual([account.email, 403, "order_owner_only"]);
      }
    });

    it("an unknown order is a 404 (a malformed id without a query)", async () => {
      expect((await send(api, `ord_${"0".repeat(32)}`, OFFER, { access: "a".repeat(64) })).status).toBe(404);
      expect((await send(api, "not-an-order", OFFER)).status).toBe(404);
    });
  });

  it("validates every field at once: 400 fieldErrors", async () => {
    const order = await paidOrder(api, world.eventId);
    const res = await send(api, order.orderId, { ticket: 0, name: "", email: "not an email", senderName: "a@b" }, { access: order.access });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["email", "name", "senderName", "ticket"]);
    expect(res.body.fieldErrors.email).toBe("Enter a valid email");
  });

  it("refuses the buyer's own address, ignoring case: 409 own_email with fieldErrors.email", async () => {
    const order = await paidOrder(api, world.eventId);
    const res = await send(api, order.orderId, { ...OFFER, email: BUYER.toUpperCase() }, { access: order.access });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "own_email", fieldErrors: { email: "That's your own email" } });
  });

  it("refuses an address with a typo'd domain (the buyer email checks): 400 email_typo", async () => {
    const order = await paidOrder(api, world.eventId);
    const res = await send(api, order.orderId, { ...OFFER, email: "sam@gmial.com" }, { access: order.access });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("email_typo");
  });

  it("one offer at a time per ticket (409 transfer_pending); an unknown ticket number is a 404", async () => {
    const order = await paidOrder(api, world.eventId);
    await offer(api, order);
    const again = await send(api, order.orderId, { ...OFFER, email: "other@example.com" }, { access: order.access });
    expect([again.status, again.body.code]).toEqual([409, "transfer_pending"]);
    expect((await send(api, order.orderId, { ...OFFER, ticket: 3 }, { access: order.access })).status).toBe(404);
  });

  it("refuses a ticket that's been checked in: 409 ticket_checked_in", async () => {
    const order = await paidOrder(api, world.eventId);
    const [code] = await codesOf(api, order.orderId);
    expect((await checkIn(api, world, code)).body.outcome).toBe("admitted");
    const res = await send(api, order.orderId, OFFER, { access: order.access });
    expect([res.status, res.body.code]).toEqual([409, "ticket_checked_in"]);
  });

  it("once per ticket: after it's accepted, 409 ticket_already_sent", async () => {
    const { order } = await acceptedTransfer();
    const res = await send(api, order.orderId, { ...OFFER, email: "other@example.com" }, { access: order.access });
    expect([res.status, res.body.code]).toEqual([409, "ticket_already_sent"]);
  });

  it("5 offers per ticket, any outcome: then 409 transfer_attempts_used", async () => {
    const order = await paidOrder(api, world.eventId);
    for (let i = 0; i < TICKET_TRANSFER_LIMITS.maxOffersPerTicket; i++) {
      const id = await offer(api, order, { email: `friend${i}@example.com` });
      expect((await cancel(order.orderId, id, { access: order.access })).status).toBe(200);
    }
    const res = await send(api, order.orderId, { ...OFFER, email: "last@example.com" }, { access: order.access });
    expect([res.status, res.body.code]).toEqual([409, "transfer_attempts_used"]);
  });

  it("the sender's pending cap (a database parameter): pending_cap", async () => {
    const order = await paidOrder(api, world.eventId);
    const buyer = await member(api, { email: BUYER });
    const call = (ticket: number) =>
      api.db.query<{ result: string }>(
        `select result from private.create_ticket_transfer($1, $2, $3, 'Alex', 'Sam', $4, true, true, '2 hours', '72 hours',
           1, 5, 1, 10, '1 day', 3, '1 day', 300, '1 day')`,
        [order.orderId, ticket, buyer.userId, `f${ticket}@example.com`],
      );
    expect((await call(1))[0].result).toBe("created");
    expect((await call(2))[0].result).toBe("pending_cap");
  });

  describe("limits", () => {
    it("per client: 429 rate_limited with Retry-After, before anything else", async () => {
      const order = await paidOrder(api, world.eventId);
      for (let i = 0; i < TICKET_TRANSFER_LIMITS.sendsPerClient.hits; i++) {
        await send(api, order.orderId, { ...OFFER, ticket: 99 }, { access: order.access, ip: "203.0.113.7" });
      }
      const res = await send(api, order.orderId, OFFER, { access: order.access, ip: "203.0.113.7" });
      expect([res.status, res.body.code, res.headers.get("retry-after")]).toEqual([429, "rate_limited", "3600"]);
    });

    it("per order: 429 once the order's daily allowance is used", async () => {
      const order = await paidOrder(api, world.eventId);
      for (let i = 0; i < TICKET_TRANSFER_LIMITS.sendsPerOrder.hits; i++) {
        await send(api, order.orderId, { ...OFFER, ticket: 99 }, { access: order.access });
      }
      const res = await send(api, order.orderId, OFFER, { access: order.access });
      expect([res.status, res.body.code, res.headers.get("retry-after")]).toEqual([429, "rate_limited", "86400"]);
    });

    it("3 offers a day per recipient address, across senders: the 4th is a 429 and writes nothing", async () => {
      const orders = [await paidOrder(api, world.eventId, "a@example.com"), await paidOrder(api, world.eventId, "b@example.com")];
      await offer(api, orders[0]);
      await offer(api, orders[0], { ticket: 2 });
      await offer(api, orders[1]);
      const [before] = await api.db.query<{ n: number; jobs: number; hits: number }>(
        `select (select count(*)::int from private.ticket_transfers) as n,
                (select count(*)::int from private.email_outbox where ticket_transfer_id is not null) as jobs,
                (select hits from private.platform_rate_limits where bucket = 'ticket_transfer_offers_daily') as hits`,
      );
      const res = await send(api, orders[1].orderId, { ...OFFER, ticket: 2, email: "SAM@example.com" }, { access: orders[1].access });
      expect([res.status, res.body.code, res.headers.get("retry-after")]).toEqual([429, "rate_limited", "86400"]);
      const [after] = await api.db.query<{ n: number; jobs: number; hits: number }>(
        `select (select count(*)::int from private.ticket_transfers) as n,
                (select count(*)::int from private.email_outbox where ticket_transfer_id is not null) as jobs,
                (select hits from private.platform_rate_limits where bucket = 'ticket_transfer_offers_daily') as hits`,
      );
      expect(after).toEqual(before);
      expect(before).toEqual({ n: 3, jobs: 3, hits: 3 });
    });

    it("the platform's daily offers and the account's daily sends (database parameters): rate_limited, nothing kept", async () => {
      const order = await paidOrder(api, world.eventId);
      const buyer = await member(api, { email: BUYER });
      const call = (ticket: number, accountLimit: number, platformLimit: number) =>
        api.db.query<{ result: string }>(
          `select result from private.create_ticket_transfer($1, $2, $3, 'Alex', 'Sam', $4, true, true, '2 hours', '72 hours',
             1, 5, 20, $5, '1 day', 3, '1 day', $6, '1 day')`,
          [order.orderId, ticket, buyer.userId, `f${ticket}@example.com`, accountLimit, platformLimit],
        );
      expect((await call(1, 1, 300))[0].result).toBe("created");
      expect((await call(2, 1, 300))[0].result).toBe("rate_limited");
      expect((await call(2, 10, 1))[0].result).toBe("rate_limited");
      const [hits] = await api.db.query<{ account: number; platform: number }>(
        `select (select hits from private.rate_limits where user_id = $1 and bucket = 'ticket_transfer_sends') as account,
                (select hits from private.platform_rate_limits where bucket = 'ticket_transfer_offers_daily') as platform`,
        [buyer.userId],
      );
      expect(hits).toEqual({ account: 1, platform: 1 });
    });
  });
});

describe("seated and group tickets", () => {
  it("a seated ticket keeps its seat: on the offer, the received ticket and at the door", async () => {
    const { event } = await seatedEvent(api, world.organiser, world.admin);
    const held = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { seats: { mapVersion: event.seating!.version, seatIds: ["A1", "A2"] }, buyerEmail: BUYER },
    });
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    const orderId = held.body.orderId as string;
    const paid = await api.send(
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
            customer_details: { email: BUYER },
          },
        },
      }),
    );
    expect(paid.status).toBe(200);
    const transferId = await offer(api, { orderId, access: held.body.orderAccess });
    const token = await mintToken(api, transferId);
    const seat = { section: expect.any(String), row: "A", seat: expect.any(String), kind: "standard" };
    expect((await viewOffer(token)).body).toMatchObject({ ticketTypeName: "Premium", seat });
    const sam = await member(api, { email: "sam@example.com" });
    expect((await accept(api, token, sam)).status).toBe(200);
    const received = await api.call(getReceivedTicket, { token: sam.token, params: { transferId } });
    expect(received.body.ticket).toMatchObject({ ticketTypeName: "Premium", seat });
    const page = await view(orderId);
    expect(page.body.transferredTickets).toEqual([expect.objectContaining({ ticketNumber: 1, seat })]);
    expect(page.body.tickets).toEqual([expect.objectContaining({ ticketNumber: 2, seat })]);
    const scan = await api.call(checkInTicket, {
      token: world.organiser.token,
      params: { eventId: event.eventId },
      body: { code: received.body.ticket.ticketCode, requestId: crypto.randomUUID() },
    });
    expect(scan.body).toMatchObject({ outcome: "admitted", ticket: { ticketNumber: 1, ticketCount: 2, seat: { row: "A" } } });
  });

  it("a group ticket's person is sent alone: their place in the group stays, the others keep their codes", async () => {
    const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
    await api.db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
         subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status)
       values ($1, $2, $3, 'Neon Static', $4, $5::text::jsonb, 6000, 0, 6000, 0, 'paid')`,
      [
        orderId,
        world.eventId,
        world.organiser.organiserId,
        BUYER,
        JSON.stringify([{ ticketTypeId: "ga", ticketTypeName: "GA", unitPriceCents: 6000, feePolicy: "buyer-pays", quantity: 1, admits: 2 }]),
      ],
    );
    for (let i = 0; i < 2; i++) {
      await api.db.query(
        `insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name, group_size)
         values ($1, $2, $3, 'ga', 'GA', 2)`,
        [generateTicketCode(), orderId, world.eventId],
      );
    }
    const buyer = await member(api, { email: BUYER });
    const sent = await send(api, orderId, { ...OFFER, ticket: 2 }, { token: buyer.token });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const token = await mintToken(api, sent.body.transferId);
    expect((await viewOffer(token)).body).toMatchObject({ ticketTypeName: "GA", group: { position: 2, size: 2 } });
    expect((await accept(api, token, await member(api, { email: "sam@example.com" }))).status).toBe(200);
    const page = await view(orderId);
    expect(page.body.tickets).toEqual([expect.objectContaining({ ticketNumber: 1, group: { position: 1, size: 2 } })]);
    expect(page.body.transferredTickets).toEqual([expect.objectContaining({ ticketNumber: 2, group: { position: 2, size: 2 } })]);
    const [first, second] = await codesOf(api, orderId);
    expect((await checkIn(api, world, second)).body.outcome).toBe("transferred");
    expect((await checkIn(api, world, first)).body.outcome).toBe("admitted");
  });
});

describe("the flag (NEXT_PUBLIC_TICKET_TRANSFERS)", () => {
  it("off: sending is a 404 and the page offers none; an offer already made can still be viewed, accepted, declined and cancelled", async () => {
    const order = await paidOrder(api, world.eventId);
    const first = await offer(api, order);
    const second = await offer(api, order, { ticket: 2, email: "kim@example.com" });
    vi.stubEnv("NEXT_PUBLIC_TICKET_TRANSFERS", "");
    expect((await send(api, order.orderId, OFFER, { access: order.access })).status).toBe(404);
    const page = await view(order.orderId, { [ORDER_ACCESS_HEADER]: order.access });
    expect(page.body).not.toHaveProperty("transfers");
    expect(page.body.tickets[0]).not.toHaveProperty("canSend");
    // Offers in progress still show, and can be cancelled.
    expect(page.body.tickets[1].transfer).toMatchObject({ transferId: second, canCancel: true });
    const token = await mintToken(api, first);
    expect((await viewOffer(token)).body.status).toBe("open");
    const recipient = await member(api, { email: "sam@example.com" });
    expect((await accept(api, token, recipient)).status).toBe(200);
    // With sending off, only an offer still waiting can be cancelled: anything else is a 404, before control.
    expect((await cancel(order.orderId, first)).status).toBe(404);
    expect((await cancel(order.orderId, second, { access: order.access })).status).toBe(200);
    expect((await cancel(order.orderId, second, { access: order.access })).status).toBe(404);
  });
});

describe("cancel", () => {
  it("the sender cancels: 200 with the page's order; the link stops working; their code still checks in", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    const token = await mintToken(api, transferId);
    const res = await cancel(order.orderId, transferId, { access: order.access });
    expect(res.status).toBe(200);
    expect(res.body.order.tickets[0]).not.toHaveProperty("transfer");
    expect(res.body.order.tickets[0].canSend).toBe(true);
    expect(await transferRow(api, transferId)).toMatchObject({ status: "cancelled", cancelled_by: "sender" });
    expect(await jobsOf(api, transferId)).toEqual(["transfer_offer"]);
    expect((await viewOffer(token)).status).toBe(404);
    const [code] = await codesOf(api, order.orderId);
    expect((await checkIn(api, world, code)).body.outcome).toBe("admitted");
  });

  it("only with control of the order (403), only while pending (409 transfer_not_pending), only the order's own (404)", async () => {
    const order = await paidOrder(api, world.eventId);
    const other = await paidOrder(api, world.eventId, "other@example.com");
    const transferId = await offer(api, order);
    // The order's link alone sees the offer, but can't cancel it.
    expect((await view(order.orderId)).body.tickets[0].transfer.canCancel).toBe(false);
    expect((await cancel(order.orderId, transferId)).status).toBe(403);
    expect((await cancel(other.orderId, transferId, { access: other.access })).status).toBe(404);
    expect((await cancel(order.orderId, "not-a-uuid", { access: order.access })).status).toBe(404);
    expect((await cancel(order.orderId, transferId, { access: order.access })).status).toBe(200);
    const again = await cancel(order.orderId, transferId, { access: order.access });
    expect([again.status, again.body.code]).toEqual([409, "transfer_not_pending"]);
  });

  it("is refused when the rules don't let senders cancel: 409 cancel_not_allowed", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    rules.overrides = { senderMayCancel: false };
    const res = await cancel(order.orderId, transferId, { access: order.access });
    expect([res.status, res.body.code]).toEqual([409, "cancel_not_allowed"]);
  });
});

describe("the offer link: view", () => {
  it("an open offer: the sender's and recipient's names, the ticket and event, nothing about the order", async () => {
    const order = await paidOrder(api, world.eventId);
    const token = await mintToken(api, await offer(api, order));
    expect(token).toMatch(TRANSFER_TOKEN_PATTERN);
    const res = await viewOffer(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toMatchObject({
      status: "open",
      fromName: "Alex Chen",
      toName: "Sam Lee",
      toMaskedEmail: "s***@example.com",
      eventTitle: "Neon Static",
      eventListed: true,
      venueName: "The Tote",
      suburb: "Collingwood",
      ticketTypeName: "GA",
    });
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "status", "fromName", "toName", "toMaskedEmail", "expiresAt", "eventTitle", "eventListed", "eventSlug",
        "eventStartsAt", "eventEndsAt", "eventTimeZone", "eventState", "venueName", "suburb", "ticketTypeName",
      ].sort(),
    );
  });

  it("one 404 for every link that can't be opened: unknown, malformed, declined, cancelled, expired, accepted by someone else", async () => {
    const order = await paidOrder(api, world.eventId, BUYER, 4);
    const declined = await mintToken(api, await offer(api, order, { email: "a@example.com" }));
    expect((await decline(declined)).status).toBe(200);
    const cancelledId = await offer(api, order, { ticket: 2, email: "b@example.com" });
    const cancelled = await mintToken(api, cancelledId);
    await cancel(order.orderId, cancelledId, { access: order.access });
    const expiredId = await offer(api, order, { ticket: 3, email: "c@example.com" });
    const expired = await mintToken(api, expiredId);
    await backdate(api, expiredId, "73 hours");
    const taken = await mintToken(api, await offer(api, order, { ticket: 4 }));
    expect((await accept(api, taken, await member(api, { email: "sam@example.com" }))).status).toBe(200);
    const someoneElse = await member(api, { email: "kim@example.com" });
    for (const token of ["A".repeat(43), "short", declined, cancelled, expired, taken]) {
      const res = await viewOffer(token, someoneElse);
      expect([res.status, res.body.error]).toEqual([404, OFFER_UNAVAILABLE]);
    }
  });

  it("an accepted offer, for the account that accepted it: its received ticket's id", async () => {
    const { token, recipient, transferId } = await acceptedTransfer();
    expect((await viewOffer(token, recipient)).body).toEqual({ status: "accepted", transferId });
    expect((await viewOffer(token)).status).toBe(404);
  });

  it("every view counts against the client's allowance: 429", async () => {
    for (let i = 0; i < TICKET_TRANSFER_LIMITS.viewsPerClient.hits; i++) await viewOffer("A".repeat(43), undefined, "203.0.113.9");
    const res = await viewOffer("A".repeat(43), undefined, "203.0.113.9");
    expect([res.status, res.headers.get("retry-after")]).toEqual([429, "3600"]);
  });
});

describe("accept", () => {
  it("any verified account: a new code of its own, a new pass serial, the notice stamped, the emails queued", async () => {
    const { order, transferId, recipient, row } = await acceptedTransfer();
    const [original] = await codesOf(api, order.orderId);
    expect(row).toMatchObject({ status: "accepted", accepted_user_id: recipient.userId, accepted_email: "sam@example.com", holder_name: "Sam Lee" });
    expect(row.issued_code).toMatch(TICKET_CODE_PATTERN);
    expect(row.issued_code).not.toBe(original);
    expect(row.holder_notice_at).not.toBeNull();
    const [ticket] = await api.db.query<{ serial: string }>(`select wallet_serial::text as serial from public.tickets where code = $1`, [original]);
    expect(row.wallet_serial).not.toBeNull();
    expect(row.wallet_serial).not.toBe(ticket.serial);
    expect(await jobsOf(api, transferId)).toEqual(["transfer_accepted", "transfer_offer", "transfer_ticket"]);
  });

  it("the account needn't be the address it was sent to (owner decision O1); the sender sees who, masked", async () => {
    const order = await paidOrder(api, world.eventId);
    const token = await mintToken(api, await offer(api, order));
    const kim = await member(api, { email: "kim@example.org" });
    expect((await accept(api, token, kim, "Kim Park")).status).toBe(200);
    const page = await view(order.orderId, { [ORDER_ACCESS_HEADER]: order.access });
    expect(page.body.transferredTickets).toEqual([
      expect.objectContaining({ ticketNumber: 1, holderName: "Kim Park", acceptedByMaskedEmail: "k***@example.org" }),
    ]);
  });

  it("who an offer went to and who holds a sent ticket only for a request that controls the order", async () => {
    const order = await paidOrder(api, world.eventId);
    const token = await mintToken(api, await offer(api, order));
    await offer(api, order, { ticket: 2, email: "kim@example.com", name: "Kim Park" });
    expect((await accept(api, token, await member(api, { email: "sam@example.com" }))).status).toBe(200);
    const anyone = await view(order.orderId);
    expect(anyone.body.transferredTickets).toEqual([{ ticketNumber: 1, ticketTypeName: "GA", acceptedAt: expect.any(String) }]);
    expect(anyone.body.tickets[0].transfer).toEqual({ status: "pending", expiresAt: expect.any(String), canCancel: false });
    const text = JSON.stringify(anyone.body);
    for (const leak of ["Sam Lee", "Kim Park", "s***@example.com", "k***@example.com"]) expect(text).not.toContain(leak);
    const buyer = await view(order.orderId, { [ORDER_ACCESS_HEADER]: order.access });
    expect(buyer.body.transferredTickets[0]).toMatchObject({ holderName: "Sam Lee" });
    expect(buyer.body.tickets[0].transfer).toMatchObject({ toName: "Kim Park", toMaskedEmail: "k***@example.com", canCancel: true });
  });

  it("again by the same account: 200, the same id; by another: the uniform 404", async () => {
    const { token, recipient, transferId } = await acceptedTransfer();
    expect((await accept(api, token, recipient)).body).toEqual({ transferId });
    const other = await member(api, { email: "kim@example.com" });
    expect(await accept(api, token, other)).toMatchObject({ status: 404, body: { error: OFFER_UNAVAILABLE } });
  });

  it("signed out 401; unverified 403; a bad name 400", async () => {
    const order = await paidOrder(api, world.eventId);
    const token = await mintToken(api, await offer(api, order));
    expect((await api.call(acceptTicketOffer, { body: { token, holderName: "Sam" } })).status).toBe(401);
    expect((await accept(api, token, await member(api, { emailVerified: false }))).status).toBe(403);
    const res = await accept(api, token, await member(api), "@sam");
    expect([res.status, Object.keys(res.body.fieldErrors)]).toEqual([400, ["holderName"]]);
  });

  it("not by the buyer (own_ticket): their account by email, or the account that sent it", async () => {
    const order = await paidOrder(api, world.eventId);
    const buyer = await member(api, { email: "Alex@Example.com" });
    const token = await mintToken(api, await offer(api, order));
    expect(await accept(api, token, buyer)).toMatchObject({ status: 409, body: { code: "own_ticket" } });
    const other = await paidOrder(api, world.eventId, "jo@example.com");
    const sender = await member(api, { email: "jo@example.com" });
    const sent = await send(api, other.orderId, OFFER, { token: sender.token });
    const senderToken = await mintToken(api, sent.body.transferId);
    await api.db.query(`update auth.users set email = 'jo.new@example.com' where id = $1`, [sender.userId]);
    const renamed = api.tokenFor({ userId: sender.userId, email: "jo.new@example.com", emailVerified: true, isAdmin: false });
    expect(await accept(api, senderToken, { token: renamed })).toMatchObject({ status: 409, body: { code: "own_ticket" } });
  });

  it("closes when the event moves earlier: 409 transfers_closed", async () => {
    const order = await paidOrder(api, world.eventId);
    const token = await mintToken(api, await offer(api, order));
    await startEventIn(api, world.eventId, "90 minutes");
    expect(await accept(api, token, await member(api))).toMatchObject({ status: 409, body: { code: "transfers_closed" } });
  });

  it("an overdue offer is expired on the spot (lazily): 404, and the sender's email queued", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    const token = await mintToken(api, transferId);
    await backdate(api, transferId, "73 hours");
    expect((await accept(api, token, await member(api))).status).toBe(404);
    expect((await transferRow(api, transferId)).status).toBe("expired");
    expect(await jobsOf(api, transferId)).toEqual(["transfer_expired", "transfer_offer"]);
  });

  it("a send expires the ticket's overdue offer first, then makes the new one", async () => {
    const order = await paidOrder(api, world.eventId);
    const old = await offer(api, order);
    await backdate(api, old, "73 hours");
    const fresh = await offer(api, order, { email: "kim@example.com" });
    expect((await transferRow(api, old)).status).toBe("expired");
    expect(await jobsOf(api, old)).toEqual(["transfer_expired", "transfer_offer"]);
    expect((await transferRow(api, fresh)).status).toBe("pending");
  });

  it("a refunded order's or a checked-in ticket's offer: 409 ticket_unavailable", async () => {
    const order = await paidOrder(api, world.eventId);
    const first = await mintToken(api, await offer(api, order));
    const [code] = await codesOf(api, order.orderId);
    // Checked in while the offer was out (the sender's QR still works then).
    expect((await checkIn(api, world, code)).body.outcome).toBe("admitted");
    expect(await accept(api, first, await member(api))).toMatchObject({ status: 409, body: { code: "ticket_unavailable" } });
    const jo = await paidOrder(api, world.eventId, "jo@example.com");
    const second = await mintToken(api, await offer(api, jo));
    await refundInFull(jo.orderId);
    expect(await accept(api, second, await member(api))).toMatchObject({ status: 409, body: { code: "ticket_unavailable" } });
  });

  it("an account holds at most so many received tickets per event (a database parameter): held_cap", async () => {
    const recipient = await member(api, { email: "sam@example.com" });
    const tokens = [];
    for (const email of ["a@example.com", "b@example.com"]) {
      tokens.push(await mintToken(api, await offer(api, await paidOrder(api, world.eventId, email, 1))));
    }
    const call = (token: string, code: string) =>
      api.db.query<{ result: string }>(
        `select result from private.accept_ticket_transfer($1, $2, 'sam@example.com', 'Sam', $3, '2 hours', 1, 10, '1 hour')`,
        [hashTransferToken(token), recipient.userId, code],
      );
    expect((await call(tokens[0], "AAAA-AAAA"))[0].result).toBe("accepted");
    expect((await call(tokens[1], "BBBB-BBBB"))[0].result).toBe("held_cap");
    // A code that's already a ticket's or an issued one: code_taken (the API retries).
    const [taken] = await codesOf(api, (await paidOrder(api, world.eventId, "c@example.com", 1)).orderId);
    const third = await mintToken(api, await offer(api, await paidOrder(api, world.eventId, "d@example.com", 1)));
    const kim = await member(api, { email: "kim@example.com" });
    for (const code of [taken, "AAAA-AAAA"]) {
      const [row] = await api.db.query<{ result: string }>(
        `select result from private.accept_ticket_transfer($1, $2, 'kim@example.com', 'Kim', $3, '2 hours', 10, 10, '1 hour')`,
        [hashTransferToken(third), kim.userId, code],
      );
      expect(row.result).toBe("code_taken");
    }
  });

  it("the account's allowance: 429 rate_limited, and the offer stays open", async () => {
    const recipient = await member(api, { email: "sam@example.com" });
    const transferId = await offer(api, await paidOrder(api, world.eventId));
    const token = await mintToken(api, transferId);
    const limit = TICKET_TRANSFER_LIMITS.acceptsPerAccount;
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'ticket_transfer_accepts', now(), $2)`,
      [recipient.userId, limit.hits],
    );
    const res = await accept(api, token, recipient);
    expect([res.status, res.body.code, res.headers.get("retry-after")]).toEqual([429, "rate_limited", "3600"]);
    expect((await transferRow(api, transferId)).status).toBe("pending");
    expect(await jobsOf(api, transferId)).toEqual(["transfer_offer"]);
  });
});

describe("decline (no sign-in)", () => {
  it("declines: 200, the link dies, the sender's email is queued and their code still checks in", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    const token = await mintToken(api, transferId);
    expect((await decline(token)).body).toEqual({ status: "declined" });
    expect((await transferRow(api, transferId)).status).toBe("declined");
    expect(await jobsOf(api, transferId)).toEqual(["transfer_declined", "transfer_offer"]);
    expect((await decline(token)).status).toBe(404);
    expect((await viewOffer(token)).status).toBe(404);
    // It can be sent again, and the sender's code still checks in meanwhile.
    expect((await send(api, order.orderId, { ...OFFER, email: "kim@example.com" }, { access: order.access })).status).toBe(201);
    const [code] = await codesOf(api, order.orderId);
    expect((await checkIn(api, world, code)).body.outcome).toBe("admitted");
  });

  it("a malformed token is the uniform 404", async () => {
    expect(await decline("nope")).toMatchObject({ status: 404, body: { error: OFFER_UNAVAILABLE } });
  });
});

describe("the expiry sweep (the email cron)", () => {
  it("expires overdue offers and queues their emails; a current one is left", async () => {
    const order = await paidOrder(api, world.eventId);
    const overdue = await offer(api, order);
    const current = await offer(api, order, { ticket: 2, email: "kim@example.com" });
    await backdate(api, overdue, "73 hours");
    const res = await api.send(
      runEmailOutboxCron,
      new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(200);
    expect((await transferRow(api, overdue)).status).toBe("expired");
    expect(await jobsOf(api, overdue)).toEqual(["transfer_expired", "transfer_offer"]);
    expect((await transferRow(api, current)).status).toBe("pending");
    // Past the cut-off counts as overdue too.
    await startEventIn(api, world.eventId, "1 hour");
    const [swept] = await api.db.query<{ n: number }>(`select private.expire_ticket_transfers(200, '2 hours') as n`);
    expect(swept.n).toBe(1);
    expect((await transferRow(api, current)).status).toBe("expired");
  });
});

describe("the received ticket", () => {
  it("the recipient's own code, the ticket and event; never the order's id, reference or buyer", async () => {
    const { transferId, recipient, row, order } = await acceptedTransfer();
    const res = await api.call(getReceivedTicket, { token: recipient.token, params: { transferId } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toMatchObject({
      transferId,
      reference: transferReference(transferId),
      fromName: "Alex Chen",
      holderName: "Sam Lee",
      status: "valid",
      eventTitle: "Neon Static",
      ticket: { ticketCode: row.issued_code, ticketTypeName: "GA", checkedInAt: null },
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(order.orderId);
    expect(text).not.toContain(orderReference(order.orderId).slice(1));
    expect(text).not.toContain(BUYER);
  });

  it("another account's, or an unverified caller: 404 / 403", async () => {
    const { transferId } = await acceptedTransfer();
    expect((await api.call(getReceivedTicket, { token: (await member(api)).token, params: { transferId } })).status).toBe(404);
    expect((await api.call(getReceivedTicket, { token: (await member(api, { emailVerified: false })).token, params: { transferId } })).status).toBe(403);
    expect((await api.call(getReceivedTicket, { token: (await member(api)).token, params: { transferId: "nope" } })).status).toBe(404);
  });

  it("void once the buyer's order is refunded (owner decision D9): no code, and the door says void", async () => {
    const { transferId, recipient, row, order } = await acceptedTransfer();
    await refundInFull(order.orderId);
    const res = await api.call(getReceivedTicket, { token: recipient.token, params: { transferId } });
    expect(res.body.status).toBe("void");
    expect(res.body).not.toHaveProperty("ticket");
    expect(res.body).not.toHaveProperty("venueName");
    expect((await checkIn(api, world, row.issued_code as string)).body.outcome).toBe("not_admissible");
  });

  it("can't be sent on while recipients may not re-send: 409 resend_not_allowed", async () => {
    const { transferId, recipient } = await acceptedTransfer();
    const res = await api.call(sendHeldTicket, { token: recipient.token, params: { transferId }, body: OFFER });
    expect([res.status, res.body.code]).toEqual([409, "resend_not_allowed"]);
    // In the database too: once per ticket.
    const [row] = await api.db.query<{ result: string }>(
      `select result from private.create_holder_ticket_transfer($1, $2, 'Sam', 'Kim', 'kim@example.com', true, true,
         '2 hours', '72 hours', 1, 5, 20, 10, '1 day', 3, '1 day', 300, '1 day')`,
      [transferId, recipient.userId],
    );
    expect(row.result).toBe("already_sent");
  });

  it("with re-sending allowed (two rules), the holder sends it on and the new holder replaces them", async () => {
    rules.overrides = { recipientMayResend: true, maxAcceptedPerTicket: 2 };
    const { transferId, recipient, row } = await acceptedTransfer();
    const res = await api.call(sendHeldTicket, {
      token: recipient.token,
      params: { transferId },
      body: { name: "Kim Park", email: "kim@example.com", senderName: "Sam Lee" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const order = (await api.db.query<{ order_id: string }>(`select order_id from private.ticket_transfers where id = $1`, [transferId]))[0];
    const [buyerCancel] = await api.db.query<{ result: string }>(
      `select result from private.cancel_ticket_transfer($1, $2, 'sender', null, null, null)`,
      [res.body.transferId, order.order_id],
    );
    expect(buyerCancel.result).toBe("not_found");
    const token = await mintToken(api, res.body.transferId);
    const kim = await member(api, { email: "kim@example.com" });
    expect(await accept(api, token, recipient)).toMatchObject({ status: 409, body: { code: "own_ticket" } });
    expect((await accept(api, token, kim, "Kim Park")).status).toBe(200);
    const sam = await api.call(getReceivedTicket, { token: recipient.token, params: { transferId } });
    expect(sam.body.status).toBe("void");
    const kims = await transferRow(api, res.body.transferId);
    expect((await checkIn(api, world, row.issued_code as string)).body.outcome).toBe("transferred");
    expect((await checkIn(api, world, kims.issued_code as string)).body.outcome).toBe("admitted");
  });
});

describe("Who's Going and GET /me", () => {
  it("the sender's opt-in goes when they gave away their only ticket; the recipient can opt in", async () => {
    const buyer = await member(api, { email: BUYER });
    const order = await paidOrder(api, world.eventId, BUYER, 1);
    const going = (account: { token: string }) =>
      api.call(putMyGoing, { token: account.token, params: { eventId: world.eventId }, method: "PUT" });
    expect((await going(buyer)).status).toBe(200);
    const me = async (account: { token: string }) => (await api.call(getMe, { token: account.token })).body.upcomingCount;
    expect(await me(buyer)).toBe(1);
    const token = await mintToken(api, await offer(api, order));
    const recipient = await member(api, { email: "sam@example.com" });
    expect(await me(recipient)).toBe(0);
    expect((await accept(api, token, recipient)).status).toBe(200);
    expect(await api.db.query(`select 1 from public.event_attendees where user_id = $1`, [buyer.userId])).toEqual([]);
    expect((await going(buyer)).status).toBe(403);
    expect((await going(recipient)).status).toBe(200);
    expect(await me(buyer)).toBe(0);
    expect(await me(recipient)).toBe(1);
  });

  it("is kept when the sender still holds another ticket for the event", async () => {
    const buyer = await member(api, { email: BUYER });
    const order = await paidOrder(api, world.eventId, BUYER, 2);
    expect((await api.call(putMyGoing, { token: buyer.token, params: { eventId: world.eventId }, method: "PUT" })).status).toBe(200);
    const token = await mintToken(api, await offer(api, order));
    expect((await accept(api, token, await member(api, { email: "sam@example.com" }))).status).toBe(200);
    expect(await api.db.query(`select 1 from public.event_attendees where user_id = $1`, [buyer.userId])).toHaveLength(1);
  });
});

describe("retention (purge_operational_data)", () => {
  it("deletes tokens 30 days after their offer was decided and unaccepted offers 30 days after the event; keeps accepted ones", async () => {
    const order = await paidOrder(api, world.eventId, BUYER, 2);
    const declinedId = await offer(api, order);
    const declinedToken = await mintToken(api, declinedId);
    await decline(declinedToken);
    const acceptedId = await offer(api, order, { ticket: 2 });
    await accept(api, await mintToken(api, acceptedId), await member(api, { email: "sam@example.com" }));
    const counts = async () =>
      (
        await api.db.query<{ tokens: number; transfers: number }>(
          `select (select count(*)::int from private.ticket_transfer_tokens) as tokens,
                  (select count(*)::int from private.ticket_transfers) as transfers`,
        )
      )[0];
    await api.db.query(`select private.purge_operational_data()`);
    expect(await counts()).toEqual({ tokens: 2, transfers: 2 });
    await backdate(api, declinedId, "31 days");
    await backdate(api, acceptedId, "31 days");
    let [purged] = await api.db.query<{ ticket_transfer_tokens_deleted: number; ticket_transfers_deleted: number }>(
      `select * from private.purge_operational_data()`,
    );
    expect(purged).toMatchObject({ ticket_transfer_tokens_deleted: 2, ticket_transfers_deleted: 0 });
    await api.db.query(
      `update public.events set starts_at = now() - interval '32 days', ends_at = now() - interval '31 days' where id = $1`,
      [world.eventId],
    );
    [purged] = await api.db.query(`select * from private.purge_operational_data()`);
    expect(purged).toMatchObject({ ticket_transfers_deleted: 1 });
    expect((await transferRow(api, acceptedId)).status).toBe("accepted");
    expect(await transferRow(api, declinedId)).toBeUndefined();
  });
});

describe("buyer email changes (PR #65)", () => {
  it("still work after a ticket was sent, and the recipient's scan isn't the buyer's", async () => {
    const { order, row } = await acceptedTransfer();
    expect((await checkIn(api, world, row.issued_code as string)).body.outcome).toBe("admitted");
    const [block] = await api.db.query<{ block: string | null }>(`select private.order_email_change_block($1) as block`, [order.orderId]);
    expect(block.block).toBeNull();
    const res = await api.call(changeOrderEmail, {
      params: { sessionId: order.orderId },
      body: { email: "alex.new@example.com" },
      headers: { [ORDER_ACCESS_HEADER]: order.access },
    });
    expect(res.status).toBe(200);
    expect(res.body.order.tickets).toHaveLength(1);
    expect(res.body.order.transferredTickets).toEqual([expect.objectContaining({ ticketNumber: 1, holderName: "Sam Lee" })]);
    // The buyer's own scan still counts.
    const [own] = await codesOf(api, order.orderId).then((codes) => codes.slice(1));
    expect((await checkIn(api, world, own)).body.outcome).toBe("admitted");
    const [after] = await api.db.query<{ block: string | null }>(`select private.order_email_change_block($1) as block`, [order.orderId]);
    expect(after.block).toBe("scanned");
  });
});

describe("support", () => {
  it("lists offers by order or transfer reference, addresses masked only; non-admins 403", async () => {
    const { order, transferId } = await acceptedTransfer();
    const list = (query: Record<string, string>, token = world.admin.token) => api.call(adminListTicketTransfers, { token, query });
    for (const reference of [orderReference(order.orderId), transferReference(transferId).slice(1).toLowerCase()]) {
      const res = await list({ reference });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        expect.objectContaining({
          transferId,
          reference: transferReference(transferId),
          orderReference: orderReference(order.orderId),
          status: "accepted",
          senderKind: "paying_browser",
          toName: "Sam Lee",
          toMaskedEmail: "s***@example.com",
          holderName: "Sam Lee",
          acceptedMaskedEmail: "s***@example.com",
        }),
      ]);
      expect(JSON.stringify(res.body)).not.toContain("sam@example.com");
    }
    expect((await list({})).body.items).toHaveLength(1);
    expect((await list({ reference: "nope" })).status).toBe(400);
    expect((await list({}, (await member(api)).token)).status).toBe(403);
  });

  it("cancels a pending offer with a reason; 409 once it isn't; the reason's rules; non-admins 403", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    const cancelAsAdmin = (reason: unknown, token = world.admin.token) =>
      api.call(adminCancelTicketTransfer, { token, params: { transferId }, body: { reason } });
    expect((await cancelAsAdmin("no")).status).toBe(400);
    expect((await cancelAsAdmin("Asked by sam@example.com")).body.fieldErrors.reason).toBe("Leave email addresses out of the reason.");
    expect((await cancelAsAdmin("Buyer asked", (await member(api)).token)).status).toBe(403);
    expect((await cancelAsAdmin("Buyer asked us to")).body).toEqual({ result: "cancelled" });
    expect(await transferRow(api, transferId)).toMatchObject({ status: "cancelled", cancelled_by: "admin", cancel_reason: "Buyer asked us to" });
    expect((await cancelAsAdmin("Buyer asked us to")).body.code).toBe("transfer_not_pending");
  });
});

describe("the database's own rules", () => {
  it("the guard: an offer's details never change, an accepted one never goes back", async () => {
    const { transferId } = await acceptedTransfer();
    for (const change of [
      `recipient_email = 'x@example.com'`,
      `status = 'pending', decided_at = null`,
      `issued_code = 'ZZZZ-ZZZZ'`,
      `expires_at = expires_at + interval '1 day'`,
    ]) {
      expect(await refusedBy(`update private.ticket_transfers set ${change} where id = $1`, [transferId])).toEqual({
        code: "23514",
        constraint: "ticket_transfers_guard",
      });
    }
    // Once, by support's runbook.
    await api.db.query(`update private.ticket_transfers set holder_details_withdrawn_at = now() where id = $1`, [transferId]);
    expect(
      await refusedBy(`update private.ticket_transfers set holder_details_withdrawn_at = now() + interval '1 second' where id = $1`, [
        transferId,
      ]),
    ).toEqual({ code: "23514", constraint: "ticket_transfers_guard" });
  });

  it("support's redaction: a decided offer's typed details become the placeholders, once; never a pending one", async () => {
    const { transferId, order } = await acceptedTransfer();
    const redact = (id: string) =>
      refusedBy(
        `update private.ticket_transfers set sender_name = 'Redacted', recipient_name = 'Redacted',
                recipient_email = 'redacted@redacted.invalid', details_redacted_at = now() where id = $1`,
        [id],
      );
    expect(await redact(transferId)).toBeNull();
    const [row] = await api.db.query<{ sender_name: string; recipient_email: string }>(
      `select sender_name, recipient_email from private.ticket_transfers where id = $1`,
      [transferId],
    );
    expect(row).toEqual({ sender_name: "Redacted", recipient_email: "redacted@redacted.invalid" });
    expect(await redact(transferId)).toMatchObject({ constraint: "ticket_transfers_guard" });
    const pending = await offer(api, order, { ticket: 2, email: "kim@example.com" });
    expect(await redact(pending)).toMatchObject({ constraint: "ticket_transfers_guard" });
    // Only the placeholders.
    await decline(await mintToken(api, pending));
    expect(
      await refusedBy(`update private.ticket_transfers set recipient_name = 'Someone', details_redacted_at = now() where id = $1`, [pending]),
    ).toMatchObject({ code: "23514", constraint: "ticket_transfers_redacted" });
  });

  it("a deleted account's references are set to null (the foreign keys' own update)", async () => {
    const { transferId, recipient } = await acceptedTransfer();
    await api.db.query(`delete from auth.users where id = $1`, [recipient.userId]);
    expect((await transferRow(api, transferId)).accepted_user_id).toBeNull();
  });

  it("a new ticket never gets a code already issued to a recipient", async () => {
    const { row, order } = await acceptedTransfer();
    expect(
      await refusedBy(
        `insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name) values ($1, $2, $3, 'ga', 'GA')`,
        [row.issued_code, order.orderId, world.eventId],
      ),
    ).toEqual({ code: "23505", constraint: "tickets_pkey" });
  });

  it("names are checked as the buyer's are (person_name_ok)", async () => {
    const [row] = await api.db.query<{ ok: boolean[] }>(
      `select array[private.person_name_ok('Sam'), private.person_name_ok(' Sam'), private.person_name_ok(''),
                    private.person_name_ok(repeat('a', 81)), private.person_name_ok('Sa' || chr(8203) || 'm')] as ok`,
    );
    expect(row.ok).toEqual([true, false, false, false, false]);
  });
});
