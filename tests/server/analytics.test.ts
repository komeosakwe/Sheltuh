import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VIEW_SOURCES } from "@/lib/api/types";
import { calculateBookingFeeCents, calculateOrderSummary } from "@/lib/fees";
import type { Db } from "@/lib/server/db";
import { addDays, melbourneDateOf } from "@/lib/server/analytics-range";
import { adminApproveOrganiser, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import {
  getAnalyticsOverview,
  getAnalyticsOverviewCsv,
  getEventAnalytics,
  getEventAnalyticsCsv,
} from "@/lib/server/handlers/analytics";
import { recordEventView, VIEW_RATE_LIMIT } from "@/lib/server/handlers/event-views";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import { createTrackingLink, deleteTrackingLink, listTrackingLinks } from "@/lib/server/handlers/tracking-links";
import type { EventRecord } from "@/lib/server/types";
import { SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import {
  application,
  approvedOrganiser,
  draftEvent,
  enablePayouts,
  insertOrder,
  publishedEvent,
  signUpAdmin,
} from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let serverUrl: string | undefined;

const TICKETS = [
  { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 10 },
];
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

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
  await enablePayouts(api, organiser.organiserId);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function viewRequest(eventId: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${SITE_URL}/api/events/${eventId}/view`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": BROWSER_UA, ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const view = (eventId: string = event.eventId, body?: unknown, headers?: Record<string, string>) =>
  api.send(recordEventView, viewRequest(eventId, body, headers), { eventId });

async function viewRows(eventId: string = event.eventId) {
  return api.db.query<{ day: string; source: string; link_code: string | null; views: number }>(
    `select day::text as day, source, link_code, views from public.event_view_counts where event_id = $1
      order by source, link_code nulls first`,
    [eventId],
  );
}

const links = (token: string, eventId: string = event.eventId) =>
  api.call(listTrackingLinks, { token, params: { eventId } });
const createLink = (token: string, label: unknown, eventId: string = event.eventId) =>
  api.call(createTrackingLink, { token, params: { eventId }, body: { label } });
const deleteLink = (token: string, linkId: string, eventId: string = event.eventId) =>
  api.call(deleteTrackingLink, { token, params: { eventId, linkId }, method: "DELETE" });
const analytics = (token: string | undefined, query?: Record<string, string>, eventId: string = event.eventId) =>
  api.call(getEventAnalytics, { token, params: { eventId }, query });
const overview = (token: string | undefined, query?: Record<string, string>) =>
  api.call(getAnalyticsOverview, { token, query });

/** A CSV route's raw text (TestApi.call parses JSON). */
async function csv(
  handler: typeof getEventAnalyticsCsv | typeof getAnalyticsOverviewCsv,
  token: string,
  params: Record<string, string> = {},
  query: Record<string, string> = {},
) {
  const url = new URL(`${SITE_URL}/api/test.csv`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const { runHandler } = await import("@/lib/server/route");
  const res = await runHandler(
    handler as typeof getEventAnalyticsCsv,
    new Request(url, { headers: { authorization: `Bearer ${token}` } }),
    params as { eventId: string },
    api.deps,
  );
  // Keep the byte-order mark (Response.text() strips it).
  return { status: res.status, headers: res.headers, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer()) };
}

let sessionCounter = 0;

/** A paid order through the real checkout + webhook (prices and fees from the API, never the test). */
async function paidOrder(lineItems: { ticketTypeId: string; quantity: number }[], extra: Record<string, unknown> = {}) {
  sessionCounter += 1;
  api.stripe.checkout.sessions.create.mockResolvedValueOnce({
    id: `cs_test_${sessionCounter}`,
    url: `https://checkout.stripe.test/cs_test_${sessionCounter}`,
  });
  const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems, ...extra } });
  expect(res.status).toBe(201);
  const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
  const webhook = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_test_${sessionCounter}`,
          object: "checkout.session",
          client_reference_id: orderId,
          payment_status: "paid",
          payment_intent: `pi_test_${sessionCounter}`,
          customer_details: { email: `buyer${sessionCounter}@example.com` },
        },
      },
    }),
  );
  expect(webhook.status).toBe(200);
  return orderId;
}

async function orderRow(orderId: string) {
  const [row] = await api.db.query<{ tracking_code: string | null; total_cents: number; application_fee_cents: number }>(
    `select tracking_code, total_cents, application_fee_cents from public.orders where id = $1`,
    [orderId],
  );
  return row;
}

/** A user whose organiser application is still pending. */
async function pendingOrganiser() {
  const user = await api.signUp();
  await api.call(applyAsOrganiser, { token: user.token, body: application });
  return user;
}

const today = () => melbourneDateOf();

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

describe("POST /events/{id}/view", () => {
  it("counts a view in today's Melbourne bucket, 204 and private", async () => {
    const res = await view();
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    await view();
    expect(await viewRows()).toEqual([{ day: today(), source: "direct", link_code: null, views: 2 }]);
  });

  it("buckets the source against the allowlist", async () => {
    for (const source of VIEW_SOURCES) await view(event.eventId, { source });
    await view(event.eventId, { source: "myspace" });
    await view(event.eventId, { source: 42 });
    await view(event.eventId, "not json");
    const rows = Object.fromEntries((await viewRows()).map((r) => [r.source, r.views]));
    // 'tracking' without a valid code is 'other', as are unknown values; a body that isn't JSON is direct.
    expect(rows).toEqual({
      direct: 2,
      search: 1,
      instagram: 1,
      facebook: 1,
      x: 1,
      tiktok: 1,
      email: 1,
      eventbrite: 1,
      other: 4,
    });
  });

  it("counts a view with one of the event's codes under that code, and ignores any other code", async () => {
    const link = (await createLink(organiser.token, "Instagram bio")).body;
    const other = await publishedEvent(api, organiser, admin);
    const otherLink = (await createLink(organiser.token, "Elsewhere", other.eventId)).body;

    await view(event.eventId, { source: "instagram", code: link.code });
    await view(event.eventId, { code: link.code.toUpperCase() });
    await view(event.eventId, { source: "instagram", code: otherLink.code });
    await view(event.eventId, { source: "email", code: "zzzzzzzz" });
    await view(event.eventId, { code: "'; drop table events; --" });
    await view(event.eventId, { code: { $ne: null } });

    expect(await viewRows()).toEqual([
      { day: today(), source: "direct", link_code: null, views: 2 },
      { day: today(), source: "email", link_code: null, views: 1 },
      { day: today(), source: "instagram", link_code: null, views: 1 },
      { day: today(), source: "tracking", link_code: link.code, views: 2 },
    ]);
    expect(await viewRows(other.eventId)).toEqual([]);
  });

  it("is a 404 for an unknown, malformed, draft or unpublished event, and counts nothing", async () => {
    const draft = await draftEvent(api, organiser);
    for (const eventId of [crypto.randomUUID(), "nope", draft.eventId]) {
      const res = await view(eventId);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, body: { reason: "x" } });
    expect((await view()).status).toBe(404);
    const [{ count }] = await api.db.query<{ count: number }>(`select count(*)::int as count from public.event_view_counts`);
    expect(count).toBe(0);
  });

  it("ignores bots, link previews, tools and prefetches", async () => {
    const agents = [
      "",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
      "curl/8.4.0",
      "python-requests/2.31",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "WhatsApp/2.23.20.0",
    ];
    for (const ua of agents) expect((await view(event.eventId, {}, { "user-agent": ua })).status).toBe(204);
    expect((await view(event.eventId, {}, { "sec-purpose": "prefetch;prerender" })).status).toBe(204);
    expect((await view(event.eventId, {}, { purpose: "prefetch" })).status).toBe(204);
    expect(await viewRows()).toEqual([]);
    // A bot's request isn't even checked against the database: no 404 to learn from either.
    expect((await view(crypto.randomUUID(), {}, { "user-agent": "curl/8" })).status).toBe(204);
  });

  it("ignores a body over the cap", async () => {
    const res = await view(event.eventId, { source: "instagram", padding: "x".repeat(2000) });
    expect(res.status).toBe(204);
    expect(await viewRows()).toEqual([]);
  });

  it("stores nothing about the visitor: the counter table holds only event, day, bucket, code and a count", async () => {
    const columns = await api.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'event_view_counts' order by ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(["event_id", "day", "source", "link_code", "views"]);
  });

  it("stops counting an event past its per-minute cap, whoever is sending, and starts again next window", async () => {
    await api.db.query(
      `insert into private.event_rate_limits (event_id, bucket, window_started_at, hits) values ($1, 'views', now(), $2)`,
      [event.eventId, VIEW_RATE_LIMIT.hits],
    );
    expect((await view()).status).toBe(204);
    expect((await view(event.eventId, {}, { "user-agent": `${BROWSER_UA} Other` })).status).toBe(204);
    expect(await viewRows()).toEqual([]);
    // Another event isn't affected.
    const other = await publishedEvent(api, organiser, admin);
    await view(other.eventId);
    expect(await viewRows(other.eventId)).toHaveLength(1);

    await api.db.query(`update private.event_rate_limits set window_started_at = now() - interval '61 seconds'`);
    await view();
    expect(await viewRows()).toEqual([{ day: today(), source: "direct", link_code: null, views: 1 }]);
  });

  it("counts concurrent views exactly, and concurrent views can't pass the cap", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => view()));
    expect(results.every((r) => r.status === 204)).toBe(true);
    expect(await viewRows()).toEqual([{ day: today(), source: "direct", link_code: null, views: 25 }]);

    const other = await publishedEvent(api, organiser, admin);
    const capped = await Promise.all(
      Array.from({ length: 12 }, () =>
        api.db.query<{ result: string }>(`select private.record_view($1, 'direct', null, 5, '1 minute') as result`, [
          other.eventId,
        ]),
      ),
    );
    expect(capped.map(([r]) => r.result).filter((r) => r === "recorded")).toHaveLength(5);
    expect((await viewRows(other.eventId))[0].views).toBe(5);
  });

  it("answers 204 even if the database fails", async () => {
    const broken: Db = {
      async query() {
        throw new Error("connection refused");
      },
    };
    const res = await new TestApi(broken).send(recordEventView, viewRequest(event.eventId), { eventId: event.eventId });
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Tracking links
// ---------------------------------------------------------------------------

describe("tracking links", () => {
  it("creates a link with a server-made code, and lists links newest first", async () => {
    const created = await createLink(organiser.token, "  Instagram bio  ");
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("private, no-store");
    expect(created.body).toMatchObject({ label: "Instagram bio", views: 0, orders: 0, ticketsSold: 0, grossCents: 0 });
    expect(created.body.code).toMatch(/^[2-9a-hjkmnp-z]{8}$/);
    expect(created.body.url).toBe(`${SITE_URL}/events/${event.slug}?ref=${created.body.code}`);

    // A code in the body is never used.
    const second = await api.call(createTrackingLink, {
      token: organiser.token,
      params: { eventId: event.eventId },
      body: { label: "Newsletter", code: "abcdefgh" },
    });
    expect(second.body.code).not.toBe("abcdefgh");
    await api.db.query(`update public.event_tracking_links set created_at = now() - interval '1 hour' where id = $1`, [
      created.body.linkId,
    ]);

    const list = await links(organiser.token);
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("private, no-store");
    expect(list.body.items.map((l: { label: string }) => l.label)).toEqual(["Newsletter", "Instagram bio"]);
  });

  it("validates the label", async () => {
    for (const label of [undefined, "", "   ", 7, "x".repeat(41), "bad\u0000label", "zero​width", "line sep"]) {
      const res = await createLink(organiser.token, label);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors.label).toBeTruthy();
    }
    // 40 characters (code points, not UTF-16 units) is fine.
    expect((await createLink(organiser.token, "🎟".repeat(40))).status).toBe(201);
  });

  it("refuses a label already on the event, ignoring case", async () => {
    await createLink(organiser.token, "Instagram");
    const res = await createLink(organiser.token, "INSTAGRAM");
    expect(res.status).toBe(409);
    expect(res.body.fieldErrors.label).toBeTruthy();
    // Another event can use it.
    const other = await publishedEvent(api, organiser, admin);
    expect((await createLink(organiser.token, "Instagram", other.eventId)).status).toBe(201);
  });

  it("caps an event at 20 links, even when created concurrently", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => createLink(organiser.token, `Link ${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(20);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused.map((r) => r.status)).toEqual([409, 409, 409, 409, 409]);
    expect(refused[0].body.error).toMatch(/20/);
    expect((await links(organiser.token)).body.items).toHaveLength(20);
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)(
    "real Postgres only: a second create waits for the first to commit, then sees the cap",
    async () => {
      const first = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
      const other = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
      const create = (sql: postgres.Sql, code: string, label: string) =>
        sql.unsafe(`select result from private.create_tracking_link($1, $2, $3, $4, 1)`, [
          event.eventId,
          organiser.organiserId,
          code,
          label,
        ]);
      try {
        await first.unsafe("begin");
        expect((await create(first, "aaaaaaaa", "One"))[0].result).toBe("created");
        const [{ pid }] = await other.unsafe("select pg_backend_pid() as pid");
        const pending = create(other, "bbbbbbbb", "Two").execute();
        for (let i = 0; ; i++) {
          const [row] = await api.db.query<{ wait_event_type: string | null }>(
            `select wait_event_type from pg_stat_activity where pid = $1`,
            [pid],
          );
          if (row?.wait_event_type === "Lock") break;
          if (i > 200) throw new Error("the second create never blocked");
          await new Promise((r) => setTimeout(r, 25));
        }
        await first.unsafe("commit");
        expect((await pending)[0].result).toBe("limit");
      } finally {
        await first.end();
        await other.end();
      }
      expect((await links(organiser.token)).body.items).toHaveLength(1);
    },
  );

  it("create_tracking_link reports a code collision so the API retries with a new code", async () => {
    const link = (await createLink(organiser.token, "First")).body;
    const [row] = await api.db.query<{ result: string }>(
      `select result from private.create_tracking_link($1, $2, $3, 'Second', 20)`,
      [event.eventId, organiser.organiserId, link.code],
    );
    expect(row.result).toBe("code_taken");
    const [other] = await api.db.query<{ result: string }>(
      `select result from private.create_tracking_link($1, $2, 'abcdefgh', 'Second', 20)`,
      [event.eventId, crypto.randomUUID()],
    );
    expect(other.result).toBe("not_found");
  });

  it("deletes idempotently, only within the caller's own event", async () => {
    const link = (await createLink(organiser.token, "Bio")).body;
    const other = await publishedEvent(api, organiser, admin);
    // A link id from a different event, through this event's path: nothing happens.
    expect((await deleteLink(organiser.token, link.linkId, other.eventId)).status).toBe(204);
    expect((await links(organiser.token)).body.items).toHaveLength(1);

    for (let i = 0; i < 2; i++) {
      const res = await deleteLink(organiser.token, link.linkId);
      expect(res.status).toBe(204);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    expect((await links(organiser.token)).body.items).toEqual([]);
    expect((await deleteLink(organiser.token, "not-a-uuid")).status).toBe(404);
  });

  it("deleting the event deletes its links", async () => {
    const draft = await draftEvent(api, organiser);
    await createLink(organiser.token, "Bio", draft.eventId);
    await api.db.query(`delete from public.events where id = $1`, [draft.eventId]);
    const [{ count }] = await api.db.query<{ count: number }>(
      `select count(*)::int as count from public.event_tracking_links where event_id = $1`,
      [draft.eventId],
    );
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Who may see what
// ---------------------------------------------------------------------------

describe("eligibility and ownership", () => {
  it("another organiser's event is a 404 on every route, and they can't change it", async () => {
    const link = (await createLink(organiser.token, "Bio")).body;
    const rival = await approvedOrganiser(api, admin, { displayName: "Rival" });
    const eventId = event.eventId;
    const responses = [
      await analytics(rival.token),
      await csv(getEventAnalyticsCsv, rival.token, { eventId }),
      await links(rival.token),
      await createLink(rival.token, "Mine now"),
      await deleteLink(rival.token, link.linkId),
    ];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    expect((await links(organiser.token)).body.items.map((l: { label: string }) => l.label)).toEqual(["Bio"]);
    // Their overview has none of it.
    await paidOrder([{ ticketTypeId: "ga", quantity: 1 }]);
    const theirs = await overview(rival.token);
    expect(theirs.body.events).toEqual([]);
    expect(theirs.body.totals.orders).toBe(0);
  });

  it("a malformed or unknown event id is a 404", async () => {
    for (const eventId of ["nope", crypto.randomUUID()]) {
      expect((await analytics(organiser.token, {}, eventId)).status).toBe(404);
      expect((await links(organiser.token, eventId)).status).toBe(404);
    }
  });

  it("needs a signed-in, approved organiser", async () => {
    expect((await analytics(undefined)).status).toBe(401);
    expect((await overview(undefined)).status).toBe(401);
    const pending = await pendingOrganiser();
    const nobody = await api.signUp();
    for (const user of [pending, nobody]) {
      expect((await analytics(user.token)).status).toBe(403);
      expect((await overview(user.token)).status).toBe(403);
      expect((await links(user.token)).status).toBe(403);
      expect((await createLink(user.token, "x")).status).toBe(403);
      expect((await csv(getAnalyticsOverviewCsv, user.token)).status).toBe(403);
    }
  });

  it("admins get nothing extra: no organiser of their own is a 403, and with one, others' events are 404", async () => {
    expect((await analytics(admin.token)).status).toBe(403);
    expect((await overview(admin.token)).status).toBe(403);
    expect((await links(admin.token)).status).toBe(403);

    const applied = await api.call(applyAsOrganiser, { token: admin.token, body: application });
    await api.call(adminApproveOrganiser, {
      token: admin.token,
      params: { organiserId: applied.body.organiserId },
      method: "POST",
    });
    expect((await analytics(admin.token)).status).toBe(404);
    expect((await csv(getEventAnalyticsCsv, admin.token, { eventId: event.eventId })).status).toBe(404);
    expect((await links(admin.token)).status).toBe(404);
    const own = await overview(admin.token);
    expect(own.status).toBe(200);
    expect(own.body.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Checkout attribution
// ---------------------------------------------------------------------------

describe("checkout attribution", () => {
  it("records one of the event's codes on the order, without changing the price or the Stripe call", async () => {
    const link = (await createLink(organiser.token, "Bio")).body;
    const plain = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }]);
    const plainParams = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0];
    const tracked = await paidOrder([{ ticketTypeId: "ga", quantity: 2 }], { trackingCode: link.code });
    const trackedParams = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0];

    expect(await orderRow(tracked)).toEqual({ tracking_code: link.code, total_cents: 6340, application_fee_cents: 340 });
    expect(await orderRow(plain)).toEqual({ tracking_code: null, total_cents: 6340, application_fee_cents: 340 });
    const strip = (p: Record<string, unknown>) => ({ ...p, client_reference_id: undefined, metadata: undefined, success_url: undefined });
    expect(strip(trackedParams)).toEqual(strip(plainParams));
    expect(trackedParams.metadata).toEqual({ orderId: tracked, eventId: event.eventId });
  });

  it("silently ignores an unknown, malformed or other event's code", async () => {
    const other = await publishedEvent(api, organiser, admin);
    const otherLink = (await createLink(organiser.token, "Other", other.eventId)).body;
    for (const trackingCode of [otherLink.code, "zzzzzzzz", "x", 12345678, { code: "abc" }, ["abcdefgh"], null]) {
      const orderId = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }], { trackingCode });
      expect((await orderRow(orderId)).tracking_code).toBeNull();
    }
  });

  it("works for free orders too, and a deleted link's code is no longer attributed", async () => {
    const free = await publishedEvent(api, organiser, admin, {
      ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    const link = (await createLink(organiser.token, "Bio", free.eventId)).body;
    const checkout = (trackingCode: string) =>
      api.call(createCheckout, {
        params: { eventId: free.eventId },
        body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "fan@example.com", trackingCode },
      });
    const first = await checkout(link.code);
    expect(first.status).toBe(201);
    await deleteLink(organiser.token, link.linkId, free.eventId);
    await checkout(link.code);
    const rows = await api.db.query<{ tracking_code: string | null }>(
      `select tracking_code from public.orders where event_id = $1 order by created_at, id`,
      [free.eventId],
    );
    expect(rows.map((r) => r.tracking_code).sort()).toEqual([link.code, null].sort());
  });
});

// ---------------------------------------------------------------------------
// Sales analytics
// ---------------------------------------------------------------------------

describe("event analytics", () => {
  it("adds up views and paid orders, with fees and net matching lib/fees.ts", async () => {
    const link = (await createLink(organiser.token, "Instagram bio")).body;
    for (let i = 0; i < 3; i++) await view();
    await view(event.eventId, { source: "instagram" });
    await view(event.eventId, { source: "instagram" });
    await view(event.eventId, { source: "instagram", code: link.code });

    const a = await paidOrder(
      [
        { ticketTypeId: "ga", quantity: 2 },
        { ticketTypeId: "vip", quantity: 1 },
      ],
      { trackingCode: link.code },
    );
    const b = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }]);
    // Not counted: pending, failed, refunded and refund-pending orders.
    for (const status of ["pending", "failed", "refunded", "oversold_refund_required"] as const) {
      const id = await insertOrder(api, event, `x-${status}@example.com`, status);
      await api.db.query(
        `update public.orders set total_cents = 99999, application_fee_cents = 999,
           line_items = '[{"ticketTypeId":"ga","ticketTypeName":"GA","unitPriceCents":3000,"feePolicy":"buyer-pays","quantity":7}]'
         where id = $1`,
        [id],
      );
    }

    // Independent of the API: what lib/fees.ts says each line costs.
    const gaFee = calculateBookingFeeCents(3000);
    const vipFee = calculateBookingFeeCents(8000);
    const gaGross = calculateOrderSummary(3000, 3, "buyer-pays").totalCents;
    const vipGross = calculateOrderSummary(8000, 1, "organiser-absorbs").totalCents;
    const grossCents = gaGross + vipGross;
    const feesCents = gaFee * 3 + vipFee;
    // And the snapshot on the orders agrees.
    const [ra, rb] = [await orderRow(a), await orderRow(b)];
    expect(ra.total_cents + rb.total_cents).toBe(grossCents);
    expect(ra.application_fee_cents + rb.application_fee_cents).toBe(feesCents);
    expect({ grossCents, feesCents }).toEqual({ grossCents: 17510, feesCents: 880 });

    const res = await analytics(organiser.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = res.body;
    expect(body.range).toEqual({ from: today(), to: today() });
    expect(body.viewsTrackedSince).toBe(today());
    expect(body.event).toMatchObject({ eventId: event.eventId, title: event.title, status: "published", everPublished: true });
    expect(body.totals).toEqual({
      views: 6,
      orders: 2,
      ticketsSold: 4,
      grossCents,
      feesCents,
      netCents: grossCents - feesCents,
      conversionRate: 2 / 6,
    });
    expect(body.byDay).toEqual([
      { date: today(), views: 6, orders: 2, ticketsSold: 4, grossCents, feesCents, netCents: grossCents - feesCents },
    ]);
    expect(body.bySource).toEqual(
      VIEW_SOURCES.map((source) => ({
        source,
        views: { direct: 3, instagram: 2, tracking: 1 }[source as string] ?? 0,
      })),
    );
    expect(body.byTicketType).toEqual([
      {
        ticketTypeId: "ga",
        name: "GA",
        priceCents: 3000,
        feePolicy: "buyer-pays",
        quantityAvailable: 10,
        ticketsSold: 3,
        faceValueCents: 9000,
        grossCents: gaGross,
        feesCents: gaFee * 3,
        netCents: gaGross - gaFee * 3,
      },
      {
        ticketTypeId: "vip",
        name: "VIP",
        priceCents: 8000,
        feePolicy: "organiser-absorbs",
        quantityAvailable: 10,
        ticketsSold: 1,
        faceValueCents: 8000,
        grossCents: vipGross,
        feesCents: vipFee,
        netCents: vipGross - vipFee,
      },
    ]);
    expect(body.trackingLinks).toEqual([
      {
        code: link.code,
        linkId: link.linkId,
        label: "Instagram bio",
        views: 1,
        orders: 1,
        ticketsSold: 3,
        grossCents: ra.total_cents,
        feesCents: ra.application_fee_cents,
        netCents: ra.total_cents - ra.application_fee_cents,
        conversionRate: 1,
      },
    ]);
    expect(body.previous).toBeUndefined();
    // Nothing about any buyer.
    expect(JSON.stringify(body)).not.toMatch(/@example\.com|pi_test|cs_test|ord_/);

    // The tracking-link list carries the same all-time numbers.
    const listed = (await links(organiser.token)).body.items[0];
    expect(listed).toMatchObject({ views: 1, orders: 1, ticketsSold: 3, grossCents: ra.total_cents });

    // A deleted link keeps its numbers, under its code, without a label.
    await deleteLink(organiser.token, link.linkId);
    const after = (await analytics(organiser.token)).body.trackingLinks;
    expect(after).toEqual([expect.objectContaining({ code: link.code, views: 1, orders: 1 })]);
    expect(after[0].linkId).toBeUndefined();
    expect(after[0].label).toBeUndefined();
  });

  it("buckets by Melbourne day, respects the range, and compares with the previous period", async () => {
    await api.db.query(`update private.analytics_settings set views_tracked_since = '2026-01-01'`);
    const a = await paidOrder([{ ticketTypeId: "ga", quantity: 1 }]);
    const b = await paidOrder([{ ticketTypeId: "vip", quantity: 2 }]);
    // 15:00 UTC on 30 Sep is 01:00 on 1 Oct in Melbourne (AEST, +10).
    await api.db.query(`update public.orders set created_at = '2026-09-30T15:00:00Z' where id = $1`, [a]);
    // In the previous 10-day period (21–30 Sep).
    await api.db.query(`update public.orders set created_at = '2026-09-25T02:00:00Z' where id = $1`, [b]);
    await api.db.query(
      `insert into public.event_view_counts (event_id, day, source, link_code, views) values
         ($1, '2026-10-01', 'direct', null, 4), ($1, '2026-10-10', 'search', null, 6),
         ($1, '2026-09-30', 'direct', null, 5), ($1, '2026-10-11', 'direct', null, 100)`,
      [event.eventId],
    );

    const res = await analytics(organiser.token, { from: "2026-10-01", to: "2026-10-10", compare: "prevPeriod" });
    expect(res.status).toBe(200);
    const { totals, byDay, previous } = res.body;
    expect(totals).toMatchObject({ views: 10, orders: 1, ticketsSold: 1, grossCents: 3170, feesCents: 170 });
    expect(totals.conversionRate).toBeCloseTo(0.1);
    expect(byDay).toHaveLength(10);
    expect(byDay[0]).toMatchObject({ date: "2026-10-01", views: 4, orders: 1, grossCents: 3170 });
    expect(byDay[9]).toMatchObject({ date: "2026-10-10", views: 6, orders: 0, grossCents: 0 });
    expect(byDay[4]).toEqual({
      date: "2026-10-05",
      views: 0,
      orders: 0,
      ticketsSold: 0,
      grossCents: 0,
      feesCents: 0,
      netCents: 0,
    });

    expect(previous.range).toEqual({ from: "2026-09-21", to: "2026-09-30" });
    expect(previous.totals).toMatchObject({ views: 5, orders: 1, ticketsSold: 2, grossCents: 16000, feesCents: 740 });
    expect(previous.byDay).toHaveLength(10);
    expect(previous.byDay.find((d: { date: string }) => d.date === "2026-09-25")).toMatchObject({ orders: 1 });

    // The day before: the order placed at 01:00 Melbourne time on 1 Oct isn't in it.
    const day = await analytics(organiser.token, { from: "2026-09-30", to: "2026-09-30" });
    expect(day.body.totals).toMatchObject({ views: 5, orders: 0 });
  });

  it("marks days before view counting began as not counted, with no conversion rate", async () => {
    await api.db.query(`update private.analytics_settings set views_tracked_since = '2026-10-05'`);
    await paidOrder([{ ticketTypeId: "ga", quantity: 1 }]);
    await api.db.query(`update public.orders set created_at = '2026-10-02T02:00:00Z'`);
    await api.db.query(
      `insert into public.event_view_counts (event_id, day, source, link_code, views) values ($1, '2026-10-06', 'direct', null, 3)`,
      [event.eventId],
    );
    const res = await analytics(organiser.token, { from: "2026-10-01", to: "2026-10-07" });
    expect(res.body.viewsTrackedSince).toBe("2026-10-05");
    expect(res.body.byDay.map((d: { views: number | null }) => d.views)).toEqual([null, null, null, null, 0, 3, 0]);
    expect(res.body.totals).toMatchObject({ views: 3, orders: 1, conversionRate: null });
    // Wholly inside the counted period: a rate again.
    const later = await analytics(organiser.token, { from: "2026-10-05", to: "2026-10-07" });
    expect(later.body.totals.conversionRate).toBe(0);
  });

  it("validates and caps the date range", async () => {
    const bad: Record<string, string>[] = [
      { from: "2026-13-01" },
      { from: "2026-02-30" },
      { from: "yesterday" },
      { to: "2026/10/01" },
      { from: "1999-12-31", to: "2000-01-31" },
      { from: "2026-10-10", to: "2026-10-01" },
      { from: "2024-01-01", to: "2026-01-01" },
      { compare: "yes" },
    ];
    for (const query of bad) {
      const res = await analytics(organiser.token, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(Object.keys(res.body.fieldErrors).length).toBeGreaterThan(0);
      expect((await overview(organiser.token, query)).status, JSON.stringify(query)).toBe(400);
    }
    // Exactly the cap (731 days) is fine.
    const max = await analytics(organiser.token, { from: "2024-01-01", to: "2025-12-31" });
    expect(max.status).toBe(200);
    expect(max.body.byDay).toHaveLength(731);
    // A missing `from` is the event's creation date; a missing `to` is today.
    expect((await analytics(organiser.token, { to: addDays(today(), 3) })).body.range).toEqual({
      from: today(),
      to: addDays(today(), 3),
    });
    // ...pulled forward if `to` is far ahead, so the default never breaks the cap.
    const far = (await analytics(organiser.token, { to: "2030-01-01" })).body.range;
    expect(far).toEqual({ from: addDays("2030-01-01", -730), to: "2030-01-01" });
  });

  it("lists every current ticket type and link even with no activity, and a never-published event works", async () => {
    const draft = await draftEvent(api, organiser);
    await createLink(organiser.token, "Ready for launch", draft.eventId);
    const res = await analytics(organiser.token, {}, draft.eventId);
    expect(res.status).toBe(200);
    expect(res.body.event.everPublished).toBe(false);
    expect(res.body.totals).toEqual({
      views: 0,
      orders: 0,
      ticketsSold: 0,
      grossCents: 0,
      feesCents: 0,
      netCents: 0,
      conversionRate: null,
    });
    expect(res.body.byTicketType).toEqual([expect.objectContaining({ ticketTypeId: "ga", ticketsSold: 0, grossCents: 0 })]);
    expect(res.body.trackingLinks).toEqual([expect.objectContaining({ label: "Ready for launch", views: 0, conversionRate: null })]);
  });
});

