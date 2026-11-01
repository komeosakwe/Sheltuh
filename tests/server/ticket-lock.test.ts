import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgConstraint, pgErrorCode } from "@/lib/server/db";
import { adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { getMyEvent, updateEventDraft } from "@/lib/server/handlers/events";
import { createCheckout, TICKET_LOCKED_CODE } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { putSeatMap } from "@/lib/server/handlers/seating";
import { EVENT_LOCK_LIMIT, setTicketLock } from "@/lib/server/handlers/ticket-lock";
import { releaseTickets } from "@/lib/server/handlers/ticket-release";
import type { AdminEventRecord, EventRecord } from "@/lib/server/types";
import { embeddedSession, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, eventInput, publishedEvent, setUpPayouts, signUpAdmin } from "./helpers/fixtures";
import { gridTemplate, seatedEvent } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// "Opens when the ticket above sells out": docs/architecture.md, "Sequential
// ticket releases"; supabase/migrations/20261117000000_ticket_release_lock.sql.

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

const FIRST = { id: "early", name: "Early bird", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 2 };
const SECOND = { id: "second", name: "Second release", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 3 };
const THIRD = { id: "final", name: "Final release", priceCents: 4000, feePolicy: "buyer-pays", quantityAvailable: 5 };
const RELEASES = [FIRST, { ...SECOND, opensAfterPrevious: true }, { ...THIRD, opensAfterPrevious: true }];

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
  event = await publishedEvent(api, organiser, admin, { ticketTypes: RELEASES });
  await setUpPayouts(api, organiser.organiserId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function toggle(
  opensAfterPrevious: unknown,
  options: { token?: string | null; eventId?: string; ticketTypeId?: string } = {},
) {
  return api.call(setTicketLock, {
    token: options.token === null ? undefined : (options.token ?? organiser.token),
    params: { eventId: options.eventId ?? event.eventId, ticketTypeId: options.ticketTypeId ?? "second" },
    body: { opensAfterPrevious },
    method: "PUT",
  });
}

async function tiers(eventId = event.eventId) {
  const rows = await api.db.query<{ id: string; opens_after_previous: boolean; sold_out: boolean; sold: number }>(
    `select id, opens_after_previous, sold_out_at is not null as sold_out, quantity_sold as sold
       from public.ticket_types where event_id = $1 order by position`,
    [eventId],
  );
  return rows;
}

/** Sells a tier out the way the database sees it (fulfil_order raises quantity_sold). */
const sellOut = (id: string, eventId = event.eventId) =>
  api.db.query(`update public.ticket_types set quantity_sold = quantity_available where event_id = $1 and id = $2`, [eventId, id]);

const logEntries = (eventId = event.eventId) =>
  api.db.query<{ actor_id: string | null; details: { ticketTypes: { old: unknown[]; new: unknown[] } } }>(
    `select actor_id, details from public.event_moderation_log where event_id = $1 and action = 'edited' order by id`,
    [eventId],
  );

function buy(ticketTypeId: string, quantity = 1, token?: string) {
  return api.call(createCheckout, {
    token,
    params: { eventId: event.eventId },
    body: { lineItems: [{ ticketTypeId, quantity }] },
  });
}

let sessions = 0;
beforeEach(() => {
  sessions = 0;
});
function stripeSessions() {
  api.stripe.checkout.sessions.create.mockImplementation(async () => embeddedSession(`cs_lock_${++sessions}`));
}

describe("what an event record says", () => {
  it("names the tier a waiting tier opens after, in the organiser's and the public shapes", async () => {
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    const [early, second, final] = mine.body.ticketTypes;
    expect(early.opensAfterPrevious).toBeUndefined();
    expect(early.opensAfter).toBeUndefined();
    expect(second).toMatchObject({ opensAfterPrevious: true, opensAfter: { ticketTypeId: "early", name: "Early bird" } });
    expect(final).toMatchObject({ opensAfterPrevious: true, opensAfter: { ticketTypeId: "second", name: "Second release" } });

    const pub = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(pub.body.ticketTypes[1]).toMatchObject({ opensAfter: { ticketTypeId: "early", name: "Early bird" }, soldOut: false });
    expect(pub.body.soldOut).toBe(false);
    const feed = await api.call(listPublicEvents, { query: { upcoming: "1" } });
    expect(feed.body.items[0].ticketTypes[2].opensAfter).toEqual({ ticketTypeId: "second", name: "Second release" });
  });

  it("opensAfter goes once the tier above sells out (opensAfterPrevious stays), and stays gone after more tickets are released", async () => {
    await sellOut("early");
    const pub = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(pub.body.ticketTypes[0]).toMatchObject({ soldOut: true, remaining: 0 });
    expect(pub.body.ticketTypes[1].opensAfter).toBeUndefined();
    expect(pub.body.ticketTypes[1].opensAfterPrevious).toBe(true);
    // The tier after that still waits for the second.
    expect(pub.body.ticketTypes[2].opensAfter).toEqual({ ticketTypeId: "second", name: "Second release" });

    // Sticky: more of the first tier doesn't shut the second again.
    expect((await api.call(releaseTickets, {
      token: organiser.token,
      params: { eventId: event.eventId, ticketTypeId: "early" },
      body: { quantityAvailable: 20 },
      method: "POST",
    })).status).toBe(200);
    const after = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(after.body.ticketTypes[0].soldOut).toBe(false);
    expect(after.body.ticketTypes[1].opensAfter).toBeUndefined();
    expect((await tiers()).map((t) => t.sold_out)).toEqual([true, false, false]);
  });
});

describe("saving ticket types with the setting", () => {
  it("400 on the first ticket, on a non-boolean and on null; absent is fine", async () => {
    const create = (ticketTypes: unknown[]) => draftEvent(api, organiser, { ticketTypes }).then(
      () => null,
      (err: Error) => err.message,
    );
    const first = await create([{ ...FIRST, opensAfterPrevious: true }, SECOND]);
    expect(first).toContain("ticketTypes[0].opensAfterPrevious");
    expect(await create([FIRST, { ...SECOND, opensAfterPrevious: "yes" }])).toContain("ticketTypes[1].opensAfterPrevious");
    expect(await create([FIRST, { ...SECOND, opensAfterPrevious: null }])).toContain("ticketTypes[1].opensAfterPrevious");
    expect(await create([{ ...FIRST, opensAfterPrevious: false }, SECOND])).toBeNull();
  });

  it("a draft edit: absent keeps the stored setting, false clears it, and a tier moved to the top loses it", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: RELEASES });
    const edit = (ticketTypes: unknown[]) =>
      api.call(updateEventDraft, {
        token: organiser.token,
        params: { eventId: draft.eventId },
        body: eventInput({ ticketTypes }),
        method: "PATCH",
      });

    // A client that predates the setting sends none: stored values stay.
    let res = await edit([FIRST, SECOND, THIRD]);
    expect(res.status).toBe(200);
    expect((await tiers(draft.eventId)).map((t) => t.opens_after_previous)).toEqual([false, true, true]);

    res = await edit([FIRST, { ...SECOND, opensAfterPrevious: false }, THIRD]);
    expect(res.status).toBe(200);
    expect((await tiers(draft.eventId)).map((t) => t.opens_after_previous)).toEqual([false, false, true]);
    expect(res.body.ticketTypes.map((t: { opensAfterPrevious?: boolean }) => t.opensAfterPrevious)).toEqual([undefined, undefined, true]);

    // The waiting "final" moves to the top: nothing above it, so the database clears it.
    res = await edit([THIRD, FIRST, SECOND]);
    expect(res.status).toBe(200);
    expect((await tiers(draft.eventId)).map((t) => [t.id, t.opens_after_previous])).toEqual([
      ["final", false],
      ["early", false],
      ["second", false],
    ]);
  });

  it("400 for a seated tier (fieldErrors name the tier); the database constraints hold whatever else got through", async () => {
    const seated = await seatedEvent(api, organiser, admin, { publish: false });
    const res = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId: seated.event.eventId },
      body: eventInput({
        ticketTypes: [
          { id: "prem", name: "Premium", priceCents: 5000, feePolicy: "buyer-pays", quantityAvailable: 1 },
          { id: "std", name: "Standard", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 1, opensAfterPrevious: true },
          { id: "ga", name: "Standing", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 },
        ],
      }),
      method: "PATCH",
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["ticketTypes[1].opensAfterPrevious"]);

    const bad = (sql: string, params: unknown[]) =>
      api.db.query(sql, params).then(
        () => null,
        (err) => [pgErrorCode(err), pgConstraint(err)],
      );
    expect(await bad(`update public.ticket_types set opens_after_previous = true where event_id = $1 and id = 'std'`, [seated.event.eventId])).toEqual([
      "23514",
      "ticket_types_lock_ga_only",
    ]);
    expect(await bad(`update public.ticket_types set opens_after_previous = true where event_id = $1 and id = 'early'`, [event.eventId])).toEqual([
      "23514",
      "ticket_types_lock_not_first",
    ]);
  });

  it("a seat map can't put seats on a waiting tier (400, nothing saved)", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: [FIRST, { ...SECOND, opensAfterPrevious: true }] });
    const res = await api.call(putSeatMap, {
      token: organiser.token,
      params: { eventId: draft.eventId },
      method: "PUT",
      body: { template: gridTemplate([{ label: "A", tier: "second", seats: 2 }]) },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["template.sections[0].rows[0].seats[0].ticketTypeId", "template.sections[0].rows[0].seats[1].ticketTypeId"]);
    const ok = await api.call(putSeatMap, {
      token: organiser.token,
      params: { eventId: draft.eventId },
      method: "PUT",
      body: { template: gridTemplate([{ label: "A", tier: "early", seats: 2 }]) },
    });
    expect(ok.status).toBe(200);
  });

  it("an admin's edit: a flag-only change is an edit (logged), absent keeps it, a stale edit is refused", async () => {
    const asAdmin = (current: AdminEventRecord | EventRecord, ticketTypes: unknown[]) =>
      api.call(adminUpdateEvent, {
        token: admin.token,
        params: { eventId: event.eventId },
        method: "PATCH",
        body: { ...eventInput({ ticketTypes }), ticketingMode: "sheltuh", expectedUpdatedAt: current.updatedAt },
      });

    // No change at all (the setting as stored, sent back or left out): nothing logged.
    const same = await asAdmin(event, [FIRST, SECOND, THIRD]);
    expect(same.status).toBe(200);
    expect(same.body.moderationLog.filter((e: { action: string }) => e.action === "edited")).toHaveLength(0);
    expect((await tiers()).map((t) => t.opens_after_previous)).toEqual([false, true, true]);

    // Titles etc. in eventInput are the event's own; only the flag differs.
    const cleared = await asAdmin(same.body, [FIRST, { ...SECOND, opensAfterPrevious: false }, THIRD]);
    expect(cleared.status).toBe(200);
    expect((await tiers()).map((t) => t.opens_after_previous)).toEqual([false, false, true]);
    const [entry] = (await logEntries()).slice(-1);
    expect(entry.actor_id).toBe(admin.userId);
    expect(entry.details.ticketTypes.old).toEqual([
      expect.objectContaining({ id: "early" }),
      expect.objectContaining({ id: "second", opensAfterPrevious: true }),
      expect.objectContaining({ id: "final", opensAfterPrevious: true }),
    ]);
    expect(entry.details.ticketTypes.new[1]).not.toHaveProperty("opensAfterPrevious");
    expect(entry.details.ticketTypes.new[2]).toHaveProperty("opensAfterPrevious", true);

    const stale = await asAdmin(event, [FIRST, { ...SECOND, opensAfterPrevious: true }, THIRD]);
    expect(stale.status).toBe(409);
  });
});

