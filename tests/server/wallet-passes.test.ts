import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { clientKey, orderKey } from "@/lib/server/client-key";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { confirmFreeOrder } from "@/lib/server/handlers/free-orders";
import { createCheckout, getOrderBySession, stripeWebhook } from "@/lib/server/handlers/orders";
import { getAppleWalletPass, getGoogleWalletPass, WALLET_RATE_LIMITS } from "@/lib/server/handlers/wallet";
import type { Handler } from "@/lib/server/route";
import type { EventRecord } from "@/lib/server/types";
import { appleWalletConfigFromEnv, googleWalletConfigFromEnv, type AppleWalletConfig, type GoogleWalletConfig } from "@/lib/server/wallet/config";
import { GOOGLE_SAVE_URL_BASE } from "@/lib/server/wallet/google";
import { ticketQrPayload } from "@/lib/ticket-code";
import { embeddedSession, SITE_URL, stripeWebhookRequest, TestApi, WEBHOOK_SECRET } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";
import { appleWalletEnv, decodeJwt, googleWalletEnv, readZip, verifyDetachedSignature } from "./helpers/wallet";

// The wallet pass routes (lib/server/handlers/wallet.ts):
// GET /api/orders/by-session/{id}/wallet/google?ticket={n} and …/apple, by the
// ticket page's capability and rules; the order response's `wallet` flags;
// the rate limit; and what never reaches a log. The passes themselves are
// wallet-google.test.ts and wallet-apple.test.ts.

const IP = "203.0.113.7";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let intents = 0;

// One credential set per run (key generation is slow); each test decides whether a wallet is on.
const googleCreds = googleWalletEnv();
const apple = appleWalletEnv();
const googleConfig = (googleWalletConfigFromEnv(googleCreds.env) as { config: GoogleWalletConfig }).config;
const appleConfig = (appleWalletConfigFromEnv(apple.env) as { config: AppleWalletConfig }).config;

const TICKETS = [
  { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 20 },
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
  api.googleWallet = googleConfig;
  api.appleWallet = appleConfig;
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
  await enablePayouts(api, organiser.organiserId);
  let sessions = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => embeddedSession(`cs_test_${++sessions}`));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A card checkout's order, still pending (no webhook yet). */
async function pendingOrder(quantity = 2) {
  await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity }] } });
  return api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
}

