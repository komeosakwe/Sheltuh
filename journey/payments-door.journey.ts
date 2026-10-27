import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calculateBookingFeeCents } from "@/lib/fees";
import { WORDMARK_CID } from "@/lib/server/email-layout";
import { ticketQrPayload } from "@/lib/ticket-code";
import { ticketQrMatrix } from "@/lib/ticket-qr";
import { buyTickets, checkout, organiserWithPayouts, pay, publishedEvent, scan, sendAndLoseResponse, type Organiser } from "./harness/flows";
import { journeyEnabled, startJourney, type Journey, type User } from "./harness";
import { parseMail, qrModulesFromPng } from "./harness/smtp-sink";

/*
 * Payments and the door, end to end over HTTP (docs/testing.md, layer b):
 * real route modules and handlers, a real Postgres, nodemailer to a local
 * SMTP sink, the Stripe SDK to a local fake Stripe API, webhooks signed with
 * the webhook secret. tests/server covers each step's rules in depth; these
 * prove the steps chain together through the production wiring.
 */

const FEE = calculateBookingFeeCents(3000);

describe.skipIf(!journeyEnabled)("payments and the door (journey harness)", () => {
  let j: Journey;
  let admin: User;
  let organiser: Organiser;

  beforeAll(async () => {
    j = await startJourney();
    admin = await j.signUp({ admin: true });
    organiser = await organiserWithPayouts(j, admin);
  });

  afterAll(async () => {
    await j?.stop();
  });

  const sold = async (eventId: string) =>
    (await j.sql<{ sold: number }[]>`select quantity_sold as sold from public.ticket_types where event_id = ${eventId} and id = 'ga'`)[0].sold;
  const orderStatuses = async (eventId: string) =>
    (await j.sql<{ status: string }[]>`select status::text from public.orders where event_id = ${eventId} order by status`).map((r) => r.status);

  it("1. purchase → payment webhook → ticket email with matching QR → door scan → duplicate refused → refund → entry refused", async () => {
    const event = await publishedEvent(j, organiser, admin, { title: "Journey One" });
    const buyer = "ada.buyer@journey.test";

    // Checkout: the page sends ids and quantities only; Stripe is asked for database prices.
    const res = await checkout(j, event.eventId, { quantity: 2, buyerEmail: buyer, key: crypto.randomUUID() });
    expect(res.status).toBe(201);
    const orderId = res.body.orderId as string;
    const session = j.stripe.sessionForOrder(orderId);
    // Embedded checkout: our payment page, which reads the session's client secret itself.
    expect(res.body.url).toBe(`/checkout/pay?order=${orderId}`);
    expect(session.ui_mode).toBe("embedded_page");
    expect(session.idempotencyKey).toBe(`checkout-session-${orderId}`);
    expect(session.amount_total).toBe(2 * (3000 + FEE));
    expect(session.params.payment_intent_data).toEqual({
      application_fee_amount: String(2 * FEE),
      transfer_data: { destination: organiser.stripeAccountId },
    });
    expect(session.params.return_url).toBe(`${j.baseUrl}/checkout/success?session_id=${orderId}`);
    expect(session.params.adaptive_pricing).toEqual({ enabled: "false" });
    // The payment page's read: the open session's client secret, through the real route and SDK.
    const payment = await j.request("GET", `/api/orders/by-session/${orderId}/payment`);
    expect(payment).toMatchObject({ status: 200, body: { status: "open", clientSecret: session.client_secret } });
    expect(await j.request("GET", `/api/orders/by-session/${orderId}`)).toMatchObject({ status: 200, body: { status: "pending" } });
    expect(await sold(event.eventId)).toBe(0);

    // A forged webhook changes nothing.
    const forged = await fetch(`${j.baseUrl}/api/stripe/webhook`, {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef", "content-type": "application/json" },
      body: JSON.stringify(j.stripe.completedEvent(session)),
    });
    expect(forged.status).toBe(400);

    // The buyer pays; Stripe's signed webhook fulfils the order.
    const { event: completed, charge } = pay(j, orderId);
    expect((await j.webhook(completed)).status).toBe(200);
    await j.idle();
    const order = await j.request("GET", `/api/orders/by-session/${orderId}`);
    expect(order.status).toBe(200);
    expect(order.body).toMatchObject({ status: "paid", totalCents: 2 * (3000 + FEE) });
    const codes = (order.body.tickets as { ticketCode: string }[]).map((t) => t.ticketCode);
    expect(codes).toHaveLength(2);
    expect(await sold(event.eventId)).toBe(2);

    // The ticket email, as delivered over SMTP (authenticated), to the buyer.
    const mail = await j.smtp.waitFor((m) => m.rcptTo.includes(buyer));
    expect(mail.authUser).toBe(process.env.SMTP_USER);
    const parsed = parseMail(mail.raw);
    expect(parsed.subject).toMatch(/Journey One/);
    const html = parsed.parts.find((p) => p.contentType === "text/html")!.body.toString("utf8");
    const text = parsed.parts.find((p) => p.contentType === "text/plain")!.body.toString("utf8");
    // Inline PNGs: one QR per ticket, plus the header wordmark (lib/server/email-layout.ts, attached inline too).
    const pngs = parsed.parts.filter((p) => p.contentType === "image/png");
    const images = pngs.filter((p) => p.contentId?.startsWith("ticket-qr-"));
    expect(images).toHaveLength(2);
    expect(pngs.filter((p) => !images.includes(p)).map((p) => p.contentId)).toEqual([WORDMARK_CID]);
    for (const code of codes) {
      expect(html).toContain(code);
      expect(text).toContain(code);
    }
    // Each inline QR, read back from its pixels, is exactly the QR of one issued code (the success page draws
    // the same matrix, lib/ticket-qr.ts): one per ticket, none for anything else.
    const decoded = images.map((img) => {
      expect(html).toContain(`cid:${img.contentId}`);
      return JSON.stringify(qrModulesFromPng(img.body));
    });
    expect(decoded.sort()).toEqual(codes.map((c) => JSON.stringify(ticketQrMatrix(c))).sort());

    // A redelivery issues nothing more and sends no second email.
    expect((await j.webhook(completed)).status).toBe(200);
    await j.idle();
    expect(j.smtp.to(buyer)).toHaveLength(1);
    expect(await sold(event.eventId)).toBe(2);

    // The door: the QR's payload is admitted once; the same ticket again is refused as already in.
    const [first, second] = codes;
    const admitted = await scan(j, organiser, event.eventId, ticketQrPayload(first));
    expect(admitted.status).toBe(200);
    expect(admitted.body).toMatchObject({ outcome: "admitted", ticket: { ticketTypeName: "General admission", ticketCount: 2 } });
    const again = await scan(j, organiser, event.eventId, ticketQrPayload(first));
    expect(again.body).toMatchObject({ outcome: "already_checked_in", checkInId: admitted.body.checkInId });

    // Refunded in full from the Stripe dashboard: the order is void, the tickets with it.
    const refunded = j.stripe.dashboardRefund(charge.payment_intent);
    expect((await j.webhook(j.stripe.chargeRefundedEvent(refunded))).status).toBe(200);
    await j.idle();
    const after = await j.request("GET", `/api/orders/by-session/${orderId}`);
    expect(after.body).toMatchObject({ status: "refunded", refundReason: "refunded", tickets: [] });
    expect(await sold(event.eventId)).toBe(0);
    for (const code of [first, second]) {
      const refused = await scan(j, organiser, event.eventId, ticketQrPayload(code));
      expect(refused.status).toBe(200);
      expect(refused.body.outcome).toBe("not_admissible");
    }
    // Sheltüh never asked Stripe for a refund itself: the dashboard's was the only one.
    expect(j.stripe.refunds.filter((r) => r.payment_intent === charge.payment_intent)).toHaveLength(1);
  });

  it("2. a full refund delivered before the payment webhook: the payment then issues nothing", async () => {
    const event = await publishedEvent(j, organiser, admin, { title: "Journey Two" });
    const buyer = "early.refund@journey.test";
    const res = await checkout(j, event.eventId, { quantity: 1, buyerEmail: buyer, key: crypto.randomUUID() });
    expect(res.status).toBe(201);
    const orderId = res.body.orderId as string;

    // Paid, then refunded in the dashboard, and Stripe happens to deliver charge.refunded first.
    const { event: completed, charge } = pay(j, orderId);
    const refundedEvent = j.stripe.chargeRefundedEvent(j.stripe.dashboardRefund(charge.payment_intent));
    expect((await j.webhook(refundedEvent)).status).toBe(200);
    expect(await j.request("GET", `/api/orders/by-session/${orderId}`)).toMatchObject({ body: { status: "pending" } });
    expect((await j.webhook(completed)).status).toBe(200);
    await j.idle();

    expect((await j.request("GET", `/api/orders/by-session/${orderId}`)).body).toMatchObject({ status: "refunded", tickets: [] });
    expect(await j.sql`select 1 from public.tickets where order_id = ${orderId}`).toHaveLength(0);
    expect(await sold(event.eventId)).toBe(0);
    // Both redelivered, in either order: still nothing issued, emailed or refunded again.
    expect((await j.webhook(completed)).status).toBe(200);
    expect((await j.webhook(refundedEvent)).status).toBe(200);
    await j.idle();
    expect(await j.sql`select 1 from public.tickets where order_id = ${orderId}`).toHaveLength(0);
    expect(await sold(event.eventId)).toBe(0);
    expect(j.smtp.to(buyer)).toHaveLength(0);
    expect(j.stripe.refunds.filter((r) => r.payment_intent === charge.payment_intent)).toHaveLength(1);
  });

  it("5. a scan whose response was lost: the retry (same request id) gets the original answer, one check-in", async () => {
    const event = await publishedEvent(j, organiser, admin, { title: "Journey Five" });
    const { codes } = await buyTickets(j, event.eventId, "door.retry@journey.test", 2);
    const path = `/api/organisers/me/events/${event.eventId}/check-ins`;

    // The phone sent the scan; the server admitted the ticket; the answer never arrived.
    const requestId = crypto.randomUUID();
    expect(await sendAndLoseResponse(j, path, organiser.token, { code: ticketQrPayload(codes[0]), requestId })).toBe(200);
    const retry = await scan(j, organiser, event.eventId, ticketQrPayload(codes[0]), requestId);
    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe("admitted");
    // A new scan of the same ticket is a duplicate, pointing at the same admission.
    const rescan = await scan(j, organiser, event.eventId, codes[0]);
    expect(rescan.body).toMatchObject({ outcome: "already_checked_in", checkInId: retry.body.checkInId });

    // The same scan sent twice at once (a double tap on a flaky network): both told admitted, one admission.
    const twin = crypto.randomUUID();
    const both = await Promise.all([1, 2].map(() => scan(j, organiser, event.eventId, codes[1], twin)));
    expect(both.map((r) => r.body.outcome)).toEqual(["admitted", "admitted"]);
    expect(both[0].body.checkInId).toBe(both[1].body.checkInId);

    const summary = await j.request("GET", path, { token: organiser.token });
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ checkedIn: 2, ticketsSold: 2 });
    // Two admissions and one already-in in the log: the lost response's retry and the twin added nothing.
    const outcomes = (summary.body.recent as { result: string }[]).map((e) => e.result).sort();
    expect(outcomes).toEqual(["admitted", "admitted", "already_checked_in"]);
  });

  it("6. sold-out race: more payments than tickets arrive at once; exactly the stock is sold, the rest refunded", async () => {
    const event = await publishedEvent(j, organiser, admin, {
      title: "Journey Six",
      ticketTypes: [{ id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 2 }],
    });
    // Five buyers each start a checkout while two tickets are left (nothing is held before payment).
    const buyers = [1, 2, 3, 4, 5].map((n) => `race${n}@journey.test`);
    const orders: string[] = [];
    for (const [i, buyer] of buyers.entries()) {
      const res = await checkout(j, event.eventId, { buyerEmail: buyer, key: crypto.randomUUID(), ip: `203.0.113.${50 + i}` });
      expect(res.status).toBe(201);
      orders.push(res.body.orderId as string);
    }
    // All five pay, and Stripe delivers the five webhooks at the same time.
    const payments = orders.map((orderId) => pay(j, orderId));
    const delivered = await Promise.all(payments.map((p) => j.webhook(p.event)));
    expect(delivered.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    await j.idle();

    expect(await sold(event.eventId)).toBe(2);
    expect(await orderStatuses(event.eventId)).toEqual(["paid", "paid", "refunded", "refunded", "refunded"]);
    expect(await j.sql`select 1 from public.tickets t join public.orders o on o.id = t.order_id where o.event_id = ${event.eventId}`).toHaveLength(2);
    // The three who lost are refunded in full by Sheltüh, fee and transfer included, once each.
    const losers = (await j.sql<{ id: string }[]>`select id from public.orders where event_id = ${event.eventId} and status = 'refunded'`).map((r) => r.id);
    const refunds = j.stripe.refunds.filter((r) => losers.includes(r.metadata.orderId));
    expect(refunds.map((r) => r.idempotencyKey).sort()).toEqual(losers.map((id) => `oversold-refund-${id}`).sort());
    for (const refund of refunds) {
      expect(refund).toMatchObject({ reverse_transfer: "true", refund_application_fee: "true", amount: 3000 + FEE });
    }
    for (const id of losers) {
      expect((await j.request("GET", `/api/orders/by-session/${id}`)).body).toMatchObject({ status: "refunded", refundReason: "oversold", tickets: [] });
    }
    // Ticket emails only for the two who got tickets.
    expect(buyers.reduce((n, b) => n + j.smtp.to(b).length, 0)).toBe(2);

    // Stripe redelivers all five at once: nothing changes, nothing is refunded twice.
    await Promise.all(payments.map((p) => j.webhook(p.event)));
    await j.idle();
    expect(await sold(event.eventId)).toBe(2);
    expect(await orderStatuses(event.eventId)).toEqual(["paid", "paid", "refunded", "refunded", "refunded"]);
    expect(j.stripe.refunds.filter((r) => losers.includes(r.metadata.orderId))).toHaveLength(3);
    expect(buyers.reduce((n, b) => n + j.smtp.to(b).length, 0)).toBe(2);
  });

  it("7. a double click and a retry with the same Idempotency-Key: one order, one Stripe session", async () => {
    const event = await publishedEvent(j, organiser, admin, { title: "Journey Seven" });
    const key = crypto.randomUUID();
    const buyerEmail = "double.click@journey.test";
    const sessionsBefore = j.stripe.sessionsCreated;

    // Five identical requests at once.
    const burst = await Promise.all([1, 2, 3, 4, 5].map(() => checkout(j, event.eventId, { quantity: 2, buyerEmail, key })));
    const created = burst.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);
    const { orderId, url } = created[0].body as { orderId: string; url: string };
    for (const other of burst.filter((r) => r.status !== 201)) {
      if (other.status === 409) expect(other.body.code).toBe("checkout_in_progress");
      else expect(other).toMatchObject({ status: 200, body: { orderId, url } });
    }
    // The retry after a lost response (or after "in progress"): the same order and session.
    const retry = await checkout(j, event.eventId, { quantity: 2, buyerEmail, key });
    expect(retry).toMatchObject({ status: 200, body: { orderId, url } });
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect(j.stripe.sessionsCreated - sessionsBefore).toBe(1);
    expect(await j.sql`select 1 from public.orders where event_id = ${event.eventId}`).toHaveLength(1);

    // The same key for a different basket is refused, writing nothing.
    const reused = await checkout(j, event.eventId, { quantity: 1, buyerEmail, key });
    expect(reused).toMatchObject({ status: 422, body: { code: "idempotency_key_reused" } });
    expect(await j.sql`select 1 from public.orders where event_id = ${event.eventId}`).toHaveLength(1);

    // The same key and basket from another connection: refused, giving away neither the order nor the session.
    const elsewhere = await checkout(j, event.eventId, { quantity: 2, buyerEmail, key, ip: "198.51.100.77" });
    expect(elsewhere).toMatchObject({ status: 409, body: { code: "checkout_other_client" } });
    expect(JSON.stringify(elsewhere.body)).not.toContain(orderId);
    expect(JSON.stringify(elsewhere.body)).not.toContain(url);
    expect(j.stripe.sessionsCreated - sessionsBefore).toBe(1);

    // Paid: the key is spent; the page is told the checkout completed rather than making another.
    const { event: completed } = pay(j, orderId);
    expect((await j.webhook(completed)).status).toBe(200);
    await j.idle();
    const afterPaid = await checkout(j, event.eventId, { quantity: 2, buyerEmail, key });
    expect(afterPaid).toMatchObject({ status: 409, body: { code: "checkout_completed" } });
    expect(j.stripe.sessionsCreated - sessionsBefore).toBe(1);
    expect(await sold(event.eventId)).toBe(2);
  });
});
