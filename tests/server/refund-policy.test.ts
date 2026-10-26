import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tightensRefundPolicy, type RefundPolicy, type RefundTerms } from "@/lib/refund-policy";
import { PG_CHECK_VIOLATION, pgConstraint, pgErrorCode } from "@/lib/server/db";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { adminCreateEvent, adminCreateOrganiser, adminGetEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { createEventDraft, getMyEvent, REFUND_POLICY_TIGHTENED, updateEventDraft } from "@/lib/server/handlers/events";
import { getOrderBySession } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import type { AdminEventRecord, EventRecord } from "@/lib/server/types";
import { TestApi } from "./helpers/api";
import {
  application,
  approvedOrganiser,
  draftEvent,
  eventInput,
  insertOrder,
  publishedEvent,
  signUpAdmin,
} from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * Per-event refund policy (supabase/migrations/20261109000100_event_refund_policy.sql,
 * lib/refund-policy.ts, lib/server/event-input.ts parseRefundPolicy).
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFUND_MIGRATION = "20261109000100_event_refund_policy.sql";

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

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
});

async function stored(eventId: string) {
  const [row] = await api.db.query<{ refund_policy: string; refund_days: number | null }>(
    `select refund_policy, refund_days from public.events where id = $1`,
    [eventId],
  );
  return row;
}

function organiserPatch(eventId: string, body: unknown, token = organiser.token) {
  return api.call(updateEventDraft, { token, params: { eventId }, body, method: "PATCH" });
}

/** The admin PATCH body that saves `event` as it is, with `overrides`. */
function adminBody(event: AdminEventRecord | EventRecord, overrides: Record<string, unknown> = {}) {
  return {
    ...eventInput(),
    ticketTypes: event.ticketTypes,
    ticketingMode: event.ticketingMode,
    externalTicketUrl: event.externalTicketUrl ?? null,
    externalFree: event.externalFree,
    expectedUpdatedAt: event.updatedAt,
    ...overrides,
  };
}

function adminPatch(eventId: string, body: unknown, token = admin.token) {
  return api.call(adminUpdateEvent, { token, params: { eventId }, body, method: "PATCH" });
}

async function adminEvent(eventId: string): Promise<AdminEventRecord> {
  return (await api.call(adminGetEvent, { token: admin.token, params: { eventId } })).body as AdminEventRecord;
}

async function editedEntries(eventId: string) {
  return api.db.query<{ details: Record<string, unknown>; reason: string | null }>(
    `select details, reason from public.event_moderation_log where event_id = $1 and action = 'edited' order by id`,
    [eventId],
  );
}

function expectTightenedRefused(res: { status: number; body: Record<string, unknown> }) {
  expect(res.status).toBe(409);
  expect(res.body.code).toBe("refund_policy_tightened");
  expect(res.body.error).toBe(REFUND_POLICY_TIGHTENED);
  expect(res.body.fieldErrors).toEqual({ refundPolicy: REFUND_POLICY_TIGHTENED });
}

describe("defaults", () => {
  it("an event that predates the migration gets no_change_of_mind, no days", { timeout: 120_000 }, async () => {
    // Every migration before this one, an event, then this one: the column's
    // default is what existing rows read.
    const pg = new PGlite();
    try {
      await pg.exec(readFileSync(path.join(ROOT, "supabase/test/supabase-stubs.sql"), "utf8"));
      const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files.filter((f) => f < REFUND_MIGRATION)) {
        await pg.exec(readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8"));
      }
      await pg.exec(`
        insert into public.organisers (id, owner_user_id, display_name, contact_email, description, categories, status)
        values ('00000000-0000-0000-0000-0000000000a1', null, 'Old Org', 'old@sheltuh.example', 'Old.', '{art}', 'approved');
        insert into public.events (id, organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
                                   starts_at, ends_at)
        values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'old-event', 'Old', 'Old.',
                'art', 'Hall', '1 Main St', 'Fitzroy', '2027-01-01T09:00:00Z', '2027-01-01T12:00:00Z');`);
      await pg.exec(readFileSync(path.join(ROOT, "supabase/migrations", REFUND_MIGRATION), "utf8"));
      const { rows } = await pg.query(`select refund_policy, refund_days from public.events`);
      expect(rows).toEqual([{ refund_policy: "no_change_of_mind", refund_days: null }]);
    } finally {
      await pg.close();
    }
  });

  it("a new event without a policy gets no_change_of_mind: stored, on the record and in the public payloads", async () => {
    const live = await publishedEvent(api, organiser, admin);
    expect(await stored(live.eventId)).toEqual({ refund_policy: "no_change_of_mind", refund_days: null });
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: live.eventId } });
    expect(mine.body.refundPolicy).toBe("no_change_of_mind");
    expect(mine.body).not.toHaveProperty("refundDays");
    const bySlug = await api.call(getPublicEventBySlug, { params: { slug: live.slug } });
    expect(bySlug.body.refundPolicy).toBe("no_change_of_mind");
    expect(bySlug.body).not.toHaveProperty("refundDays");
  });

  it("an admin-created event without a policy gets the default too", async () => {
    const res = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }] }), organiserId: organiser.organiserId },
    });
    expect(res.status).toBe(201);
    expect(res.body.refundPolicy).toBe("no_change_of_mind");
    expect(await stored(res.body.eventId)).toEqual({ refund_policy: "no_change_of_mind", refund_days: null });
  });
});

