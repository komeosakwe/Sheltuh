import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgConstraint } from "@/lib/server/db";
import { adminApproveOrganiser } from "@/lib/server/handlers/admin";
import { adminCreateEvent, adminCreateOrganiser } from "@/lib/server/handlers/admin-authoring";
import { getEventAnalytics } from "@/lib/server/handlers/analytics";
import { CHECK_IN_LIMIT, checkInTicket, getCheckInSummary, undoCheckIn } from "@/lib/server/handlers/check-ins";
import { createCheckout, getOrderBySession, stripeWebhook } from "@/lib/server/handlers/orders";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import { runHandler } from "@/lib/server/route";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { application, approvedOrganiser, enablePayouts, eventInput, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// Ticket check-in: lib/server/handlers/check-ins.ts,
// supabase/migrations/20261021000000_ticket_check_in.sql and 20261021130000_check_in_followups.sql.

type Organiser = { token: string; userId: string; organiserId: string };

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: Organiser;
let event: EventRecord;

const TICKETS = [
  { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 2 },
];

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  serverUrl = testDb.url;
  api = new TestApi(testDb.db);
});

let sessions = 0;
let intents = 0;

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, { ticketTypes: TICKETS });
  await enablePayouts(api, organiser.organiserId);
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    const id = `cs_test_${++sessions}`;
    return embeddedSession(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A paid order (checkout, then Stripe's webhook), its payment intent, and its codes in the ticket email's order. */
async function paidOrder(eventId: string, lineItems: { ticketTypeId: string; quantity: number }[]) {
  const res = await api.call(createCheckout, { params: { eventId }, body: { lineItems } });
  expect(res.status).toBe(201);
  const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
  const paymentIntent = `pi_test_${++intents}`;
  const paid = await api.send(
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
  expect(paid.status).toBe(200);
  const page = await api.call(getOrderBySession, { params: { sessionId: orderId } });
  const tickets = page.body.tickets as { ticketCode: string; ticketTypeName: string }[];
  return { orderId, paymentIntent, tickets, codes: tickets.map((t) => t.ticketCode) };
}

/** Stripe's charge.refunded for a full refund. */
async function refundInFull(paymentIntent: string, amount: number) {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const res = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "charge.refunded",
      data: { object: { id: "ch_test", object: "charge", payment_intent: paymentIntent, amount_refunded: amount, refunded: true } },
    }),
  );
  expect(res.status).toBe(200);
}

const scan = (token: string | undefined, code: unknown, requestId: unknown = crypto.randomUUID(), eventId = event.eventId) =>
  api.call(checkInTicket, { token, params: { eventId }, body: { code, requestId } });

const undo = (token: string | undefined, checkInId: string, reason: unknown = "Scanned the wrong ticket", eventId = event.eventId) =>
  api.call(undoCheckIn, { token, params: { eventId, checkInId }, body: { reason } });

const summary = (token: string | undefined, eventId = event.eventId) =>
  api.call(getCheckInSummary, { token, params: { eventId } });

/** The raw response body, for byte-for-byte comparisons. */
async function rawScan(token: string, code: string) {
  const req = new Request(`${SITE_URL}/api/test`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ code, requestId: crypto.randomUUID() }),
  });
  const res = await runHandler(checkInTicket, req, { eventId: event.eventId }, api.deps);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

async function log(eventId = event.eventId) {
  return api.db.query<{ id: string; result: string; ticket_code: string | null; actor_user_id: string | null; reason: string | null }>(
    `select id::text as id, result, ticket_code, actor_user_id, reason from public.ticket_check_ins where event_id = $1 order by id`,
    [eventId],
  );
}

/** The log's public ids (what the API calls checkInId), oldest first. */
async function publicIds(eventId = event.eventId) {
  const rows = await api.db.query<{ public_id: string; result: string }>(
    `select public_id::text as public_id, result from public.ticket_check_ins where event_id = $1 order by id`,
    [eventId],
  );
  return rows;
}

async function checkedInAt(code: string): Promise<Date | null> {
  const [row] = await api.db.query<{ checked_in_at: Date | string | null }>(
    `select checked_in_at from public.tickets where code = $1`,
    [code],
  );
  return row.checked_in_at ? new Date(row.checked_in_at) : null;
}

async function anotherOrganiser() {
  const other = await approvedOrganiser(api, admin, { displayName: "Other Collective" });
  const otherEvent = await publishedEvent(api, other, admin, { title: "Their Night", ticketTypes: TICKETS });
  await api.db.query(`update public.organisers set stripe_account_id = 'acct_test_2', payouts_enabled = true where id = $1`, [
    other.organiserId,
  ]);
  return { other, otherEvent };
}

/** A well-formed code no ticket has. */
const UNKNOWN_CODE = "ZZZZ-2222";

/** Check-in ids are random uuids (the log's public_id), never its sequential key. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

describe("who can check in", () => {
  it("only the approved organiser who owns the event: 401 signed out, 403 without an approved organiser, 404 anyone else's (an admin's too)", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const member = await api.signUp();
    const pending = await api.signUp();
    await api.call(applyAsOrganiser, { token: pending.token, body: application });
    const { other } = await anotherOrganiser();

    expect((await scan(undefined, codes[0])).status).toBe(401);
    expect((await scan(member.token, codes[0])).status).toBe(403);
    expect((await scan(admin.token, codes[0])).status).toBe(404); // admins only for platform-managed organisers' events
    expect((await scan(pending.token, codes[0])).status).toBe(403);
    expect((await scan(other.token, codes[0])).status).toBe(404);
    expect((await scan(organiser.token, codes[0], crypto.randomUUID(), "not-a-uuid")).status).toBe(404);
    expect((await scan(organiser.token, codes[0], crypto.randomUUID(), crypto.randomUUID())).status).toBe(404);

    for (const token of [undefined, member.token, admin.token, other.token]) {
      const status = (await summary(token)).status;
      expect(status).toBe(token === undefined ? 401 : token === other.token || token === admin.token ? 404 : 403);
    }

    // Nothing was logged, marked or counted against anyone.
    expect(await log()).toEqual([]);
    expect(await checkedInAt(codes[0])).toBeNull();
    expect(await api.db.query(`select user_id from private.rate_limits where bucket = 'check_in'`)).toEqual([]);

    const own = await scan(organiser.token, codes[0]);
    expect(own.status).toBe(200);
    expect(own.body.outcome).toBe("admitted");
  });

  it("undo follows the same rules", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const admitted = await scan(organiser.token, codes[0]);
    const { checkInId } = admitted.body;
    const { other, otherEvent } = await anotherOrganiser();

    expect((await undo(undefined, checkInId)).status).toBe(401);
    expect((await undo(admin.token, checkInId)).status).toBe(404);
    expect((await undo(other.token, checkInId)).status).toBe(404);
    // Their own event id doesn't reach someone else's check-in either.
    expect((await undo(other.token, checkInId, "Scanned the wrong ticket", otherEvent.eventId)).status).toBe(404);
    expect(await checkedInAt(codes[0])).not.toBeNull();
    expect((await log()).map((r) => r.result)).toEqual(["admitted"]);
  });
});

// ---------------------------------------------------------------------------
// Admins at the door: platform-managed organisers' events only (owner
// decision, docs/FEATURE_PLAN.md; 20261023000100_review_hardening.sql)
// ---------------------------------------------------------------------------

const FREE_TICKETS = [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }];

/** A new platform-managed organiser (no owner account), made by the admin. */
async function platformOrganiser(): Promise<string> {
  const res = await api.call(adminCreateOrganiser, {
    token: admin.token,
    body: { ...application, displayName: "Sheltüh Presents", contactEmail: "events@sheltuh.example" },
  });
  expect(res.status).toBe(201);
  return res.body.organiserId as string;
}

