import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import {
  deleteMyGoing,
  getGoingSummary,
  getMyGoing,
  listGoingAttendees,
  putMyGoing,
} from "@/lib/server/handlers/going";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { stripeWebhookRequest, TestApi } from "./helpers/api";
import {
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

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin);
});

type Member = { token: string; userId: string; email: string };

/** A signed-up user with a profile (unless `profile: false`). */
async function member(
  options: { email?: string; emailVerified?: boolean; displayName?: string; profile?: boolean } = {},
): Promise<Member> {
  const user = await api.signUp({ email: options.email, emailVerified: options.emailVerified });
  if (options.profile !== false) {
    // Created directly: putMyProfile (rightly) refuses unverified callers.
    await api.db.query(
      `insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, $2, now())`,
      [user.userId, options.displayName ?? `Member ${user.userId.slice(0, 6)}`],
    );
  }
  return user;
}

/** A member with a paid order for `forEvent` under their email, opted in. */
async function goingMember(forEvent: EventRecord = event, options: { displayName?: string } = {}) {
  const m = await member(options);
  await insertOrder(api, forEvent, m.email);
  const res = await put(m, forEvent);
  expect(res.status).toBe(200);
  return m;
}

const params = (e: { eventId: string } = event) => ({ eventId: e.eventId });
const put = (m: { token: string }, e: { eventId: string } = event) =>
  api.call(putMyGoing, { token: m.token, params: params(e), method: "PUT" });
const del = (m: { token: string }, e: { eventId: string } = event) =>
  api.call(deleteMyGoing, { token: m.token, params: params(e), method: "DELETE" });
const mine = (m: { token: string }, e: { eventId: string } = event) =>
  api.call(getMyGoing, { token: m.token, params: params(e) });
const summary = (e: { eventId: string } = event) => api.call(getGoingSummary, { params: params(e) });
const attendees = (m: { token: string }, e: { eventId: string } = event, query?: Record<string, string>) =>
  api.call(listGoingAttendees, { token: m.token, params: params(e), query });

async function attendeeRows(eventId = event.eventId) {
  return api.db.query<{ user_id: string }>(`select user_id from public.event_attendees where event_id = $1`, [eventId]);
}

async function endEvent(e: EventRecord = event) {
  await api.db.query(
    `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 minute' where id = $1`,
    [e.eventId],
  );
}

async function disableWhosGoing(e: EventRecord = event) {
  await api.db.query(`update public.events set whos_going_enabled = false where id = $1`, [e.eventId]);
}

async function suspend(m: Member) {
  await api.db.query(`update public.profiles set social_suspended_at = now() where user_id = $1`, [m.userId]);
}

