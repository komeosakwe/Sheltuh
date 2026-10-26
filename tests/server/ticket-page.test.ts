import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { checkInTicket, undoCheckIn } from "@/lib/server/handlers/check-ins";
import { confirmFreeOrder } from "@/lib/server/handlers/free-orders";
import { createCheckout, getOrderBySession, stripeWebhook } from "@/lib/server/handlers/orders";
import type { EmailMessage } from "@/lib/server/email";
import { encodePng } from "@/lib/server/png";
import { orderReference, ticketPageLink } from "@/lib/server/ticket-email";
import type { EventRecord } from "@/lib/server/types";
import { TICKET_CODE_PATTERN } from "@/lib/ticket-code";
import { ticketQrMatrix } from "@/lib/ticket-qr";
import { embeddedSession, sessionAmount, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// The buyer's side of a ticket: issuance (paid and free, one ticket and
// several), the ticket page's payload (GET /api/orders/by-session/{id}: event
// details and each ticket's check-in status), and the links that lead to it.
// The door's side (scans, races, refunds, authorisation) is check-ins.test.ts.

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

const TICKETS = [
  { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 20 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 5 },
  { id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 },
];

let intents = 0;

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
  event = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
  await enablePayouts(api, organiser.organiserId);
  let sessions = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    const id = `cs_test_${++sessions}`;
    return embeddedSession(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Ticket = { ticketCode: string; ticketTypeName: string; checkedInAt: string | null };

const page = async (orderId: string) => (await api.call(getOrderBySession, { params: { sessionId: orderId } })).body;

/** A paid order (checkout, then Stripe's webhook). */
async function paidOrder(lineItems: { ticketTypeId: string; quantity: number }[]) {
  const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems } });
  expect(res.status).toBe(201);
  const session = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0];
  const orderId = session.client_reference_id as string;
  const paymentIntent = `pi_test_${++intents}`;
  const paid = await api.send(
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
  expect(paid.status).toBe(200);
  return { orderId, paymentIntent, returnUrl: session.return_url as string };
}

/** A free order booked by a member with their own verified email: issued straight away. */
async function memberFreeOrder(quantity: number) {
  const member = await api.signUp({ email: `member-${crypto.randomUUID().slice(0, 8)}@example.com` });
  const res = await api.call(createCheckout, {
    token: member.token,
    params: { eventId: event.eventId },
    body: { lineItems: [{ ticketTypeId: "rsvp", quantity }], buyerEmail: member.email },
  });
  expect(res.status).toBe(201);
  return { url: res.body.url as string, orderId: new URL(res.body.url).searchParams.get("session_id") as string };
}

