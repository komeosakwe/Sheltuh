import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkInTicket, getCheckInSummary } from "@/lib/server/handlers/check-ins";
import { getEventImage } from "@/lib/server/handlers/event-images";
import { createCheckout } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { TICKET_CODE_PATTERN } from "@/lib/ticket-code";
import { databaseLabel, memberEmail, SEED_SLUG_PREFIX, SEED_TITLE_PREFIX, seedLoadData, type SeedOptions } from "../load/seed/seed";
import { embeddedSession, TestApi } from "./helpers/api";
import { setUpPayouts } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// The k6 load tests' staging seed (tests/load/seed/seed.ts), against every
// migration: what it makes is what the scenarios open, claim, buy and scan.

let api: TestApi;
let reset: () => Promise<void>;
let owner: { token: string; userId: string; email: string };

/** A 1x1 JPEG: the seed stores photos as given. */
const JPEG = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
    "base64",
  ),
);

function options(overrides: Partial<SeedOptions> = {}): SeedOptions {
  return {
    ownerUserId: owner.userId,
    organiserEmail: owner.email,
    browseEvents: 10,
    scarceQuantity: 3,
    doorTickets: 0,
    doorLabel: "t1",
    images: [{ contentType: "image/jpeg", data: JPEG }],
    ...overrides,
  };
}

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  owner = await api.signUp();
});

describe("load-test seed", () => {
  it("publishes upcoming, marked events the feed, event, photo and organiser routes serve", async () => {
    const out = await seedLoadData(api.db, options());

    const feed = await api.call(listPublicEvents, { query: { upcoming: "1", limit: "50" } });
    expect(feed.status).toBe(200);
    const items = feed.body.items as { slug: string; title: string; eventId: string; ticketingMode: string; imageUrl?: string }[];
    // 10 browse events, the on-sale one and the scarce one; no paid one (no payouts); no door event.
    expect(items).toHaveLength(12);
    for (const item of items) {
      expect(item.title.startsWith(SEED_TITLE_PREFIX)).toBe(true);
      expect(item.slug.startsWith(SEED_SLUG_PREFIX)).toBe(true);
    }
    expect(out.paid).toBeNull();
    expect(out.door).toBeNull();
    expect(out.organiser.payoutsReady).toBe(false);

    // Every 8th browse event is externally ticketed (the external-going route), with no ticket types.
    const external = items.filter((i) => i.ticketingMode === "external");
    expect(external).toHaveLength(1);
    const ext = await api.call(getPublicEventBySlug, { params: { slug: external[0].slug } });
    expect(ext.status).toBe(200);
    expect(ext.body.ticketTypes).toStrictEqual([]);

    // Searches in tests/load/lib/journeys.js find seeded events.
    const search = await api.call(listPublicEvents, { query: { q: "jazz", upcoming: "1", recent: "1" } });
    expect(search.body.items.length).toBeGreaterThan(0);

    // Photos: served at the URL the feed hands out.
    const withImage = items.find((i) => i.imageUrl);
    expect(withImage).toBeDefined();
    const v = new URL(withImage!.imageUrl!, "https://x.test").searchParams.get("v")!;
    const image = await api.callRaw(getEventImage, { params: { eventId: withImage!.eventId }, query: { v } });
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=3600");

    const onsale = await api.call(getPublicEventBySlug, { params: { slug: out.onsale.slug } });
    expect(onsale.body.eventId).toBe(out.onsale.eventId);
    expect(onsale.body.ticketTypes).toMatchObject([{ id: "free", priceCents: 0 }]);
    expect(out.scarce.quantity).toBe(3);

    const profile = await api.call(getPublicOrganiserProfile, { params: { organiserId: out.organiser.organiserId } });
    expect(profile.status).toBe(200);
    expect(profile.body.upcomingEvents.length).toBeGreaterThan(0);
  });

  it("makes door tickets the organiser can check in, without queueing ticket emails", async () => {
    const out = await seedLoadData(api.db, options({ browseEvents: 0, doorTickets: 9 }));
    expect(out.door).not.toBeNull();
    const door = out.door!;
    expect(door.codes).toHaveLength(9);
    expect(new Set(door.codes).size).toBe(9);
    for (const code of door.codes) expect(code).toMatch(TICKET_CODE_PATTERN);

    const scan = (code: string) =>
      api.call(checkInTicket, { token: owner.token, params: { eventId: door.eventId }, body: { code, requestId: crypto.randomUUID() } });
    const first = await scan(`SH1:${door.codes[0]}`);
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("admitted");
    expect((await scan(door.codes[0].toLowerCase())).body.outcome).toBe("already_checked_in");
    expect((await scan(door.codes[8])).body.outcome).toBe("admitted");

    const summary = await api.call(getCheckInSummary, { token: owner.token, params: { eventId: door.eventId } });
    expect(summary.status).toBe(200);
    expect(summary.body.event.title.startsWith(SEED_TITLE_PREFIX)).toBe(true);
    expect(summary.body).toMatchObject({ ticketsSold: 9, checkedIn: 2, capacity: 9 });

    const [{ count }] = await api.db.query<{ count: number }>(
      `select count(*)::int as count from private.email_outbox j join public.orders o on o.id = j.order_id where o.event_id = $1`,
      [door.eventId],
    );
    expect(count).toBe(0);
  });

  it("issues free claims on the on-sale event and sells the scarce one out without overselling", async () => {
    const out = await seedLoadData(api.db, options({ browseEvents: 0 }));
    const claim = (member: { token: string; email: string }, eventId: string) =>
      api.call(createCheckout, {
        token: member.token,
        params: { eventId },
        headers: { "idempotency-key": crypto.randomUUID() },
        body: { lineItems: [{ ticketTypeId: "free", quantity: 1 }], buyerEmail: member.email, buyerName: "Load Test" },
      });
    const members = [await api.signUp(), await api.signUp()];

    const onsale = await claim(members[0], out.onsale.eventId);
    expect(onsale.status).toBe(201);
    expect(onsale.body.url).toContain("/checkout/success?session_id=ord_");

    const statuses: number[] = [];
    for (const member of [members[0], members[0], members[1], members[1]]) statuses.push((await claim(member, out.scarce.eventId)).status);
    expect(statuses).toStrictEqual([201, 201, 201, 409]);
  });

  it("adds the paid event once the organiser has payouts, and its checkout reaches Stripe", async () => {
    const first = await seedLoadData(api.db, options({ browseEvents: 0 }));
    await setUpPayouts(api, first.organiser.organiserId);
    const out = await seedLoadData(api.db, options({ browseEvents: 0 }));
    expect(out.organiser.payoutsReady).toBe(true);
    expect(out.paid).not.toBeNull();
    // Re-running keeps the same events.
    expect(out.onsale).toStrictEqual(first.onsale);
    expect(out.scarce).toStrictEqual(first.scarce);

    api.stripe.checkout.sessions.create.mockImplementation(async () => embeddedSession("cs_test_load"));
    const res = await api.call(createCheckout, {
      params: { eventId: out.paid!.eventId },
      headers: { "idempotency-key": crypto.randomUUID(), "x-forwarded-for": "203.0.113.7" },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }], buyerName: "Load Test" },
    });
    expect(res.status).toBe(201);
    expect(res.body.orderId).toMatch(/^ord_[0-9a-f]{32}$/);
  });

  it("re-running keeps existing events and refuses a door label that's been used", async () => {
    await seedLoadData(api.db, options({ doorTickets: 2 }));
    const countEvents = async () =>
      (await api.db.query<{ n: number }>(`select count(*)::int as n from public.events where slug like 'load-test-%'`))[0].n;
    const before = await countEvents();
    await seedLoadData(api.db, options());
    expect(await countEvents()).toBe(before);
    await expect(seedLoadData(api.db, options({ doorTickets: 2 }))).rejects.toThrow(/already exists/);
    await expect(seedLoadData(api.db, options({ doorLabel: "Not OK" }))).rejects.toThrow(/doorLabel/);
    // A scarce label makes a fresh sell-out event.
    const again = await seedLoadData(api.db, options({ browseEvents: 0, scarceLabel: "r2", scarceQuantity: 5 }));
    expect(again.scarce).toMatchObject({ slug: "load-test-scarce-free-r2", quantity: 5 });
  });

  it("refuses an organiser that isn't approved", async () => {
    await api.db.query(
      `insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, status)
       values ($1, 'Pending One', $2, 'x', array['art']::public.event_category[], 'pending')`,
      [owner.userId, owner.email],
    );
    await expect(seedLoadData(api.db, options())).rejects.toThrow(/not approved/);
  });
});