describe("opting in: who is eligible", () => {
  it("a paid ticket holder (real checkout + webhook) can opt in", async () => {
    await enablePayouts(api, organiser.organiserId);
    const m = await member({ email: "payer@example.com" });
    const checkout = await api.call(createCheckout, {
      params: params(),
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] },
    });
    expect(checkout.status).toBe(201);
    // The buyer's email only arrives with Stripe's webhook, as in production.
    const [{ id }] = await api.db.query<{ id: string }>(`select id from public.orders where event_id = $1`, [
      event.eventId,
    ]);
    expect((await put(m)).status).toBe(403);
    await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_1",
            object: "checkout.session",
            client_reference_id: id,
            payment_status: "paid",
            payment_intent: "pi_test_1",
            customer_details: { email: "payer@example.com" },
          },
        },
      }),
    );

    expect((await mine(m)).body).toEqual({ going: false, eligible: true, hasProfile: true });
    const res = await put(m);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ going: true, eligible: true, hasProfile: true });
    expect(await attendeeRows()).toEqual([{ user_id: m.userId }]);
    expect((await summary()).body).toEqual({ count: 1, closed: false });
  });

  it("a free ticket holder can opt in (free tickets are A$0 paid orders)", async () => {
    const free = await publishedEvent(api, organiser, admin, {
      title: "Free night",
      ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    const m = await member({ email: "free@example.com" });
    const checkout = await api.call(createCheckout, {
      params: params(free),
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "free@example.com" },
    });
    expect(checkout.status).toBe(201);

    const res = await put(m, free);
    expect(res.status).toBe(200);
    expect(res.body.going).toBe(true);
  });

  it("matches the ticket's email case-insensitively", async () => {
    const m = await member({ email: "fan@example.com" });
    await insertOrder(api, event, "Fan@Example.COM");
    expect((await put(m)).status).toBe(200);
  });

  it.each(["pending", "failed", "oversold_refund_required", "refunded"] as const)(
    "rejects a %s order with 403",
    async (status) => {
      const m = await member();
      await insertOrder(api, event, m.email, status);
      const res = await put(m);
      expect(res.status).toBe(403);
      expect((await mine(m)).body).toEqual({ going: false, eligible: false, hasProfile: true });
      expect(await attendeeRows()).toEqual([]);
    },
  );

  it("rejects a ticket bought under a different email", async () => {
    const m = await member({ email: "me@example.com" });
    await insertOrder(api, event, "someone-else@example.com");
    expect((await put(m)).status).toBe(403);
    expect(await attendeeRows()).toEqual([]);
  });

  it("rejects a ticket for a different event", async () => {
    const other = await publishedEvent(api, organiser, admin, { title: "Other" });
    const m = await member();
    await insertOrder(api, other, m.email);
    expect((await put(m)).status).toBe(403);
  });

  it("rejects an unverified email even when a paid order matches it", async () => {
    const m = await member({ emailVerified: false });
    await insertOrder(api, event, m.email);
    expect((await put(m)).status).toBe(403);
    expect((await mine(m)).body).toEqual({ going: false, eligible: false, hasProfile: true });
    expect(await attendeeRows()).toEqual([]);
  });

  it("requires a signed-in caller", async () => {
    expect((await api.call(putMyGoing, { params: params(), method: "PUT" })).status).toBe(401);
    expect((await api.call(getMyGoing, { params: params() })).status).toBe(401);
    expect((await api.call(deleteMyGoing, { params: params(), method: "DELETE" })).status).toBe(401);
  });

  it("asks for a profile first (409), reporting eligible but no profile", async () => {
    const m = await member({ profile: false });
    await insertOrder(api, event, m.email);
    expect((await mine(m)).body).toEqual({ going: false, eligible: true, hasProfile: false });
    expect((await put(m)).status).toBe(409);
    expect(await attendeeRows()).toEqual([]);
  });

  it("rejects a suspended profile with 403", async () => {
    const m = await member();
    await insertOrder(api, event, m.email);
    await suspend(m);
    expect((await put(m)).status).toBe(403);
    expect((await mine(m)).body).toEqual({ going: false, eligible: false, hasProfile: true });
    expect(await attendeeRows()).toEqual([]);
  });

  it("is a 404 for events that aren't published, and for unknown ids", async () => {
    const draft = await draftEvent(api, organiser, { title: "Draft" });
    const m = await member();
    await insertOrder(api, draft, m.email);
    expect((await put(m, draft)).status).toBe(404);
    expect((await mine(m, draft)).status).toBe(404);
    expect((await put(m, { eventId: crypto.randomUUID() })).status).toBe(404);
    expect((await put(m, { eventId: "not-a-uuid" })).status).toBe(404);
    expect((await mine(m, { eventId: "not-a-uuid" })).status).toBe(404);
  });

  it("refuses opt-ins once the event has ended or Who's Going is switched off", async () => {
    const ended = await publishedEvent(api, organiser, admin, { title: "Ended" });
    const m = await member();
    await insertOrder(api, ended, m.email);
    await insertOrder(api, event, m.email);
    await endEvent(ended);
    await disableWhosGoing(event);

    for (const e of [ended, event]) {
      expect((await put(m, e)).status).toBe(404);
      expect((await mine(m, e)).body).toEqual({ going: false, eligible: false, hasProfile: true });
    }
    expect(await api.db.query(`select 1 from public.event_attendees`)).toEqual([]);
  });

  it("refuses opt-ins once the event is unpublished", async () => {
    const m = await member();
    await insertOrder(api, event, m.email);
    await api.call(adminUnpublishEvent, { token: admin.token, params: params(), body: { reason: "x" } });
    expect((await put(m)).status).toBe(404);
  });
});

