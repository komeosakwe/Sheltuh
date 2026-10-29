import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSuspendOrganiser } from "@/lib/server/handlers/admin";
import { getMyEvent } from "@/lib/server/handlers/events";
import { createCheckout } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { getTrendingEvents } from "@/lib/server/handlers/trending";
import { joinWaitlist } from "@/lib/server/handlers/waitlist";
import { EVENT_RELEASE_LIMIT, MAX_TICKETS_PER_TYPE, RELEASE_LIMIT, releaseTickets } from "@/lib/server/handlers/ticket-release";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { seatedEvent } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// "Release more tickets": docs/architecture.md, "Releasing more tickets";
// supabase/migrations/20261113000000_release_tickets.sql.

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

const GA = { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  serverUrl = testDb.url;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  vi.spyOn(console, "info").mockImplementation(() => {});
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: [GA] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function release(
  quantityAvailable: unknown,
  options: { token?: string | null; eventId?: string; ticketTypeId?: string } = {},
) {
  return api.call(releaseTickets, {
    token: options.token === null ? undefined : (options.token ?? organiser.token),
    params: { eventId: options.eventId ?? event.eventId, ticketTypeId: options.ticketTypeId ?? "ga" },
    body: { quantityAvailable },
    method: "POST",
  });
}

async function ticket(ticketTypeId = "ga", eventId = event.eventId) {
  const [row] = await api.db.query<{
    quantity_available: number;
    quantity_sold: number;
    name: string;
    price_cents: number;
    fee_policy: string;
  }>(
    `select quantity_available, quantity_sold, name, price_cents, fee_policy::text as fee_policy
       from public.ticket_types where event_id = $1 and id = $2`,
    [eventId, ticketTypeId],
  );
  return row;
}

const logEntries = () =>
  api.db.query<{ action: string; actor_id: string | null; details: { ticketTypes: { old: unknown[]; new: unknown[] } } }>(
    `select action::text as action, actor_id, details from public.event_moderation_log
      where event_id = $1 and action = 'edited' order by id`,
    [event.eventId],
  );

describe("releasing more tickets", () => {
  it("raises the total, keeps everything else, logs it and shows the sold count to the organiser only", async () => {
    await api.db.query(`update public.ticket_types set quantity_sold = 4 where event_id = $1`, [event.eventId]);
    const [before] = await api.db.query<{ updated_at: Date }>(`select updated_at from public.events where id = $1`, [event.eventId]);
    await new Promise((r) => setTimeout(r, 5));

    const res = await release(25);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eventId: event.eventId, ticketTypeId: "ga", quantityAvailable: 25, quantitySold: 4 });
    expect(await ticket()).toEqual({
      quantity_available: 25,
      quantity_sold: 4,
      name: "General admission",
      price_cents: 3000,
      fee_policy: "buyer-pays",
    });

    // The audit entry: the organiser's own account, only the changed tier before and after.
    const entries = await logEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].actor_id).toBe(organiser.userId);
    expect(entries[0].details.ticketTypes.old).toEqual([{ id: "ga", name: "General admission", quantityAvailable: 10 }]);
    expect(entries[0].details.ticketTypes.new).toEqual([{ id: "ga", name: "General admission", quantityAvailable: 25 }]);
    // An admin's edit made from before this is stale.
    const [after] = await api.db.query<{ updated_at: Date }>(`select updated_at from public.events where id = $1`, [event.eventId]);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());

    // The organiser's record: capacity, sold and the log; the public payload never carries sales.
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(mine.body.ticketTypes[0].quantityAvailable).toBe(25);
    expect(mine.body.ticketsSold).toEqual({ ga: 4 });
    expect(mine.body.moderationLog.at(-1)).toMatchObject({ action: "edited", by: organiser.userId });
    // The public shapes (slug, feed, trending, the organiser's page) never carry sales.
    const pub = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    const feed = await api.call(listPublicEvents, { query: { upcoming: "1" } });
    const trending = await api.call(getTrendingEvents, {});
    const profile = await api.call(getPublicOrganiserProfile, { params: { organiserId: organiser.organiserId } });
    for (const res of [pub, feed, trending, profile]) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain("ticketsSold");
    }
    expect(JSON.stringify(feed.body)).toContain(event.eventId);
  });

  it("a general admission tier of an event with a seat map can be raised; a seated tier can't", async () => {
    const other = await approvedOrganiser(api, admin, { displayName: "Seats Co", contactEmail: "s@example.com" });
    const { event: seated } = await seatedEvent(api, other, admin);
    const own = (ticketTypeId: string) => release(50, { token: other.token, eventId: seated.eventId, ticketTypeId });
    expect((await own("ga")).status).toBe(200);
    const res = await own("prem");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/seat map/i);
    const [prem] = await api.db.query<{ quantity_available: number }>(
      `select quantity_available from public.ticket_types where event_id = $1 and id = 'prem'`,
      [seated.eventId],
    );
    expect(prem.quantity_available).toBe(4);
  });
});

