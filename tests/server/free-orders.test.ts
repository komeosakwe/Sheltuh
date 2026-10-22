import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmFreeOrder, FREE_LIMITS } from "@/lib/server/handlers/free-orders";
import { createCheckout, getOrderBySession } from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

const FREE = [
  { id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 },
  { id: "kids", name: "Kids", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 },
];

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  serverUrl = testDb.url;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Books; a guest's confirmation email is sent after the response
 * (Deps.defer), so for a guest (no token) that's run too. A member's deferred
 * ticket email is left for the test to run. `bookOnly` runs nothing.
 */
async function book(
  buyerEmail: string,
  quantity = 1,
  options: { token?: string; eventId?: string; ticketTypeId?: string; extra?: Record<string, unknown> } = {},
) {
  const res = await bookOnly(buyerEmail, quantity, options);
  if (!options.token) await api.runDeferred();
  return res;
}

function bookOnly(
  buyerEmail: string,
  quantity = 1,
  options: { token?: string; eventId?: string; ticketTypeId?: string; extra?: Record<string, unknown> } = {},
) {
  return api.call(createCheckout, {
    token: options.token,
    params: { eventId: options.eventId ?? event.eventId },
    body: { lineItems: [{ ticketTypeId: options.ticketTypeId ?? "rsvp", quantity }], buyerEmail, ...options.extra },
  });
}

function confirm(token: unknown) {
  return api.call(confirmFreeOrder, { body: { token } });
}

/** The token from the n-th email sent (its link's fragment). */
function tokenFromEmail(n = -1): string {
  const message = api.sendEmail.mock.calls.at(n)![0];
  const match = message.text.match(/\/checkout\/confirm#token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("no confirmation link in the email");
  return match[1];
}

async function sold(eventId = event.eventId) {
  const rows = await api.db.query<{ id: string; quantity_sold: number }>(
    `select id, quantity_sold from public.ticket_types where event_id = $1 order by id`,
    [eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.quantity_sold]));
}

async function orders() {
  return api.db.query<{ status: string; buyer_email: string; buyer_email_key: string; tickets: number }>(
    `select o.status::text as status, o.buyer_email, o.buyer_email_key,
            (select count(*)::int from public.tickets t where t.order_id = o.id) as tickets
       from public.orders o order by o.created_at, o.id`,
  );
}

async function refusals() {
  const rows = await api.db.query<{ reason: string; refusals: number }>(
    `select reason, refusals from private.free_order_refusals order by reason`,
  );
  return Object.fromEntries(rows.map((r) => [r.reason, r.refusals]));
}

async function buckets() {
  const rows = await api.db.query<{ bucket: string; hits: number }>(
    `select bucket, hits from private.platform_rate_limits order by bucket`,
  );
  return Object.fromEntries(rows.map((r) => [r.bucket, r.hits]));
}

async function bookAndConfirm(email: string, quantity = 1, ticketTypeId = "rsvp") {
  const res = await book(email, quantity, { ticketTypeId });
  expect(res.status).toBe(202);
  return confirm(tokenFromEmail());
}