describe("seeded members", () => {
  it("each have their own free-ticket allowance (no +tag addresses, which share one)", async () => {
    const emails = Array.from({ length: 25 }, (_, i) => memberEmail(i + 1, "example.com"));
    const [{ keys }] = await api.db.query<{ keys: number }>(
      `select count(distinct private.email_key(e))::int as keys from unnest($1::text[]) e`,
      [`{${emails.join(",")}}`],
    );
    expect(keys).toBe(25);

    // And end to end: more members than one allowance (4) can each claim on the same event.
    const out = await seedLoadData(api.db, options({ browseEvents: 0 }));
    const statuses: number[] = [];
    for (const email of emails.slice(0, 6)) {
      const member = await api.signUp({ email });
      const res = await api.call(createCheckout, {
        token: member.token,
        params: { eventId: out.onsale.eventId },
        headers: { "idempotency-key": crypto.randomUUID() },
        body: { lineItems: [{ ticketTypeId: "free", quantity: 1 }], buyerEmail: email },
      });
      statuses.push(res.status);
    }
    expect(statuses).toStrictEqual([201, 201, 201, 201, 201, 201]);
  });
});

describe("databaseLabel (LOAD_SEED_CONFIRM)", () => {
  it("is the Supabase project ref for pooler and direct URLs, else the host", () => {
    expect(databaseLabel("postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres")).toBe(
      "abcdefghijklmnopqrst",
    );
    expect(databaseLabel("postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres")).toBe("abcdefghijklmnopqrst");
    expect(databaseLabel("postgres://me@127.0.0.1:5432/staging")).toBe("127.0.0.1");
  });
});