describe("buying a waiting tier", () => {
  it("a paid checkout is refused (409 ticket_locked, naming the tier above) and nothing is written", async () => {
    stripeSessions();
    const res = await buy("second");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(TICKET_LOCKED_CODE);
    expect(res.body.error).toBe('"Second release" opens when "Early bird" sells out.');
    expect(await api.db.query(`select 1 from public.orders`)).toEqual([]);
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();

    // A basket mixing an open tier with a waiting one is refused whole.
    const mixed = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "early", quantity: 1 }, { ticketTypeId: "final", quantity: 1 }] },
    });
    expect(mixed.status).toBe(409);
    expect(mixed.body.error).toBe('"Final release" opens when "Second release" sells out.');
    // The open tier alone is fine.
    expect((await buy("early")).status).toBe(201);
  });

  it("opens once the tier above is sold out, and the next one still waits for it", async () => {
    stripeSessions();
    await sellOut("early");
    expect((await buy("early")).status).toBe(409);
    expect((await buy("second", 2)).status).toBe(201);
    const third = await buy("final");
    expect(third.status).toBe(409);
    expect(third.body.code).toBe(TICKET_LOCKED_CODE);
  });

  it("a pending (abandoned) checkout never opens the next tier", async () => {
    stripeSessions();
    expect((await buy("early", 2)).status).toBe(201);
    expect((await buy("second")).status).toBe(409);
  });

  it("free tickets: a member's and a guest's order are refused too, and the free count is untouched", async () => {
    const free = await publishedEvent(api, organiser, admin, {
      ticketTypes: [
        { id: "a", name: "Round one", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 3 },
        { id: "b", name: "Round two", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 3, opensAfterPrevious: true },
      ],
    });
    const member = await api.signUp({ email: "fan@example.com" });
    const params = { eventId: free.eventId };
    const asMember = await api.call(createCheckout, {
      token: member.token,
      params,
      body: { lineItems: [{ ticketTypeId: "b", quantity: 1 }], buyerEmail: "fan@example.com" },
    });
    expect(asMember.status).toBe(409);
    expect(asMember.body.code).toBe(TICKET_LOCKED_CODE);
    const asGuest = await api.call(createCheckout, {
      params,
      body: { lineItems: [{ ticketTypeId: "b", quantity: 1 }], buyerEmail: "guest@example.com" },
    });
    expect(asGuest.status).toBe(409);
    expect(await api.db.query(`select 1 from public.orders`)).toEqual([]);
    expect((await api.call(createCheckout, {
      token: member.token,
      params,
      body: { lineItems: [{ ticketTypeId: "a", quantity: 1 }], buyerEmail: "fan@example.com" },
    })).status).toBe(201);

    await sellOut("a", free.eventId);
    expect((await api.call(createCheckout, {
      token: member.token,
      params,
      body: { lineItems: [{ ticketTypeId: "b", quantity: 1 }], buyerEmail: "fan@example.com" },
    })).status).toBe(201);
  });

  it("seated checkout: a general admission line of a waiting tier is refused (hold_seats never runs)", async () => {
    const seated = await seatedEvent(api, organiser, admin);
    // "ga" is the third tier; "std" above it is seated and not sold out.
    const set = await api.call(setTicketLock, {
      token: organiser.token,
      params: { eventId: seated.event.eventId, ticketTypeId: "ga" },
      body: { opensAfterPrevious: true },
      method: "PUT",
    });
    expect(set.status).toBe(200);
    expect(set.body.opensAfter).toEqual({ ticketTypeId: "std", name: "Standard" });
    const res = await api.call(createCheckout, {
      params: { eventId: seated.event.eventId },
      body: {
        lineItems: [{ ticketTypeId: "ga", quantity: 1 }],
        seats: { mapVersion: seated.map.version, seatIds: ["A1"] },
      },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(TICKET_LOCKED_CODE);
    expect(await api.db.query(`select 1 from public.orders`)).toEqual([]);
  });

  it("the database refuses the order itself (a toggle racing the checkout): orders_tiers_open", async () => {
    const insert = (ticketTypeId: string) =>
      api.db.query(
        `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
           buyer_fee_cents, total_cents, application_fee_cents)
         values ($1, $2, $3, 'Test', $4::text::jsonb, 0, 0, 0, 0)`,
        [
          `ord_${crypto.randomUUID().replace(/-/g, "")}`,
          event.eventId,
          organiser.organiserId,
          JSON.stringify([{ ticketTypeId, ticketTypeName: "x", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 1 }]),
        ],
      );
    await expect(insert("second")).rejects.toSatisfy((err) => pgConstraint(err) === "orders_tiers_open" && pgErrorCode(err) === "23514");
    await insert("early");
    await sellOut("early");
    await insert("second");
  });

  it("an order made before the tier was locked still fulfils", async () => {
    stripeSessions();
    const placed = await buy("second");
    expect(placed.status).toBe(409);
    // Unlock, buy, lock again, then pay: the order exists, so it's fulfilled.
    expect((await toggle(false)).status).toBe(200);
    const order = await buy("second");
    expect(order.status).toBe(201);
    expect((await toggle(true)).status).toBe(200);
    const [row] = await api.db.query<{ status: string }>(
      `select private.fulfil_order($1, 'buyer@example.com', 'pi_lock', $2::text::jsonb)::text as status`,
      [order.body.orderId, JSON.stringify([{ ticketCode: "LK01-AAAA", ticketTypeId: "second", ticketTypeName: "Second release" }])],
    );
    expect(row.status).toBe("paid");
    expect((await tiers()).find((t) => t.id === "second")?.sold).toBe(1);
  });
});