/** A guest's free order: book, then confirm with the emailed link's token. */
async function guestFreeOrder(quantity: number) {
  const res = await api.call(createCheckout, {
    params: { eventId: event.eventId },
    body: { lineItems: [{ ticketTypeId: "rsvp", quantity }], buyerEmail: "guest@example.com" },
  });
  expect(res.status).toBe(202);
  // A guest's confirmation email goes out after the response (Deps.defer), as in production.
  await api.runDeferred();
  const token = api.sendEmail.mock.calls.at(-1)![0].text.match(/#token=([A-Za-z0-9_-]+)/)![1];
  const confirmed = await api.call(confirmFreeOrder, { body: { token } });
  expect(confirmed.status).toBe(200);
  return { url: confirmed.body.url as string, orderId: new URL(confirmed.body.url).searchParams.get("session_id") as string };
}

/** The ticket email for an order (sent through the outbox, as after a real purchase). */
async function ticketEmail(orderId: string): Promise<EmailMessage> {
  await api.runDeferred();
  const sent = api.sendEmail.mock.calls.map(([m]) => m).filter((m) => m.subject.startsWith("Your tickets"));
  const reference = orderReference(orderId);
  const email = sent.find((m) => m.text.includes(`Order reference: ${reference}`));
  if (!email) throw new Error(`no ticket email for ${reference}`);
  return email;
}

/** Codes that are well formed, all different, each with its own QR, and the email carrying exactly those QRs. */
async function expectDistinctTicketsAndQrs(orderId: string, count: number) {
  const body = await page(orderId);
  expect(body.status).toBe("paid");
  const codes = (body.tickets as Ticket[]).map((t) => t.ticketCode);
  expect(codes).toHaveLength(count);
  expect(new Set(codes).size).toBe(count);
  for (const code of codes) expect(code).toMatch(TICKET_CODE_PATTERN);
  const matrices = codes.map((code) => JSON.stringify(ticketQrMatrix(code)));
  expect(new Set(matrices).size).toBe(count);

  const email = await ticketEmail(orderId);
  const qrs = (email.inlineImages ?? []).filter((image) => image.cid.startsWith("ticket-qr-"));
  expect(qrs).toHaveLength(count);
  for (const [i, code] of codes.entries()) {
    // The email's QR for ticket n is ticket n's code, in the same order as the page.
    // 16 px a module, 4-module quiet zone (lib/server/ticket-email.ts).
    expect(qrs[i].content.equals(encodePng(ticketQrMatrix(code)!, 16, 4))).toBe(true);
    expect(email.html).toContain(`>${code}</td>`);
    expect(email.text).toContain(`Entry code: ${code}`);
  }
  return codes;
}

describe("issuing tickets: every ticket gets its own code and QR", () => {
  it("a paid order with one ticket", async () => {
    const { orderId } = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }]);
    await expectDistinctTicketsAndQrs(orderId, 1);
  });

  it("a paid order with several tickets of several types", async () => {
    const { orderId } = await paidOrder([
      { ticketTypeId: "ga", quantity: 3 },
      { ticketTypeId: "vip", quantity: 2 },
    ]);
    await expectDistinctTicketsAndQrs(orderId, 5);
  });

  it("a member's free order with one ticket, and with several", async () => {
    const one = await memberFreeOrder(1);
    await expectDistinctTicketsAndQrs(one.orderId, 1);
    const four = await memberFreeOrder(4);
    const codes = await expectDistinctTicketsAndQrs(four.orderId, 4);
    // And none repeats another order's.
    const all = await api.db.query<{ n: number; distinct: number }>(`select count(*)::int as n, count(distinct code)::int as distinct from public.tickets`);
    expect(all[0]).toEqual({ n: 5, distinct: 5 });
    expect(codes).not.toContain((await page(one.orderId)).tickets[0].ticketCode);
  });

  it("a guest's free order with one ticket, and with several, once confirmed", async () => {
    const one = await guestFreeOrder(1);
    await expectDistinctTicketsAndQrs(one.orderId, 1);
    const three = await guestFreeOrder(3);
    await expectDistinctTicketsAndQrs(three.orderId, 3);
  });
});