describe("opting in and out: idempotency and races", () => {
  it("PUT twice leaves one row; DELETE twice leaves none", async () => {
    const m = await member();
    await insertOrder(api, event, m.email);
    expect((await put(m)).status).toBe(200);
    expect((await put(m)).status).toBe(200);
    expect(await attendeeRows()).toHaveLength(1);

    for (let i = 0; i < 2; i++) {
      const res = await del(m);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ going: false, eligible: true, hasProfile: true });
    }
    expect(await attendeeRows()).toEqual([]);
  });

  it("concurrent PUTs all succeed and leave exactly one row", async () => {
    const m = await member();
    await insertOrder(api, event, m.email);
    const results = await Promise.all(Array.from({ length: 5 }, () => put(m)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await attendeeRows()).toHaveLength(1);
  });

  it("only ever changes the caller's own opt-in", async () => {
    const a = await goingMember();
    const b = await goingMember();
    await del(a);
    expect(await attendeeRows()).toEqual([{ user_id: b.userId }]);
  });

  it("opting out still works after the event has ended or been unpublished", async () => {
    const m = await goingMember();
    await endEvent();
    expect((await del(m)).status).toBe(200);
    expect(await attendeeRows()).toEqual([]);

    const m2 = await goingMember(await publishedEvent(api, organiser, admin, { title: "Second" }));
    const [second] = await api.db.query<{ event_id: string }>(
      `select event_id from public.event_attendees where user_id = $1`,
      [m2.userId],
    );
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: second.event_id }, body: { reason: "x" } });
    const res = await del(m2, { eventId: second.event_id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ going: false, eligible: false, hasProfile: true });
    expect(await attendeeRows(second.event_id)).toEqual([]);
  });

  it("an unverified member can still opt out", async () => {
    const m = await member({ emailVerified: false });
    await api.db.query(`insert into public.event_attendees (event_id, user_id) values ($1, $2)`, [
      event.eventId,
      m.userId,
    ]);
    expect((await del(m)).status).toBe(200);
    expect(await attendeeRows()).toEqual([]);
  });
});

describe("public count", () => {
  it("counts opted-in members only, leaving out suspended ones", async () => {
    expect((await summary()).body).toEqual({ count: 0, closed: false });
    await goingMember();
    const suspended = await goingMember();
    // A ticket holder who hasn't opted in isn't counted.
    const quiet = await member();
    await insertOrder(api, event, quiet.email);
    expect((await summary()).body).toEqual({ count: 2, closed: false });

    await suspend(suspended);
    const res = await summary();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 1, closed: false });
  });

  it("shows nothing once the event has ended or Who's Going is switched off", async () => {
    await goingMember();
    await disableWhosGoing();
    expect((await summary()).body).toEqual({ count: 0, closed: true });

    await api.db.query(`update public.events set whos_going_enabled = true where id = $1`, [event.eventId]);
    expect((await summary()).body).toEqual({ count: 1, closed: false });
    await endEvent();
    expect((await summary()).body).toEqual({ count: 0, closed: true });
  });

  it("is a 404 unless the event is published", async () => {
    const draft = await draftEvent(api, organiser, { title: "Draft" });
    expect((await summary(draft)).status).toBe(404);
    expect((await summary({ eventId: crypto.randomUUID() })).status).toBe(404);
    expect((await summary({ eventId: "nope" })).status).toBe(404);
  });
});