describe("guest: book, then confirm by email", () => {
  it("records a pending order holding nothing, emails a link, and issues the tickets only on confirmation", async () => {
    const res = await book("fan@example.com", 2);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "confirmation_sent", expiresInHours: 24 });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await sold()).toEqual({ kids: 0, rsvp: 0 });
    expect(await orders()).toEqual([{ status: "pending", buyer_email: "fan@example.com", buyer_email_key: "fan@example.com", tickets: 0 }]);

    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    const email = api.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("fan@example.com");
    expect(email.subject).toBe("Confirm your free tickets: Neon Static");
    expect(email.text).toContain("2 × RSVP");
    const token = tokenFromEmail();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(email.html).toContain(`${SITE_URL}/checkout/confirm#token=${token}`);

    // Only a hash of the token is stored, and it expires in 24 hours.
    const [stored] = await api.db.query<{ row: string; hours: number }>(
      `select row_to_json(o)::text as row, (extract(epoch from confirmation_expires_at - now()) / 3600)::float8 as hours from public.orders o`,
    );
    expect(stored.row).not.toContain(token);
    expect(stored.hours).toBeGreaterThan(23.9);
    expect(stored.hours).toBeLessThanOrEqual(24);
    expect(JSON.stringify(res.body)).not.toContain(token);

    const confirmed = await confirm(token);
    expect(confirmed.status).toBe(200);
    expect(confirmed.headers.get("cache-control")).toBe("private, no-store");
    expect(confirmed.body.url).toMatch(/^https:\/\/sheltuh\.test\/checkout\/success\?session_id=ord_[0-9a-f]{32}$/);
    expect(await sold()).toEqual({ kids: 0, rsvp: 2 });
    const orderId = new URL(confirmed.body.url).searchParams.get("session_id")!;
    const page = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(page.body).toMatchObject({ status: "paid", maskedEmail: "f***@example.com" });
    expect(page.body.tickets).toHaveLength(2);

    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(2);
    expect(api.sendEmail.mock.calls[1][0].subject).toBe("Your tickets: Neon Static");
  });

  it("confirming again is harmless: the same page, no more tickets, one ticket email", async () => {
    await book("fan@example.com", 2);
    const token = tokenFromEmail();
    const first = await confirm(token);
    const again = await confirm(token);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await sold()).toEqual({ kids: 0, rsvp: 2 });
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(2); // the link, then the tickets
  });

  it("confirmations racing each other issue the tickets once", async () => {
    await book("fan@example.com", 2);
    const token = tokenFromEmail();
    const results = await Promise.all([1, 2, 3].map(() => confirm(token)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.body.url)).size).toBe(1);
    expect(await sold()).toEqual({ kids: 0, rsvp: 2 });
    expect((await orders())[0].tickets).toBe(2);
  });

  it("an expired link issues nothing (410)", async () => {
    await book("fan@example.com");
    await api.db.query(`update public.orders set confirmation_expires_at = now() - interval '1 second'`);
    const res = await confirm(tokenFromEmail());
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/);
    expect(await sold()).toEqual({ kids: 0, rsvp: 0 });
    expect((await orders())[0]).toMatchObject({ status: "pending", tickets: 0 });
  });

  it("a malformed token is a 400 and an unknown one a 404", async () => {
    await book("fan@example.com");
    const token = tokenFromEmail();
    for (const bad of [undefined, "", 42, token.slice(1), `${token}x`, token.replace(/.$/, "!")]) {
      const res = await confirm(bad);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.token).toBeTruthy();
    }
    const unknown = await confirm("A".repeat(43));
    expect(unknown.status).toBe(404);
    expect(await sold()).toEqual({ kids: 0, rsvp: 0 });
  });

  it("an invalid email is a 400 that records nothing and sends nothing", async () => {
    for (const buyerEmail of [
      "",
      "nope",
      "a@b",
      "two@@example.com",
      " @example.com",
      `${"x".repeat(320)}@example.com`,
      // Address-list syntax that mail software would read as other recipients.
      "victim+,attacker.x@gmail.com",
      "n1<me@gmail.com>",
      "(n1)me@gmail.com",
      '"quoted"@example.com',
      '"a,b"@example.com',
      "a@example.com; b@example.com",
      "a:b@example.com",
      "x@[127.0.0.1]",
      "back\\slash@example.com",
    ]) {
      expect((await book(buyerEmail)).status).toBe(400);
    }
    expect(await orders()).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("the link is emailed only after the response: no SMTP call before it, the same 202 as an address-limited request", async () => {
    const res = await bookOnly("fan@example.com");
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "confirmation_sent", expiresInHours: 24 });
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect(await orders()).toHaveLength(1);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0].to).toBe("fan@example.com");
  });

  it("if the confirmation email can't be sent: still 202 (sent after the response), nothing kept, and the log names no address or order", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValueOnce(new Error("550 <fan@example.com> no such user"));
    const res = await bookOnly("fan@example.com");
    expect(res.status).toBe(202);
    expect(await orders()).toHaveLength(1);
    await api.runDeferred();
    expect(await orders()).toEqual([]);
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("confirmation email failed");
    expect(logged).not.toContain("fan@example.com");
    expect(logged).not.toMatch(/ord_[0-9a-f]{32}/);
  });

  it("a flood of requests can't drain an event: nothing is held until a link is confirmed", async () => {
    const small = await publishedEvent(api, organiser, admin, {
      title: "Tiny room",
      ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 2 }],
    });
    for (let i = 0; i < 25; i++) expect((await book(`bot${i}@example.com`, 2, { eventId: small.eventId })).status).toBe(202);
    expect(await sold(small.eventId)).toEqual({ rsvp: 0 });
    // A real person can still book and confirm.
    expect((await book("real@example.com", 2, { eventId: small.eventId })).status).toBe(202);
    expect((await confirm(tokenFromEmail())).status).toBe(200);
    expect(await sold(small.eventId)).toEqual({ rsvp: 2 });
  });

  it("keeps inventory exact: a confirmation after a sell-out is refused and holds nothing", async () => {
    const small = await publishedEvent(api, organiser, admin, {
      title: "Tiny room",
      ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 3 }],
    });
    await book("a@example.com", 2, { eventId: small.eventId });
    const first = tokenFromEmail();
    await book("b@example.com", 2, { eventId: small.eventId });
    const second = tokenFromEmail();
    expect((await confirm(first)).status).toBe(200);
    const late = await confirm(second);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/ran out/);
    expect(await sold(small.eventId)).toEqual({ rsvp: 2 });
    expect((await orders()).map((o) => [o.status, o.tickets])).toEqual([
      ["paid", 2],
      ["failed", 0],
    ]);
    // ...and stays refused.
    expect((await confirm(second)).status).toBe(409);
  });

  it("unconfirmed links can't be reused once refused or expired, and refused orders hold nothing", async () => {
    await book("fan@example.com");
    await api.db.query(`update public.orders set status = 'failed'`);
    const res = await confirm(tokenFromEmail());
    expect(res.status).toBe(409);
    expect(await sold()).toEqual({ kids: 0, rsvp: 0 });
  });
});