describe("the ticket page (GET /api/orders/by-session/{id})", () => {
  it("shows the event's date, time, venue name and suburb, and each ticket's type, ready to scan", async () => {
    const { orderId } = await paidOrder([
      { ticketTypeId: "vip", quantity: 1 },
      { ticketTypeId: "ga", quantity: 1 },
    ]);
    const body = await page(orderId);
    expect(body).toMatchObject({
      status: "paid",
      eventTitle: "Neon Static",
      eventListed: true,
      eventStartsAt: "2027-03-06T09:00:00.000Z",
      eventEndsAt: "2027-03-06T12:30:00.000Z",
      venueName: "The Tote",
      suburb: "Collingwood",
    });
    expect(body).not.toHaveProperty("venueAddress");
    // In the email's order: ticket type id, then code.
    expect((body.tickets as Ticket[]).map((t) => [t.ticketTypeName, t.checkedInAt])).toEqual([
      ["General admission", null],
      ["VIP", null],
    ]);
  });

  it("shows the event's current details if the organiser changed them after the order", async () => {
    const { orderId } = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }]);
    await api.db.query(
      `update public.events set venue_name = 'The Corner', suburb = 'Richmond', starts_at = '2027-03-07T09:00:00Z', ends_at = '2027-03-07T12:00:00Z' where id = $1`,
      [event.eventId],
    );
    expect(await page(orderId)).toMatchObject({
      eventStartsAt: "2027-03-07T09:00:00.000Z",
      eventEndsAt: "2027-03-07T12:00:00.000Z",
      venueName: "The Corner",
      suburb: "Richmond",
    });
  });

  it("once the event isn't published, keeps the tickets but drops its date, time, venue and suburb", async () => {
    const { orderId } = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }]);
    const codes = ((await page(orderId)).tickets as Ticket[]).map((t) => t.ticketCode);
    const details = ["eventStartsAt", "eventEndsAt", "venueName", "suburb"];
    const expectUnlisted = async () => {
      const body = await page(orderId);
      expect(body).toMatchObject({ status: "paid", eventTitle: "Neon Static", eventListed: false });
      for (const key of details) expect(body).not.toHaveProperty(key);
      expect((body.tickets as Ticket[]).map((t) => t.ticketCode)).toEqual(codes);
      expect(JSON.stringify(body)).not.toMatch(/The Tote|Collingwood|2027-03-06/);
    };

    // Unpublished by an admin (back to draft).
    const unpublished = await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });
    expect(unpublished.status).toBe(200);
    await expectUnlisted();
    // Back in review, or rejected.
    for (const status of ["pending_review", "rejected"]) {
      await api.db.query(`update public.events set status = $2::public.event_status where id = $1`, [event.eventId, status]);
      await expectUnlisted();
    }
    // Published again: the details are back.
    await api.db.query(`update public.events set status = 'published' where id = $1`, [event.eventId]);
    expect(await page(orderId)).toMatchObject({ eventListed: true, venueName: "The Tote", suburb: "Collingwood" });
  });

  it("says when a ticket was checked in, only for that ticket, and goes back to ready after an undo", async () => {
    const { orderId } = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }]);
    const [first, second] = (await page(orderId)).tickets as Ticket[];
    const scan = await api.call(checkInTicket, {
      token: organiser.token,
      params: { eventId: event.eventId },
      body: { code: `SH1:${second.ticketCode}`, requestId: crypto.randomUUID() },
    });
    expect(scan.body.outcome).toBe("admitted");

    const after = (await page(orderId)).tickets as Ticket[];
    expect(after.map((t) => t.ticketCode)).toEqual([first.ticketCode, second.ticketCode]);
    expect(after[0].checkedInAt).toBeNull();
    expect(after[1].checkedInAt).toBe(scan.body.checkedInAt);
    expect(new Date(after[1].checkedInAt as string).toISOString()).toBe(after[1].checkedInAt);

    const undone = await api.call(undoCheckIn, {
      token: organiser.token,
      params: { eventId: event.eventId, checkInId: scan.body.checkInId },
      body: { reason: "Scanned the wrong ticket" },
    });
    expect(undone.body.outcome).toBe("undone");
    expect(((await page(orderId)).tickets as Ticket[]).map((t) => t.checkedInAt)).toEqual([null, null]);
  });

  it("a refunded order shows no tickets, no check-in status and no event details", async () => {
    const { orderId, paymentIntent } = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }]);
    const [ticket] = (await page(orderId)).tickets as Ticket[];
    await api.call(checkInTicket, {
      token: organiser.token,
      params: { eventId: event.eventId },
      body: { code: ticket.ticketCode, requestId: crypto.randomUUID() },
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "charge.refunded",
        data: { object: { id: "ch_test", object: "charge", payment_intent: paymentIntent, amount_refunded: 6340, refunded: true } },
      }),
    );
    const body = await page(orderId);
    expect(body).toMatchObject({ status: "refunded", refundReason: "refunded", tickets: [] });
    for (const key of ["eventListed", "eventStartsAt", "eventEndsAt", "venueName", "suburb"]) expect(body).not.toHaveProperty(key);
    expect(JSON.stringify(body)).not.toContain(ticket.ticketCode);
  });

  it("a pending order still shows nothing but its status", async () => {
    await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    expect(await page(orderId)).toEqual({ status: "pending" });
  });
});

describe("ticket links keep working", () => {
  it("the email's View your tickets link is the order's existing page: Stripe's return URL, unchanged", async () => {
    const { orderId, returnUrl } = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }]);
    const email = await ticketEmail(orderId);
    const link = `${SITE_URL}/checkout/success?session_id=${orderId}`;
    expect(returnUrl).toBe(link);
    expect(ticketPageLink(SITE_URL, orderId)).toBe(link);
    expect(email.html).toContain(`<a href="${link}"`);
    expect(email.text).toContain(`View your tickets: ${link}`);
    // The link's session_id opens the same tickets as before.
    const sessionId = new URL(link).searchParams.get("session_id") as string;
    expect((await page(sessionId)).tickets).toHaveLength(2);
  });

  it("a free order's page URL (member or confirmed guest) is the same link the email carries", async () => {
    for (const order of [await memberFreeOrder(2), await guestFreeOrder(2)]) {
      const email = await ticketEmail(order.orderId);
      expect(order.url).toBe(ticketPageLink(SITE_URL, order.orderId));
      expect(email.html).toContain(`<a href="${order.url}"`);
      expect((await page(order.orderId)).tickets).toHaveLength(2);
    }
  });
});
