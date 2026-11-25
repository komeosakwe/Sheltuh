import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_ACCESS_HEADER } from "@/lib/api/types";
import type { EmailMessage } from "@/lib/server/email";
import { adminResendEmailJob } from "@/lib/server/handlers/email-outbox";
import { cancelTicketTransfer, declineTicketOffer, viewTicketOffer } from "@/lib/server/handlers/ticket-transfers";
import { orderReference } from "@/lib/server/order-reference";
import { buildTransferOfferEmail, buildTransferTicketEmail } from "@/lib/server/ticket-transfer-email";
import type { EventRecord } from "@/lib/server/types";
import { hashTransferToken } from "@/lib/server/ticket-transfers";
import { SITE_URL, TestApi } from "./helpers/api";
import { member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";
import {
  accept,
  backdate,
  BUYER,
  checkIn,
  codesOf,
  OFFER,
  offer,
  paidOrder,
  send,
  startEventIn,
  transferRow,
  transferWorld,
  type TransferWorld,
} from "./helpers/ticket-transfers";

// The ticket transfer emails (lib/server/ticket-transfer-email.ts) and their delivery
// (lib/server/email-outbox.ts, deliverTicketTransferEmail), end to end through the API and the outbox.

const CODE = /[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/;
const GMAIL_CLIP_BYTES = 102 * 1024;

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
  vi.stubEnv("NEXT_PUBLIC_TICKET_TRANSFERS", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  world = await transferWorld(api);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Every email sent since the last call, and clears them. */
async function sent(): Promise<EmailMessage[]> {
  await api.runDeferred();
  const messages = api.sendEmail.mock.calls.map(([m]) => m);
  api.sendEmail.mockClear();
  return messages;
}

const tokenOf = (message: EmailMessage) => /#token=([A-Za-z0-9_-]{43})/.exec(message.html)?.[1] as string;

function expectShell(message: EmailMessage) {
  expect(message.text.length).toBeGreaterThan(0);
  expect(Buffer.byteLength(message.html)).toBeLessThan(GMAIL_CLIP_BYTES);
  for (const body of [message.html, message.text]) {
    expect(body).not.toMatch(/Pty Ltd|\bABN\s/);
  }
  expect(message.html).toContain("Need a hand?");
  expect(message.html).toContain("Privacy policy");
}

describe("the offer (to the address typed)", () => {
  it("goes out after the send: the locked ticket, Accept and Decline links with a fresh token, How it works, no code", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    const [message, ...rest] = await sent();
    expect(rest).toEqual([]);
    expect(message).toMatchObject({ to: "sam@example.com", subject: "Alex sent you a ticket to NEON STATIC" });
    expectShell(message);
    const token = tokenOf(message);
    expect(message.html).toContain(`${SITE_URL}/tickets/accept#token=${token}"`);
    expect(message.html).toContain(`${SITE_URL}/tickets/accept#token=${token}&#38;decline=1"`);
    // Stored hashed before the send, and it opens the offer.
    expect(await api.db.query(`select transfer_id::text as id from private.ticket_transfer_tokens where token_hash = $1`, [hashTransferToken(token)])).toEqual([
      { id: transferId },
    ]);
    expect((await api.call(viewTicketOffer, { body: { token } })).body.status).toBe("open");
    for (const line of [
      "From Alex Chen",
      "Alex sent you a ticket to NEON STATIC.",
      "Accept the ticket to get your QR code",
      "How it works",
      "Sign in or create an account, then accept to get your own QR code.",
      "Alex’s copy stops working once you accept.",
      "Not going? Decline and the ticket goes back to Alex.",
      "Don’t forward this email: whoever accepts first gets the ticket.",
      "You’re getting this email because Alex Chen sent you a ticket on Sheltüh.",
      "/email/ticket/qr-locked.png",
      "Accept it to get your own QR code",
    ]) {
      expect(message.html).toContain(line.replaceAll("’", "’"));
    }
    // No code of any kind, no QR attachment, nothing about the order or the buyer.
    for (const body of [message.html, message.text]) {
      expect(body).not.toMatch(CODE);
      expect(body).not.toContain(order.orderId);
      expect(body).not.toContain(orderReference(order.orderId).slice(1));
      expect(body).not.toContain(BUYER);
    }
    expect(message.inlineImages?.map((i) => i.contentType)).toEqual(["image/png"]);
    expect(message.inlineImages?.some((i) => i.cid.startsWith("ticket-qr"))).toBe(false);
    expect(message.text).toContain(`Accept ticket: ${SITE_URL}/tickets/accept#token=${token}`);
  });

  it("a retry mints another token; the first one keeps working", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    const first = tokenOf((await sent())[0]);
    await api.db.query(`update private.email_outbox set status = 'pending', next_attempt_at = now() where ticket_transfer_id = $1`, [transferId]);
    api.deferred.push(async () => {
      const { drainEmailOutbox } = await import("@/lib/server/email-outbox");
      await drainEmailOutbox(api.deps, { kind: "transfer_offer" });
    });
    const second = tokenOf((await sent())[0]);
    expect(second).not.toBe(first);
    for (const token of [first, second]) expect((await api.call(viewTicketOffer, { body: { token } })).body.status).toBe("open");
  });

  it("isn't sent, and no token is minted, once the offer was cancelled before the worker got to it", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    expect(
      (await api.call(cancelTicketTransfer, { params: { sessionId: order.orderId, transferId }, body: {}, headers: { [ORDER_ACCESS_HEADER]: order.access } }))
        .status,
    ).toBe(200);
    expect(await sent()).toEqual([]);
    expect(await api.db.query(`select 1 from private.ticket_transfer_tokens`)).toEqual([]);
    expect(await api.db.query(`select status from private.email_outbox where ticket_transfer_id = $1`, [transferId])).toEqual([{ status: "failed" }]);
  });

  it("mints no token when the offer closes between the worker's check and the mint (the insert checks it): not sent", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    const query = api.db.query.bind(api.db);
    vi.spyOn(api.db, "query").mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("insert into private.ticket_transfer_tokens")) {
        // The sender cancels just before the mint.
        await query(
          `update private.ticket_transfers set status = 'cancelled', decided_at = now(), cancelled_by = 'sender' where id = $1`,
          [transferId],
        );
      }
      return query(sql, params);
    });
    expect(await sent()).toEqual([]);
    expect(await query(`select 1 from private.ticket_transfer_tokens`)).toEqual([]);
    expect(await query(`select status from private.email_outbox where ticket_transfer_id = $1 and kind = 'transfer_offer'`, [transferId])).toEqual([
      { status: "failed" },
    ]);
  });

  it("escapes typed names as text", async () => {
    const order = await paidOrder(api, world.eventId);
    await offer(api, order, { senderName: "Alex <b>Chen</b>" });
    const [message] = await sent();
    expect(message.html).toContain("From Alex &#60;b&#62;Chen&#60;/b&#62;");
    expect(message.html).not.toContain("<b>Chen</b>");
  });
});