describe("member: straight away", () => {
  it("only for the member's own verified email; anyone else confirms by email", async () => {
    const member = await api.signUp({ email: "Mia@Example.com" });
    const instant = await book("mia@example.com", 1, { token: member.token });
    expect(instant.status).toBe(201);
    expect(instant.headers.get("cache-control")).toBe("private, no-store");

    // Someone else's address, an unverified account, or a token that doesn't check out: the guest path.
    expect((await book("friend@example.com", 1, { token: member.token })).status).toBe(202);
    const unverified = await api.signUp({ email: "new@example.com", emailVerified: false });
    expect((await book("new@example.com", 1, { token: unverified.token })).status).toBe(202);
    expect((await book("mia@example.com", 1, { token: "not-a-real-token" })).status).toBe(202);
    expect(await sold()).toEqual({ kids: 0, rsvp: 1 });
  });

  it("at most 10 free orders a day per account; refusals and sell-outs don't use the allowance", async () => {
    const member = await api.signUp({ email: "mia@example.com" });
    const events = [event];
    for (let i = 0; i < 4; i++) events.push(await publishedEvent(api, organiser, admin, { ticketTypes: FREE }));
    // A sell-out first: doesn't count.
    const gone = await publishedEvent(api, organiser, admin, {
      ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 1 }],
    });
    await api.db.query(`update public.ticket_types set quantity_sold = 1 where event_id = $1`, [gone.eventId]);
    expect((await book("mia@example.com", 1, { token: member.token, eventId: gone.eventId })).status).toBe(409);

    let placed = 0;
    for (const e of events) {
      for (const ticketTypeId of ["rsvp", "kids"]) {
        const res = await book("mia@example.com", 1, { token: member.token, eventId: e.eventId, ticketTypeId });
        expect(res.status).toBe(201);
        placed += 1;
      }
    }
    expect(placed).toBe(10);
    const extra = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    const over = await book("mia@example.com", 1, { token: member.token, eventId: extra.eventId });
    expect(over.status).toBe(429);
    expect(await sold(extra.eventId)).toEqual({ kids: 0, rsvp: 0 });
    expect(await refusals()).toEqual({ member_daily_limit: 1 });
  });
});