/** A published event of the platform-managed organiser, and a member's free order of `quantity` tickets for it. */
async function platformEventWithTickets(quantity = 1, overrides: Record<string, unknown> = {}) {
  const organiserId = await platformOrganiser();
  const created = await api.call(adminCreateEvent, {
    token: admin.token,
    body: { ...eventInput({ title: "Sheltüh Presents: Late Night", ticketTypes: FREE_TICKETS, ...overrides }), organiserId, publish: true },
  });
  expect(created.status).toBe(201);
  const eventId = created.body.eventId as string;
  const member = await api.signUp();
  const booked = await api.call(createCheckout, {
    token: member.token,
    params: { eventId },
    body: { lineItems: [{ ticketTypeId: "free", quantity }], buyerEmail: member.email },
  });
  expect(booked.status).toBe(201);
  const orderId = new URL(booked.body.url).searchParams.get("session_id")!;
  const page = await api.call(getOrderBySession, { params: { sessionId: orderId } });
  return { eventId, organiserId, codes: (page.body.tickets as { ticketCode: string }[]).map((t) => t.ticketCode) };
}

describe("admins at the door of a platform-managed organiser's event", () => {
  it("an admin checks in, sees the summary and undoes, recorded as the scanner, on their own allowance", async () => {
    const platform = await platformEventWithTickets(2);

    const admitted = await scan(admin.token, platform.codes[0], crypto.randomUUID(), platform.eventId);
    expect(admitted.status).toBe(200);
    expect(admitted.headers.get("cache-control")).toBe("private, no-store");
    expect(admitted.body).toMatchObject({
      outcome: "admitted",
      checkInId: expect.stringMatching(UUID),
      ticket: { ticketTypeName: "Free entry", ticketNumber: 1, ticketCount: 2, codeLast4: platform.codes[0].slice(-4) },
    });
    const again = await scan(admin.token, platform.codes[0], crypto.randomUUID(), platform.eventId);
    expect(again.body).toMatchObject({ outcome: "already_checked_in", checkInId: admitted.body.checkInId });
    expect((await scan(admin.token, UNKNOWN_CODE, crypto.randomUUID(), platform.eventId)).body).toEqual({ outcome: "invalid" });

    const counts = await summary(admin.token, platform.eventId);
    expect(counts.status).toBe(200);
    expect(counts.headers.get("cache-control")).toBe("private, no-store");
    expect(counts.body).toMatchObject({ checkedIn: 1, ticketsSold: 2, capacity: 50 });
    expect(counts.body.recent.map((r: { result: string }) => r.result)).toEqual(["invalid", "already_checked_in", "admitted"]);

    const undone = await undo(admin.token, admitted.body.checkInId, "Scanned the wrong ticket", platform.eventId);
    expect(undone.status).toBe(200);
    expect(undone.body.outcome).toBe("undone");
    expect(await checkedInAt(platform.codes[0])).toBeNull();

    // The admin is the acting account on every row (the audit), and the allowance is theirs.
    const rows = await log(platform.eventId);
    expect(rows.map((r) => [r.result, r.actor_user_id])).toEqual([
      ["admitted", admin.userId],
      ["already_checked_in", admin.userId],
      ["invalid", admin.userId],
      ["undone", admin.userId],
    ]);
    expect(rows.at(-1)?.reason).toBe("Scanned the wrong ticket");
    expect(await api.db.query(`select user_id, hits from private.rate_limits where bucket = 'check_in'`)).toEqual([
      { user_id: admin.userId, hits: 4 },
    ]);
  });

  it("the authorisation matrix: admins only on platform-managed events, organisers only on their own", async () => {
    const platform = await platformEventWithTickets(1);
    const own = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const member = await api.signUp();

    // An organiser (or anyone else) on the platform event: 404 / 403 / 401, as for another organiser's event.
    expect((await scan(organiser.token, platform.codes[0], crypto.randomUUID(), platform.eventId)).status).toBe(404);
    expect((await summary(organiser.token, platform.eventId)).status).toBe(404);
    expect((await scan(member.token, platform.codes[0], crypto.randomUUID(), platform.eventId)).status).toBe(403);
    expect((await scan(undefined, platform.codes[0], crypto.randomUUID(), platform.eventId)).status).toBe(401);
    // An admin on an organiser's event, even holding its ticket, or on an event that doesn't exist: 404.
    expect((await scan(admin.token, own.codes[0])).status).toBe(404);
    expect((await summary(admin.token)).status).toBe(404);
    expect((await scan(admin.token, own.codes[0], crypto.randomUUID(), crypto.randomUUID())).status).toBe(404);
    expect((await scan(admin.token, own.codes[0], crypto.randomUUID(), "not-a-uuid")).status).toBe(404);
    // The organiser's ticket scanned at the platform event by an admin: just invalid (another organiser's).
    expect((await scan(admin.token, own.codes[0], crypto.randomUUID(), platform.eventId)).body).toEqual({ outcome: "invalid" });

    // Nothing else was logged, marked or counted.
    expect(await log()).toEqual([]);
    expect((await log(platform.eventId)).map((r) => r.result)).toEqual(["invalid"]);
    expect(await checkedInAt(own.codes[0])).toBeNull();
    expect(await checkedInAt(platform.codes[0])).toBeNull();
    expect(await api.db.query(`select user_id from private.rate_limits where bucket = 'check_in'`)).toEqual([
      { user_id: admin.userId },
    ]);
  });

  it("an admin who also owns an approved organiser checks in for its events as usual", async () => {
    const adminOrganiser = await api.signUp({ admin: true });
    const applied = await api.call(applyAsOrganiser, { token: adminOrganiser.token, body: { ...application, displayName: "Admin's Collective" } });
    await api.call(adminApproveOrganiser, { token: admin.token, params: { organiserId: applied.body.organiserId }, method: "POST" });
    const theirs = await publishedEvent(api, adminOrganiser, admin, { title: "Their Own Night", ticketTypes: FREE_TICKETS });
    const res = await scan(adminOrganiser.token, UNKNOWN_CODE, crypto.randomUUID(), theirs.eventId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: "invalid" });
    // But not another organiser's.
    expect((await scan(adminOrganiser.token, UNKNOWN_CODE)).status).toBe(404);
  });

  it("an external event of a platform-managed organiser has no check-in: 409, nothing logged or counted", async () => {
    const organiserId = await platformOrganiser();
    const created = await api.call(adminCreateEvent, {
      token: admin.token,
      body: {
        ...eventInput({ ticketTypes: [] }),
        ticketingMode: "external",
        externalTicketUrl: "https://events.humanitix.com/late-night",
        organiserId,
        publish: true,
      },
    });
    expect(created.status).toBe(201);
    const eventId = created.body.eventId as string;
    expect((await scan(admin.token, UNKNOWN_CODE, crypto.randomUUID(), eventId)).status).toBe(409);
    expect((await summary(admin.token, eventId)).status).toBe(409);
    expect((await undo(admin.token, crypto.randomUUID(), "Scanned the wrong ticket", eventId)).status).toBe(409);
    expect(await log(eventId)).toEqual([]);
  });

  it("the database refuses a check-in row by anyone but an admin for a platform-managed event, and by an admin for an organiser's", async () => {
    const platform = await platformEventWithTickets(1);
    const own = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const refusal = async (work: Promise<unknown>) => {
      try {
        await work;
      } catch (err) {
        return { code: (err as { code?: string }).code, constraint: pgConstraint(err) };
      }
      throw new Error("expected the database to refuse it");
    };
    const actorRefused = { code: "23514", constraint: "ticket_check_ins_actor_allowed" };
    const insert = (eventId: string, actorId: string) =>
      api.db.query(
        `insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result)
         values ($1, null, $2, gen_random_uuid(), 'invalid')`,
        [eventId, actorId],
      );
    // Straight inserts.
    expect(await refusal(insert(platform.eventId, organiser.userId))).toEqual(actorRefused);
    expect(await refusal(insert(event.eventId, admin.userId))).toEqual(actorRefused);
    // The functions, called as a buggy API might: nothing admitted, nothing counted (the call rolls back).
    expect(
      await refusal(
        api.db.query(`select * from private.check_in_ticket($1, $2, $3, $4, gen_random_uuid(), 600, '5 minutes')`, [
          event.eventId,
          organiser.organiserId,
          admin.userId,
          own.codes[0],
        ]),
      ),
    ).toEqual(actorRefused);
    expect(
      await refusal(
        api.db.query(`select * from private.check_in_ticket($1, $2, $3, $4, gen_random_uuid(), 600, '5 minutes')`, [
          platform.eventId,
          platform.organiserId,
          organiser.userId,
          platform.codes[0],
        ]),
      ),
    ).toEqual(actorRefused);
    expect(await checkedInAt(own.codes[0])).toBeNull();
    expect(await checkedInAt(platform.codes[0])).toBeNull();
    expect(await api.db.query(`select 1 from public.ticket_check_ins`)).toEqual([]);
    expect(await api.db.query(`select 1 from private.rate_limits where bucket = 'check_in'`)).toEqual([]);
    // The owner, any non-admin account on an organiser's event (future door staff), and an admin on a platform one: fine.
    const staff = await api.signUp();
    await insert(event.eventId, organiser.userId);
    await insert(event.eventId, staff.userId);
    await insert(platform.eventId, admin.userId);
  });
});

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