describe("who may release", () => {
  it("401 signed out; 403 for a member with no approved organiser; another organiser's event is a 404", async () => {
    expect((await release(20, { token: null })).status).toBe(401);
    const member = await api.signUp({});
    expect((await release(20, { token: member.token })).status).toBe(403);
    const other = await approvedOrganiser(api, admin, { displayName: "Other Co", contactEmail: "o@example.com" });
    const res = await release(20, { token: other.token });
    expect(res.status).toBe(404);
    // An admin has no organiser of their own here either: no special path.
    expect((await release(20, { token: admin.token })).status).toBe(403);
    expect((await ticket()).quantity_available).toBe(10);
    expect(await logEntries()).toEqual([]);
  });

  it("404 for an unknown event, a malformed id and an unknown ticket type", async () => {
    expect((await release(20, { eventId: crypto.randomUUID() })).status).toBe(404);
    expect((await release(20, { eventId: "not-a-uuid" })).status).toBe(404);
    expect((await release(20, { ticketTypeId: "nope" })).status).toBe(404);
  });

  it("403 once the organiser has been taken down (its events are unpublished too)", async () => {
    const res = await api.call(adminSuspendOrganiser, {
      token: admin.token,
      params: { organiserId: organiser.organiserId },
      body: { reason: "Fake venue." },
    });
    expect(res.status).toBe(200);
    expect((await release(20)).status).toBe(403);
    expect((await ticket()).quantity_available).toBe(10);
  });

  it("the function itself refuses an organiser that is no longer approved, and one that isn't the actor's", async () => {
    await api.db.query(`update public.organisers set status = 'pending' where id = $1`, [organiser.organiserId]);
    const call = (actor: string) =>
      api.db.query<{ result: string }>(
        `select result from private.release_tickets($1, $2, $3, 'ga', 20, 100000, 30, interval '1 hour', 10, interval '24 hours')`,
        [event.eventId, organiser.organiserId, actor],
      );
    expect((await call(organiser.userId))[0].result).toBe("not_approved");
    expect((await call(crypto.randomUUID()))[0].result).toBe("not_found");
    expect((await ticket()).quantity_available).toBe(10);
  });
});

describe("what can be released", () => {
  it("a draft is refused (409), and so is an event that has ended", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: [GA] });
    const res = await release(20, { eventId: draft.eventId });
    expect(res.status).toBe(409);
    expect((await ticket("ga", draft.eventId)).quantity_available).toBe(10);

    await api.db.query(
      `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = $1`,
      [event.eventId],
    );
    const ended = await release(20);
    expect(ended.status).toBe(409);
    expect(ended.body.error).toBe("This event has ended.");
    expect((await ticket()).quantity_available).toBe(10);
  });

  it("an event ticketed on another site is refused (409)", async () => {
    const external = await publishedEvent(api, organiser, admin, {
      ticketingMode: "external",
      externalTicketUrl: "https://www.eventbrite.com.au/e/some-event-123",
      ticketTypes: [],
    });
    const res = await release(20, { eventId: external.eventId });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/another site/);
  });

  it("only an increase: equal, lower, zero, negative, fractional and non-numeric are 400 with a field error", async () => {
    for (const value of [10, 9, 1, 0, -5, 12.5, "20", null, undefined, Number.NaN]) {
      const res = await release(value);
      expect(res.status, String(value)).toBe(400);
      expect(res.body.fieldErrors.quantityAvailable).toBeTruthy();
    }
    expect((await release(10)).body.fieldErrors.quantityAvailable).toBe("Enter more than the current 10.");
    expect((await ticket()).quantity_available).toBe(10);
    expect(await logEntries()).toEqual([]);
  });

  it("not above the cap", async () => {
    for (const value of [MAX_TICKETS_PER_TYPE + 1, 2 ** 31, 1e12]) {
      const res = await release(value);
      expect(res.status, String(value)).toBe(400);
      expect(res.body.fieldErrors.quantityAvailable).toMatch(/Can't be more than/);
    }
    expect((await release(MAX_TICKETS_PER_TYPE)).status).toBe(200);
  });

  it("a number cannot go below what was sold even through the function (an increase only)", async () => {
    await api.db.query(`update public.ticket_types set quantity_sold = 10 where event_id = $1`, [event.eventId]);
    expect((await release(10)).status).toBe(400);
    expect((await ticket()).quantity_available).toBe(10);
  });
});