describe("choosing a policy", () => {
  it("days_before with its days: stored, and carried by every public payload", async () => {
    const live = await publishedEvent(api, organiser, admin, { refundPolicy: "days_before", refundDays: 7 });
    expect(live).toMatchObject({ refundPolicy: "days_before", refundDays: 7 });
    expect(await stored(live.eventId)).toEqual({ refund_policy: "days_before", refund_days: 7 });

    const bySlug = await api.call(getPublicEventBySlug, { params: { slug: live.slug } });
    expect(bySlug.body).toMatchObject({ refundPolicy: "days_before", refundDays: 7 });
    const list = await api.call(listPublicEvents);
    expect(list.body.items[0]).toEqual(bySlug.body);

    // The ticket page, for a paid order while the event is published.
    const orderId = await insertOrder(api, live, "fan@example.com", "paid");
    const page = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(page.body).toMatchObject({ status: "paid", eventListed: true, refundPolicy: "days_before", refundDays: 7 });
  });

  it("the ticket page leaves the policy out once the event isn't listed, as it does the date and venue", async () => {
    const live = await publishedEvent(api, organiser, admin, { refundPolicy: "days_before", refundDays: 7 });
    const orderId = await insertOrder(api, live, "fan@example.com", "paid");
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: live.eventId }, body: { reason: "Venue fell through." }, method: "POST" });
    const page = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(page.body.eventListed).toBe(false);
    expect(page.body).not.toHaveProperty("refundPolicy");
    expect(page.body).not.toHaveProperty("refundDays");
  });

  it("accepts 1 day and 30 days", async () => {
    for (const refundDays of [1, 30]) {
      const draft = await draftEvent(api, organiser, { refundPolicy: "days_before", refundDays });
      expect(draft).toMatchObject({ refundPolicy: "days_before", refundDays });
    }
  });

  it("no_change_of_mind may send refundDays as null", async () => {
    const draft = await draftEvent(api, organiser, { refundPolicy: "no_change_of_mind", refundDays: null });
    expect(draft.refundPolicy).toBe("no_change_of_mind");
    expect(await stored(draft.eventId)).toEqual({ refund_policy: "no_change_of_mind", refund_days: null });
  });
});