describe("sold_out_at", () => {
  it("is set when the last ticket sells, whichever way quantity_sold moves, and never cleared", async () => {
    expect((await tiers()).map((t) => t.sold_out)).toEqual([false, false, false]);
    await api.db.query(`update public.ticket_types set quantity_sold = 1 where event_id = $1 and id = 'early'`, [event.eventId]);
    expect((await tiers())[0].sold_out).toBe(false);
    await api.db.query(`update public.ticket_types set quantity_sold = 2 where event_id = $1 and id = 'early'`, [event.eventId]);
    expect((await tiers())[0].sold_out).toBe(true);
    // A refund gives a ticket back; more tickets are released: still opened.
    await api.db.query(`update public.ticket_types set quantity_sold = 0, quantity_available = 9 where event_id = $1 and id = 'early'`, [event.eventId]);
    expect((await tiers())[0].sold_out).toBe(true);
  });
});

describe("the organiser's toggle", () => {
  it("turns a tier on and off, logs it, bumps updated_at and answers with opensAfter while it waits", async () => {
    const off = await toggle(false);
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ eventId: event.eventId, ticketTypeId: "second", opensAfterPrevious: false });
    expect(off.headers.get("cache-control")).toMatch(/no-store/);
    const [before] = await api.db.query<{ updated_at: Date }>(`select updated_at from public.events where id = $1`, [event.eventId]);
    await new Promise((r) => setTimeout(r, 5));

    const on = await toggle(true);
    expect(on.status).toBe(200);
    expect(on.body).toEqual({
      eventId: event.eventId,
      ticketTypeId: "second",
      opensAfterPrevious: true,
      opensAfter: { ticketTypeId: "early", name: "Early bird" },
    });
    const [after] = await api.db.query<{ updated_at: Date }>(`select updated_at from public.events where id = $1`, [event.eventId]);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());

    const entries = (await logEntries()).slice(-2);
    expect(entries.map((e) => e.actor_id)).toEqual([organiser.userId, organiser.userId]);
    expect(entries[0].details.ticketTypes.old).toEqual([
      { id: "second", name: "Second release", quantityAvailable: 3, opensAfterPrevious: true },
    ]);
    expect(entries[0].details.ticketTypes.new).toEqual([{ id: "second", name: "Second release", quantityAvailable: 3 }]);
    expect(entries[1].details.ticketTypes.new).toEqual([
      { id: "second", name: "Second release", quantityAvailable: 3, opensAfterPrevious: true },
    ]);
    // It shows in the organiser's record (by their own account).
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(mine.body.moderationLog.at(-1)).toMatchObject({ action: "edited", by: organiser.userId });
  });

  it("asking for the current value is a 200 that writes nothing and uses no allowance", async () => {
    const before = (await logEntries()).length;
    for (let i = 0; i < EVENT_LOCK_LIMIT.limit + 3; i += 1) {
      const res = await toggle(true);
      expect(res.status).toBe(200);
      expect(res.body.opensAfter).toEqual({ ticketTypeId: "early", name: "Early bird" });
    }
    expect((await logEntries()).length).toBe(before);
    // Off again for a tier that isn't on: the same.
    const off = await toggle(false, { ticketTypeId: "early" });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ eventId: event.eventId, ticketTypeId: "early", opensAfterPrevious: false });
  });

  it("is allowed on a tier that already has sales, and opensAfter goes once the tier above has sold out", async () => {
    await api.db.query(`update public.ticket_types set quantity_sold = 1 where event_id = $1 and id = 'early'`, [event.eventId]);
    await toggle(false, { ticketTypeId: "final" });
    await api.db.query(`update public.ticket_types set quantity_sold = 1 where event_id = $1 and id = 'final'`, [event.eventId]);
    const on = await toggle(true, { ticketTypeId: "final" });
    expect(on.status).toBe(200);
    expect(on.body.opensAfter).toEqual({ ticketTypeId: "second", name: "Second release" });

    await sellOut("early");
    const second = await toggle(true);
    expect(second.status).toBe(200);
    expect(second.body.opensAfterPrevious).toBe(true);
    expect(second.body).not.toHaveProperty("opensAfter");
  });

  it("400 for the first tier and for anything but a boolean", async () => {
    const first = await toggle(true, { ticketTypeId: "early" });
    expect(first.status).toBe(400);
    expect(first.body.fieldErrors).toHaveProperty("opensAfterPrevious");
    for (const bad of ["true", 1, null, undefined]) {
      const res = await toggle(bad);
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toHaveProperty("opensAfterPrevious");
    }
    expect((await tiers())[0].opens_after_previous).toBe(false);
  });

  it("401 signed out; 403 for a member with no approved organiser; another organiser's event and unknown ids are 404", async () => {
    expect((await toggle(false, { token: null })).status).toBe(401);
    const member = await api.signUp({});
    expect((await toggle(false, { token: member.token })).status).toBe(403);
    const other = await approvedOrganiser(api, admin, { displayName: "Other Co", contactEmail: "o@example.com" });
    expect((await toggle(false, { token: other.token })).status).toBe(404);
    expect((await toggle(false, { eventId: crypto.randomUUID() })).status).toBe(404);
    expect((await toggle(false, { eventId: "not-a-uuid" })).status).toBe(404);
    expect((await toggle(false, { ticketTypeId: "nope" })).status).toBe(404);
    expect((await tiers()).map((t) => t.opens_after_previous)).toEqual([false, true, true]);
    expect(await logEntries()).toEqual([]);
  });

  it("403 once the organiser is no longer approved; the function also refuses a stranger and a missing limit", async () => {
    await api.db.query(`update public.organisers set status = 'pending' where id = $1`, [organiser.organiserId]);
    expect((await toggle(false)).status).toBe(403);
    const call = (actor: string | null, limit: number | null = 30) =>
      api.db.query<{ result: string }>(
        `select result from private.set_ticket_lock($1, $2, $3, 'second', false, $4, interval '1 hour', 10, interval '24 hours')`,
        [event.eventId, organiser.organiserId, actor, limit],
      );
    expect((await call(organiser.userId))[0].result).toBe("not_approved");
    expect((await call(crypto.randomUUID()))[0].result).toBe("not_found");
    expect((await call(null))[0].result).toBe("not_found");
    await expect(call(organiser.userId, null)).rejects.toThrow(/missing/);
    expect((await tiers())[1].opens_after_previous).toBe(true);
  });

  it("409 for a draft, an ended event, external ticketing and a seated tier", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: [FIRST, SECOND] });
    const asDraft = await toggle(true, { eventId: draft.eventId });
    expect(asDraft.status).toBe(409);
    expect((await tiers(draft.eventId))[1].opens_after_previous).toBe(false);

    const seated = await seatedEvent(api, organiser, admin);
    const onSeated = await toggle(true, { eventId: seated.event.eventId, ticketTypeId: "std" });
    expect(onSeated.status).toBe(409);
    expect(onSeated.body.error).toMatch(/seat/i);
    // Switching a seated tier off, which it already is, is a plain 200.
    expect((await toggle(false, { eventId: seated.event.eventId, ticketTypeId: "std" })).status).toBe(200);

    await api.db.query(
      `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = $1`,
      [event.eventId],
    );
    const ended = await toggle(false);
    expect(ended.status).toBe(409);
    expect(ended.body.error).toBe("This event has ended.");
    expect((await tiers())[1].opens_after_previous).toBe(true);
  });

  it("an external event has no ticket types to toggle (the function says external when it has been switched)", async () => {
    // External events have no ticket types (a trigger), so this reaches the function's own check directly.
    await api.db.query(`delete from public.ticket_types where event_id = $1`, [event.eventId]);
    await api.db.query(`update public.events set ticketing_mode = 'external', external_ticket_url = 'https://events.humanitix.com/x' where id = $1`, [event.eventId]);
    const [row] = await api.db.query<{ result: string }>(
      `select result from private.set_ticket_lock($1, $2, $3, 'second', true, 30, interval '1 hour', 10, interval '24 hours')`,
      [event.eventId, organiser.organiserId, organiser.userId],
    );
    expect(row.result).toBe("external");
  });

  it("429 past the event's daily allowance, which a refusal doesn't grow and a no-change doesn't need", async () => {
    for (let i = 0; i < EVENT_LOCK_LIMIT.limit; i += 1) {
      expect((await toggle(i % 2 === 0 ? false : true)).status).toBe(200);
    }
    const blocked = await toggle(false);
    expect(blocked.status).toBe(429);
    expect((await logEntries()).length).toBe(EVENT_LOCK_LIMIT.limit);
    // A no-change is still answered.
    expect((await toggle(true)).status).toBe(200);
  });

  it("429 past the organiser's hourly allowance, across events, leaving the tier as it was", async () => {
    const other = await publishedEvent(api, organiser, admin, { ticketTypes: RELEASES });
    const lock = (flag: boolean, id = other.eventId) =>
      api.db.query<{ result: string }>(
        `select result from private.set_ticket_lock($1, $2, $3, 'second', $4, 1, interval '1 hour', 10, interval '24 hours')`,
        [id, organiser.organiserId, organiser.userId, flag],
      );
    expect((await lock(false))[0].result).toBe("set");
    expect((await lock(false))[0].result).toBe("unchanged");
    expect((await lock(true))[0].result).toBe("rate_limited");
    expect((await tiers(other.eventId))[1].opens_after_previous).toBe(false);
  });
});