describe("attendee list", () => {
  it("needs a signed-in, verified member", async () => {
    await goingMember();
    expect((await api.call(listGoingAttendees, { params: params() })).status).toBe(401);
    const unverified = await member({ emailVerified: false });
    expect((await attendees(unverified)).status).toBe(403);
  });

  it("is a 404 unless the event is published", async () => {
    const viewer = await member();
    const draft = await draftEvent(api, organiser, { title: "Draft" });
    expect((await attendees(viewer, draft)).status).toBe(404);
    expect((await attendees(viewer, { eventId: "nope" })).status).toBe(404);
  });

  it("shows exactly an opaque id, the display name and isYou — oldest first, suspended members left out", async () => {
    const first = await goingMember(event, { displayName: "Ada" });
    const hidden = await goingMember(event, { displayName: "Hidden" });
    const third = await goingMember(event, { displayName: "Grace" });
    await suspend(hidden);

    const res = await attendees(third);
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeUndefined();
    expect(res.body.items.map((a: { displayName: string; isYou: boolean }) => [a.displayName, a.isYou])).toEqual([
      ["Ada", false],
      ["Grace", true],
    ]);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(["attendeeId", "displayName", "isYou"]);
    }
    const raw = JSON.stringify(res.body);
    for (const m of [first, hidden, third]) {
      expect(raw).not.toContain(m.userId);
      expect(raw).not.toContain(m.email);
    }
    expect(raw).not.toContain("General admission");
  });

  it("gives the same person a different attendeeId on every event", async () => {
    const second = await publishedEvent(api, organiser, admin, { title: "Second" });
    const m = await goingMember(event);
    await insertOrder(api, second, m.email);
    expect((await put(m, second)).status).toBe(200);

    const a = (await attendees(m, event)).body.items[0].attendeeId;
    const b = (await attendees(m, second)).body.items[0].attendeeId;
    expect(a).not.toEqual(b);
    expect([a, b]).not.toContain(m.userId);
  });

  it("caps a page at 50 and pages on with a cursor", async () => {
    // Bulk-created directly: 51 users each with a profile and an opt-in.
    await api.db.query(
      `with u as (
         insert into auth.users (id, email)
         select gen_random_uuid(), 'bulk' || g || '@example.com' from generate_series(1, 51) g
         returning id
       ), p as (
         insert into public.profiles (user_id, display_name, adult_confirmed_at)
         select id, 'Bulk', now() from u returning user_id
       )
       insert into public.event_attendees (event_id, user_id) select $1, user_id from p`,
      [event.eventId],
    );
    const viewer = await member();

    const page1 = await attendees(viewer, event, { limit: "500" });
    expect(page1.body.items).toHaveLength(50);
    expect(page1.body.nextCursor).toBeDefined();
    const page2 = await attendees(viewer, event, { limit: "500", cursor: page1.body.nextCursor });
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeUndefined();

    const ids = new Set([...page1.body.items, ...page2.body.items].map((a: { attendeeId: string }) => a.attendeeId));
    expect(ids.size).toBe(51);
    expect((await attendees(viewer, event, { cursor: "garbage" })).status).toBe(400);
  });

  it("is empty once the event has ended or Who's Going is switched off", async () => {
    const m = await goingMember();
    await disableWhosGoing();
    expect((await attendees(m)).body).toEqual({ items: [] });
    await api.db.query(`update public.events set whos_going_enabled = true where id = $1`, [event.eventId]);
    expect((await attendees(m)).body.items).toHaveLength(1);
    await endEvent();
    expect((await attendees(m)).body).toEqual({ items: [] });
  });
});

describe("private.set_going (database function)", () => {
  it("returns each outcome directly", async () => {
    const m = await member({ profile: false });
    const call = async (eventId: string, email: string | null = m.email) =>
      (
        await api.db.query<{ r: string }>(`select private.set_going($1, $2, $3) as r`, [eventId, m.userId, email])
      )[0].r;

    expect(await call(crypto.randomUUID())).toBe("event_unavailable");
    expect(await call(event.eventId)).toBe("no_profile");
    await api.db.query(`insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, 'M', now())`, [
      m.userId,
    ]);
    expect(await call(event.eventId)).toBe("not_eligible");
    await insertOrder(api, event, m.email.toUpperCase());
    expect(await call(event.eventId, null)).toBe("not_eligible");
    expect(await call(event.eventId)).toBe("going");
    expect(await call(event.eventId)).toBe("going");
    await suspend(m);
    expect(await call(event.eventId)).toBe("suspended");
  });
});