describe("validation (400 fieldErrors, nothing written)", () => {
  const create = (overrides: Record<string, unknown>) => api.call(adminCreateEvent, {
    token: admin.token,
    body: { ...eventInput(overrides), organiserId: organiser.organiserId },
  });

  it.each([
    ["missing", {}],
    ["null", { refundDays: null }],
    ["0", { refundDays: 0 }],
    ["31", { refundDays: 31 }],
    ["negative", { refundDays: -1 }],
    ["a fraction", { refundDays: 7.5 }],
    ["a string", { refundDays: "7" }],
  ])("days_before with days %s: fieldErrors.refundDays", async (_label, days) => {
    const res = await api.call(createEventDraft, { token: organiser.token, body: eventInput({ refundPolicy: "days_before", ...days }) });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ refundDays: "Enter a whole number of days from 1 to 30." });
    expect(await api.db.query(`select 1 from public.events`)).toEqual([]);
  });

  it.each([["an unknown policy", "full_refund"], ["a number", 7], ["an empty string", ""]])(
    "%s: fieldErrors.refundPolicy",
    async (_label, refundPolicy) => {
      const res = await create({ refundPolicy });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toEqual({ refundPolicy: "Choose a refund policy." });
    },
  );

  it("no_change_of_mind with days: fieldErrors.refundDays, rather than dropping them", async () => {
    const res = await create({ refundPolicy: "no_change_of_mind", refundDays: 7 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ refundDays: "Only for refunds up to a number of days before the event." });
  });

  it("days without a policy: fieldErrors.refundPolicy", async () => {
    const res = await create({ refundDays: 7 });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ refundPolicy: "Choose a refund policy." });
  });

  it("reports refund errors alongside the other fields' errors", async () => {
    const res = await create({ title: "", refundPolicy: "days_before", refundDays: 0 });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["refundDays", "title"]);
  });

  it("the database refuses an inconsistent row whatever the code does", async () => {
    const draft = await draftEvent(api, organiser);
    for (const [sql, constraint] of [
      [`update public.events set refund_policy = 'days_before', refund_days = null where id = $1`, "events_refund_days_check"],
      [`update public.events set refund_policy = 'days_before', refund_days = 0 where id = $1`, "events_refund_days_check"],
      [`update public.events set refund_policy = 'days_before', refund_days = 31 where id = $1`, "events_refund_days_check"],
      [`update public.events set refund_days = 7 where id = $1`, "events_refund_days_check"],
      [`update public.events set refund_policy = 'anything' where id = $1`, "events_refund_policy_check"],
    ] as const) {
      const err = await api.db.query(sql, [draft.eventId]).then(() => undefined, (e: unknown) => e);
      expect(pgErrorCode(err), sql).toBe(PG_CHECK_VIOLATION);
      expect(pgConstraint(err), sql).toBe(constraint);
    }
  });
});

describe("the organiser's edit", () => {
  it("keeps the stored policy when the edit doesn't send one (older clients)", async () => {
    const draft = await draftEvent(api, organiser, { refundPolicy: "days_before", refundDays: 7 });
    const res = await organiserPatch(draft.eventId, eventInput({ title: "Neon Static II" }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Neon Static II", refundPolicy: "days_before", refundDays: 7 });
  });

  it("changes the days, and switching to no_change_of_mind clears them", async () => {
    const draft = await draftEvent(api, organiser, { refundPolicy: "days_before", refundDays: 7 });
    const more = await organiserPatch(draft.eventId, eventInput({ refundPolicy: "days_before", refundDays: 14 }));
    expect(more.body).toMatchObject({ refundPolicy: "days_before", refundDays: 14 });

    const none = await organiserPatch(draft.eventId, eventInput({ refundPolicy: "no_change_of_mind" }));
    expect(none.status).toBe(200);
    expect(none.body.refundPolicy).toBe("no_change_of_mind");
    expect(none.body).not.toHaveProperty("refundDays");
    expect(await stored(draft.eventId)).toEqual({ refund_policy: "no_change_of_mind", refund_days: null });
  });

  it("can't edit it once submitted or published (the event isn't editable: 409)", async () => {
    const live = await publishedEvent(api, organiser, admin);
    const res = await organiserPatch(live.eventId, eventInput({ refundPolicy: "days_before", refundDays: 7 }));
    expect(res.status).toBe(409);
    expect(await stored(live.eventId)).toEqual({ refund_policy: "no_change_of_mind", refund_days: null });
  });

  it("an unpublished event that sold tickets: loosening is allowed, tightening is a 409 that writes nothing", async () => {
    const live = await publishedEvent(api, organiser, admin, { refundPolicy: "days_before", refundDays: 7 });
    await insertOrder(api, live, "fan@example.com", "paid");
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: live.eventId }, body: { reason: "Fixing details." }, method: "POST" });

    for (const tighter of [{ refundPolicy: "no_change_of_mind" }, { refundPolicy: "days_before", refundDays: 8 }]) {
      const res = await organiserPatch(live.eventId, eventInput({ title: "Changed", ...tighter }));
      expectTightenedRefused(res);
      const [row] = await api.db.query<{ title: string }>(`select title from public.events where id = $1`, [live.eventId]);
      expect(row.title).toBe("Neon Static");
      expect(await stored(live.eventId)).toEqual({ refund_policy: "days_before", refund_days: 7 });
    }

    const looser = await organiserPatch(live.eventId, eventInput({ refundPolicy: "days_before", refundDays: 2 }));
    expect(looser.status).toBe(200);
    expect(looser.body).toMatchObject({ refundPolicy: "days_before", refundDays: 2 });
  });

  it("someone else's event is a 404; signed out is a 401", async () => {
    const draft = await draftEvent(api, organiser);
    const other = await approvedOrganiser(api, admin, { contactEmail: "other@static.example" });
    const body = eventInput({ refundPolicy: "days_before", refundDays: 7 });
    expect((await organiserPatch(draft.eventId, body, other.token)).status).toBe(404);
    expect((await api.call(updateEventDraft, { params: { eventId: draft.eventId }, body, method: "PATCH" })).status).toBe(401);
    expect(await stored(draft.eventId)).toEqual({ refund_policy: "no_change_of_mind", refund_days: null });
  });
});