describe("after an accept", () => {
  async function accepted(recipientEmail = "sam@example.com") {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    const token = tokenOf((await sent())[0]);
    const recipient = await member(api, { email: recipientEmail });
    expect((await accept(api, token, recipient)).status).toBe(200);
    return { order, transferId, recipient, messages: await sent(), row: await transferRow(api, transferId) };
  }

  it("the sender hears who has it; the recipient gets their own ticket with their own code only", async () => {
    const { order, transferId, messages, row } = await accepted();
    const codes = await codesOf(api, order.orderId);
    const toSender = messages.find((m) => m.to === BUYER) as EmailMessage;
    const toRecipient = messages.find((m) => m.to === "sam@example.com") as EmailMessage;
    expect(messages).toHaveLength(2);

    expect(toSender.subject).toBe("Sam accepted your ticket");
    expectShell(toSender);
    for (const line of [
      `Order ${orderReference(order.orderId)} · Transfer complete`,
      "Sam accepted your ticket.",
      "Sam Lee now holds Ticket 1 of 2 for NEON STATIC on",
      "Your QR code for this ticket no longer works.",
      "View order",
    ]) {
      expect(toSender.html).toContain(line);
    }
    expect(toSender.html).not.toContain("not the address you sent it to");
    for (const body of [toSender.html, toSender.text]) expect(body).not.toContain(row.issued_code as string);

    expect(toRecipient.subject).toBe("Your ticket to NEON STATIC");
    expectShell(toRecipient);
    // The offer frame's intro pattern: the sender, then the event in capitals; the footer names the sender.
    expect(toRecipient.html).toContain("From Alex Chen");
    expect(toRecipient.html).toContain(">Your ticket to NEON STATIC.</h1>");
    expect(toRecipient.html).not.toContain("You’re in.");
    expect(toRecipient.html).toContain("You’re getting this email because Alex Chen sent you a ticket on Sheltüh.");
    expect(toRecipient.text).toContain("You're getting this email because Alex Chen sent you a ticket on Sheltüh.");
    expect(toRecipient.html).toContain(row.issued_code as string);
    expect(toRecipient.text).toContain(`Show this code at the door: ${row.issued_code}`);
    expect(toRecipient.html).toContain(`${SITE_URL}/tickets/received/${transferId}`);
    expect(toRecipient.inlineImages?.some((i) => i.cid.startsWith("ticket-qr"))).toBe(true);
    for (const body of [toRecipient.html, toRecipient.text]) {
      for (const leak of [codes[0], codes[1], order.orderId, orderReference(order.orderId).slice(1), BUYER, "a***@example.com"]) {
        expect(body).not.toContain(leak);
      }
      expect(body).not.toMatch(/ticket \d of 2/i);
    }
  });

  it("tells the sender the accepting address, masked, only when it isn't the one they typed (D4)", async () => {
    const { messages } = await accepted("kim@example.org");
    const toSender = messages.find((m) => m.to === BUYER) as EmailMessage;
    expect(toSender.html).toContain("They accepted with k***@example.org, not the address you sent it to.");
    expect(messages.find((m) => m.to === "kim@example.org")?.subject).toBe("Your ticket to NEON STATIC");
  });

  it("the buyer's ticket email, rebuilt, shows the sent ticket as sent: no code, no QR, ticket numbers kept", async () => {
    const { order, row } = await accepted();
    const codes = await codesOf(api, order.orderId);
    const [job] = await api.db.query<{ id: string }>(`select id::text as id from private.email_outbox where order_id = $1 and kind = 'ticket_email'`, [order.orderId]);
    expect((await api.call(adminResendEmailJob, { token: world.admin.token, params: { jobId: job.id }, method: "POST" })).status).toBe(200);
    const [rebuilt] = await sent();
    expect(rebuilt.to).toBe(BUYER);
    for (const body of [rebuilt.html, rebuilt.text]) {
      expect(body).not.toContain(codes[0]);
      expect(body).not.toContain(row.issued_code as string);
      expect(body).toContain("This QR code no longer works");
    }
    expect(rebuilt.text).toMatch(/Ticket 1 of 2 · GA: sent to Sam Lee, accepted .+\. This QR code no longer works/);
    // The full card is ticket 2, still the buyer's, with its own QR and code.
    expect(rebuilt.text).toContain(`Ticket 2 of 2 · GA — Entry code: ${codes[1]}`);
    expect(rebuilt.inlineImages?.filter((i) => i.cid.startsWith("ticket-qr")).map((i) => i.cid)).toEqual(["ticket-qr-2@sheltuh.com.au"]);
  });
});

