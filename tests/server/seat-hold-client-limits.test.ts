import { createHash } from "node:crypto";
import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clientIp, clientKey, normaliseIp } from "@/lib/server/client-key";
import { cancelPendingOrder, createCheckout, SEAT_HOLD_LIMITS } from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { runHandler } from "@/lib/server/route";
import { SITE_URL, TestApi, WEBHOOK_SECRET } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// The per-client seat-hold limit (supabase/migrations/20261103000000_seat_hold_client_limits.sql,
// lib/server/client-key.ts; docs/architecture.md, "Reserved seating").

const IP = "203.0.113.7";
const OTHER_IP = "198.51.100.20";

describe("clientIp / normaliseIp / clientKey", () => {
  const req = (headers: Record<string, string>) => new Request("https://sheltuh.test/api/x", { headers });

  it("takes x-forwarded-for's first hop, else x-real-ip; ignores anything that isn't an IP", () => {
    expect(clientIp(req({ "x-forwarded-for": `${IP}, 10.0.0.1, 10.0.0.2`, "x-real-ip": OTHER_IP }))).toBe(IP);
    expect(clientIp(req({ "x-real-ip": ` ${OTHER_IP} ` }))).toBe(OTHER_IP);
    expect(clientIp(req({ "x-forwarded-for": "unknown", "x-real-ip": OTHER_IP }))).toBe(OTHER_IP);
    expect(clientIp(req({ "x-forwarded-for": "not-an-ip" }))).toBeUndefined();
    expect(clientIp(req({}))).toBeUndefined();
  });

  it("keys IPv6 on its /64, an IPv4-mapped address on its IPv4 address, and drops a zone id", () => {
    expect(normaliseIp("2001:db8:aa:bb:1:2:3:4")).toBe("2001:db8:aa:bb::/64");
    expect(normaliseIp("2001:DB8:AA:BB::ffff")).toBe("2001:db8:aa:bb::/64");
    expect(normaliseIp("2001:0db8:00aa:00bb:0000:0000:0000:0001")).toBe("2001:db8:aa:bb::/64");
    expect(normaliseIp("::1")).toBe("0:0:0:0::/64");
    expect(normaliseIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(normaliseIp("::ffff:203.0.113.7")).toBe(IP);
    expect(normaliseIp(IP)).toBe(IP);
    for (const bad of ["", "1.2.3", "1.2.3.4.5", "999.1.1.1", "2001:db8::g", "[::1]", "::1:2:3:4:5:6:7:8:9"]) {
      expect(normaliseIp(bad)).toBeUndefined();
    }
  });

  it("is a salted SHA-256: 64 hex, stable for a secret, different per secret, never the plain hash", () => {
    const key = clientKey(IP, WEBHOOK_SECRET);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(clientKey(IP, WEBHOOK_SECRET)).toBe(key);
    expect(clientKey(IP, "another secret")).not.toBe(key);
    expect(clientKey(OTHER_IP, WEBHOOK_SECRET)).not.toBe(key);
    expect(key).not.toBe(createHash("sha256").update(IP).digest("hex"));
  });
});

let api: TestApi;
let reset: () => Promise<void>;
let dbUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  dbUrl = testDb.url;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  ({ event } = await seatedEvent(api, organiser, admin));
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    n += 1;
    return { id: `cs_test_${n}`, url: `https://checkout.stripe.test/cs_test_${n}` };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const hold = (seatIds: string[], options: { ip?: string; headers?: Record<string, string>; on?: EventRecord } = {}) => {
  const on = options.on ?? event;
  return api.call(createCheckout, {
    params: { eventId: on.eventId },
    body: { seats: { mapVersion: on.seating!.version, seatIds } },
    headers: options.headers ?? (options.ip ? { "x-forwarded-for": options.ip } : {}),
  });
};

const cancel = (orderId: string) => api.call(cancelPendingOrder, { params: { sessionId: orderId }, method: "POST" });

async function counters() {
  return api.db.query<{ client_key: string; bucket: string; hits: number }>(
    `select client_key, bucket, hits from private.client_rate_limits order by bucket`,
  );
}

const eventBucket = (eventId: string) => `seat_holds:${eventId}`;

async function orderCount(eventId = event.eventId) {
  const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from public.orders where event_id = $1`, [eventId]);
  return n;
}

describe("per-client hold attempts", () => {
  it("are 20 per event and 60 in all per 10 minutes", () => {
    expect(SEAT_HOLD_LIMITS.perClient).toEqual({ event: 20, allEvents: 60, window: "10 minutes" });
  });

  it("20 attempts per event from one client, then a 429 that writes nothing; other clients and events are unaffected", async () => {
    const key = clientKey(IP, WEBHOOK_SECRET);
    for (let i = 0; i < SEAT_HOLD_LIMITS.perClient.event; i++) {
      const res = await hold(["A1"], { ip: IP });
      expect(res.status).toBe(201);
      expect((await cancel(res.body.orderId)).body.status).toBe("released");
    }
    expect(await counters()).toEqual([
      { client_key: key, bucket: "seat_holds", hits: 20 },
      { client_key: key, bucket: eventBucket(event.eventId), hits: 20 },
    ]);

    const over = await hold(["A1"], { ip: IP });
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({
      code: "client_rate_limited",
      seatIds: ["A1"],
      fieldErrors: { seats: expect.any(String) },
    });
    expect(over.body.error).toMatch(/a lot of checkouts/);
    expect(over.headers.get("cache-control")).toBe("private, no-store");
    expect(await orderCount()).toBe(20);
    // A refusal keeps no hit, in either bucket.
    expect((await counters()).map((c) => c.hits)).toEqual([20, 20]);
    // The event's own counter only ever counted the 20 holds.
    const [eventWide] = await api.db.query<{ hits: number }>(
      `select hits from private.event_rate_limits where event_id = $1 and bucket = 'seat_holds'`,
      [event.eventId],
    );
    expect(eventWide.hits).toBe(20);

    // Another client, and the same client on another event, still get through.
    expect((await hold(["A1"], { ip: OTHER_IP })).status).toBe(201);
    const { event: second } = await seatedEvent(api, organiser, admin, { overrides: { title: "Second Hall" } });
    expect((await hold(["A1"], { ip: IP, on: second })).status).toBe(201);
    expect((await counters()).find((c) => c.client_key === key && c.bucket === "seat_holds")?.hits).toBe(21);
  });

  it("counts attempts the database refuses (the hold cap), unlike the event's counter", async () => {
    const { event: big } = await seatedEvent(api, organiser, admin, {
      rows: [
        { label: "A", tier: "prem", seats: 15 },
        { label: "B", tier: "std", seats: 15 },
      ],
      overrides: { title: "Cap Hall" },
    });
    const ids = (row: string, from: number, n: number) => Array.from({ length: n }, (_, i) => `${row}${from + i}`);
    expect((await hold(ids("A", 1, 10), { ip: IP, on: big })).status).toBe(201);
    expect((await hold(ids("A", 11, 5).concat(ids("B", 1, 5)), { ip: IP, on: big })).status).toBe(201);
    for (let i = 0; i < 18; i++) expect((await hold(["B9"], { ip: IP, on: big })).body.code).toBe("hold_cap");
    expect((await hold(["B9"], { ip: IP, on: big })).body.code).toBe("client_rate_limited");
    const [eventWide] = await api.db.query<{ hits: number }>(
      `select hits from private.event_rate_limits where event_id = $1 and bucket = 'seat_holds'`,
      [big.eventId],
    );
    expect(eventWide.hits).toBe(2);
  });

  it("60 attempts in all, across events: then a 429 for any event, keeping no hit on the event's bucket", async () => {
    const key = clientKey(IP, WEBHOOK_SECRET);
    await api.db.query(
      `insert into private.client_rate_limits (client_key, bucket, window_started_at, hits) values ($1, 'seat_holds', now(), $2)`,
      [key, SEAT_HOLD_LIMITS.perClient.allEvents],
    );
    const res = await hold(["A1"], { ip: IP });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("client_rate_limited");
    expect(await orderCount()).toBe(0);
    expect(await counters()).toEqual([{ client_key: key, bucket: "seat_holds", hits: 60 }]);
  });

  it("a new window starts once 10 minutes have passed", async () => {
    const key = clientKey(IP, WEBHOOK_SECRET);
    await api.db.query(
      `insert into private.client_rate_limits (client_key, bucket, window_started_at, hits) values
         ($1, $2, now() - interval '11 minutes', 20), ($1, 'seat_holds', now() - interval '11 minutes', 60)`,
      [key, eventBucket(event.eventId)],
    );
    expect((await hold(["A1"], { ip: IP })).status).toBe(201);
    expect((await counters()).map((c) => c.hits)).toEqual([1, 1]);
  });

  it("never stores the IP address: only the salted key", async () => {
    await hold(["A1"], { ip: IP });
    await hold(["A2"], { headers: { "x-real-ip": OTHER_IP } });
    const rows = await api.db.query(`select * from private.client_rate_limits`);
    const stored = JSON.stringify(rows);
    for (const ip of [IP, OTHER_IP]) {
      expect(stored).not.toContain(ip);
      expect(stored).not.toContain(createHash("sha256").update(ip).digest("hex"));
    }
    expect(new Set(rows.map((r) => (r as { client_key: string }).client_key))).toEqual(
      new Set([clientKey(IP, WEBHOOK_SECRET), clientKey(OTHER_IP, WEBHOOK_SECRET)]),
    );
  });

  it("one IPv6 /64 is one client", async () => {
    await hold(["A1"], { ip: "2001:db8:1:2::a" });
    await hold(["A2"], { ip: "2001:db8:1:2:ffff::b" });
    const rows = await counters();
    expect(new Set(rows.map((r) => r.client_key)).size).toBe(1);
    expect(rows.map((r) => r.hits)).toEqual([2, 2]);
  });

  it("fails open without a client IP header: logged (without request details), nothing counted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await hold(["A1"])).status).toBe(201);
    expect(await counters()).toEqual([]);
    expect(warn).toHaveBeenCalledWith("Seat hold without a client IP header: the per-client hold limit was skipped.");
  });

  it("fails open, logged, when the secret it's salted with isn't configured", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = {
      ...api.deps,
      stripeWebhookSecret: () => {
        throw new Error("Missing required environment variable: STRIPE_WEBHOOK_SECRET");
      },
    };
    const req = new Request(`${SITE_URL}/api/test`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": IP },
      body: JSON.stringify({ seats: { mapVersion: event.seating!.version, seatIds: ["A1"] } }),
    });
    const res = await runHandler(createCheckout, req, { eventId: event.eventId }, deps);
    expect(res.status).toBe(201);
    expect(await counters()).toEqual([]);
    expect(error).toHaveBeenCalledWith("STRIPE_WEBHOOK_SECRET isn't set: the per-client hold limit was skipped.");
    expect(JSON.stringify(error.mock.calls)).not.toContain(IP);
  });

  it("only paid seated holds count: early refusals, general admission and free seats don't", async () => {
    // Refused before the hold (a seat visibly taken, a stale map, bad input): no hit.
    await hold(["A1"], { ip: OTHER_IP });
    expect((await hold(["A1"], { ip: IP })).status).toBe(409);
    expect((await api.call(createCheckout, { params: { eventId: event.eventId }, body: { seats: { mapVersion: 999, seatIds: ["A2"] } }, headers: { "x-forwarded-for": IP } })).status).toBe(409);
    // General admission: no hold.
    const ga = await publishedEvent(api, organiser, admin, { title: "Plain Gig" });
    expect((await api.call(createCheckout, { params: { eventId: ga.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] }, headers: { "x-forwarded-for": IP } })).status).toBe(201);
    // Free seats: no hold either (their own caps apply).
    const { event: free } = await seatedEvent(api, organiser, admin, {
      tiers: [{ id: "free", name: "Free seat", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 1 }],
      rows: [{ label: "A", tier: "free", seats: 4 }],
      overrides: { title: "Free Hall" },
    });
    expect((await hold(["A1"], { headers: { "x-forwarded-for": IP }, on: free })).status).toBe(400); // no email
    const key = clientKey(IP, WEBHOOK_SECRET);
    const mine = (await counters()).filter((c) => c.client_key === key);
    expect(mine.filter((c) => c.bucket.startsWith("seat_holds"))).toEqual([]);
    // General admission paid checkouts have their own per-client buckets (tests/server/checkout-attempts.test.ts).
    expect(mine.map((c) => c.bucket).sort()).toEqual(["checkouts", `checkouts:${ga.eventId}`]);
  });
});

// Many attempts at once: only a real server (PGlite is one connection). Run
// with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("per-client limit under concurrency (real Postgres only)", () => {
  it("30 checkouts at once from one client: exactly 20 reach the hold, the rest are refused", async () => {
    const { event: big } = await seatedEvent(api, organiser, admin, {
      rows: [
        { label: "A", tier: "prem", seats: 15 },
        { label: "B", tier: "std", seats: 15 },
      ],
      overrides: { title: "Rush Hall" },
    });
    const ids = [...Array.from({ length: 15 }, (_, i) => `A${i + 1}`), ...Array.from({ length: 15 }, (_, i) => `B${i + 1}`)];
    const results = await Promise.all(ids.map((id) => hold([id], { ip: IP, on: big })));
    const limited = results.filter((r) => r.body?.code === "client_rate_limited");
    expect(limited).toHaveLength(10);
    expect(results.filter((r) => r.status === 201)).toHaveLength(20);
    const [{ hits }] = await api.db.query<{ hits: number }>(
      `select hits from private.client_rate_limits where client_key = $1 and bucket = $2`,
      [clientKey(IP, WEBHOOK_SECRET), eventBucket(big.eventId)],
    );
    expect(hits).toBe(SEAT_HOLD_LIMITS.perClient.event); // each refusal's hit was rolled back
  });

  it("attempts on different events at once share the all-events allowance exactly and never deadlock", async () => {
    const sql = Array.from({ length: 8 }, () => postgres(dbUrl!, { max: 1, onnotice: () => {} }));
    try {
      const key = clientKey(IP, WEBHOOK_SECRET);
      const events = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      const attempts = Array.from({ length: 80 }, (_, i) => ({ conn: sql[i % sql.length], eventId: events[i % events.length] }));
      const results = await Promise.all(
        attempts.map(({ conn, eventId }) =>
          conn<{ result: string }[]>`select private.take_seat_hold_attempt(${key}, ${eventId}::uuid, 20, 50, '10 minutes') as result`.then(
            ([row]) => row.result,
          ),
        ),
      );
      expect(results.filter((r) => r === "ok")).toHaveLength(50);
      expect(results.filter((r) => r === "all")).toHaveLength(30);
      const [all] = await api.db.query<{ hits: number }>(
        `select hits from private.client_rate_limits where client_key = $1 and bucket = 'seat_holds'`,
        [key],
      );
      expect(all.hits).toBe(50);
      // Each event's bucket holds only its ok attempts (a refusal for 'all' kept no event hit).
      const [{ sum }] = await api.db.query<{ sum: number }>(
        `select sum(hits)::int as sum from private.client_rate_limits where client_key = $1 and bucket like 'seat_holds:%'`,
        [key],
      );
      expect(sum).toBe(50);
    } finally {
      await Promise.all(sql.map((c) => c.end()));
    }
  });
});