describe("checking a ticket in", () => {
  it("admits a paid ticket once, then says when it was first checked in", async () => {
    const { codes, tickets } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const first = await scan(organiser.token, codes[0]);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.body).toEqual({
      outcome: "admitted",
      checkInId: expect.stringMatching(UUID),
      ticket: { ticketTypeName: tickets[0].ticketTypeName, ticketNumber: 1, ticketCount: 1, codeLast4: codes[0].slice(-4) },
      checkedInAt: expect.any(String),
    });
    const at = await checkedInAt(codes[0]);
    expect(at?.toISOString()).toBe(first.body.checkedInAt);

    const again = await scan(organiser.token, codes[0]);
    expect(again.status).toBe(200);
    // The refusal carries the current admission's id, so the door can undo it from there.
    expect(again.body).toEqual({
      outcome: "already_checked_in",
      checkInId: first.body.checkInId,
      ticket: first.body.ticket,
      checkedInAt: first.body.checkedInAt,
    });
    // Re-entry didn't move the first time.
    expect((await checkedInAt(codes[0]))?.toISOString()).toBe(first.body.checkedInAt);

    expect(await log()).toEqual([
      { id: expect.any(String), result: "admitted", ticket_code: codes[0], actor_user_id: organiser.userId, reason: null },
      { id: expect.any(String), result: "already_checked_in", ticket_code: codes[0], actor_user_id: organiser.userId, reason: null },
    ]);
  });

  it("accepts the QR form and typed variants: SH1: prefix, any case, surrounding whitespace", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 3 }]);
    expect((await scan(organiser.token, `SH1:${codes[0]}`)).body.outcome).toBe("admitted");
    expect((await scan(organiser.token, `  sh1:${codes[1].toLowerCase()}\n`)).body.outcome).toBe("admitted");
    expect((await scan(organiser.token, ` ${codes[2].toLowerCase()} `)).body.outcome).toBe("admitted");
    expect((await log()).map((r) => r.ticket_code)).toEqual(codes);
  });

  it("numbers each ticket within its order the way the ticket email does", async () => {
    const { codes, tickets } = await paidOrder(event.eventId, [
      { ticketTypeId: "vip", quantity: 1 },
      { ticketTypeId: "ga", quantity: 2 },
    ]);
    // getOrderBySession lists tickets in the email's order (ticket type id, then code). Scanned in reverse.
    for (let index = codes.length - 1; index >= 0; index--) {
      const res = await scan(organiser.token, codes[index]);
      expect(res.body.ticket).toEqual({
        ticketTypeName: tickets[index].ticketTypeName,
        ticketNumber: index + 1,
        ticketCount: 3,
        codeLast4: codes[index].slice(-4),
      });
    }
    expect(tickets.map((t) => t.ticketTypeName)).toEqual(["General admission", "General admission", "VIP"]);
  });

  it("an unknown code, junk and another organiser's ticket get byte-identical responses, and nothing scanned is stored", async () => {
    const { otherEvent } = await anotherOrganiser();
    const theirs = await paidOrder(otherEvent.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);

    const responses = [
      await rawScan(organiser.token, UNKNOWN_CODE),
      await rawScan(organiser.token, theirs.codes[0]),
      await rawScan(organiser.token, `SH1:${theirs.codes[0]}`),
      await rawScan(organiser.token, "https://evil.example/?q=hello"),
      await rawScan(organiser.token, ""),
    ];
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.text).toBe('{"outcome":"invalid"}');
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }

    expect((await log()).map((r) => ({ result: r.result, code: r.ticket_code }))).toEqual(
      Array.from({ length: 5 }, () => ({ result: "invalid", code: null })),
    );
    const everything = JSON.stringify(await api.db.query(`select * from public.ticket_check_ins`));
    for (const scanned of [UNKNOWN_CODE, theirs.codes[0], "evil.example"]) expect(everything).not.toContain(scanned);
    // Their ticket wasn't touched.
    expect(await checkedInAt(theirs.codes[0])).toBeNull();
  });

  it("the same organiser's ticket for another of their events says which event, and isn't checked in", async () => {
    const second = await publishedEvent(api, organiser, admin, { title: "Second Night", ticketTypes: TICKETS });
    const { codes } = await paidOrder(second.eventId, [{ ticketTypeId: "vip", quantity: 1 }]);
    const res = await scan(organiser.token, codes[0]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      outcome: "other_event",
      otherEventTitle: "Second Night",
      ticket: { ticketTypeName: "VIP", ticketNumber: 1, ticketCount: 1, codeLast4: codes[0].slice(-4) },
    });
    expect(await checkedInAt(codes[0])).toBeNull();
    expect(await log()).toMatchObject([{ result: "other_event", ticket_code: codes[0] }]);
    // It still checks in at its own event.
    expect((await scan(organiser.token, codes[0], crypto.randomUUID(), second.eventId)).body.outcome).toBe("admitted");
  });

  it("a ticket refunded in Stripe (charge.refunded) is not admissible, before or after it was checked in", async () => {
    const refunded = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 2 }]);
    await scan(organiser.token, refunded.codes[1]); // in before the refund
    await refundInFull(refunded.paymentIntent, 6340);

    for (const code of refunded.codes) {
      const res = await scan(organiser.token, code);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        outcome: "not_admissible",
        ticket: expect.objectContaining({ ticketTypeName: "General admission", ticketCount: 2 }),
      });
    }
    expect(await checkedInAt(refunded.codes[0])).toBeNull();
    expect((await log()).map((r) => r.result)).toEqual(["admitted", "not_admissible", "not_admissible"]);
  });

  it("a partly refunded order's tickets still admit (the order stays paid)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const order = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 2 }]);
    await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "charge.refunded",
        data: { object: { id: "ch_p", object: "charge", payment_intent: order.paymentIntent, amount_refunded: 3170, refunded: false } },
      }),
    );
    expect((await scan(organiser.token, order.codes[0])).body.outcome).toBe("admitted");
  });

  it("never returns the buyer's email or name, or the order id", async () => {
    const { orderId, codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const bodies = [await scan(organiser.token, codes[0]), await scan(organiser.token, codes[0]), await summary(organiser.token)];
    for (const res of bodies) {
      const text = JSON.stringify(res.body);
      expect(text).not.toContain("buyer@example.com");
      expect(text).not.toContain(orderId);
    }
  });

  it("a malformed request is a 400 (or 413 if too large), and nothing is logged or counted", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const bad = [
      { requestId: crypto.randomUUID() },
      { code: 12345678, requestId: crypto.randomUUID() },
      { code: codes[0] },
      { code: codes[0], requestId: "not-a-uuid" },
      { code: codes[0], requestId: 7 },
    ];
    for (const body of bad) {
      const res = await api.call(checkInTicket, { token: organiser.token, params: { eventId: event.eventId }, body });
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(Object.keys(res.body.fieldErrors).length).toBeGreaterThan(0);
    }
    const big = await scan(organiser.token, `${codes[0]}${" ".repeat(1100)}`);
    expect(big.status).toBe(413);
    expect(await log()).toEqual([]);
    expect(await checkedInAt(codes[0])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("retries (same request id)", () => {
  it("a retried admission says admitted again, with one log row", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const requestId = crypto.randomUUID();
    const first = await scan(organiser.token, codes[0], requestId);
    const retry = await scan(organiser.token, codes[0], requestId.toUpperCase());
    expect(first.body.outcome).toBe("admitted");
    expect(retry.body).toEqual(first.body);
    expect((await log()).map((r) => r.result)).toEqual(["admitted"]);
  });

  it("returns the original result unchanged, even after the ticket's state moved on", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const admitted = await scan(organiser.token, codes[0]);
    const dupeId = crypto.randomUUID();
    const dupe = await scan(organiser.token, codes[0], dupeId);
    expect(dupe.body.outcome).toBe("already_checked_in");

    expect(dupe.body.checkInId).toBe(admitted.body.checkInId);
    // While that admission is still current, a retry of the duplicate offers the same undo.
    expect((await scan(organiser.token, codes[0], dupeId)).body).toEqual(dupe.body);

    // Undo and admit again: a retry of the duplicate scan still reports the first admission, but no longer
    // offers to undo it (the time it shows and the admission an undo would reverse must be the same one).
    expect((await undo(organiser.token, admitted.body.checkInId)).body.outcome).toBe("undone");
    const withoutUndo = { ...dupe.body };
    delete withoutUndo.checkInId;
    expect(await scan(organiser.token, codes[0], dupeId)).toMatchObject({ status: 200, body: withoutUndo });
    expect((await scan(organiser.token, codes[0], dupeId)).body.checkInId).toBeUndefined();
    const readmitted = await scan(organiser.token, codes[0]);
    expect(readmitted.body.outcome).toBe("admitted");
    expect((await scan(organiser.token, codes[0], dupeId)).body).toEqual(withoutUndo);
    // A new duplicate scan offers the new admission.
    expect((await scan(organiser.token, codes[0])).body.checkInId).toBe(readmitted.body.checkInId);

    // The same request id with the same (unknown) code replays; so does any other text that isn't one of the
    // organiser's tickets (the answer is the same `invalid`).
    const invalidId = crypto.randomUUID();
    expect((await scan(organiser.token, UNKNOWN_CODE, invalidId)).body).toEqual({ outcome: "invalid" });
    expect((await scan(organiser.token, UNKNOWN_CODE.toLowerCase(), invalidId)).body).toEqual({ outcome: "invalid" });
    expect((await scan(organiser.token, "junk", invalidId)).body).toEqual({ outcome: "invalid" });

    expect((await log()).map((r) => r.result)).toEqual([
      "admitted",
      "already_checked_in",
      "undone",
      "admitted",
      "already_checked_in",
      "invalid",
    ]);
  });

  it("a request id reused for a different code is a 409, with nothing logged, marked or replayed", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 2 }]);
    const { otherEvent } = await anotherOrganiser();
    const theirs = await paidOrder(otherEvent.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);

    const admittedId = crypto.randomUUID();
    expect((await scan(organiser.token, codes[0], admittedId)).body.outcome).toBe("admitted");
    const invalidId = crypto.randomUUID();
    expect((await scan(organiser.token, UNKNOWN_CODE, invalidId)).body.outcome).toBe("invalid");

    for (const [requestId, code] of [
      [admittedId, codes[1]], // another of this event's tickets
      [admittedId, UNKNOWN_CODE], // a code that isn't one
      [admittedId, "junk"],
      [invalidId, codes[1]], // an invalid scan's id, now with a real ticket
    ]) {
      const res = await scan(organiser.token, code, requestId);
      expect({ code, status: res.status }).toEqual({ code, status: 409 });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.body).not.toHaveProperty("outcome");
    }
    // Another organiser's ticket resolves to nothing, like an unknown code: the invalid scan's answer replays,
    // so a reused id can't tell their ticket from an unknown code either.
    expect(await rawScan(organiser.token, theirs.codes[0])).toMatchObject({ status: 200, text: '{"outcome":"invalid"}' });
    expect((await scan(organiser.token, theirs.codes[0], invalidId)).body).toEqual({ outcome: "invalid" });

    expect(await checkedInAt(codes[1])).toBeNull();
    expect((await log()).map((r) => r.result)).toEqual(["admitted", "invalid", "invalid"]);
    // Its own code still replays.
    expect((await scan(organiser.token, `sh1:${codes[0].toLowerCase()}`, admittedId)).body.outcome).toBe("admitted");
  });

  it("request ids are per event: the same id at another event is a new scan", async () => {
    const second = await publishedEvent(api, organiser, admin, { title: "Second Night", ticketTypes: TICKETS });
    const mine = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const theirs = await paidOrder(second.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const requestId = crypto.randomUUID();
    expect((await scan(organiser.token, mine.codes[0], requestId)).body.outcome).toBe("admitted");
    expect((await scan(organiser.token, theirs.codes[0], requestId, second.eventId)).body.outcome).toBe("admitted");
  });
});

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