describe("declined and expired (to the sender)", () => {
  it("declined: the ticket is back, with View and Send to a friend (ticket number)", async () => {
    const order = await paidOrder(api, world.eventId);
    await offer(api, order);
    const token = tokenOf((await sent())[0]);
    expect((await api.call(declineTicketOffer, { body: { token } })).status).toBe(200);
    const [message, ...rest] = await sent();
    expect(rest).toEqual([]);
    expect(message).toMatchObject({ to: BUYER, subject: "Sam declined your ticket" });
    expectShell(message);
    for (const line of [`Order ${orderReference(order.orderId)} · Transfer declined`, "Sam declined, so the ticket is back with you.", "Your QR code still works.", "You can send it to someone else from your ticket.", "It’s back with you — your QR code still works"]) {
      expect(message.html).toContain(line);
    }
    expect(message.html).toContain(`session_id=${order.orderId}&#38;send=1"`);
  });

  it("expired (the sweep): built like declined; past the cut-off, no Send to a friend", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    await sent();
    await backdate(api, transferId, "73 hours");
    await startEventIn(api, world.eventId, "1 hour");
    await api.db.query(`select private.expire_ticket_transfers(200, '2 hours')`);
    api.deferred.push(async () => {
      const { drainEmailOutbox } = await import("@/lib/server/email-outbox");
      await drainEmailOutbox(api.deps, { kind: "transfer_expired" });
    });
    const [message] = await sent();
    expect(message).toMatchObject({ to: BUYER, subject: "Sam didn’t accept your ticket in time" });
    expect(message.html).toContain("Sam didn’t accept in time, so the ticket is still yours.");
    expect(message.html).toContain("Tickets can be sent until 2 hours before the event starts.");
    expect(message.html).not.toContain("Send to a friend");
  });

  /** Makes the transfer's `kind` job not due (as if delayed or waiting for a retry), and later due again. */
  async function holdJob(transferId: string, kind: string, until: "later" | "now") {
    await api.db.query(
      `update private.email_outbox set next_attempt_at = now() + $3::interval where ticket_transfer_id = $1 and kind = $2`,
      [transferId, kind, until === "later" ? "1 hour" : "0 seconds"],
    );
  }

  function drain(kind: "transfer_declined" | "transfer_expired") {
    api.deferred.push(async () => {
      const { drainEmailOutbox } = await import("@/lib/server/email-outbox");
      await drainEmailOutbox(api.deps, { kind });
    });
  }

  it("a delayed decline notice isn't sent once the same ticket was sent again and accepted (it'd say the QR still works)", async () => {
    const order = await paidOrder(api, world.eventId);
    const declinedId = await offer(api, order);
    const token = tokenOf((await sent())[0]);
    expect((await api.call(declineTicketOffer, { body: { token } })).status).toBe(200);
    await holdJob(declinedId, "transfer_declined", "later");
    expect(await sent()).toEqual([]);

    // The buyer sends the same ticket again, and this time it's accepted.
    const secondId = await offer(api, order, { name: "Kim Ng", email: "kim@example.org" });
    const secondToken = tokenOf((await sent())[0]);
    expect((await accept(api, secondToken, await member(api, { email: "kim@example.org" }), "Kim Ng")).status).toBe(200);
    expect((await sent()).map((m) => m.subject).sort()).toEqual(["Kim accepted your ticket", "Your ticket to NEON STATIC"]);
    expect((await transferRow(api, secondId)).status).toBe("accepted");

    await holdJob(declinedId, "transfer_declined", "now");
    drain("transfer_declined");
    expect(await sent()).toEqual([]);
    expect(
      await api.db.query(`select status from private.email_outbox where ticket_transfer_id = $1 and kind = 'transfer_declined'`, [declinedId]),
    ).toEqual([{ status: "failed" }]);
  });

  it("a delayed expiry notice isn't sent once the order is no longer paid", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    await sent();
    await backdate(api, transferId, "73 hours");
    await api.db.query(`select private.expire_ticket_transfers(200, '2 hours')`);
    await holdJob(transferId, "transfer_expired", "later");
    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [order.orderId]);
    await holdJob(transferId, "transfer_expired", "now");
    drain("transfer_expired");
    expect(await sent()).toEqual([]);
    expect(
      await api.db.query(`select status from private.email_outbox where ticket_transfer_id = $1 and kind = 'transfer_expired'`, [transferId]),
    ).toEqual([{ status: "failed" }]);
  });

  it("a send that expires an overdue offer: the new offer goes out, the old one's expiry notice doesn't (it'd say send it again)", async () => {
    const order = await paidOrder(api, world.eventId);
    const first = await offer(api, order);
    await sent();
    await backdate(api, first, "73 hours");
    await offer(api, order, { name: "Kim Ng", email: "kim@example.org" });
    expect((await transferRow(api, first)).status).toBe("expired");
    expect((await sent()).map((m) => [m.to, m.subject])).toEqual([["kim@example.org", "Alex sent you a ticket to NEON STATIC"]]);
    expect(
      await api.db.query(`select status from private.email_outbox where ticket_transfer_id = $1 and kind = 'transfer_expired'`, [first]),
    ).toEqual([{ status: "failed" }]);
  });

  it("a ticket checked in meanwhile: the notice says so, with no 'QR code still works' and no Send to a friend", async () => {
    const order = await paidOrder(api, world.eventId);
    const transferId = await offer(api, order);
    const token = tokenOf((await sent())[0]);
    const [code] = await codesOf(api, order.orderId);
    expect((await checkIn(api, world, code)).status).toBe(200);
    expect((await api.call(declineTicketOffer, { body: { token } })).status).toBe(200);
    const [message, ...rest] = await sent();
    expect(rest).toEqual([]);
    expect((await transferRow(api, transferId)).status).toBe("declined");
    expect(message.html).toContain("It’s been checked in at the door, so it can’t be sent on.");
    for (const body of [message.html, message.text]) {
      expect(body).not.toContain("still works");
      expect(body).not.toContain("Send to a friend");
      expect(body).not.toContain("send it to someone else");
    }
  });

  it("goes to the order's current address: an email change since the decision is followed", async () => {
    const order = await paidOrder(api, world.eventId);
    await offer(api, order);
    const token = tokenOf((await sent())[0]);
    await api.call(declineTicketOffer, { body: { token } });
    await api.db.query(`update public.orders set buyer_email = 'alex.new@example.com' where id = $1`, [order.orderId]);
    const [message] = await sent();
    expect(message.to).toBe("alex.new@example.com");
  });
});