describe("an admin's edit", () => {
  it("is admin only: 401 signed out, 403 for an organiser", async () => {
    const live = await publishedEvent(api, organiser, admin);
    const body = adminBody(live, { refundPolicy: "days_before", refundDays: 7 });
    expect((await api.call(adminUpdateEvent, { params: { eventId: live.eventId }, body, method: "PATCH" })).status).toBe(401);
    expect((await adminPatch(live.eventId, body, organiser.token)).status).toBe(403);
  });

  it("can set any policy on a published event without orders, logged in one `edited` entry", async () => {
    const live = await publishedEvent(api, organiser, admin, { refundPolicy: "days_before", refundDays: 3 });
    const tighter = await adminPatch(live.eventId, adminBody(await adminEvent(live.eventId), { refundPolicy: "no_change_of_mind", reason: "Organiser asked." }));
    expect(tighter.status).toBe(200);
    expect(tighter.body.refundPolicy).toBe("no_change_of_mind");
    expect(tighter.body).not.toHaveProperty("refundDays");
    expect(await editedEntries(live.eventId)).toEqual([
      {
        details: { refundPolicy: { old: "days_before", new: "no_change_of_mind" }, refundDays: { old: 3, new: null } },
        reason: "Organiser asked.",
      },
    ]);
    // The organiser sees the change (by "Sheltüh team"), both sides rebuilt.
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: live.eventId } });
    const entry = (mine.body as EventRecord).moderationLog.find((e) => e.action === "edited");
    expect(entry).toMatchObject({
      by: "Sheltüh team",
      changes: { refundPolicy: { old: "days_before", new: "no_change_of_mind" }, refundDays: { old: 3, new: null } },
    });
  });

  it("keeps the stored policy when the edit doesn't send one, logging nothing about it", async () => {
    const live = await publishedEvent(api, organiser, admin, { refundPolicy: "days_before", refundDays: 7 });
    const res = await adminPatch(live.eventId, adminBody(await adminEvent(live.eventId), { title: "Renamed" }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ refundPolicy: "days_before", refundDays: 7 });
    expect(await editedEntries(live.eventId)).toEqual([
      { details: { title: { old: "Neon Static", new: "Renamed" } }, reason: null },
    ]);
  });

  it("sending the same policy changes nothing (200, nothing logged)", async () => {
    const live = await publishedEvent(api, organiser, admin, { refundPolicy: "days_before", refundDays: 7 });
    const before = await adminEvent(live.eventId);
    const res = await adminPatch(live.eventId, adminBody(before, { refundPolicy: "days_before", refundDays: 7 }));
    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(before.updatedAt);
    expect(await editedEntries(live.eventId)).toEqual([]);
  });

  it("after a sale: loosening is allowed (no_change_of_mind → days_before, then fewer days)", async () => {
    const live = await publishedEvent(api, organiser, admin);
    await insertOrder(api, live, "fan@example.com", "paid");

    const opened = await adminPatch(live.eventId, adminBody(await adminEvent(live.eventId), { refundPolicy: "days_before", refundDays: 14 }));
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ refundPolicy: "days_before", refundDays: 14 });

    const fewer = await adminPatch(live.eventId, adminBody(opened.body, { refundPolicy: "days_before", refundDays: 2 }));
    expect(fewer.status).toBe(200);
    expect(fewer.body).toMatchObject({ refundPolicy: "days_before", refundDays: 2 });

    expect((await editedEntries(live.eventId)).map((e) => e.details)).toEqual([
      { refundPolicy: { old: "no_change_of_mind", new: "days_before" }, refundDays: { old: null, new: 14 } },
      { refundDays: { old: 14, new: 2 } },
    ]);
  });

  it("after a sale: tightening (more days, or no_change_of_mind) is a 409 and nothing at all is written", async () => {
    const live = await publishedEvent(api, organiser, admin, { refundPolicy: "days_before", refundDays: 7 });
    await insertOrder(api, live, "fan@example.com", "paid");
    const before = await adminEvent(live.eventId);

    for (const tighter of [{ refundPolicy: "days_before", refundDays: 8 }, { refundPolicy: "no_change_of_mind" }]) {
      // Alongside other changes: the whole edit is refused, not just the policy.
      const res = await adminPatch(live.eventId, adminBody(before, { title: "Renamed", ...tighter }));
      expectTightenedRefused(res);
    }
    const after = await adminEvent(live.eventId);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after).toMatchObject({ title: "Neon Static", refundPolicy: "days_before", refundDays: 7 });
    expect(await editedEntries(live.eventId)).toEqual([]);
  });

  it("a pending order (a buyer paying now) also blocks tightening; failed and refunded orders don't", async () => {
    const live = await publishedEvent(api, organiser, admin, { refundPolicy: "days_before", refundDays: 7 });
    const pending = await insertOrder(api, live, "fan@example.com", "pending");
    expectTightenedRefused(await adminPatch(live.eventId, adminBody(await adminEvent(live.eventId), { refundPolicy: "no_change_of_mind" })));

    await api.db.query(`update public.orders set status = 'failed' where id = $1`, [pending]);
    await insertOrder(api, live, "other@example.com", "refunded");
    const res = await adminPatch(live.eventId, adminBody(await adminEvent(live.eventId), { refundPolicy: "no_change_of_mind" }));
    expect(res.status).toBe(200);
    expect(res.body.refundPolicy).toBe("no_change_of_mind");
  });

  it("validates the policy like the organiser's form (400)", async () => {
    const live = await publishedEvent(api, organiser, admin);
    const res = await adminPatch(live.eventId, adminBody(live, { refundPolicy: "days_before", refundDays: 45 }));
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ refundDays: "Enter a whole number of days from 1 to 30." });
  });

  it("an admin can create a platform-managed organiser's event with a policy", async () => {
    const org = await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: { ...application, displayName: "Sheltüh Presents", contactEmail: "events@sheltuh.example" },
    });
    const res = await api.call(adminCreateEvent, {
      token: admin.token,
      body: {
        ...eventInput({
          ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
          refundPolicy: "days_before",
          refundDays: 1,
        }),
        organiserId: org.body.organiserId,
        publish: true,
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "published", refundPolicy: "days_before", refundDays: 1 });
  });
});

