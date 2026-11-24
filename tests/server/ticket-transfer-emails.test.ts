import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_ACCESS_HEADER } from "@/lib/api/types";
import type { EmailMessage } from "@/lib/server/email";
import { adminResendEmailJob } from "@/lib/server/handlers/email-outbox";
import { cancelTicketTransfer, declineTicketOffer, viewTicketOffer } from "@/lib/server/handlers/ticket-transfers";
import { orderReference } from "@/lib/server/order-reference";
import { hashTransferToken } from "@/lib/server/ticket-transfers";
import { SITE_URL, TestApi } from "./helpers/api";
import { member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";
import {
  accept,
  backdate,
  BUYER,
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
    expect(body).not.toMatch(/Pty Ltd|ABN/);
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
    expect(toRecipient.html).toContain("You’re in. Here’s your ticket.");
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

it("a send through the API with the flag on queues exactly one offer email per offer", async () => {
  const order = await paidOrder(api, world.eventId);
  expect((await send(api, order.orderId, OFFER, { access: order.access })).status).toBe(201);
  expect(await sent()).toHaveLength(1);
});