describe("the run after a response", () => {
  it("the five kinds share one 30 s budget: once it's spent, no later kind starts (the cron sends the rest)", async () => {
    const { sendTicketTransferEmailsSoon } = await import("@/lib/server/email-outbox");
    const { mintToken } = await import("./helpers/ticket-transfers");
    const order = await paidOrder(api, world.eventId);
    // Ticket 1 declined (its declined job due), ticket 2 offered (its offer job due); nothing sent yet.
    const declinedId = await offer(api, order);
    expect((await api.call(declineTicketOffer, { body: { token: await mintToken(api, declinedId) } })).status).toBe(200);
    await offer(api, order, { ticket: 2, name: "Kim Ng", email: "kim@example.org" });
    api.deferred.length = 0;
    // Each send takes 31 s of the clock: the offer (the first kind) spends the whole budget.
    const realNow = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    api.sendEmail.mockImplementation(async () => {
      offset += 31_000;
    });
    sendTicketTransferEmailsSoon(api.deps);
    expect((await sent()).map((m) => m.to)).toEqual(["kim@example.org"]);
    expect(
      await api.db.query(`select status from private.email_outbox where ticket_transfer_id = $1 and kind = 'transfer_declined'`, [declinedId]),
    ).toEqual([{ status: "pending" }]);
  });
});