// Two sessions at once: only a real server (PGlite is one connection).
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

  const lockOn = (conn: postgres.Sql, flag: boolean) =>
    conn.unsafe(
      `select result, locked from private.set_ticket_lock($1, $2, $3, 'second', $4, 30, interval '1 hour', 10, interval '24 hours')`,
      [event.eventId, organiser.organiserId, organiser.userId, flag],
    );

  const insertOrder = (conn: postgres.Sql, ticketTypeId: string) =>
    conn.unsafe(
      `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
         buyer_fee_cents, total_cents, application_fee_cents)
       values ($1, $2, $3, 'Test', $4::text::jsonb, 0, 0, 0, 0)`,
      [
        `ord_${crypto.randomUUID().replace(/-/g, "")}`,
        event.eventId,
        organiser.organiserId,
        JSON.stringify([{ ticketTypeId, ticketTypeName: "x", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 1 }]),
      ],
    );

  it("two toggles at once: one changes it, the other waits and then finds it unchanged (one log entry)", async () => {
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await lockOn(one, false))[0]).toMatchObject({ result: "set", locked: false });
      const blocked = await waitUntilBlocked(two);
      const pending = lockOn(two, false).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("unchanged");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await logEntries()).toHaveLength(1);
    expect((await tiers())[1].opens_after_previous).toBe(false);
  });

  it("the last ticket of the tier above, still uncommitted, doesn't open the next tier; once committed it does", async () => {
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      await one.unsafe(`update public.ticket_types set quantity_sold = quantity_available where event_id = $1 and id = 'early'`, [event.eventId]);
      // Not committed: the second connection still sees the first tier on sale.
      await expect(insertOrder(two, "second")).rejects.toSatisfy((err) => pgConstraint(err) === "orders_tiers_open");
      await one.unsafe("commit");
      await insertOrder(two, "second");
    } finally {
      await one.end();
      await two.end();
    }
    const rows = await api.db.query<{ n: number }>(`select count(*)::int as n from public.orders`);
    expect(rows[0].n).toBe(1);
  });
});