/** A paid order (checkout, then Stripe's webhook). */
async function paidOrder(quantity = 2) {
  const orderId = await pendingOrder(quantity);
  const paymentIntent = `pi_test_${++intents}`;
  const res = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${paymentIntent}`,
          object: "checkout.session",
          client_reference_id: orderId,
          payment_status: "paid",
          payment_intent: paymentIntent,
          customer_details: { email: "buyer@example.com" },
        },
      },
    }),
  );
  expect(res.status).toBe(200);
  return { orderId, paymentIntent };
}

/** A wallet route's raw response; `ticket` null for no `?ticket=`, `ip` null for no client IP header. */
const pass = (handler: Handler<{ sessionId: string }>, sessionId: string, ticket: string | null = "1", ip: string | null = IP) =>
  api.callRaw(handler, {
    params: { sessionId },
    query: ticket === null ? {} : { ticket },
    headers: ip === null ? {} : { "x-forwarded-for": ip },
  });

const page = async (orderId: string) => (await api.call(getOrderBySession, { params: { sessionId: orderId } })).body;

async function errorOf(res: Response) {
  return { status: res.status, cacheControl: res.headers.get("cache-control"), body: await res.json() };
}

describe("Add to Google Wallet (GET …/wallet/google?ticket={n})", () => {
  it("redirects a paid order's ticket to Google's save page, the JWT signed and its barcode the ticket's own QR payload", async () => {
    const { orderId } = await paidOrder(2);
    const { tickets } = await page(orderId);
    for (const [i, t] of (tickets as { ticketCode: string }[]).entries()) {
      const res = await pass(getGoogleWalletPass, orderId, String(i + 1));
      expect(res.status).toBe(302);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      // Google never gets this URL (its order id) as a Referer.
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      const location = res.headers.get("location")!;
      expect(location.startsWith(GOOGLE_SAVE_URL_BASE)).toBe(true);
      const { claims, verified } = decodeJwt(location.slice(GOOGLE_SAVE_URL_BASE.length), googleCreds.keys.publicKey);
      expect(verified).toBe(true);
      expect(claims.origins).toEqual([SITE_URL]);
      const [cls] = claims.payload.eventTicketClasses;
      const [object] = claims.payload.eventTicketObjects;
      expect(cls.id).toBe(`${googleConfig.issuerId}.sheltuh-event-${event.eventId}`);
      expect(cls.eventName.defaultValue.value).toBe("Neon Static");
      // The street address the ticket email shows (the page's response leaves it out).
      expect(cls.venue.address.defaultValue.value).toBe("71 Johnston St, Collingwood");
      expect(cls.dateTime).toEqual({ start: "2027-03-06T20:00:00+11:00", end: "2027-03-06T23:30:00+11:00" });
      expect(object.barcode).toEqual({ type: "QR_CODE", value: ticketQrPayload(t.ticketCode), alternateText: t.ticketCode });
      expect(object.ticketNumber).toBe(`${i + 1} of 2`);
      // Nothing about the buyer, and not the order id.
      expect(JSON.stringify(claims)).not.toMatch(new RegExp(`buyer@example\\.com|${orderId}`));
    }
  });
});

describe("Add to Apple Wallet (GET …/wallet/apple?ticket={n})", () => {
  it("serves a paid order's ticket as a signed .pkpass, uncached, named by its number only", async () => {
    const { orderId } = await paidOrder(2);
    const { tickets } = await page(orderId);
    const res = await pass(getAppleWalletPass, orderId, "2");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="sheltuh-ticket-2.pkpass"');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get("content-length")).toBe(String(bytes.length));
    const files = readZip(bytes);
    verifyDetachedSignature(files.get("signature")!, files.get("manifest.json")!, apple.signerPem, apple.wwdrPem);
    const json = JSON.parse(files.get("pass.json")!.toString("utf8"));
    const code = (tickets as { ticketCode: string }[])[1].ticketCode;
    expect(json.barcodes[0]).toMatchObject({ message: ticketQrPayload(code), altText: code });
    expect(json.eventTicket.auxiliaryFields[0].value).toBe("General admission · Ticket 2 of 2");
    expect(files.get("pass.json")!.toString("utf8")).not.toMatch(new RegExp(`buyer@example\\.com|${orderId}`));
  });
});

describe("pass serials (tickets.wallet_serial)", () => {
  /** Each ticket's stored serial, in the page's order, as 32 hex characters. */
  const serials = async (orderId: string) =>
    (
      await api.db.query<{ code: string; serial: string }>(
        `select code, replace(wallet_serial::text, '-', '') as serial from public.tickets where order_id = $1 order by ticket_type_id, code`,
        [orderId],
      )
    ).map((r) => r.serial);

  it("every ticket gets its own random serial, and both wallets use it: Apple's serialNumber, Google's object id", async () => {
    const { orderId } = await paidOrder(2);
    const stored = await serials(orderId);
    expect(stored).toHaveLength(2);
    expect(new Set(stored).size).toBe(2);
    const codes = ((await page(orderId)).tickets as { ticketCode: string }[]).map((t) => t.ticketCode);
    for (const [i, serial] of stored.entries()) {
      expect(serial).toMatch(/^[0-9a-f]{32}$/);
      // Nothing derived from the code (the earlier hashed serial, for one).
      expect(serial).not.toBe(createHash("sha256").update(`sheltuh/wallet-ticket/v1:${codes[i]}`).digest("hex").slice(0, 32));
      const applePass = readZip(Buffer.from(await (await pass(getAppleWalletPass, orderId, String(i + 1))).arrayBuffer()));
      expect(JSON.parse(applePass.get("pass.json")!.toString("utf8")).serialNumber).toBe(serial);
      const googleRes = await pass(getGoogleWalletPass, orderId, String(i + 1));
      const { claims } = decodeJwt(googleRes.headers.get("location")!.slice(GOOGLE_SAVE_URL_BASE.length), googleCreds.keys.publicKey);
      expect(claims.payload.eventTicketObjects[0].id).toBe(`${googleConfig.issuerId}.sheltuh-ticket-${serial}`);
    }
    // Stable: asked again, the same serials (adding a ticket again replaces its pass).
    expect(await serials(orderId)).toEqual(stored);
    const again = readZip(Buffer.from(await (await pass(getAppleWalletPass, orderId, "1")).arrayBuffer()));
    expect(JSON.parse(again.get("pass.json")!.toString("utf8")).serialNumber).toBe(stored[0]);
  });

  it("the serial is never in the ticket page's response", async () => {
    const { orderId } = await paidOrder(1);
    const [serial] = await serials(orderId);
    const raw = JSON.stringify(await page(orderId));
    expect(raw).not.toContain(serial);
    expect(raw).not.toContain(serial.slice(0, 8));
  });
});

describe("the event's current details", () => {
  it("Google's class (and the Apple pass) carry the event's current title, not the order's snapshot", async () => {
    const { orderId } = await paidOrder(1);
    await api.db.query(`update public.events set title = 'Neon Static (late show)' where id = $1`, [event.eventId]);
    expect((await page(orderId)).eventTitle).toBe("Neon Static");
    const res = await pass(getGoogleWalletPass, orderId);
    const { claims } = decodeJwt(res.headers.get("location")!.slice(GOOGLE_SAVE_URL_BASE.length), googleCreds.keys.publicKey);
    expect(claims.payload.eventTicketClasses[0].eventName.defaultValue.value).toBe("Neon Static (late show)");
    const files = readZip(Buffer.from(await (await pass(getAppleWalletPass, orderId)).arrayBuffer()));
    expect(JSON.parse(files.get("pass.json")!.toString("utf8")).eventTicket.primaryFields[0].value).toBe("Neon Static (late show)");
  });
});

describe("the ticket page's capability and rules", () => {
  const handlers = [
    ["google", getGoogleWalletPass],
    ["apple", getAppleWalletPass],
  ] as const;

  it("a malformed order id is a 404 without a query; an unknown one is a 404", async () => {
    for (const [, handler] of handlers) {
      const query = vi.spyOn(api.db, "query");
      for (const id of ["ord_", "cs_test_1", `ord_${"A".repeat(32)}`, "' or 1=1 --"]) {
        expect((await errorOf(await pass(handler, id))).status).toBe(404);
      }
      expect(query).not.toHaveBeenCalled();
      query.mockRestore();
      expect(await errorOf(await pass(handler, `ord_${"0".repeat(32)}`))).toEqual({
        status: 404,
        cacheControl: "private, no-store",
        body: { error: "Order not found." },
      });
    }
  });

  it("an unpaid order (pending, or failed) is a 404, the same as an unknown one", async () => {
    const pending = await pendingOrder();
    const failed = await pendingOrder();
    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [failed]);
    for (const [, handler] of handlers) {
      for (const id of [pending, failed]) {
        expect(await errorOf(await pass(handler, id))).toMatchObject({ status: 404, body: { error: "Order not found." } });
      }
    }
  });

  it("a refunded order's tickets are void: 404", async () => {
    const { orderId, paymentIntent } = await paidOrder(1);
    await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "charge.refunded",
        data: { object: { id: "ch_test", object: "charge", payment_intent: paymentIntent, amount_refunded: 3170, refunded: true } },
      }),
    );
    expect((await page(orderId)).status).toBe("refunded");
    for (const [, handler] of handlers) expect((await pass(handler, orderId)).status).toBe(404);
  });

  it("an event no longer listed (unpublished, in review, rejected) is a 404 and no wallet buttons; published again, both are back", async () => {
    const { orderId } = await paidOrder(1);
    const unpublished = await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });
    expect(unpublished.status).toBe(200);
    for (const status of ["draft", "pending_review", "rejected"]) {
      await api.db.query(`update public.events set status = $2::public.event_status where id = $1`, [event.eventId, status]);
      const body = await page(orderId);
      expect(body).toMatchObject({ status: "paid", eventListed: false });
      expect(body).not.toHaveProperty("wallet");
      for (const [, handler] of handlers) expect((await pass(handler, orderId)).status).toBe(404);
    }
    await api.db.query(`update public.events set status = 'published' where id = $1`, [event.eventId]);
    expect((await page(orderId)).wallet).toEqual({ google: true, apple: true });
    for (const [, handler] of handlers) expect([200, 302]).toContain((await pass(handler, orderId)).status);
  });

  it("only the order's own tickets: a number past its last ticket is a 404, another order's ticket can't be reached by number", async () => {
    const mine = await paidOrder(1);
    const theirs = await paidOrder(3);
    const theirCodes = ((await page(theirs.orderId)).tickets as { ticketCode: string }[]).map((t) => t.ticketCode);
    for (const [, handler] of handlers) {
      for (const n of ["2", "3", "9999"]) {
        expect(await errorOf(await pass(handler, mine.orderId, n))).toMatchObject({ status: 404, body: { error: "Ticket not found." } });
      }
    }
    // Ticket 1 of my order is my ticket, never theirs.
    const res = await pass(getGoogleWalletPass, mine.orderId, "1");
    const { claims } = decodeJwt(res.headers.get("location")!.slice(GOOGLE_SAVE_URL_BASE.length), googleCreds.keys.publicKey);
    expect(theirCodes).not.toContain(claims.payload.eventTicketObjects[0].barcode.alternateText);
  });

  it("the ticket number must be a whole number from 1: 400 otherwise", async () => {
    const { orderId } = await paidOrder(1);
    for (const [, handler] of handlers) {
      for (const ticket of [null, "", "0", "-1", "1.5", "abc", "01", "12345", "7KQM-2HXD"]) {
        expect(await errorOf(await pass(handler, orderId, ticket))).toMatchObject({
          status: 400,
          cacheControl: "private, no-store",
          body: { fieldErrors: { ticket: expect.any(String) } },
        });
      }
    }
  });

  it("free orders: a member's at once; a guest's once its emailed link is confirmed (404 before)", async () => {
    const member = await api.signUp({ email: "member@example.com" });
    const booked = await api.call(createCheckout, {
      token: member.token,
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 2 }], buyerEmail: member.email },
    });
    expect(booked.status).toBe(201);
    const memberOrder = new URL(booked.body.url).searchParams.get("session_id")!;
    expect((await page(memberOrder)).wallet).toEqual({ google: true, apple: true });
    expect((await pass(getGoogleWalletPass, memberOrder, "2")).status).toBe(302);
    expect((await pass(getAppleWalletPass, memberOrder, "2")).status).toBe(200);

    const guest = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" },
    });
    expect(guest.status).toBe(202);
    await api.runDeferred();
    const token = api.sendEmail.mock.calls.at(-1)![0].text.match(/#token=([A-Za-z0-9_-]+)/)![1];
    const [{ id: guestOrder }] = await api.db.query<{ id: string }>(
      `select id from public.orders where buyer_email = 'guest@example.com'`,
    );
    for (const [, handler] of handlers) expect((await pass(handler, guestOrder)).status).toBe(404);
    const confirmed = await api.call(confirmFreeOrder, { body: { token } });
    expect(new URL(confirmed.body.url).searchParams.get("session_id")).toBe(guestOrder);
    expect((await pass(getGoogleWalletPass, guestOrder)).status).toBe(302);
    expect((await pass(getAppleWalletPass, guestOrder)).status).toBe(200);
  });
});

describe("a wallet that isn't configured", () => {
  it("is a 404 before any query, and the order says so (`wallet` flags false)", async () => {
    const { orderId } = await paidOrder(1);
    api.googleWallet = undefined;
    api.appleWallet = undefined;
    expect((await page(orderId)).wallet).toEqual({ google: false, apple: false });
    const query = vi.spyOn(api.db, "query");
    expect(await errorOf(await pass(getGoogleWalletPass, orderId))).toEqual({
      status: 404,
      cacheControl: "private, no-store",
      body: { error: "Google Wallet passes aren't available." },
    });
    expect(await errorOf(await pass(getAppleWalletPass, orderId))).toEqual({
      status: 404,
      cacheControl: "private, no-store",
      body: { error: "Apple Wallet passes aren't available." },
    });
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();

    // Each one on its own.
    api.googleWallet = googleConfig;
    expect((await page(orderId)).wallet).toEqual({ google: true, apple: false });
    expect((await pass(getGoogleWalletPass, orderId)).status).toBe(302);
    expect((await pass(getAppleWalletPass, orderId)).status).toBe(404);
    api.googleWallet = undefined;
    api.appleWallet = appleConfig;
    expect((await page(orderId)).wallet).toEqual({ google: false, apple: true });
  });

  it("the order response carries `wallet` only when its tickets could be added (paid, listed, with tickets)", async () => {
    const pending = await pendingOrder();
    expect(await page(pending)).toEqual({ status: "pending" });
    const { orderId } = await paidOrder(1);
    expect((await page(orderId)).wallet).toEqual({ google: true, apple: true });
  });
});

describe("rate limit", () => {
  it(`allows ${WALLET_RATE_LIMITS.perClient.hits} a minute per client across both wallets and every order, then 429 (another client is unaffected)`, async () => {
    const { orderId } = await paidOrder(1);
    const unknown = `ord_${"1".repeat(32)}`;
    for (let i = 0; i < WALLET_RATE_LIMITS.perClient.hits; i++) {
      const handler = i % 2 ? getGoogleWalletPass : getAppleWalletPass;
      // Unknown orders count too: the limit bounds trying ids.
      const res = await pass(handler, i % 3 === 0 ? unknown : orderId);
      expect([200, 302, 404]).toContain(res.status);
    }
    expect(await errorOf(await pass(getGoogleWalletPass, orderId))).toMatchObject({ status: 429, cacheControl: "private, no-store" });
    expect((await pass(getAppleWalletPass, orderId)).status).toBe(429);
    expect((await pass(getGoogleWalletPass, orderId, "1", "198.51.100.20")).status).toBe(302);
    // Stored by the keyed hash only, never the address.
    const rows = await api.db.query<{ client_key: string; hits: number }>(
      `select client_key, hits from private.client_rate_limits where bucket = $1`,
      [WALLET_RATE_LIMITS.perClient.bucket],
    );
    expect(rows.map((r) => r.client_key).sort()).toEqual([clientKey(IP, WEBHOOK_SECRET), clientKey("198.51.100.20", WEBHOOK_SECRET)].sort());
    expect(JSON.stringify(rows)).not.toContain(IP);
  });

  it(`allows ${WALLET_RATE_LIMITS.perOrder.hits} a minute per order from any number of clients, then 429; another order and unknown ids are unaffected`, async () => {
    const { orderId } = await paidOrder(1);
    const other = await paidOrder(1);
    for (let i = 0; i < WALLET_RATE_LIMITS.perOrder.hits; i++) {
      const handler = i % 2 ? getGoogleWalletPass : getAppleWalletPass;
      // A fresh client each time: the per-client limit never applies.
      expect([200, 302]).toContain((await pass(handler, orderId, "1", `198.51.100.${i + 1}`)).status);
    }
    expect(await errorOf(await pass(getGoogleWalletPass, orderId, "1", "203.0.113.200"))).toMatchObject({
      status: 429,
      cacheControl: "private, no-store",
      body: { error: expect.stringContaining("This order") },
    });
    expect((await pass(getAppleWalletPass, orderId, "1", "203.0.113.201")).status).toBe(429);
    expect((await pass(getGoogleWalletPass, other.orderId, "1", "203.0.113.202")).status).toBe(302);
    // Keyed on an HMAC of the order id, never the id; unknown ids take no per-order hit.
    await pass(getGoogleWalletPass, `ord_${"2".repeat(32)}`, "1", "203.0.113.203");
    const rows = await api.db.query<{ client_key: string }>(`select client_key from private.client_rate_limits where bucket = $1`, [
      WALLET_RATE_LIMITS.perOrder.bucket,
    ]);
    expect(rows.map((r) => r.client_key).sort()).toEqual([orderKey(orderId, WEBHOOK_SECRET), orderKey(other.orderId, WEBHOOK_SECRET)].sort());
    expect(JSON.stringify(rows)).not.toContain(orderId);
  });

  it("malformed requests and a wallet that's off don't count", async () => {
    const { orderId } = await paidOrder(1);
    api.appleWallet = undefined;
    for (let i = 0; i < 40; i++) {
      await pass(getGoogleWalletPass, "ord_bad");
      await pass(getGoogleWalletPass, orderId, "zero");
      await pass(getAppleWalletPass, orderId);
    }
    expect((await pass(getGoogleWalletPass, orderId)).status).toBe(302);
  });

  it("without a client IP header the limit is skipped, logged without request details", async () => {
    const { orderId } = await paidOrder(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await pass(getGoogleWalletPass, orderId, "1", null)).status).toBe(302);
    expect(warn).toHaveBeenCalledWith("Wallet pass (google) without a client IP header: the per-client limit was skipped.");
  });
});

describe("log hygiene", () => {
  it("never logs a key, a certificate, a session (order) id or a ticket code, whatever happens", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { orderId } = await paidOrder(1);
    const codes = ((await page(orderId)).tickets as { ticketCode: string }[]).map((t) => t.ticketCode);
    await pass(getGoogleWalletPass, orderId);
    await pass(getAppleWalletPass, orderId);
    await pass(getGoogleWalletPass, orderId, "1", null);
    // Signing fails (a key that can't sign): a bare 500, logged without detail.
    api.appleWallet = { ...appleConfig, signerKey: {} as AppleWalletConfig["signerKey"] };
    const failed = await pass(getAppleWalletPass, orderId);
    expect(await errorOf(failed)).toMatchObject({ status: 500, body: { error: "Something went wrong." } });
    // A misconfigured wallet, as Deps would log it.
    const { loadWalletConfig } = await import("@/lib/server/wallet/config");
    loadWalletConfig("Google Wallet", () => googleWalletConfigFromEnv({ ...googleCreds.env, GOOGLE_WALLET_ISSUER_ID: "x" }));
    loadWalletConfig("Apple Wallet", () => appleWalletConfigFromEnv({ ...apple.env, APPLE_WALLET_TEAM_ID: "x" }));

    const logged = spies.flatMap((s) => s.mock.calls.flat()).map(String).join("\n");
    expect(logged).toContain("Apple Wallet pass signing failed.");
    for (const secret of [
      orderId,
      ...codes,
      googleCreds.env.GOOGLE_WALLET_PRIVATE_KEY!.slice(30, 90),
      googleCreds.keys.privatePem.split("\n")[1],
      apple.env.APPLE_WALLET_CERT_PEM!.slice(0, 40),
      apple.env.APPLE_WALLET_KEY_PEM!.slice(0, 40),
      apple.signerPem.split("\n")[1],
      "PRIVATE KEY",
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe("the ticket email's wallet links (lib/server/ticket-email.ts, ticketWalletLinks)", () => {
  /** The order's ticket email, as the outbox sent it (the paid webhook queues it; Deps.defer drains it). */
  async function sentEmail() {
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalled();
    return api.sendEmail.mock.calls.at(-1)![0];
  }

  /** Each plain-text ticket block: its number, its entry code, and its wallet links (label → URL). */
  function textTickets(text: string) {
    return text
      .split("\n\nTicket ")
      .slice(1)
      .map((block) => {
        const number = Number(/^(\d+) of /.exec(block)![1]);
        const code = /^Entry code: (\S+)$/m.exec(block)![1];
        const links = Object.fromEntries([...block.matchAll(/^(Add to (?:Apple|Google) Wallet): (\S+)$/gm)].map((m) => [m[1], m[2]]));
        return { number, code, links };
      });
  }

  it("each ticket's links are numbered as the route takes them: ?ticket=n is the pass of the ticket the email shows as n", async () => {
    const { orderId } = await paidOrder(3);
    const { text, html } = await sentEmail();
    const tickets = textTickets(text);
    expect(tickets.map((t) => t.number)).toEqual([1, 2, 3]);
    // The email's order is the ticket page's (the API's), which is the route's.
    expect(tickets.map((t) => t.code)).toEqual(((await page(orderId)).tickets as { ticketCode: string }[]).map((t) => t.ticketCode));
    const panels = html.split('class="ticket"').slice(1);
    expect(panels).toHaveLength(3);
    for (const [i, { number, code, links }] of tickets.entries()) {
      const base = `${SITE_URL}/api/orders/by-session/${orderId}/wallet`;
      expect(links).toEqual({
        "Add to Apple Wallet": `${base}/apple?ticket=${number}`,
        "Add to Google Wallet": `${base}/google?ticket=${number}`,
      });
      // The HTML panel showing this code links the same two routes, and no other ticket's.
      expect(panels[i]).toContain(code);
      expect(panels[i]).toContain(`href="${base}/apple?ticket=${number}"`);
      expect(panels[i]).toContain(`href="${base}/google?ticket=${number}"`);
      expect(panels[i].match(/\/wallet\/(?:apple|google)\?ticket=(\d+)/g)!.every((m) => m.endsWith(`=${number}`))).toBe(true);

      // Following the link gives this ticket's pass, from both wallets.
      const google = await pass(getGoogleWalletPass, orderId, String(number));
      const { claims } = decodeJwt(google.headers.get("location")!.slice(GOOGLE_SAVE_URL_BASE.length), googleCreds.keys.publicKey);
      expect(claims.payload.eventTicketObjects[0].barcode.alternateText).toBe(code);
      const applePass = readZip(Buffer.from(await (await pass(getAppleWalletPass, orderId, String(number))).arrayBuffer()));
      expect(JSON.parse(applePass.get("pass.json")!.toString("utf8")).barcodes[0].altText).toBe(code);
    }
  });

  it("only for the wallets that are on, and none with both off", async () => {
    api.googleWallet = undefined;
    const { orderId } = await paidOrder(1);
    let { text, html } = await sentEmail();
    expect(textTickets(text)[0].links).toEqual({ "Add to Apple Wallet": `${SITE_URL}/api/orders/by-session/${orderId}/wallet/apple?ticket=1` });
    expect(html).toContain(">Add to Apple Wallet</a>");
    expect(html).not.toContain("Google Wallet");

    api.appleWallet = undefined;
    api.sendEmail.mockClear();
    await paidOrder(1);
    ({ text, html } = await sentEmail());
    for (const body of [text, html]) {
      expect(body).not.toContain("/wallet/");
      expect(body).not.toMatch(/Add to (Apple|Google) Wallet/);
    }
  });

  it("none once the event isn't listed when the email is built (the routes would 404)", async () => {
    await paidOrder(1);
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    const { text, html } = await sentEmail();
    expect(text).toContain("This event is no longer listed.");
    for (const body of [text, html]) {
      expect(body).not.toContain("/wallet/");
      expect(body).not.toMatch(/Add to (Apple|Google) Wallet/);
    }
  });
});
