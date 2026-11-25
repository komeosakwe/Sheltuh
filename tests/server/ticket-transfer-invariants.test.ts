import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_ACCESS_HEADER } from "@/lib/api/types";
import { maskEmail } from "@/lib/server/email-address";
import { getCheckInSummary, undoCheckIn } from "@/lib/server/handlers/check-ins";
import { adminResendEmailJob } from "@/lib/server/handlers/email-outbox";
import { changeOrderEmail } from "@/lib/server/handlers/order-email";
import { getOrderBySession } from "@/lib/server/handlers/orders";
import { getReceivedTicket, viewTicketOffer } from "@/lib/server/handlers/ticket-transfers";
import { getAppleWalletPass, getGoogleWalletPass } from "@/lib/server/handlers/wallet";
import { orderReference } from "@/lib/server/order-reference";
import { appleWalletConfigFromEnv, googleWalletConfigFromEnv, type AppleWalletConfig, type GoogleWalletConfig } from "@/lib/server/wallet/config";
import { GOOGLE_SAVE_URL_BASE } from "@/lib/server/wallet/google";
import { TestApi } from "./helpers/api";
import { member, type Member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";
import {
  accept,
  BUYER,
  checkIn,
  codesOf,
  mintToken,
  offer,
  paidOrder,
  transferRow,
  transferWorld,
  type TransferWorld,
} from "./helpers/ticket-transfers";
import { appleWalletEnv, googleWalletEnv } from "./helpers/wallet";

// docs/design/my-ticket.md §7.2, explicitly: nothing the sender holds reveals the recipient's code, and nothing the
// recipient gets carries the order's id or reference, the buyer's details, amounts or the order's other tickets.
// (The transfer emails, reminders and holder messages join these with PR-2 and PR-4.)

const googleCreds = googleWalletEnv();
const apple = appleWalletEnv();
const googleConfig = (googleWalletConfigFromEnv(googleCreds.env) as { config: GoogleWalletConfig }).config;
const appleConfig = (appleWalletConfigFromEnv(apple.env) as { config: AppleWalletConfig }).config;

let api: TestApi;
let reset: () => Promise<void>;
let world: TransferWorld;
/** A paid 2-ticket order whose ticket 1 was sent and accepted. */
let order: { orderId: string; access: string };
let codes: string[];
let issued: string;
let transferId: string;
let token: string;
let recipient: Member;
let buyer: Member;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  api.googleWallet = googleConfig;
  api.appleWallet = appleConfig;
  vi.stubEnv("NEXT_PUBLIC_TICKET_TRANSFERS", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  world = await transferWorld(api);
  buyer = await member(api, { email: BUYER, displayName: "Alex Chen" });
  order = await paidOrder(api, world.eventId, BUYER, 2, "Alexandra Buyer");
  expect(await api.db.query(`select buyer_name from public.orders where id = $1`, [order.orderId])).toEqual([
    { buyer_name: "Alexandra Buyer" },
  ]);
  codes = await codesOf(api, order.orderId);
  transferId = await offer(api, order);
  token = await mintToken(api, transferId);
  recipient = await member(api, { email: "sam@example.com" });
  expect((await accept(api, token, recipient)).status).toBe(200);
  issued = (await transferRow(api, transferId)).issued_code as string;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** `text` holds neither the recipient's code (bare or in its QR payload) nor the ticket's original one. */
function expectNoCodeOfTicket1(text: string) {
  expect(text).not.toContain(issued);
  expect(text).not.toContain(`SH1:${issued}`);
  expect(text).not.toContain(codes[0]);
}

describe("the sender's side", () => {
  it("1. the order, however it's asked for, never carries a code for the sent ticket", async () => {
    const asked = [
      await api.call(getOrderBySession, { params: { sessionId: order.orderId } }),
      await api.call(getOrderBySession, { params: { sessionId: order.orderId }, headers: { [ORDER_ACCESS_HEADER]: order.access } }),
      await api.call(getOrderBySession, { params: { sessionId: order.orderId }, token: buyer.token }),
    ];
    for (const [i, res] of asked.entries()) {
      expect(res.status).toBe(200);
      expectNoCodeOfTicket1(JSON.stringify(res.body));
      // Who holds it only with control of the order (the paying browser, the signed-in buyer).
      expect(res.body.transferredTickets).toEqual([
        { ticketNumber: 1, ticketTypeName: "GA", ...(i > 0 ? { holderName: "Sam Lee" } : {}), acceptedAt: expect.any(String) },
      ]);
      // The other ticket keeps its number and code.
      expect(res.body.tickets).toEqual([expect.objectContaining({ ticketNumber: 2, ticketCode: codes[1] })]);
    }
  });

  it("2. no wallet pass for the sent ticket's number; the other ticket's passes are unchanged", async () => {
    const [serial] = await api.db.query<{ serial: string }>(
      `select replace(wallet_serial::text, '-', '') as serial from public.tickets where code = $1`,
      [codes[1]],
    );
    for (const handler of [getGoogleWalletPass, getAppleWalletPass]) {
      const res = await api.callRaw(handler, { params: { sessionId: order.orderId }, query: { ticket: "1" } });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "Ticket not found." });
    }
    const google = await api.callRaw(getGoogleWalletPass, { params: { sessionId: order.orderId }, query: { ticket: "2" } });
    expect(google.status).toBe(302);
    const claims = Buffer.from((google.headers.get("location") as string).slice(GOOGLE_SAVE_URL_BASE.length).split(".")[1], "base64url").toString("utf8");
    expect(claims).toContain(serial.serial);
    expect(claims).toContain(codes[1]);
    expect(claims).toContain("2 of 2");
    expectNoCodeOfTicket1(claims);
    const applePass = await api.callRaw(getAppleWalletPass, { params: { sessionId: order.orderId }, query: { ticket: "2" } });
    expect(applePass.status).toBe(200);
    expect(Buffer.from(await applePass.arrayBuffer()).toString("latin1")).not.toContain(issued);
  });

  it("3. the buyer's ticket email, rebuilt by a resend and by an email change, never carries the recipient's code, nor the sent ticket's own", async () => {
    // The transfer emails the offer and the accept queued.
    await api.runDeferred();
    api.sendEmail.mockClear();
    const [job] = await api.db.query<{ id: string }>(
      `select id::text as id from private.email_outbox where order_id = $1 and kind = 'ticket_email'`,
      [order.orderId],
    );
    const resend = await api.call(adminResendEmailJob, { token: world.admin.token, params: { jobId: job.id }, method: "POST" });
    expect(resend.status).toBe(200);
    await api.runDeferred();
    const change = await api.call(changeOrderEmail, {
      params: { sessionId: order.orderId },
      body: { email: "alex.new@example.com" },
      headers: { [ORDER_ACCESS_HEADER]: order.access },
    });
    expect(change.status).toBe(200);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(2);
    for (const [message] of api.sendEmail.mock.calls) {
      const text = JSON.stringify(message);
      expect(text).not.toContain(issued);
      expect(text).not.toContain(`SH1:${issued}`);
      // The sent ticket is shown as sent: no code, no QR (ticket 2, still the buyer's, has the only QR).
      expect(text).not.toContain(codes[0]);
      expect(message.inlineImages?.filter((i) => i.cid.startsWith("ticket-qr")).map((i) => i.cid)).toEqual(["ticket-qr-2@sheltuh.com.au"]);
    }
  });
});