describe("member claim losing a race for the last tickets (SQL)", () => {
  it("leaves no order, holds nothing and doesn't use the daily allowance", async () => {
    const member = await api.signUp({ email: "mia@example.com" });
    // Gone between the API's availability check and the claim.
    await api.db.query(`update public.ticket_types set quantity_sold = quantity_available where event_id = $1`, [event.eventId]);
    const [row] = await api.db.query<{ r: string }>(
      `select private.place_free_order($1, $2, $3, 'Neon Static', $4::text::jsonb, 'mia@example.com', null, $5,
              '[{"ticketCode":"ZZZZ-ZZZZ","ticketTypeId":"rsvp","ticketTypeName":"RSVP"}]'::jsonb, 4, 10, '24 hours') as r`,
      [
        `ord_${"9".repeat(32)}`,
        event.eventId,
        event.organiserId,
        JSON.stringify([{ ticketTypeId: "rsvp", ticketTypeName: "RSVP", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 1 }]),
        member.userId,
      ],
    );
    expect(row.r).toBe("sold_out");
    expect(await orders()).toEqual([]);
    expect(await sold()).toEqual({ kids: 20, rsvp: 20 });
    const limits = await api.db.query(`select hits from private.rate_limits where user_id = $1`, [member.userId]);
    expect(limits).toEqual([]);
  });
});