it("a send through the API with the flag on queues exactly one offer email per offer", async () => {
  const order = await paidOrder(api, world.eventId);
  expect((await send(api, order.orderId, OFFER, { access: order.access })).status).toBe(201);
  expect(await sent()).toHaveLength(1);
});

describe("the layout around the ticket (Latte's offer frame)", () => {
  const event = {
    eventId: "00000000-0000-4000-8000-00000000e001",
    slug: "here-and-now",
    title: "Here & Now",
    venueName: "Interconnect Studio",
    venueAddress: "16 Catherine St",
    suburb: "Coburg North",
    state: "VIC",
    startsAt: "2026-11-14T06:00:00.000Z",
    endsAt: "2026-11-14T10:00:00.000Z",
    status: "published",
    beforeYouGo: [
      { label: "Entry", value: "Doors open 5:00 pm · last entry 8:00 pm." },
      { label: "Age <18>", value: "18+ & photo ID" },
    ],
  } as EventRecord;
  const ticket = { typeName: "Second release" };
  const offerEmail = (senderName = "Alex Chen") =>
    buildTransferOfferEmail({ to: "sam@example.com", siteUrl: SITE_URL, token: "t".repeat(43), senderName, event, ticket });
  const ticketEmail = (senderName = "Alex Chen") =>
    buildTransferTicketEmail({ to: "sam@example.com", siteUrl: SITE_URL, transferId: "3f2b9c4e-8a1d-4f6b-9e0c-7a5d2b8e1f43", senderName, code: "BPT7-7P6W", event, ticket });

  it("Before you go: the organiser's rows as plain lines, no bold label, escaped", () => {
    for (const message of [offerEmail(), ticketEmail()]) {
      const box = message.html.slice(message.html.indexOf(">Before you go</p>"));
      expect(box).toContain(">Entry: Doors open 5:00 pm · last entry 8:00 pm.</p>");
      expect(box).toContain(">Age &#60;18&#62;: 18+ &#38; photo ID</p>");
      expect(box.slice(0, box.indexOf("Need a hand?"))).not.toMatch(/font-weight:600[^>]*>(Entry|Age)/);
      expect(message.text).toContain("BEFORE YOU GO\nEntry: Doors open 5:00 pm · last entry 8:00 pm.\nAge <18>: 18+ & photo ID");
    }
  });

  it("the event row's link reads View event page", () => {
    for (const message of [offerEmail(), ticketEmail()]) {
      expect(message.html).toContain(`${SITE_URL}/events/here-and-now" style="color:#000000;text-decoration:underline;text-underline-offset:2px">View event page</a>`);
      expect(message.html).not.toContain("View event info");
    }
  });

  it("the recipient's ticket: eyebrow, heading, ticket, then its own button; the footer names the sender, escaped", () => {
    const message = ticketEmail("Alex <b>Chen</b>");
    const order = ["From Alex &#60;b&#62;Chen&#60;/b&#62;", ">Your ticket to HERE &#38; NOW.</h1>", "BPT7-7P6W", ">View your ticket&nbsp;", ">Saturday 14 November 2026<"];
    const at = order.map((s) => message.html.indexOf(s));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(message.html).toContain("You’re getting this email because Alex &#60;b&#62;Chen&#60;/b&#62; sent you a ticket on Sheltüh.");
    expect(message.html).not.toContain("<b>Chen</b>");
    expect(offerEmail("Alex <b>Chen</b>").html).toContain("You’re getting this email because Alex &#60;b&#62;Chen&#60;/b&#62; sent you a ticket on Sheltüh.");
  });

  it("the wordmarks sit in Latte's boxes: 7px under the header's (106 x 31), 6px under the footer's (88 x 26)", () => {
    const html = ticketEmail().html;
    expect(html).toMatch(/<td style="padding:0 0 7px 0"><img src="cid:[^"]+" width="106" height="24"/);
    expect(html).toMatch(/<td style="padding:0 0 6px 0"><img src="cid:[^"]+" width="88" height="20"/);
  });
});