describe("rate limit", () => {
  it("10 a day per event: the next is 429, nothing changes, and refused attempts use no slots", async () => {
    // Refusals first: none of these uses a slot.
    for (let i = 0; i < EVENT_RELEASE_LIMIT.limit + 2; i++) expect((await release(5)).status).toBe(400);
    for (let i = 1; i <= EVENT_RELEASE_LIMIT.limit; i++) expect((await release(10 + i)).status).toBe(200);
    expect((await release(10 + EVENT_RELEASE_LIMIT.limit + 1)).status).toBe(429);
    expect((await ticket()).quantity_available).toBe(10 + EVENT_RELEASE_LIMIT.limit);
    expect((await logEntries()).length).toBe(EVENT_RELEASE_LIMIT.limit);
    // Another organiser's event has its own allowance.
    const other = await approvedOrganiser(api, admin, { displayName: "Other Co", contactEmail: "o@example.com" });
    const theirs = await publishedEvent(api, other, admin, { ticketTypes: [GA] });
    expect((await release(20, { token: other.token, eventId: theirs.eventId })).status).toBe(200);
  });

  it("30 an hour per organiser, across events; a refusal by either limit doesn't cost the organiser's slot twice", async () => {
    const events = [event];
    for (let i = 0; i < 2; i++) events.push(await publishedEvent(api, organiser, admin, { ticketTypes: [GA] }));
    for (const e of events) {
      for (let i = 1; i <= EVENT_RELEASE_LIMIT.limit; i++) {
        expect((await release(10 + i, { eventId: e.eventId })).status).toBe(200);
      }
    }
    expect(RELEASE_LIMIT.limit).toBe(events.length * EVENT_RELEASE_LIMIT.limit);
    const fourth = await publishedEvent(api, organiser, admin, { ticketTypes: [GA] });
    const res = await release(20, { eventId: fourth.eventId });
    expect(res.status).toBe(429);
    const [row] = await api.db.query<{ quantity_available: number }>(
      `select quantity_available from public.ticket_types where event_id = $1`,
      [fourth.eventId],
    );
    expect(row.quantity_available).toBe(10);
  });
});

describe("hardening", () => {
  it("a ticket type id with a control character or NUL is a 404", async () => {
    for (const id of ["ga\u0000", "g\na", "ga\u007f", "\u0001"]) {
      expect((await release(20, { ticketTypeId: id })).status, JSON.stringify(id)).toBe(404);
    }
  });

  it("the function refuses a null actor (a platform-managed organiser has no owner) and raises on a null quantity", async () => {
    await api.db.query(`update public.ticket_types set price_cents = 0 where event_id = $1`, [event.eventId]);
    await api.db.query(`update public.organisers set owner_user_id = null, payouts_enabled = false, stripe_account_id = null where id = $1`, [organiser.organiserId]);
    const nullActor = await api.db.query<{ result: string }>(
      `select result from private.release_tickets($1, $2, null, 'ga', 20, 100000, 30, interval '1 hour', 10, interval '24 hours')`,
      [event.eventId, organiser.organiserId],
    );
    expect(nullActor[0].result).toBe("not_found");
    await expect(
      api.db.query(
        `select result from private.release_tickets($1, $2, $3, 'ga', null, 100000, 30, interval '1 hour', 10, interval '24 hours')`,
        [event.eventId, organiser.organiserId, organiser.userId],
      ),
    ).rejects.toThrow(/missing/);
    expect((await ticket()).quantity_available).toBe(10);
  });
});