describe("rate limit", () => {
  async function useAllowance(userId: string) {
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'check_in', now(), $2)
       on conflict (user_id, bucket) do update set window_started_at = now(), hits = $2`,
      [userId, CHECK_IN_LIMIT.limit],
    );
  }

  it("over the allowance: 429, nothing logged or marked; a new window allows again", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    await useAllowance(organiser.userId);
    const res = await scan(organiser.token, codes[0]);
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await scan(organiser.token, UNKNOWN_CODE)).status).toBe(429);
    expect(await log()).toEqual([]);
    expect(await checkedInAt(codes[0])).toBeNull();

    await api.db.query(`update private.rate_limits set window_started_at = now() - interval '6 minutes' where user_id = $1`, [
      organiser.userId,
    ]);
    expect((await scan(organiser.token, codes[0])).body.outcome).toBe("admitted");
  });

  it("counts every scan, and undos share the allowance", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const admitted = await scan(organiser.token, codes[0]);
    await scan(organiser.token, UNKNOWN_CODE);
    const hits = async () =>
      (await api.db.query<{ hits: number }>(`select hits from private.rate_limits where user_id = $1 and bucket = 'check_in'`, [
        organiser.userId,
      ]))[0].hits;
    expect(await hits()).toBe(2);

    await useAllowance(organiser.userId);
    expect((await undo(organiser.token, admitted.body.checkInId)).status).toBe(429);
    expect(await checkedInAt(codes[0])).not.toBeNull();
    expect((await log()).map((r) => r.result)).toEqual(["admitted", "invalid"]);
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe("undo", () => {
  it("reverses an admission with a reason, logs it, and lets the ticket in again", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "vip", quantity: 1 }]);
    const admitted = await scan(organiser.token, codes[0]);
    const res = await undo(organiser.token, admitted.body.checkInId, "  Scanned by mistake  ");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({
      outcome: "undone",
      checkInId: expect.stringMatching(UUID),
      ticket: { ticketTypeName: "VIP", codeLast4: codes[0].slice(-4) },
    });
    expect(await checkedInAt(codes[0])).toBeNull();
    expect((await log()).at(-1)).toMatchObject({
      result: "undone",
      ticket_code: codes[0],
      reason: "Scanned by mistake",
      actor_user_id: organiser.userId,
    });

    // Again: nothing to undo, nothing logged.
    expect((await undo(organiser.token, admitted.body.checkInId)).body.outcome).toBe("not_checked_in");
    expect((await log()).map((r) => r.result)).toEqual(["admitted", "undone"]);

    expect((await scan(organiser.token, codes[0])).body.outcome).toBe("admitted");
  });

  it("can be done from an Already-checked-in result: its checkInId is the ticket's current admission", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    // Admitted long ago: far outside the newest 20 log rows.
    const admitted = await scan(organiser.token, codes[0]);
    for (let i = 0; i < 25; i++) await scan(organiser.token, UNKNOWN_CODE);
    expect((await summary(organiser.token)).body.recent.some((e: { undoable: boolean }) => e.undoable)).toBe(false);

    const refused = await scan(organiser.token, codes[0]);
    expect(refused.body).toMatchObject({ outcome: "already_checked_in", checkInId: admitted.body.checkInId });
    const res = await undo(organiser.token, refused.body.checkInId, "Letting them back in");
    expect(res.body.outcome).toBe("undone");
    expect(await checkedInAt(codes[0])).toBeNull();
    expect((await scan(organiser.token, codes[0])).body.outcome).toBe("admitted");
  });

  it("an Already-checked-in result with no admission on record to undo carries no checkInId", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    // Checked in, but its admission row is gone (e.g. set by hand in SQL).
    await api.db.query(`update public.tickets set checked_in_at = now() where code = $1`, [codes[0]]);
    const res = await scan(organiser.token, codes[0]);
    expect(res.body.outcome).toBe("already_checked_in");
    expect(res.body).not.toHaveProperty("checkInId");
  });

  it("an older admission is superseded once the ticket was admitted again", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const first = await scan(organiser.token, codes[0]);
    await undo(organiser.token, first.body.checkInId);
    const second = await scan(organiser.token, codes[0]);

    expect((await undo(organiser.token, first.body.checkInId)).body.outcome).toBe("superseded");
    expect(await checkedInAt(codes[0])).not.toBeNull();
    expect((await undo(organiser.token, second.body.checkInId)).body.outcome).toBe("undone");
    expect(await checkedInAt(codes[0])).toBeNull();
    expect((await log()).map((r) => r.result)).toEqual(["admitted", "undone", "admitted", "undone"]);
  });

  it("only an admission of this event can be undone (404 otherwise)", async () => {
    const second = await publishedEvent(api, organiser, admin, { title: "Second Night", ticketTypes: TICKETS });
    const mine = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const elsewhere = await paidOrder(second.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const invalid = await scan(organiser.token, UNKNOWN_CODE);
    expect(invalid.body.outcome).toBe("invalid");
    const [{ public_id: invalidId }] = (await publicIds()).filter((r) => r.result === "invalid");
    const admitted = await scan(organiser.token, mine.codes[0]);
    await scan(organiser.token, mine.codes[0]);
    const alreadyId = (await publicIds()).at(-1)!.public_id;
    const there = await scan(organiser.token, elsewhere.codes[0], crypto.randomUUID(), second.eventId);
    // The log's internal (sequential) key isn't an id the API knows, even for a real admission of this event.
    const [{ id: internalId }] = (await log()).filter((r) => r.result === "admitted");

    for (const id of [
      invalidId,
      alreadyId,
      there.body.checkInId,
      crypto.randomUUID(),
      internalId,
      "999999999",
      "0",
      "abc",
      "1e3",
      "9".repeat(19),
      admitted.body.checkInId.toUpperCase().replace(/-/g, ""),
    ]) {
      const res = await undo(organiser.token, id);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(await checkedInAt(mine.codes[0])).not.toBeNull();
    expect(await checkedInAt(elsewhere.codes[0])).not.toBeNull();
  });

  it("needs a reason of 3 to 200 characters without control or invisible characters (400)", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const admitted = await scan(organiser.token, codes[0]);
    for (const reason of [undefined, null, 42, "", "   ", "ab", "x".repeat(201), "wrong\u0000ticket", "wrong‮ticket"]) {
      const res = await api.call(undoCheckIn, {
        token: organiser.token,
        params: { eventId: event.eventId, checkInId: admitted.body.checkInId },
        body: { reason },
      });
      expect({ reason, status: res.status }).toEqual({ reason, status: 400 });
      expect(res.body.fieldErrors.reason).toEqual(expect.any(String));
    }
    expect(await checkedInAt(codes[0])).not.toBeNull();
    expect((await undo(organiser.token, admitted.body.checkInId, "Oop")).body.outcome).toBe("undone");
    expect((await undo(organiser.token, admitted.body.checkInId, "y".repeat(200))).body.outcome).toBe("not_checked_in");
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe("summary", () => {
  it("counts paid tickets and check-ins per ticket type, with capacity", async () => {
    const a = await paidOrder(event.eventId, [
      { ticketTypeId: "ga", quantity: 3 },
      { ticketTypeId: "vip", quantity: 1 },
    ]);
    const refunded = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    await scan(organiser.token, refunded.codes[0]);
    await refundInFull(refunded.paymentIntent, 3170);
    await scan(organiser.token, a.codes[0]);
    await scan(organiser.token, a.codes.at(-1)!); // the VIP

    const res = await summary(organiser.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toMatchObject({
      event: { eventId: event.eventId, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt },
      checkedIn: 2,
      ticketsSold: 4,
      capacity: 12,
      byTicketType: [
        { ticketTypeId: "ga", name: "General admission", checkedIn: 1, ticketsSold: 3, capacity: 10 },
        { ticketTypeId: "vip", name: "VIP", checkedIn: 1, ticketsSold: 1, capacity: 2 },
      ],
    });
  });

  it("lists the newest 20 log entries with only the last four characters of codes", async () => {
    const { codes, orderId } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 2 }]);
    const first = await scan(organiser.token, codes[0]);
    await undo(organiser.token, first.body.checkInId, "Wrong person");
    const second = await scan(organiser.token, codes[0]);
    await scan(organiser.token, codes[1]);
    await scan(organiser.token, codes[1]);
    for (let i = 0; i < 20; i++) await scan(organiser.token, UNKNOWN_CODE);

    const all = await summary(organiser.token);
    expect(all.body.recent).toHaveLength(20);
    expect(all.body.recent.every((e: { result: string }) => e.result === "invalid")).toBe(true);
    expect(all.body.recent[0]).toEqual({
      checkInId: expect.any(String),
      result: "invalid",
      at: expect.any(String),
      codeLast4: null,
      ticketTypeName: null,
      undoable: false,
    });

    // Without the invalid scans: the rest, newest first.
    await api.db.query(`delete from public.ticket_check_ins where result = 'invalid'`);
    const res = await summary(organiser.token);
    expect(res.body.recent).toEqual([
      expect.objectContaining({ result: "already_checked_in", codeLast4: codes[1].slice(-4), undoable: false }),
      expect.objectContaining({ result: "admitted", codeLast4: codes[1].slice(-4), undoable: true }),
      expect.objectContaining({ checkInId: second.body.checkInId, result: "admitted", undoable: true }),
      expect.objectContaining({ result: "undone", reason: "Wrong person", undoable: false }),
      expect.objectContaining({ checkInId: first.body.checkInId, result: "admitted", undoable: false }),
    ]);

    // Every id is the row's random public id, never the sequential key.
    const ids = res.body.recent.map((e: { checkInId: string }) => e.checkInId);
    expect(ids.every((id: string) => UUID.test(id))).toBe(true);
    expect(ids).toEqual((await publicIds()).map((r) => r.public_id).reverse());

    const text = JSON.stringify(res.body) + JSON.stringify(all.body);
    for (const code of codes) expect(text).not.toContain(code);
    expect(text).not.toContain(orderId);
    expect(text).not.toContain("buyer@example.com");
    expect(text).not.toContain(organiser.userId);
  });

  it("names the other event for an other_event entry", async () => {
    const second = await publishedEvent(api, organiser, admin, { title: "Second Night", ticketTypes: TICKETS });
    const { codes } = await paidOrder(second.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    await scan(organiser.token, codes[0]);
    expect((await summary(organiser.token)).body.recent).toEqual([
      expect.objectContaining({ result: "other_event", otherEventTitle: "Second Night", codeLast4: codes[0].slice(-4) }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe("event analytics: attendance", () => {
  const analytics = () => api.call(getEventAnalytics, { token: organiser.token, params: { eventId: event.eventId } });

  it("is null before any ticket is sold", async () => {
    const res = await analytics();
    expect(res.status).toBe(200);
    expect(res.body.attendance).toBeNull();
  });

  it("counts checked-in against sold tickets of paid orders, by ticket type", async () => {
    const order = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 2 }]);
    const refunded = await paidOrder(event.eventId, [{ ticketTypeId: "vip", quantity: 1 }]);
    await scan(organiser.token, order.codes[0]);
    await scan(organiser.token, refunded.codes[0]);
    await refundInFull(refunded.paymentIntent, 8000);

    expect((await analytics()).body.attendance).toEqual({
      checkedIn: 1,
      ticketsSold: 2,
      byTicketType: [
        { ticketTypeId: "ga", name: "General admission", checkedIn: 1, ticketsSold: 2 },
        { ticketTypeId: "vip", name: "VIP", checkedIn: 0, ticketsSold: 0 },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Retention and database guards
// ---------------------------------------------------------------------------

describe("retention", () => {
  it("purge_analytics deletes the log and clears check-in times 25 months after the event ends, keeping its result columns", async () => {
    const old = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    await scan(organiser.token, old.codes[0]);
    await scan(organiser.token, UNKNOWN_CODE);
    const recentEvent = await publishedEvent(api, organiser, admin, { title: "Recent", ticketTypes: TICKETS });
    const kept = await paidOrder(recentEvent.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    await scan(organiser.token, kept.codes[0], crypto.randomUUID(), recentEvent.eventId);

    // Just inside the horizon: kept.
    await api.db.query(
      `update public.events set starts_at = now() - interval '25 months' + interval '1 day' - interval '3 hours',
                                ends_at = now() - interval '25 months' + interval '1 day' where id = $1`,
      [recentEvent.eventId],
    );
    let [result] = await api.db.query(`select * from private.purge_analytics()`);
    expect(Object.keys(result).sort()).toEqual(["event_rate_limits_deleted", "event_view_counts_deleted"]);
    expect(await log()).toHaveLength(2);

    // Ended over 25 months ago: gone.
    await api.db.query(
      `update public.events set starts_at = now() - interval '25 months 2 days', ends_at = now() - interval '25 months 1 day' where id = $1`,
      [event.eventId],
    );
    [result] = await api.db.query(`select * from private.purge_analytics()`);
    expect(await log()).toEqual([]);
    expect(await checkedInAt(old.codes[0])).toBeNull();
    // The ticket itself is kept (financial record), as is the recent event's data.
    expect(await api.db.query(`select code from public.tickets where code = $1`, [old.codes[0]])).toHaveLength(1);
    expect(await log(recentEvent.eventId)).toHaveLength(1);
    expect(await checkedInAt(kept.codes[0])).not.toBeNull();
    // Idempotent.
    await api.db.query(`select * from private.purge_analytics()`);
    expect(await log(recentEvent.eventId)).toHaveLength(1);
  });

  it("deleting an event deletes its log", async () => {
    await scan(organiser.token, UNKNOWN_CODE);
    expect(await log()).toHaveLength(1);
    await api.db.query(`delete from public.events where id = $1`, [event.eventId]);
    expect(await log()).toEqual([]);
  });
});

describe("database guards", () => {
  it("the log can't hold a scanned code for an invalid scan, a code-less ticket outcome, or an undo without a reason", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const insert = (code: string | null, result: string, reason: string | null = null) =>
      api.db.query(
        `insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result, reason)
         values ($1, $2, $3, gen_random_uuid(), $4, $5)`,
        [event.eventId, code, organiser.userId, result, reason],
      );
    await expect(insert(codes[0], "invalid")).rejects.toMatchObject({ code: "23514" });
    await expect(insert(null, "admitted")).rejects.toMatchObject({ code: "23514" });
    await expect(insert(codes[0], "undone")).rejects.toMatchObject({ code: "23514" });
    await expect(insert(codes[0], "undone", "no")).rejects.toMatchObject({ code: "23514" });
    await expect(insert(codes[0], "admitted", "a reason")).rejects.toMatchObject({ code: "23514" });
    await expect(insert(codes[0], "welcome")).rejects.toMatchObject({ code: "23514" });
    await expect(insert("NOPE-NOPE", "admitted")).rejects.toMatchObject({ code: "23503" });
  });

  it("every log row gets its own random public id", async () => {
    await scan(organiser.token, UNKNOWN_CODE);
    await scan(organiser.token, UNKNOWN_CODE);
    const [a, b] = await publicIds();
    expect(a.public_id).toMatch(UUID);
    expect(b.public_id).not.toBe(a.public_id);
    await expect(
      api.db.query(
        `insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result, public_id)
         values ($1, null, $2, gen_random_uuid(), 'invalid', $3)`,
        [event.eventId, organiser.userId, a.public_id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses missing arguments and a bad undo reason outright", async () => {
    await expect(
      api.db.query(`select * from private.check_in_ticket($1, $2, null, 'ABCD-EFGH', gen_random_uuid(), 10, '1 minute')`, [
        event.eventId,
        organiser.organiserId,
      ]),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      api.db.query(`select * from private.undo_check_in($1, $2, $3, gen_random_uuid(), 'no', 10, '1 minute')`, [
        event.eventId,
        organiser.organiserId,
        organiser.userId,
      ]),
    ).rejects.toMatchObject({ code: "22023" });
  });
});

// ---------------------------------------------------------------------------
// Concurrency: two sessions at once needs a real server (PGlite is one
// connection). Run with TEST_DATABASE_URL (CLAUDE.md, "Quality gates").
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrency (real Postgres only)", () => {
  function connections() {
    return [postgres(serverUrl as string, { max: 1, onnotice: () => {} }), postgres(serverUrl as string, { max: 1, onnotice: () => {} })];
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

  const checkIn = (conn: postgres.Sql, actorId: string, code: string, requestId: string = crypto.randomUUID()) =>
    conn.unsafe(
      `select result, check_in_id::text as check_in_id, admission_id::text as admission_id
         from private.check_in_ticket($1, $2, $3, $4, $5::uuid, 600, '5 minutes')`,
      [event.eventId, organiser.organiserId, actorId, code, requestId],
    );

  it("two scans of one ticket through the API at once: exactly one is admitted", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    for (let round = 0; round < 5; round++) {
      if (round > 0) await api.db.query(`update public.tickets set checked_in_at = null where code = $1`, [codes[0]]);
      const results = await Promise.all([scan(organiser.token, codes[0]), scan(organiser.token, codes[0])]);
      expect(results.map((r) => r.body.outcome).sort()).toEqual(["admitted", "already_checked_in"]);
    }
  });

  it("an admin's two scans of one platform-managed event's ticket at once: exactly one is admitted", async () => {
    const platform = await platformEventWithTickets(1);
    for (let round = 0; round < 5; round++) {
      if (round > 0) await api.db.query(`update public.tickets set checked_in_at = null where code = $1`, [platform.codes[0]]);
      const results = await Promise.all([
        scan(admin.token, platform.codes[0], crypto.randomUUID(), platform.eventId),
        scan(admin.token, platform.codes[0], crypto.randomUUID(), platform.eventId),
      ]);
      expect(results.map((r) => r.body.outcome).sort()).toEqual(["admitted", "already_checked_in"]);
    }
    const actors = await api.db.query<{ actor_user_id: string }>(
      `select distinct actor_user_id from public.ticket_check_ins where event_id = $1`,
      [platform.eventId],
    );
    expect(actors).toEqual([{ actor_user_id: admin.userId }]);
  });

  it("two accounts scanning one ticket at once: the second waits on the ticket, then sees it's already in (and which admission)", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const staff = await api.signUp();
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      const [first] = await checkIn(one, organiser.userId, codes[0]);
      expect(first.result).toBe("admitted");
      expect(first.admission_id).toBe(first.check_in_id);
      const blocked = await waitUntilBlocked(two);
      const pending = checkIn(two, staff.userId, codes[0]).execute();
      await blocked();
      await one.unsafe("commit");
      const [second] = await pending;
      expect(second.result).toBe("already_checked_in");
      // The admission committed while it waited is the one it offers to undo.
      expect(second.admission_id).toBe(first.check_in_id);
    } finally {
      await one.end();
      await two.end();
    }
    expect((await log()).map((r) => r.result)).toEqual(["admitted", "already_checked_in"]);
  });

  it("the same request id at once: the retry waits, then gets the original result and writes nothing", async () => {
    const { codes } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const staff = await api.signUp();
    const requestId = crypto.randomUUID();
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      const [first] = await checkIn(one, organiser.userId, codes[0], requestId);
      expect(first.result).toBe("admitted");
      const blocked = await waitUntilBlocked(two);
      const pending = checkIn(two, staff.userId, codes[0], requestId).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0]).toEqual(first);
    } finally {
      await one.end();
      await two.end();
    }
    expect((await log()).map((r) => r.result)).toEqual(["admitted"]);
  });

  const recordRefund = (conn: postgres.Sql, paymentIntent: string, amount: number) =>
    conn.unsafe(`select result from private.record_payment_refund($1, $2, true)`, [paymentIntent, amount]);

  it("a check-in holding the order: the refund waits, then voids the ticket (no deadlock)", async () => {
    const { codes, paymentIntent } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 2 }]);
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await checkIn(one, organiser.userId, codes[0]))[0].result).toBe("admitted");
      const blocked = await waitUntilBlocked(two);
      const pending = recordRefund(two, paymentIntent, 6340).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("refunded");
    } finally {
      await one.end();
      await two.end();
    }
    expect((await scan(organiser.token, codes[1])).body.outcome).toBe("not_admissible");
  });

  it("a refund holding the order: the check-in waits, then finds the ticket void", async () => {
    const { codes, paymentIntent } = await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]);
    const [one, two] = connections();
    try {
      await one.unsafe("begin");
      expect((await recordRefund(one, paymentIntent, 3170))[0].result).toBe("refunded");
      const blocked = await waitUntilBlocked(two);
      const pending = checkIn(two, organiser.userId, codes[0]).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("not_admissible");
    } finally {
      await one.end();
      await two.end();
    }
    expect(await checkedInAt(codes[0])).toBeNull();
  });

  it("check-ins and refunds racing on many orders never deadlock", async () => {
    const orders = [];
    for (let i = 0; i < 6; i++) orders.push(await paidOrder(event.eventId, [{ ticketTypeId: "ga", quantity: 1 }]));
    vi.spyOn(console, "info").mockImplementation(() => {});
    const conns = Array.from({ length: 4 }, () => postgres(serverUrl as string, { max: 1, onnotice: () => {} }));
    const staff = await Promise.all(Array.from({ length: 2 }, () => api.signUp()));
    try {
      await Promise.all([
        ...orders.map((o, i) => checkIn(conns[i % 2], staff[i % 2].userId, o.codes[0]).execute()),
        ...orders.map((o, i) => recordRefund(conns[2 + (i % 2)], o.paymentIntent, 3170).execute()),
      ]);
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
    const statuses = await api.db.query<{ status: string }>(`select status::text as status from public.orders where event_id = $1`, [
      event.eventId,
    ]);
    expect(statuses.every((s) => s.status === "refunded")).toBe(true);
  });
});