describe("caps", () => {
  it("at most 4 free tickets per order", async () => {
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: {
        lineItems: [
          { ticketTypeId: "rsvp", quantity: 3 },
          { ticketTypeId: "kids", quantity: 2 },
        ],
        buyerEmail: "fan@example.com",
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.lineItems).toMatch(/up to 4 free tickets/);
    expect(await orders()).toEqual([]);
    expect(await refusals()).toEqual({ order_too_large: 1 });
    expect((await book("fan@example.com", 4)).status).toBe(202);
  });

  it("at most 4 per person per event, however the address is written (+tag, case, Gmail dots)", async () => {
    expect((await bookAndConfirm("fan@gmail.com", 3)).status).toBe(200);
    for (const variant of ["Fan+again@Gmail.com", "f.a.n@gmail.com", "FAN@googlemail.com"]) {
      const res = await bookAndConfirm(variant, 2);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already has them/);
    }
    // One more is fine, under any spelling.
    expect((await bookAndConfirm("f.an+last@gmail.com", 1)).status).toBe(200);
    expect(await sold()).toEqual({ kids: 0, rsvp: 4 });
    // Across ticket types too.
    expect((await bookAndConfirm("fan@gmail.com", 1, "kids")).status).toBe(409);
    // Another person, or another event, is unaffected.
    expect((await bookAndConfirm("someone@gmail.com", 4)).status).toBe(200);
    const other = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    expect((await book("fan@gmail.com", 4, { eventId: other.eventId })).status).toBe(202);
    expect((await confirm(tokenFromEmail())).status).toBe(200);
  });

  it("the per-person cap also applies to members, combined with guest bookings", async () => {
    await bookAndConfirm("mia@example.com", 3);
    const member = await api.signUp({ email: "mia@example.com" });
    const res = await book("mia@example.com", 2, { token: member.token });
    expect(res.status).toBe(409);
    expect((await book("mia@example.com", 1, { token: member.token })).status).toBe(201);
    expect(await sold()).toEqual({ kids: 0, rsvp: 4 });
  });

  it("at most 3 unconfirmed links per address per hour; the 4th looks the same but sends nothing", async () => {
    for (const variant of ["fan@example.com", "Fan+1@example.com", "FAN+2@EXAMPLE.COM"]) {
      expect((await book(variant)).status).toBe(202);
    }
    const fourth = await book("fan+3@example.com");
    expect(fourth.status).toBe(202);
    expect(fourth.body).toEqual({ status: "confirmation_sent", expiresInHours: 24 });
    expect(api.sendEmail).toHaveBeenCalledTimes(3);
    expect(await orders()).toHaveLength(3);
    expect(await refusals()).toEqual({ address_hourly_limit: 1 });

    // Another address is unaffected; and confirming one frees a slot (its ticket email isn't a link).
    const links = () => api.sendEmail.mock.calls.filter(([m]) => m.subject.startsWith("Confirm your free tickets")).length;
    expect((await book("other@example.com")).status).toBe(202);
    expect(links()).toBe(4);
    expect((await confirm(tokenFromEmail(0))).status).toBe(200);
    await book("fan@example.com");
    expect(links()).toBe(5);
    // An hour later, links are allowed again.
    await api.db.query(`update public.orders set created_at = now() - interval '61 minutes'`);
    await book("fan@example.com");
    expect(links()).toBe(6);
  });

  it("at most 60 confirmation emails an hour platform-wide: then 503, nothing recorded", async () => {
    expect(FREE_LIMITS.platformHourly.hits).toBe(60);
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('free_order_confirmations', now(), $1)`,
      [FREE_LIMITS.platformHourly.hits],
    );
    const res = await book("fan@example.com");
    expect(res.status).toBe(503);
    expect(await orders()).toEqual([]);
    expect(api.sendEmail).not.toHaveBeenCalled();
    // Members aren't affected (no email needed to confirm).
    const member = await api.signUp({ email: "mia@example.com" });
    expect((await book("mia@example.com", 1, { token: member.token })).status).toBe(201);
    expect(await refusals()).toEqual({ platform_hourly_limit: 1 });
  });

  it("at most 400 confirmation emails per 24 hours platform-wide: then 503, nothing recorded", async () => {
    expect(FREE_LIMITS.platformDaily).toEqual({ hits: 400, window: "24 hours" });
    // One link takes a hit on each bucket.
    expect((await book("first@example.com")).status).toBe(202);
    expect(await buckets()).toEqual({ free_order_confirmations: 1, free_order_confirmations_daily: 1 });

    await api.db.query(
      `update private.platform_rate_limits set hits = $1 where bucket = 'free_order_confirmations_daily'`,
      [FREE_LIMITS.platformDaily.hits],
    );
    const res = await book("fan@example.com");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Free bookings are busy right now. Try again in a few minutes.");
    expect(await orders()).toHaveLength(1);
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(await refusals()).toEqual({ platform_daily_limit: 1 });
    // The hourly bucket isn't spent on a refusal.
    expect((await buckets()).free_order_confirmations).toBe(1);
    // Members aren't affected.
    const member = await api.signUp({ email: "mia@example.com" });
    expect((await book("mia@example.com", 1, { token: member.token })).status).toBe(201);

    // A day later, links are allowed again.
    await api.db.query(`update private.platform_rate_limits set window_started_at = now() - interval '24 hours 1 minute'`);
    expect((await book("fan@example.com")).status).toBe(202);
  });

  it("the platform caps are checked before the address: the same 503 whichever address asks", async () => {
    for (const variant of ["fan@example.com", "fan+1@example.com", "fan+2@example.com"]) await book(variant);
    // That address is at its hourly limit: its 4th looks sent, and takes nothing from the platform.
    expect((await book("fan+3@example.com")).status).toBe(202);
    expect(await buckets()).toEqual({ free_order_confirmations: 3, free_order_confirmations_daily: 3 });

    for (const bucket of ["free_order_confirmations", "free_order_confirmations_daily"]) {
      const saved = await buckets();
      await api.db.query(`update private.platform_rate_limits set hits = 1000 where bucket = $1`, [bucket]);
      expect((await book("fan+4@example.com")).status).toBe(503);
      expect((await book("new@example.com")).status).toBe(503);
      await api.db.query(`update private.platform_rate_limits set hits = $2 where bucket = $1`, [bucket, saved[bucket]]);
    }
    expect(await refusals()).toEqual({ address_hourly_limit: 1, platform_daily_limit: 2, platform_hourly_limit: 2 });
  });

  it("the previous request_free_order signature (for a deploy in progress) still applies the daily cap", async () => {
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('free_order_confirmations_daily', now(), 400)`,
    );
    const [row] = await api.db.query<{ r: string }>(
      `select private.request_free_order($1, $2, $3, 'Neon Static', '[]'::jsonb, 'fan@example.com', null, $4,
              '24 hours', 3, '1 hour', 300, '1 hour') as r`,
      [`ord_${"a".repeat(32)}`, event.eventId, event.organiserId, "a".repeat(64)],
    );
    expect(row.r).toBe("platform_daily_limited");
    expect(await orders()).toEqual([]);
  });

  it("a counter that's already over its cap refuses without writing", async () => {
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('b', now(), 3)`,
    );
    const take = async () =>
      (await api.db.query<{ ok: boolean }>(`select private.take_platform_rate_limit('b', 2, '1 hour') as ok`))[0].ok;
    const version = async () =>
      (await api.db.query<{ v: string }>(`select xmin::text as v from private.platform_rate_limits where bucket = 'b'`))[0].v;
    const before = await version();
    expect(await take()).toBe(false);
    expect(await version()).toBe(before);
    // At the limit (not yet over), one more hit is still recorded, and refused.
    await api.db.query(`update private.platform_rate_limits set hits = 2 where bucket = 'b'`);
    expect(await take()).toBe(false);
    expect((await api.db.query(`select hits from private.platform_rate_limits where bucket = 'b'`))[0]).toEqual({ hits: 3 });
    // A new window starts over.
    await api.db.query(`update private.platform_rate_limits set window_started_at = now() - interval '61 minutes'`);
    expect(await take()).toBe(true);
  });

  it("refusal counts stop at 10,000 a day per reason, without writing", async () => {
    const record = () => api.db.query(`select private.record_free_order_refusal('order_too_large')`);
    await record();
    expect(await refusals()).toEqual({ order_too_large: 1 });
    await api.db.query(`update private.free_order_refusals set refusals = 9999`);
    await record();
    expect(await refusals()).toEqual({ order_too_large: 10000 });
    const [{ v: before }] = await api.db.query<{ v: string }>(`select xmin::text as v from private.free_order_refusals`);
    await record();
    const [{ v: after }] = await api.db.query<{ v: string }>(`select xmin::text as v from private.free_order_refusals`);
    expect(after).toBe(before);
    expect(await refusals()).toEqual({ order_too_large: 10000 });
  });

  it("refusal counts hold no personal data: a day, a reason and a number", async () => {
    await book("fan@example.com", 5);
    for (let i = 0; i < 4; i++) await book("fan@example.com");
    await bookAndConfirm("x@example.com", 4);
    await bookAndConfirm("x@example.com", 1);
    const columns = await api.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'private' and table_name = 'free_order_refusals' order by ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(["day", "reason", "refusals"]);
    const rows = await api.db.query(`select * from private.free_order_refusals`);
    expect(JSON.stringify(rows)).not.toMatch(/@|example|fan/);
    expect(await refusals()).toEqual({ address_hourly_limit: 1, order_too_large: 1, person_event_limit: 1 });
  });
});

describe("email key", () => {
  it.each([
    ["Fan@Example.com", "fan@example.com"],
    ["  fan+tickets@example.com ", "fan@example.com"],
    ["f.a.n@example.com", "f.a.n@example.com"],
    ["F.A.N+x@GMAIL.com", "fan@gmail.com"],
    ["fan@googlemail.com", "fan@gmail.com"],
    ["fan+a+b@example.com", "fan@example.com"],
    ["we\"ird@sub.example.com", "we\"ird@sub.example.com"],
    // Nothing before the '+' (or only dots, for Gmail): the whole local part.
    ["+promo@gmail.com", "+promo@gmail.com"],
    ["+Promo@Example.com", "+promo@example.com"],
    ["+@example.com", "+@example.com"],
    ["..+x@googlemail.com", "..+x@gmail.com"],
    ["f.an+@gmail.com", "fan@gmail.com"],
  ])("%s → %s", async (email, key) => {
    const [row] = await api.db.query<{ key: string }>(`select private.email_key($1) as key`, [email]);
    expect(row.key).toBe(key);
  });
});

describe("email key: addresses with nothing before the '+'", () => {
  it("each gets its own allowance", async () => {
    expect((await bookAndConfirm("+a@example.com", 4)).status).toBe(200);
    expect((await bookAndConfirm("+b@example.com", 4)).status).toBe(200);
    expect((await bookAndConfirm("+A@Example.com", 1)).status).toBe(409);
    expect((await orders()).map((o) => o.buyer_email_key)).toEqual(["+a@example.com", "+b@example.com", "+a@example.com"]);
  });
});

describe("confirmation re-checks", () => {
  it("an expired link is refused even after it was confirmed; within its 24 hours it still answers", async () => {
    await book("fan@example.com");
    const token = tokenFromEmail();
    expect((await confirm(token)).status).toBe(200);
    expect((await confirm(token)).status).toBe(200);
    await api.db.query(`update public.orders set confirmation_expires_at = now() - interval '1 second'`);
    const late = await confirm(token);
    expect(late.status).toBe(410);
    expect(late.body.error).toBe("This link has expired. Your tickets were emailed to you when you confirmed it.");
    expect(late.body.url).toBeUndefined();
    // Nothing changed.
    expect((await orders())[0]).toMatchObject({ status: "paid", tickets: 1 });
  });

  it("a ticket type that's no longer free issues nothing: 409, and the order is failed", async () => {
    await book("fan@example.com", 2);
    const token = tokenFromEmail();
    // The organiser unpublished, priced it, and it was published again.
    await api.db.query(`update public.ticket_types set price_cents = 1500 where event_id = $1 and id = 'rsvp'`, [event.eventId]);
    const res = await confirm(token);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("These tickets aren't free any more. Book again from the event page.");
    expect(await sold()).toEqual({ kids: 0, rsvp: 0 });
    expect((await orders())[0]).toMatchObject({ status: "failed", tickets: 0 });
    expect((await confirm(token)).status).toBe(409);
  });

  it("so is a ticket type that no longer exists", async () => {
    await book("fan@example.com", 1, { ticketTypeId: "kids" });
    await api.db.query(`delete from public.ticket_types where event_id = $1 and id = 'kids'`, [event.eventId]);
    const res = await confirm(tokenFromEmail());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("These tickets aren't free any more. Book again from the event page.");
    expect((await orders())[0]).toMatchObject({ status: "failed", tickets: 0 });
  });
});

describe("retention (purge_operational_data)", () => {
  it("deletes unconfirmed links a week after expiry, idle counters (platform and per-client), old refusal counts and old email jobs; keeps paid orders", async () => {
    await book("old@example.com");
    await book("recent@example.com");
    await bookAndConfirm("paid@example.com");
    await api.runDeferred();
    await api.db.query(
      `update public.orders set created_at = now() - interval '9 days', confirmation_expires_at = now() - interval '8 days'
        where buyer_email in ('old@example.com', 'paid@example.com')`,
    );
    await api.db.query(
      `insert into private.free_order_refusals (day, reason, refusals) values
         ((now() at time zone 'Australia/Melbourne')::date - 400, 'order_too_large', 1),
         ((now() at time zone 'Australia/Melbourne')::date - 10, 'order_too_large', 1)`,
    );
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('stale', now() - interval '2 days', 1)`,
    );
    await api.db.query(
      `insert into private.client_rate_limits (client_key, bucket, window_started_at, hits) values
         ($1, 'seat_holds', now() - interval '2 days', 1), ($1, 'seat_holds:recent', now() - interval '20 hours', 1)`,
      ["a".repeat(64)],
    );
    await api.db.query(`update private.email_outbox set sent_at = now() - interval '91 days'`);

    const [counts] = await api.db.query(`select * from private.purge_operational_data()`);
    expect(counts).toEqual({
      unconfirmed_orders_deleted: 1,
      platform_rate_limits_deleted: 1,
      free_order_refusals_deleted: 1,
      email_jobs_deleted: 1,
      client_rate_limits_deleted: 1,
      // Payment reconciliation's retention (tests/server/payment-reconciliation.test.ts).
      early_charge_refunds_deleted: 0,
      payment_exceptions_deleted: 0,
    });
    expect(await api.db.query(`select bucket from private.client_rate_limits`)).toEqual([{ bucket: "seat_holds:recent" }]);
    expect((await orders()).map((o) => [o.buyer_email, o.status]).sort()).toEqual([
      ["paid@example.com", "paid"],
      ["recent@example.com", "pending"],
    ]);
    const [again] = await api.db.query(`select * from private.purge_operational_data()`);
    expect(Object.values(again)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

// Two sessions at once: only a real server (PGlite is one connection). Run
// with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrency (real Postgres only)", () => {
  async function connections() {
    return [
      postgres(serverUrl as string, { max: 1, onnotice: () => {} }),
      postgres(serverUrl as string, { max: 1, onnotice: () => {} }),
    ];
  }

  async function waitUntilBlocked(conn: postgres.Sql) {
    const [{ pid }] = await conn.unsafe("select pg_backend_pid() as pid");
    return async () => {
      for (let i = 0; ; i++) {
        const [row] = await api.db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (row?.wait_event_type === "Lock") return;
        if (i > 200) throw new Error("never blocked");
        await new Promise((r) => setTimeout(r, 25));
      }
    };
  }

  const tickets = (n: number, prefix: string) =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({ ticketCode: `${prefix}${i}AA-AAAA`.slice(0, 9), ticketTypeId: "rsvp", ticketTypeName: "RSVP" })),
    );

  it("two members' claims for one person and event: the second waits, then sees the cap", async () => {
    const member = await api.signUp({ email: "mia@example.com" });
    const [one, two] = await connections();
    const call = (conn: postgres.Sql, orderId: string, codes: string, quantity: number) =>
      conn.unsafe(
        `select private.place_free_order($1, $2, $3, 'Neon Static', $4::text::jsonb, 'Mia@example.com', null, $5, $6::text::jsonb, 4, 10, '24 hours') as r`,
        [
          orderId,
          event.eventId,
          event.organiserId,
          JSON.stringify([{ ticketTypeId: "rsvp", ticketTypeName: "RSVP", unitPriceCents: 0, feePolicy: "buyer-pays", quantity }]),
          member.userId,
          codes,
        ],
      );
    try {
      await one.unsafe("begin");
      expect((await call(one, `ord_${"1".repeat(32)}`, tickets(3, "B"), 3))[0].r).toBe("paid");
      const blocked = await waitUntilBlocked(two);
      const pending = call(two, `ord_${"2".repeat(32)}`, tickets(2, "C"), 2).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].r).toBe("person_event_limit");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await sold()).toEqual({ kids: 0, rsvp: 3 });
  });

  it("two confirmations of one link at once: one issues, the other sees it confirmed", async () => {
    await book("fan@example.com", 2);
    const [{ hash }] = await api.db.query<{ hash: string }>(`select confirmation_token_hash as hash from public.orders`);
    const [one, two] = await connections();
    const call = (conn: postgres.Sql, codes: string) =>
      conn.unsafe(`select * from private.confirm_free_order($1, $2::text::jsonb, 4)`, [hash, codes]);
    try {
      await one.unsafe("begin");
      expect((await call(one, tickets(2, "D")))[0].result).toBe("confirmed");
      const blocked = await waitUntilBlocked(two);
      const pending = call(two, tickets(2, "E")).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("already_confirmed");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await sold()).toEqual({ kids: 0, rsvp: 2 });
  });

  it("two link requests for one address at the limit: the second waits, then sees it", async () => {
    await book("fan@example.com");
    await book("fan+2@example.com");
    const [one, two] = await connections();
    const call = (conn: postgres.Sql, n: string) =>
      conn.unsafe(
        `select private.request_free_order($1, $2, $3, 'Neon Static', '[]'::jsonb, 'fan+x@example.com', null, $4, '24 hours', 3, '1 hour', 60, '1 hour', 400, '24 hours') as r`,
        [`ord_${n.repeat(32)}`, event.eventId, event.organiserId, n.repeat(64)],
      );
    try {
      await one.unsafe("begin");
      expect((await call(one, "a"))[0].r).toBe("requested");
      const blocked = await waitUntilBlocked(two);
      const pending = call(two, "b").execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].r).toBe("address_limited");
    } finally {
      await one.end();
      await two.end();
    }
  });

  it("two link requests for the platform's last hourly slot: the second passes the read-only check, then waits and is refused", async () => {
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('free_order_confirmations', now(), 59)`,
    );
    const [one, two] = await connections();
    const call = (conn: postgres.Sql, n: string) =>
      conn.unsafe(
        `select private.request_free_order($1, $2, $3, 'Neon Static', '[]'::jsonb, $4, null, $5, '24 hours', 3, '1 hour', 60, '1 hour', 400, '24 hours') as r`,
        [`ord_${n.repeat(32)}`, event.eventId, event.organiserId, `${n}@example.com`, n.repeat(64)],
      );
    try {
      await one.unsafe("begin");
      expect((await call(one, "a"))[0].r).toBe("requested");
      const blocked = await waitUntilBlocked(two);
      const pending = call(two, "b").execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].r).toBe("platform_limited");
    } finally {
      await one.end();
      await two.end();
    }
    expect((await orders()).map((o) => o.buyer_email)).toEqual(["a@example.com"]);
  });
});