describe("the waitlist", () => {
  async function onWaitlist(email: string) {
    const user = await api.signUp({ email });
    const res = await api.call(joinWaitlist, { token: user.token, params: { eventId: event.eventId }, body: {} });
    expect(res.status).toBe(201);
    return user;
  }

  const jobs = () =>
    api.db.query<{ email: string }>(
      `select w.email from private.email_outbox j join private.event_waitlist w on w.id = j.waitlist_entry_id
        where j.kind = 'waitlist_available' order by j.id`,
    );

  it("a sold-out event's waitlisted buyer is told exactly once, however many more are released", async () => {
    await api.db.query(`update public.ticket_types set quantity_sold = quantity_available where event_id = $1`, [event.eventId]);
    await onWaitlist("fan@example.com");
    expect(await jobs()).toEqual([]);

    // A refused release tells nobody.
    expect((await release(10)).status).toBe(400);
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();

    expect((await release(15)).status).toBe(200);
    expect(await jobs()).toEqual([{ email: "fan@example.com" }]);
    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0]).toMatchObject({
      to: "fan@example.com",
      subject: "Tickets are available again: Neon Static",
    });

    // Releasing again within the window: the same person isn't emailed twice.
    expect((await release(20)).status).toBe(200);
    await api.runDeferred();
    expect(await jobs()).toEqual([{ email: "fan@example.com" }]);
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
  });
});

// Two sessions at once: only a real server (PGlite is one connection). Run
// with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrency (real Postgres only)", () => {
  function connections() {
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

  const releaseOn = (conn: postgres.Sql, quantity: number) =>
    conn.unsafe(`select result, total, sold from private.release_tickets($1, $2, $3, 'ga', $4, 100000, 30, interval '1 hour', 10, interval '24 hours')`, [
      event.eventId,
      organiser.organiserId,
      organiser.userId,
      quantity,
    ]);

  let codes = 0;
  const fulfil = (conn: postgres.Sql, orderId: string, n: number) =>
    conn.unsafe(`select private.fulfil_order($1, 'buyer@example.com', 'pi_race', $2::text::jsonb)::text as status`, [
      orderId,
      JSON.stringify(
        Array.from({ length: n }, () => ({ ticketCode: `RL${String(codes++).padStart(2, "0")}-RRRR`, ticketTypeId: "ga", ticketTypeName: "GA" })),
      ),
    ]);

  async function pendingOrder(quantity: number) {
    await enablePayouts(api, organiser.organiserId);
    let sessions = 0;
    api.stripe.checkout.sessions.create.mockImplementation(async () => embeddedSession(`cs_test_${++sessions}`));
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity }] },
    });
    expect(res.status).toBe(201);
    return res.body.orderId as string;
  }

  it("a release in flight: the purchase waits, then both land (sold never above the new total)", async () => {
    const orderId = await pendingOrder(2);
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await releaseOn(one, 30))[0]).toMatchObject({ result: "released", total: 30 });
      const blocked = await waitUntilBlocked(two);
      const pending = fulfil(two, orderId, 2).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].status).toBe("paid");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await ticket()).toMatchObject({ quantity_available: 30, quantity_sold: 2 });
  });

  it("a purchase in flight: the release waits for the ticket type, then reads the sold count and lands", async () => {
    const orderId = await pendingOrder(2);
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await fulfil(one, orderId, 2))[0].status).toBe("paid");
      const blocked = await waitUntilBlocked(two);
      const pending = releaseOn(two, 30).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0]).toMatchObject({ result: "released", total: 30, sold: 2 });
    } finally {
      await one.end();
      await two.end();
    }
    expect(await ticket()).toMatchObject({ quantity_available: 30, quantity_sold: 2 });
  });

  it("two releases of the same number at once: one lands, the other is refused as not an increase", async () => {
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await releaseOn(one, 20))[0].result).toBe("released");
      const blocked = await waitUntilBlocked(two);
      const pending = releaseOn(two, 20).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0]).toMatchObject({ result: "not_increase", total: 20 });
    } finally {
      await one.end();
      await two.end();
    }
    expect((await logEntries()).length).toBe(1);
  });

  it("an unpublish in flight wins: the release then sees an unpublished event", async () => {
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      await one.unsafe(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
      const blocked = await waitUntilBlocked(two);
      const pending = releaseOn(two, 20).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("not_published");
    } finally {
      await one.end();
      await two.end();
    }
    expect((await ticket()).quantity_available).toBe(10);
  });
});