describe("overview", () => {
  it("covers only the caller's events, with per-event rows, totals and the previous period", async () => {
    const second = await publishedEvent(api, organiser, admin, { title: "Second", ticketTypes: TICKETS });
    const past = await publishedEvent(api, organiser, admin, { title: "Past" });
    await api.db.query(
      `update public.events set starts_at = now() - interval '10 days', ends_at = now() - interval '9 days' where id = $1`,
      [past.eventId],
    );
    await api.db.query(`update public.events set starts_at = now() + interval '1 day', ends_at = now() + interval '2 days' where id = $1`, [
      second.eventId,
    ]);
    const rival = await approvedOrganiser(api, admin, { displayName: "Rival" });
    const rivalEvent = await publishedEvent(api, rival, admin);
    await insertOrder(api, rivalEvent, "rival-buyer@example.com");
    await api.db.query(`update public.orders set total_cents = 5000 where event_id = $1`, [rivalEvent.eventId]);
    await view(rivalEvent.eventId);

    await view();
    await view();
    await view(second.eventId);
    await paidOrder([{ ticketTypeId: "ga", quantity: 1 }]);
    const lastWeek = await paidOrder([{ ticketTypeId: "vip", quantity: 1 }]);
    await api.db.query(`update public.orders set created_at = now() - interval '35 days' where id = $1`, [lastWeek]);
    await api.db.query(`update private.analytics_settings set views_tracked_since = '2020-01-01'`);

    const res = await overview(organiser.token, { compare: "prevPeriod" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = res.body;
    expect(body.range).toEqual({ from: addDays(today(), -29), to: today() });
    expect(body.totals).toMatchObject({ views: 3, orders: 1, ticketsSold: 1, grossCents: 3170, feesCents: 170, netCents: 3000 });
    expect(body.totals.conversionRate).toBeCloseTo(1 / 3);
    expect(body.byDay).toHaveLength(30);
    expect(body.eventsTruncated).toBe(false);
    // Upcoming soonest first (second starts tomorrow, event in 2027), then past.
    expect(body.events.map((e: { title: string }) => e.title)).toEqual(["Second", event.title, "Past"]);
    const mine = body.events.find((e: { eventId: string }) => e.eventId === event.eventId);
    expect(mine.totals).toMatchObject({ views: 2, orders: 1, grossCents: 3170 });
    expect(mine.previous).toMatchObject({ views: 0, orders: 1, grossCents: 8000, feesCents: 370, netCents: 7630 });
    expect(body.previous.range).toEqual({ from: addDays(today(), -59), to: addDays(today(), -30) });
    expect(body.previous.totals).toMatchObject({ orders: 1, grossCents: 8000 });
    expect(JSON.stringify(body)).not.toContain(rivalEvent.eventId);
  });
});

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

describe("CSV exports", () => {
  it("is a private attachment with no buyer details", async () => {
    await paidOrder([{ ticketTypeId: "ga", quantity: 1 }]);
    const res = await csv(getEventAnalyticsCsv, organiser.token, { eventId: event.eventId });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="sheltuh-${event.slug}_${today()}_${today()}.csv"`,
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.text.startsWith("﻿")).toBe(true);
    expect(res.text).toContain(`"Total","0","1","1","31.70","1.70","30.00"\r\n`);
    expect(res.text).not.toMatch(/@example\.com|pi_test|cs_test|ord_/);

    const all = await csv(getAnalyticsOverviewCsv, organiser.token, {}, { compare: "prevPeriod" });
    expect(all.status).toBe(200);
    expect(all.headers.get("content-disposition")).toBe(
      `attachment; filename="sheltuh-analytics_${addDays(today(), -29)}_${today()}.csv"`,
    );
    expect(all.headers.get("cache-control")).toBe("private, no-store");
    expect(all.text).toContain('"Previous views"');
    expect(all.text).not.toMatch(/@example\.com|pi_test|cs_test|ord_/);
  });

  it("neutralises formulas and quotes cells in organiser-supplied text", async () => {
    const nasty = await publishedEvent(api, organiser, admin, {
      title: '=HYPERLINK("http://evil.example","click")',
      ticketTypes: [{ id: "t", name: "+SUM(1,2)", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    await createLink(organiser.token, "@cmd", nasty.eventId);
    await createLink(organiser.token, "-2+3", nasty.eventId);
    await createLink(organiser.token, 'Say "hi", ok', nasty.eventId);

    const res = await csv(getEventAnalyticsCsv, organiser.token, { eventId: nasty.eventId });
    expect(res.text).toContain(`"Event","'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(res.text).toContain(`"'+SUM(1,2)"`);
    expect(res.text).toContain(`"'@cmd"`);
    expect(res.text).toContain(`"'-2+3"`);
    expect(res.text).toContain(`"Say ""hi"", ok"`);
    // No cell anywhere starts with a formula character.
    const cells = res.text.replace(/^﻿/, "").match(/"(?:[^"]|"")*"/g) ?? [];
    expect(cells.length).toBeGreaterThan(20);
    for (const cell of cells) expect(cell).not.toMatch(/^"\s*[=+\-@\t\r]/);

    const all = await csv(getAnalyticsOverviewCsv, organiser.token);
    expect(all.text).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
  });

  it("the CSV routes validate the range like the JSON ones", async () => {
    const res = await csv(getEventAnalyticsCsv, organiser.token, { eventId: event.eventId }, { from: "nope" });
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

// ---------------------------------------------------------------------------
// Retention and deletion
// ---------------------------------------------------------------------------

describe("retention", () => {
  it("purge_analytics deletes view counts older than 25 months and idle rate-limit rows, and is idempotent", async () => {
    const cutoff = (
      await api.db.query<{ d: string }>(
        `select (((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date)::text as d`,
      )
    )[0].d;
    await api.db.query(
      `insert into public.event_view_counts (event_id, day, source, link_code, views) values
         ($1, $2::date - 1, 'direct', null, 1), ($1, $2::date - 40, 'search', null, 1),
         ($1, $2::date, 'direct', null, 2), ($1, current_date, 'direct', null, 3)`,
      [event.eventId, cutoff],
    );
    const other = await publishedEvent(api, organiser, admin);
    await api.db.query(
      `insert into private.event_rate_limits (event_id, bucket, window_started_at, hits) values
         ($1, 'views', now() - interval '2 days', 3), ($2, 'views', now(), 1)`,
      [event.eventId, other.eventId],
    );

    const [first] = await api.db.query(`select * from private.purge_analytics()`);
    expect(first).toEqual({ event_view_counts_deleted: 2, event_rate_limits_deleted: 1 });
    expect((await viewRows()).map((r) => r.views).sort()).toEqual([2, 3]);
    expect(await api.db.query(`select event_id from private.event_rate_limits`)).toEqual([{ event_id: other.eventId }]);
    const [second] = await api.db.query(`select * from private.purge_analytics()`);
    expect(second).toEqual({ event_view_counts_deleted: 0, event_rate_limits_deleted: 0 });

    // Reports never claim views from beyond the retention horizon were counted.
    await api.db.query(`update private.analytics_settings set views_tracked_since = '2000-01-01'`);
    expect((await analytics(organiser.token)).body.viewsTrackedSince).toBe(cutoff);
  });

  it("deleting an event deletes its view counts and rate-limit rows", async () => {
    const draft = await draftEvent(api, organiser);
    await api.db.query(
      `insert into public.event_view_counts (event_id, day, source, link_code, views) values ($1, current_date, 'direct', null, 1)`,
      [draft.eventId],
    );
    await api.db.query(
      `insert into private.event_rate_limits (event_id, bucket, window_started_at, hits) values ($1, 'views', now(), 1)`,
      [draft.eventId],
    );
    await api.db.query(`delete from public.events where id = $1`, [draft.eventId]);
    const [{ v, r }] = await api.db.query<{ v: number; r: number }>(
      `select (select count(*)::int from public.event_view_counts where event_id = $1) as v,
              (select count(*)::int from private.event_rate_limits where event_id = $1) as r`,
      [draft.eventId],
    );
    expect({ v, r }).toEqual({ v: 0, r: 0 });
  });
});