describe("the recipient's side", () => {
  it("4. view, accept and the received ticket: no other ticket's code, no order id or reference, no buyer, no amounts", async () => {
    const [amounts] = await api.db.query<{ total: number; subtotal: number }>(
      `select total_cents as total, subtotal_cents as subtotal from public.orders where id = $1`,
      [order.orderId],
    );
    // A second, still-open offer of ticket 2 to someone else, viewed by them.
    const second = await mintToken(api, await offer(api, order, { ticket: 2, email: "kim@example.com", name: "Kim Park" }));
    const answers = [
      await api.call(viewTicketOffer, { body: { token }, token: recipient.token }),
      await accept(api, token, recipient),
      await api.call(getReceivedTicket, { token: recipient.token, params: { transferId } }),
      await api.call(viewTicketOffer, { body: { token: second } }),
    ];
    for (const res of answers) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(codes[1]);
      expect(text).not.toMatch(/ord_/);
      expect(text).not.toContain(orderReference(order.orderId).slice(1));
      expect(text).not.toContain(BUYER);
      expect(text).not.toContain(maskEmail(BUYER));
      expect(text).not.toContain("Alexandra Buyer");
      for (const key of ["totalCents", "subtotalCents", "buyerFeeCents", "maskedEmail", "email", "tickets", "orderReference", "buyerName"]) {
        expect(Object.keys(res.body)).not.toContain(key);
      }
      expect(text).not.toMatch(new RegExp(`:${amounts.total}[,}]`));
      expect(text).not.toMatch(new RegExp(`:${amounts.subtotal}[,}]`));
    }
    // The received ticket carries the recipient's own code only.
    expect(answers[2].body.ticket.ticketCode).toBe(issued);
    expect(JSON.stringify(answers[2].body)).not.toContain(codes[0]);
    // The open offer: no code of any kind.
    expect(JSON.stringify(answers[3].body)).not.toMatch(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
  });
});