describe("private.refund_policy_tightens agrees with lib/refund-policy.ts", () => {
  it("for every pair of policies and day counts that matter", async () => {
    const terms: RefundTerms[] = [
      { refundPolicy: "no_change_of_mind" },
      ...[1, 2, 7, 29, 30].map((refundDays) => ({ refundPolicy: "days_before" as RefundPolicy, refundDays })),
    ];
    for (const before of terms) {
      for (const after of terms) {
        const [row] = await api.db.query<{ tightens: boolean }>(
          `select private.refund_policy_tightens($1, $2::integer, $3, $4::integer) as tightens`,
          [before.refundPolicy, before.refundDays ?? null, after.refundPolicy, after.refundDays ?? null],
        );
        expect(row.tightens, `${JSON.stringify(before)} → ${JSON.stringify(after)}`).toBe(tightensRefundPolicy(before, after));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Race: two sessions need a real server (PGlite is one connection). Run with
// TEST_DATABASE_URL (CLAUDE.md, "Quality gates").
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.TEST_DATABASE_URL)("an order placed during a tightening edit (real Postgres only)", () => {
  it("the edit waits for the order's insert (it share-locks the event), then sees it and refuses", async () => {
    const live = await publishedEvent(api, organiser, admin, { refundPolicy: "days_before", refundDays: 7 });
    const before = await adminEvent(live.eventId);
    const other = postgres(serverUrl!, { max: 1, onnotice: () => {} });
    try {
      // A checkout's order insert, not yet committed (orders_not_ended share-locks the event row).
      await other.unsafe("begin");
      await other.unsafe(
        `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
           subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status)
         values ($1, $2, $3, 'Neon Static', 'fan@example.com', '[]'::jsonb, 0, 0, 0, 0, 'pending')`,
        [`ord_${crypto.randomUUID().replace(/-/g, "")}`, live.eventId, live.organiserId],
      );
      const edit = adminPatch(live.eventId, adminBody(before, { refundPolicy: "no_change_of_mind" }));
      let settled = false;
      void edit.then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await other.unsafe("commit");
      expectTightenedRefused(await edit);
      expect(await stored(live.eventId)).toEqual({ refund_policy: "days_before", refund_days: 7 });
    } finally {
      await other.end();
    }
  });
});
