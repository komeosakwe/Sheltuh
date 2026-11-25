import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyTicketItem, MyTicketOrderItem, MyTicketReceivedItem, MyTicketsPage } from "@/lib/api/types";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { listMyTickets } from "@/lib/server/handlers/my-tickets";
import { stripeWebhook } from "@/lib/server/handlers/orders";
import { orderReference } from "@/lib/server/order-reference";
import { encodeCursor } from "@/lib/server/pagination";
import { transferReference } from "@/lib/server/transfer-reference";
import { stripeWebhookRequest, TestApi } from "./helpers/api";
import { generateTicketCode } from "@/lib/server/ticket-issuance";
import { insertOrder, publishedEvent } from "./helpers/fixtures";
import { member, type Member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";
import {
  accept,
  backdate,
  BUYER,
  checkIn,
  codesOf,
  freeOrder,
  mintToken,
  offer,
  paidOrder,
  startEventIn,
  transferRow,
  transferWorld,
  type TransferWorld,
} from "./helpers/ticket-transfers";

/**
 * GET /api/me/tickets (lib/server/handlers/my-tickets.ts; docs/architecture.md,
 * "API" and "Ticket transfers"): a verified member's orders, by their exact
 * verified email, and the tickets sent to them, by their account; upcoming
 * while they hold a ticket and the event hasn't ended, past otherwise.
 */

let api: TestApi;
let reset: () => Promise<void>;
let world: TransferWorld;
/** The member who bought with BUYER (alex@example.com). */
let buyer: Member;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
}, 120_000);

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  vi.stubEnv("NEXT_PUBLIC_TICKET_TRANSFERS", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  world = await transferWorld(api);
  buyer = await member(api, { email: BUYER, displayName: "Alex Chen" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const list = (token?: string, query?: Record<string, string>) => api.call(listMyTickets, { token, query });

async function page(token: string, query?: Record<string, string>): Promise<MyTicketsPage> {
  const res = await list(token, query);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  return res.body as MyTicketsPage;
}

const event = () => ({ eventId: world.eventId, organiserId: world.organiser.organiserId });
const orderIds = (items: MyTicketItem[]) => items.map((i) => (i.kind === "order" ? i.orderId : i.transferId));
const orderCard = (items: MyTicketItem[], orderId: string) =>
  items.find((i): i is MyTicketOrderItem => i.kind === "order" && i.orderId === orderId);

/** Another published event of the organiser (a GA tier, A$30), still to come. */
async function anotherEvent(title = `Night ${crypto.randomUUID().slice(0, 8)}`) {
  const e = await publishedEvent(api, world.organiser, world.admin, {
    title,
    ticketTypes: [{ id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  });
  return { eventId: e.eventId, organiserId: e.organiserId };
}

/** Another event with an order of BUYER's, then moved to start `fromNow` from now (3 hours long; orders are refused once an event has ended). */
async function orderStarting(fromNow: string, status?: "refunded"): Promise<string> {
  const e = await anotherEvent();
  const orderId = await insertOrder(api, e, BUYER, status);
  await startEventIn(api, e.eventId, fromNow);
  return orderId;
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
}

/** Ticket `ticket` of `order` sent to `to` and accepted by them: the transfer's id. */
async function sendAndAccept(order: { orderId: string; access: string }, to: Member, ticket = 1) {
  const transferId = await offer(api, order, { ticket, email: to.email, name: "Sam Lee" });
  const res = await accept(api, await mintToken(api, transferId), to);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return transferId;
}

describe("who may ask", () => {
  it("401 signed out, 403 with an unverified email (both private, no-store), and an unverified caller gets nothing", async () => {
    const signedOut = await list();
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("cache-control")).toBe("private, no-store");

    const unverified = await member(api, { email: "new@example.com", emailVerified: false });
    await insertOrder(api, event(), unverified.email);
    const forbidden = await list(unverified.token);
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("cache-control")).toBe("private, no-store");
    expect(forbidden.body).not.toHaveProperty("items");
    expect(forbidden.body).not.toHaveProperty("counts");
  });

  it("no tickets: an empty page with zero counts and no cursor", async () => {
    expect(await page(buyer.token)).toEqual({ items: [], counts: { upcoming: 0, past: 0 } });
  });
});

describe("whose orders", () => {
  it("the exact verified email, ignoring case; never a +tag, dotted, spaced or missing address", async () => {
    const exact = await insertOrder(api, event(), "Alex@Example.COM");
    await insertOrder(api, event(), "alex+gigs@example.com");
    await insertOrder(api, event(), "a.lex@example.com");
    await insertOrder(api, event(), " alex@example.com");
    await insertOrder(api, event(), null);
    const body = await page(buyer.token);
    expect(orderIds(body.items)).toEqual([exact]);
    // Ignoring case on the account's side too.
    const shouty = await member(api, { email: "LEE@EXAMPLE.COM" });
    const lees = await insertOrder(api, event(), "lee@example.com");
    expect(orderIds((await page(shouty.token)).items)).toEqual([lees]);
  });

  it("never another member's orders or received tickets, whatever the request says", async () => {
    const other = await member(api, { email: "kim@example.com" });
    await insertOrder(api, event(), other.email);
    const order = await paidOrder(api, world.eventId, BUYER, 2);
    await sendAndAccept(order, other);
    const body = await page(buyer.token, { email: other.email, userId: other.userId, accepted_user_id: other.userId });
    expect(orderIds(body.items)).toEqual([order.orderId]);
    expect(body.counts).toEqual({ upcoming: 1, past: 0 });
    expect((await page(other.token)).counts).toEqual({ upcoming: 2, past: 0 });
  });

  it("free and paid orders are listed; pending and failed ones aren't; refunded and oversold ones are past", async () => {
    const free = await freeOrder(api, world.eventId, buyer);
    const paid = (await paidOrder(api, world.eventId, BUYER, 1)).orderId;
    await insertOrder(api, event(), BUYER, "pending");
    await insertOrder(api, event(), BUYER, "failed");
    const oversold = await insertOrder(api, event(), BUYER, "oversold_refund_required");
    const refunded = (await paidOrder(api, world.eventId, BUYER, 1)).orderId;
    await refundInFull(refunded);
    const body = await page(buyer.token);
    expect(body.counts).toEqual({ upcoming: 2, past: 2 });
    const byId = (id: string) => orderCard(body.items, id);
    expect(byId(free)).toMatchObject({ section: "upcoming", status: "paid", totalCents: 0, ticketCount: 1, heldCount: 1, ticketTypeName: "RSVP" });
    expect(byId(free)).not.toHaveProperty("refundReason");
    expect(byId(paid)).toMatchObject({ section: "upcoming", status: "paid", ticketCount: 1, heldCount: 1, ticketTypeName: "GA" });
    expect(byId(paid)?.totalCents).toBeGreaterThan(3000);
    expect(byId(refunded)).toMatchObject({ section: "past", status: "refunded", refundReason: "refunded", ticketCount: 1, heldCount: 0 });
    expect(byId(oversold)).toMatchObject({ section: "past", status: "oversold_refund_required", refundReason: "oversold", ticketCount: 0, heldCount: 0 });
    expect(byId(oversold)).not.toHaveProperty("ticketTypeName");
    expect(body.items).toHaveLength(4);
  });
});

describe("upcoming and past", () => {
  it("in progress is upcoming, ended is past; an unlisted event stays upcoming, without its details", async () => {
    const inProgress = await orderStarting("-1 hour");
    const over = await orderStarting("-5 hours");
    const unlisted = await insertOrder(api, event(), BUYER);
    await api.db.query(`insert into public.event_images (event_id, content_type, data, focus_x, focus_y) values ($1, 'image/png', '\\x89504e47'::bytea, 30, 70)`, [
      world.eventId,
    ]);
    let body = await page(buyer.token);
    expect(orderCard(body.items, unlisted)).toMatchObject({
      section: "upcoming",
      eventListed: true,
      eventTitle: "Test event",
      eventSlug: expect.any(String),
      eventStartsAt: expect.any(String),
      eventEndsAt: expect.any(String),
      eventTimeZone: "Australia/Melbourne",
      eventState: "VIC",
      venueName: "The Tote",
      suburb: "Collingwood",
      imageUrl: expect.stringMatching(new RegExp(`^/api/events/${world.eventId}/image\\?v=\\d+$`)),
      imageFocus: { x: 30, y: 70 },
    });

    const unpublished = await api.call(adminUnpublishEvent, { token: world.admin.token, params: { eventId: world.eventId }, body: { reason: "x" } });
    expect(unpublished.status).toBe(200);
    body = await page(buyer.token);
    expect(body.counts).toEqual({ upcoming: 2, past: 1 });
    expect(orderCard(body.items, inProgress)?.section).toBe("upcoming");
    expect(orderCard(body.items, over)?.section).toBe("past");
    const card = orderCard(body.items, unlisted);
    expect(card).toMatchObject({ section: "upcoming", eventListed: false, eventTitle: "Test event" });
    for (const key of ["eventSlug", "eventStartsAt", "eventEndsAt", "eventTimeZone", "eventState", "venueName", "suburb", "imageUrl", "imageFocus"]) {
      expect(card).not.toHaveProperty(key);
    }
  });

  it("an order whose tickets were all sent away is past; one partly sent counts what's held, on offer and checked in", async () => {
    const kim = await member(api, { email: "kim@example.com" });
    const allSent = await paidOrder(api, world.eventId, BUYER, 1);
    await sendAndAccept(allSent, kim);
    const partly = await paidOrder(api, world.eventId, BUYER, 3);
    await sendAndAccept(partly, kim, 1);
    await offer(api, partly, { ticket: 2, email: "lee@example.com", name: "Lee Park" });
    const codes = await codesOf(api, partly.orderId);
    expect((await checkIn(api, world, codes[2])).body.outcome).toBe("admitted");

    const body = await page(buyer.token);
    expect(body.counts).toEqual({ upcoming: 1, past: 1 });
    expect(orderCard(body.items, allSent.orderId)).toMatchObject({ section: "past", status: "paid", ticketCount: 1, heldCount: 0, pendingCount: 0 });
    expect(orderCard(body.items, partly.orderId)).toMatchObject({
      section: "upcoming",
      ticketCount: 3,
      heldCount: 2,
      pendingCount: 1,
      checkedInCount: 1,
    });
  });

  it("a received ticket is upcoming while it's valid, and void and past once the sender's order is refunded", async () => {
    const sam = await member(api, { email: "sam@example.com", displayName: "Sam Lee" });
    const order = await paidOrder(api, world.eventId, BUYER, 2);
    const transferId = await sendAndAccept(order, sam);
    const row = await transferRow(api, transferId);
    let body = await page(sam.token);
    expect(body.counts).toEqual({ upcoming: 1, past: 0 });
    expect(body.items).toEqual([
      expect.objectContaining({
        kind: "received",
        transferId,
        reference: transferReference(transferId),
        status: "valid",
        section: "upcoming",
        fromName: "Alex Chen",
        holderName: "Sam Lee",
        acceptedAt: new Date(row.decided_at as Date).toISOString(),
        ticketTypeName: "GA",
        eventTitle: "Neon Static",
        eventListed: true,
        venueName: "The Tote",
      }),
    ]);
    expect(body.items[0]).not.toHaveProperty("checkedInAt");
    expect((await checkIn(api, world, row.issued_code as string)).body.outcome).toBe("admitted");
    expect((await page(sam.token)).items[0]).toMatchObject({ checkedInAt: expect.any(String) });

    await refundInFull(order.orderId);
    body = await page(sam.token);
    expect(body.counts).toEqual({ upcoming: 0, past: 1 });
    expect(body.items[0]).toMatchObject({ kind: "received", transferId, status: "void", section: "past" });
    // A void ticket's check-in isn't shown.
    expect(body.items[0]).not.toHaveProperty("checkedInAt");
    // The buyer's own card is past and refunded.
    expect((await page(buyer.token)).items[0]).toMatchObject({ orderId: order.orderId, section: "past", status: "refunded" });
  });
});

describe("what a card counts", () => {
  it("an expired offer, and an offer by someone other than the buyer, aren't on offer", async () => {
    const kim = await member(api, { email: "kim@example.com" });
    const order = await paidOrder(api, world.eventId, BUYER, 3);
    // Ticket 1: sent to Kim, who accepted; then an offer of it by Kim (a holder's re-send, written directly).
    const kims = await sendAndAccept(order, kim, 1);
    const [ticket1] = await codesOf(api, order.orderId);
    await api.db.query(
      `insert into private.ticket_transfers (ticket_code, order_id, event_id, sender_kind, from_transfer_id, sender_user_id,
         sender_name, recipient_name, recipient_email, expires_at)
       values ($1, $2, $3, 'holder', $4, $5, 'Kim Park', 'Lee Park', 'lee@example.com', now() + interval '1 day')`,
      [ticket1, order.orderId, world.eventId, kims, kim.userId],
    );
    // Ticket 2: an offer by the buyer that has expired but wasn't swept yet (still `pending`).
    const expired = await offer(api, order, { ticket: 2, email: "lee@example.com", name: "Lee Park" });
    await backdate(api, expired, "73 hours");
    expect((await transferRow(api, expired)).status).toBe("pending");
    let card = orderCard((await page(buyer.token)).items, order.orderId);
    expect(card).toMatchObject({ ticketCount: 3, heldCount: 2, pendingCount: 0 });
    // Ticket 3: an offer in progress counts.
    await offer(api, order, { ticket: 3, email: "max@example.com", name: "Max Park" });
    card = orderCard((await page(buyer.token)).items, order.orderId);
    expect(card).toMatchObject({ heldCount: 2, pendingCount: 1 });
  });

  it("an order of more than one ticket type has no ticketTypeName", async () => {
    const orderId = await insertOrder(api, event(), BUYER, "paid", { tickets: 0 });
    for (const [id, name] of [["ga", "GA"], ["rsvp", "RSVP"]]) {
      await api.db.query(
        `insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name) values ($1, $2, $3, $4, $5)`,
        [generateTicketCode(), orderId, world.eventId, id, name],
      );
    }
    const card = orderCard((await page(buyer.token)).items, orderId);
    expect(card).toMatchObject({ ticketCount: 2, heldCount: 2 });
    expect(card).not.toHaveProperty("ticketTypeName");
  });
});

describe("received tickets", () => {
  it("one superseded by a later holder is void and past", async () => {
    const sam = await member(api, { email: "sam@example.com" });
    const transferId = await sendAndAccept(await paidOrder(api, world.eventId, BUYER, 1), sam);
    await api.db.query(`update private.ticket_transfers set superseded_at = now() where id = $1`, [transferId]);
    const body = await page(sam.token);
    expect(body.counts).toEqual({ upcoming: 0, past: 1 });
    expect(body.items[0]).toMatchObject({ kind: "received", transferId, status: "void", section: "past" });
  });

  it("one whose event has ended is past, and still valid", async () => {
    const sam = await member(api, { email: "sam@example.com" });
    const transferId = await sendAndAccept(await paidOrder(api, world.eventId, BUYER, 1), sam);
    await startEventIn(api, world.eventId, "-5 hours");
    const body = await page(sam.token);
    expect(body.counts).toEqual({ upcoming: 0, past: 1 });
    expect(body.items[0]).toMatchObject({ kind: "received", transferId, status: "valid", section: "past" });
  });
});

describe("order and pages", () => {
  it("an order and a received ticket for the same event: the order first (by kind, whatever the ids)", async () => {
    const kim = await member(api, { email: "kim@example.com" });
    const mine = (await paidOrder(api, world.eventId, BUYER, 1)).orderId;
    const received = await sendAndAccept(await paidOrder(api, world.eventId, kim.email, 1), buyer);
    // By id alone the transfer's uuid would come first ("ord_…" sorts after any hex digit).
    expect(received < mine).toBe(true);
    const body = await page(buyer.token);
    expect(body.items.map((i) => [i.kind, i.section])).toEqual([
      ["order", "upcoming"],
      ["received", "upcoming"],
    ]);
    expect(orderIds(body.items)).toEqual([mine, received]);
    // Past too.
    await startEventIn(api, world.eventId, "-5 hours");
    expect(orderIds((await page(buyer.token)).items)).toEqual([mine, received]);
  });

  it("upcoming soonest first, then past by the event's end, newest first; ties by kind and id", async () => {
    const later = await anotherEvent();
    const soon = await anotherEvent();
    const a = await insertOrder(api, later, BUYER);
    const [b1, b2] = [await insertOrder(api, soon, BUYER), await insertOrder(api, soon, BUYER)].sort();
    // Refunded, for an event still to come: past, by the event's end (so first of the past ones).
    const r = await insertOrder(api, later, BUYER, "refunded");
    await startEventIn(api, later.eventId, "3 days");
    await startEventIn(api, soon.eventId, "1 day");
    const c = await orderStarting("-1 hour");
    const d = await orderStarting("-27 hours");
    const e = await orderStarting("-7 days");

    const body = await page(buyer.token);
    expect(orderIds(body.items)).toEqual([c, b1, b2, a, r, d, e]);
    expect(body.items.map((i) => i.section)).toEqual(["upcoming", "upcoming", "upcoming", "upcoming", "past", "past", "past"]);
    expect(body.counts).toEqual({ upcoming: 4, past: 3 });
  });

  it("pages by cursor in the same order, with the counts on every page (an empty one too)", async () => {
    const kim = await member(api, { email: "kim@example.com" });
    const order = await paidOrder(api, world.eventId, BUYER, 2);
    await sendAndAccept(order, kim);
    for (const fromNow of ["2 days", "-7 days", "-1 hour"]) await orderStarting(fromNow);
    // A received ticket of the buyer's own: from Kim's order.
    const kims = await paidOrder(api, (await anotherEvent()).eventId, kim.email, 1);
    await sendAndAccept(kims, buyer);

    const all = await page(buyer.token);
    expect(all.items).toHaveLength(5);
    expect(all.items.filter((i) => i.kind === "received")).toHaveLength(1);
    const seen: MyTicketItem[] = [];
    let cursor: string | undefined;
    do {
      const next = await page(buyer.token, { limit: "2", ...(cursor ? { cursor } : {}) });
      expect(next.counts).toEqual(all.counts);
      expect(next.items.length).toBeLessThanOrEqual(2);
      seen.push(...next.items);
      cursor = next.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.items);
    expect(await page(buyer.token, { cursor: encodeCursor(40) })).toEqual({ items: [], counts: all.counts });
  });

  it("a bad cursor is a 400; 20 a page by default, at most 50", async () => {
    for (const cursor of ["nope", encodeCursor(-1), Buffer.from(JSON.stringify({ o: 1e300 })).toString("base64url")]) {
      const res = await list(buyer.token, { cursor });
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    await api.db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
         subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status)
       select 'ord_' || md5(n::text), $1, $2, 'Test event', $3, '[]'::jsonb, 0, 0, 0, 0, 'paid'
         from generate_series(1, 51) n`,
      [world.eventId, world.organiser.organiserId, BUYER],
    );
    const first = await page(buyer.token);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeDefined();
    const capped = await page(buyer.token, { limit: "500" });
    expect(capped.items).toHaveLength(50);
    expect(capped.nextCursor).toBeDefined();
    expect(capped.counts).toEqual({ upcoming: 0, past: 51 });
  });
});

describe("privacy", () => {
  it("no ticket or issued code, buyer name or email, Stripe id or fee split; a received card has nothing of the sender's order", async () => {
    const sam = await member(api, { email: "sam@example.com", displayName: "Sam Lee" });
    const order = await paidOrder(api, world.eventId, BUYER, 2, "Alexandra Buyer");
    const transferId = await sendAndAccept(order, sam);
    // The order's own snapshot of the title differs from the event's: the received card shows the event's.
    await api.db.query(`update public.orders set event_title = 'Title when ordered' where id = $1`, [order.orderId]);
    const [stored] = await api.db.query<{ total: number; subtotal: number; fee: number; app_fee: number; session: string; pi: string }>(
      `select total_cents as total, subtotal_cents as subtotal, buyer_fee_cents as fee, application_fee_cents as app_fee,
              stripe_checkout_session_id as session, stripe_payment_intent_id as pi
         from public.orders where id = $1`,
      [order.orderId],
    );
    const codes = [
      ...(await api.db.query<{ code: string }>(`select code from public.tickets`)).map((r) => r.code),
      (await transferRow(api, transferId)).issued_code as string,
    ];
    expect(codes).toHaveLength(3);

    const mine = await page(buyer.token);
    const theirs = await page(sam.token);
    for (const body of [mine, theirs]) {
      const text = JSON.stringify(body);
      for (const code of codes) expect(text).not.toContain(code);
      expect(text).not.toContain("Alexandra Buyer");
      expect(text).not.toContain(BUYER);
      expect(text).not.toContain("sam@example.com");
      expect(text).not.toContain(stored.session);
      expect(text).not.toContain(stored.pi);
      for (const key of ["buyerName", "buyerEmail", "maskedEmail", "email", "subtotalCents", "buyerFeeCents", "applicationFeeCents", "tickets", "ticketCode"]) {
        expect(text).not.toContain(`"${key}"`);
      }
    }
    expect(orderCard(mine.items, order.orderId)).toMatchObject({ eventTitle: "Title when ordered", totalCents: stored.total, heldCount: 1 });

    const received = theirs.items[0] as MyTicketReceivedItem;
    expect(received.eventTitle).toBe("Neon Static");
    expect(Object.keys(received).sort()).toEqual(
      [
        "kind", "transferId", "reference", "status", "fromName", "holderName", "acceptedAt", "ticketTypeName",
        "section", "eventTitle", "eventListed", "eventSlug", "eventStartsAt", "eventEndsAt", "eventTimeZone", "eventState",
        "venueName", "suburb",
      ].sort(),
    );
    const text = JSON.stringify(received);
    expect(text).not.toContain(order.orderId);
    expect(text).not.toMatch(/ord_/);
    expect(text).not.toContain(orderReference(order.orderId).slice(1));
    expect(text).not.toContain("Title when ordered");
    for (const amount of [stored.total, stored.subtotal, stored.fee]) expect(text).not.toMatch(new RegExp(`:${amount}[,}]`));
  });

  it("the refunded and oversold orders are found by an index on the lower-cased email", async () => {
    const [index] = await api.db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = 'orders_refunded_email_idx'`,
    );
    expect(index?.indexdef).toMatch(/ON public\.orders USING btree \(lower\(buyer_email\)\) WHERE/);
    expect(index?.indexdef).toContain("'refunded'");
    expect(index?.indexdef).toContain("'oversold_refund_required'");
  });
});