describe("6. the door", () => {
  it("the old code is `transferred` (not admitted, logged), the new one is admitted, the old one stays refused; replays agree", async () => {
    const requestId = crypto.randomUUID();
    const old = await checkIn(api, world, codes[0], requestId);
    expect(old.body).toEqual({
      outcome: "transferred",
      ticket: { ticketTypeName: "GA", ticketNumber: 1, ticketCount: 2, codeLast4: codes[0].slice(-4) },
    });
    const [logged] = await api.db.query<{ result: string; ticket_code: string; scanned_last4: string }>(
      `select result, ticket_code, scanned_last4 from public.ticket_check_ins where request_id = $1`,
      [requestId],
    );
    expect(logged).toEqual({ result: "transferred", ticket_code: codes[0], scanned_last4: codes[0].slice(-4) });
    // A replay of the same scan: the same answer, nothing new logged.
    expect((await checkIn(api, world, codes[0], requestId)).body).toEqual(old.body);
    expect(await api.db.query(`select 1 from public.ticket_check_ins where request_id = $1`, [requestId])).toHaveLength(1);

    const admitted = await checkIn(api, world, issued);
    expect(admitted.body).toMatchObject({
      outcome: "admitted",
      ticket: { ticketNumber: 1, ticketCount: 2, codeLast4: issued.slice(-4) },
    });
    expect((await checkIn(api, world, codes[0])).body.outcome).toBe("transferred");
    expect((await checkIn(api, world, issued)).body.outcome).toBe("already_checked_in");
    // The buyer's other ticket is untouched.
    expect((await checkIn(api, world, codes[1])).body.outcome).toBe("admitted");

    // Door staff see the code that was scanned: in the recent list and when undoing.
    const summary = await api.call(getCheckInSummary, { token: world.organiser.token, params: { eventId: world.eventId } });
    const recent = summary.body.recent as { result: string; codeLast4: string | null }[];
    expect(recent.filter((r) => r.result === "admitted").map((r) => r.codeLast4)).toEqual([codes[1].slice(-4), issued.slice(-4)]);
    expect(recent.filter((r) => r.result === "transferred").map((r) => r.codeLast4)).toEqual([codes[0].slice(-4), codes[0].slice(-4)]);
    const undo = await api.call(undoCheckIn, {
      token: world.organiser.token,
      params: { eventId: world.eventId, checkInId: admitted.body.checkInId },
      body: { reason: "Scanned the wrong person" },
    });
    expect(undo.body).toMatchObject({ outcome: "undone", ticket: { codeLast4: issued.slice(-4) } });
  });

  it("a scan's request id reused for the other credential of the same ticket is a conflict (409), as for another ticket", async () => {
    const requestId = crypto.randomUUID();
    expect((await checkIn(api, world, codes[0], requestId)).body.outcome).toBe("transferred");
    expect((await checkIn(api, world, issued, requestId)).status).toBe(409);
    // Its own retry replays.
    expect((await checkIn(api, world, codes[0], requestId)).body.outcome).toBe("transferred");
    // Another ticket's code with that id is a conflict.
    expect((await checkIn(api, world, codes[1], requestId)).status).toBe(409);
  });
});

describe("7. the recipient's code is read in one place", () => {
  /** Where issued_code may appear: the migration, the transfer handlers and helpers (and later the transfer emails and recipient wallet passes). */
  const ALLOWED = new Set([
    "supabase/migrations/20261203000000_ticket_transfers.sql",
    "lib/server/handlers/ticket-transfers.ts",
    "lib/server/ticket-transfers.ts",
    "lib/server/ticket-transfer-email.ts",
    // The outbox's transfer delivery reads the recipient's code for their own ticket email only.
    "lib/server/email-outbox.ts",
  ]);

  it("no other source file mentions issued_code", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx|js|mjs|sql)$/.test(entry.name) && readFileSync(path.join(root, rel), "utf8").includes("issued_code")) {
          found.push(rel);
        }
      }
    };
    for (const dir of ["app", "components", "lib", "scripts", "supabase"]) walk(dir);
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((file) => !ALLOWED.has(file))).toEqual([]);
  });
});
