import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pgConstraint, pgErrorCode } from "@/lib/server/db";
import { adminApproveEvent, adminRejectEvent, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import {
  adminCreateEvent,
  adminCreateOrganiser,
  adminUpdateEvent,
  PLATFORM_PAID_REFUSED,
} from "@/lib/server/handlers/admin-authoring";
import {
  ADMIN_PAYOUTS_REQUIRED,
  createEventDraft,
  PAYOUTS_REQUIRED_TO_SUBMIT,
  submitEventForReview,
  updateEventDraft,
} from "@/lib/server/handlers/events";
import { getMyOrganiser } from "@/lib/server/handlers/organisers";
import type { AdminEventRecord, EventRecord } from "@/lib/server/types";
import { TestApi } from "./helpers/api";
import {
  application,
  approvedOrganiser,
  disablePayouts,
  draftEvent,
  enablePayouts,
  eventInput,
  publishedEvent,
  signUpAdmin,
} from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * Paid events need payouts (docs/architecture.md, "Payouts before paid
 * events"; supabase/migrations/20261109000000_paid_events_need_payouts.sql).
 */

const PAID = [{ id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }];
const FREE = [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }];
const VIP = { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 5 };
const EXTERNAL = { ticketingMode: "external", externalTicketUrl: "https://events.humanitix.com/neon-static", ticketTypes: [] };

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

function submit(eventId: string, token = organiser.token) {
  return api.call(submitEventForReview, { token, params: { eventId }, method: "POST" });
}

function approve(eventId: string) {
  return api.call(adminApproveEvent, { token: admin.token, params: { eventId }, method: "POST" });
}

async function status(eventId: string) {
  const [row] = await api.db.query<{ status: string }>(`select status::text from public.events where id = $1`, [eventId]);
  return row.status;
}

async function logActions(eventId: string) {
  const rows = await api.db.query<{ action: string }>(
    `select action::text from public.event_moderation_log where event_id = $1 order by id`,
    [eventId],
  );
  return rows.map((r) => r.action);
}

async function ticketPrices(eventId: string) {
  return api.db.query<{ id: string; price_cents: number }>(
    `select id, price_cents from public.ticket_types where event_id = $1 order by position`,
    [eventId],
  );
}

/** The admin PATCH body that saves `event` as it is, with `overrides`. */
function editBody(event: AdminEventRecord | EventRecord, overrides: Record<string, unknown> = {}) {
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

function adminPatch(eventId: string, body: unknown) {
  return api.call(adminUpdateEvent, { token: admin.token, params: { eventId }, body, method: "PATCH" });
}

function expectPayoutsRequired(res: { status: number; body: Record<string, unknown> }, message: string) {
  expect(res.status).toBe(409);
  expect(res.body.code).toBe("payouts_required");
  expect(res.body.error).toBe(message);
}

describe("an organiser's submit", () => {
  it("refuses a paid event while payouts aren't set up (409 payouts_required), writing nothing", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: [...FREE, ...PAID] });
    const res = await submit(draft.eventId);
    expectPayoutsRequired(res, PAYOUTS_REQUIRED_TO_SUBMIT);
    expect(res.body.fieldErrors).toBeUndefined();
    expect(await status(draft.eventId)).toBe("draft");
    expect(await logActions(draft.eventId)).toEqual([]);
    // No "event to review" email queued for the admins either.
    expect(await api.db.query(`select 1 from private.email_outbox`)).toEqual([]);
  });

  it("submits it once payouts are set up", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: PAID });
    expect((await submit(draft.eventId)).status).toBe(409);
    await enablePayouts(api, organiser.organiserId);
    const res = await submit(draft.eventId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_review");
    expect(await logActions(draft.eventId)).toEqual(["submitted"]);
  });

  it("never needs payouts for a free event", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: FREE });
    const res = await submit(draft.eventId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_review");
    expect((await approve(draft.eventId)).status).toBe(200);
    expect(await status(draft.eventId)).toBe("published");
  });

  it("never needs payouts for external ticketing, free or not", async () => {
    for (const externalFree of [false, true]) {
      const draft = await draftEvent(api, organiser, { ...EXTERNAL, externalFree });
      expect((await submit(draft.eventId)).status).toBe(200);
      expect((await approve(draft.eventId)).status).toBe(200);
    }
  });

  it("refuses a resubmit after rejection, and after an unpublish, while payouts are off", async () => {
    const rejected = await draftEvent(api, organiser, { ticketTypes: PAID });
    await enablePayouts(api, organiser.organiserId);
    expect((await submit(rejected.eventId)).status).toBe(200);
    await api.call(adminRejectEvent, {
      token: admin.token,
      params: { eventId: rejected.eventId },
      body: { reason: "Add a photo." },
      method: "POST",
    });
    const published = await publishedEvent(api, organiser, admin, { title: "Second night", ticketTypes: PAID });
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: published.eventId }, method: "POST" });

    await disablePayouts(api, organiser.organiserId);
    expectPayoutsRequired(await submit(rejected.eventId), PAYOUTS_REQUIRED_TO_SUBMIT);
    expectPayoutsRequired(await submit(published.eventId), PAYOUTS_REQUIRED_TO_SUBMIT);
    expect(await status(rejected.eventId)).toBe("rejected");
    expect(await status(published.eventId)).toBe("draft");
  });

  it("keeps its other answers: 404 for another organiser's event, 409 when it's not a draft", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: PAID });
    const other = await approvedOrganiser(api, admin, { displayName: "Other", contactEmail: "other@example.com" });
    expect((await submit(draft.eventId, other.token)).status).toBe(404);
    await enablePayouts(api, organiser.organiserId);
    expect((await submit(draft.eventId)).status).toBe(200);
    const again = await submit(draft.eventId);
    expect(again.status).toBe(409);
    expect(again.body.code).toBeUndefined();
  });

  it("doesn't block drafts: a paid draft is created and edited without payouts", async () => {
    const created = await api.call(createEventDraft, { token: organiser.token, body: eventInput({ ticketTypes: FREE }) });
    expect(created.status).toBe(201);
    const eventId = created.body.eventId as string;
    const edited = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId },
      body: eventInput({ ticketTypes: [...FREE, ...PAID] }),
      method: "PATCH",
    });
    expect(edited.status).toBe(200);
    expect(await ticketPrices(eventId)).toEqual([
      { id: "rsvp", price_cents: 0 },
      { id: "ga", price_cents: 3000 },
    ]);
  });

  it("the organiser's own view says whether payouts are set up (what the editor warns from)", async () => {
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body.payoutsEnabled).toBe(false);
    await enablePayouts(api, organiser.organiserId);
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body.payoutsEnabled).toBe(true);
  });
});

describe("an admin's approval and publish", () => {
  it("refuses to approve a paid event whose organiser's payouts were turned off since it was submitted", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: PAID });
    await enablePayouts(api, organiser.organiserId);
    expect((await submit(draft.eventId)).status).toBe(200);
    await disablePayouts(api, organiser.organiserId);

    expectPayoutsRequired(await approve(draft.eventId), ADMIN_PAYOUTS_REQUIRED);
    expect(await status(draft.eventId)).toBe("pending_review");
    expect(await logActions(draft.eventId)).toEqual(["submitted"]);

    await enablePayouts(api, organiser.organiserId);
    expect((await approve(draft.eventId)).status).toBe(200);
    expect(await status(draft.eventId)).toBe("published");
  });

  it("refuses an admin-created paid event published for an organiser without payouts, writing nothing", async () => {
    const body = { ...eventInput({ ticketTypes: PAID }), organiserId: organiser.organiserId };
    const res = await api.call(adminCreateEvent, { token: admin.token, body: { ...body, publish: true } });
    expectPayoutsRequired(res, ADMIN_PAYOUTS_REQUIRED);
    expect(res.body.fieldErrors).toEqual({ ticketTypes: ADMIN_PAYOUTS_REQUIRED });
    expect(await api.db.query(`select 1 from public.events`)).toEqual([]);

    // A draft is fine, and so is publishing once payouts are set up.
    const draft = await api.call(adminCreateEvent, { token: admin.token, body });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe("draft");
    await enablePayouts(api, organiser.organiserId);
    const published = await api.call(adminCreateEvent, { token: admin.token, body: { ...body, publish: true } });
    expect(published.status).toBe(201);
    expect(published.body.status).toBe("published");
  });

  it("refuses an admin's edit that publishes a paid draft for an organiser without payouts: nothing saved", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: PAID });
    const res = await adminPatch(draft.eventId, editBody(draft, { title: "Retitled", publish: true }));
    expectPayoutsRequired(res, ADMIN_PAYOUTS_REQUIRED);
    expect(await status(draft.eventId)).toBe("draft");
    const [row] = await api.db.query<{ title: string }>(`select title from public.events where id = $1`, [draft.eventId]);
    expect(row.title).toBe(draft.title);
    expect(await logActions(draft.eventId)).toEqual([]);
  });
});

describe("paid ticket types on a submitted or published event", () => {
  it("refuses adding a paid ticket type, or making a free one paid, while payouts are off", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    expect(event.status).toBe("published");

    const added = await adminPatch(event.eventId, editBody(event, { ticketTypes: [...FREE, VIP] }));
    expectPayoutsRequired(added, ADMIN_PAYOUTS_REQUIRED);
    expect(added.body.fieldErrors).toEqual({ ticketTypes: ADMIN_PAYOUTS_REQUIRED });

    const madePaid = await adminPatch(event.eventId, editBody(event, { ticketTypes: [{ ...FREE[0], priceCents: 1500 }] }));
    expectPayoutsRequired(madePaid, ADMIN_PAYOUTS_REQUIRED);
    expect(await ticketPrices(event.eventId)).toEqual([{ id: "rsvp", price_cents: 0 }]);
    expect(await logActions(event.eventId)).toEqual(["submitted", "approved"]);

    await enablePayouts(api, organiser.organiserId);
    const res = await adminPatch(event.eventId, editBody(event, { ticketTypes: [...FREE, VIP] }));
    expect(res.status).toBe(200);
    expect(await ticketPrices(event.eventId)).toEqual([
      { id: "rsvp", price_cents: 0 },
      { id: "vip", price_cents: 8000 },
    ]);
  });

  it("refuses the same while the event is pending review", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: FREE });
    const submitted = await submit(draft.eventId);
    expect(submitted.status).toBe(200);
    const res = await adminPatch(draft.eventId, editBody(submitted.body as EventRecord, { ticketTypes: [...FREE, VIP] }));
    expectPayoutsRequired(res, ADMIN_PAYOUTS_REQUIRED);
    expect(await ticketPrices(draft.eventId)).toEqual([{ id: "rsvp", price_cents: 0 }]);
  });

  it("leaves a published paid event's existing paid ticket types editable after payouts go off", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: [...FREE, ...PAID] });
    expect(event.status).toBe("published");
    await disablePayouts(api, organiser.organiserId);

    // Other fields, and an existing paid type's price and quantity, still save.
    const repriced = [FREE[0], { ...PAID[0], priceCents: 3500, quantityAvailable: 20 }];
    const res = await adminPatch(event.eventId, editBody(event, { title: "Neon Static II", ticketTypes: repriced }));
    expect(res.status).toBe(200);
    expect(await ticketPrices(event.eventId)).toEqual([
      { id: "rsvp", price_cents: 0 },
      { id: "ga", price_cents: 3500 },
    ]);
    // A new paid type doesn't.
    const updated = res.body as AdminEventRecord;
    expectPayoutsRequired(
      await adminPatch(event.eventId, editBody(updated, { title: "Neon Static II", ticketTypes: [...repriced, VIP] })),
      ADMIN_PAYOUTS_REQUIRED,
    );
  });

  it("the organiser still can't edit a submitted or published event at all (409 not editable, not payouts)", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE });
    const res = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId: event.eventId },
      body: eventInput({ ticketTypes: [...FREE, VIP] }),
      method: "PATCH",
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBeUndefined();
  });
});

describe("platform-managed organisers (no owner, never paid out)", () => {
  async function platformOrganiser(): Promise<string> {
    const res = await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: { ...application, displayName: "Sheltüh Presents", contactEmail: "events@sheltuh.example" },
    });
    return res.body.organiserId as string;
  }

  it("keep free and external events, published by an admin, and still get the free-only refusal for paid ones", async () => {
    const organiserId = await platformOrganiser();
    const free = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ ticketTypes: FREE }), organiserId, publish: true },
    });
    expect(free.status).toBe(201);
    expect(free.body.status).toBe("published");
    const external = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput(EXTERNAL), organiserId, publish: true },
    });
    expect(external.status).toBe(201);
    expect(external.body.status).toBe("published");

    const paid = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ ticketTypes: PAID }), organiserId, publish: true },
    });
    expect(paid.status).toBe(400);
    expect(paid.body.error).toBe(PLATFORM_PAID_REFUSED);
    const added = await adminPatch(free.body.eventId as string, editBody(free.body as AdminEventRecord, { ticketTypes: [...FREE, VIP] }));
    expect(added.status).toBe(400);
    expect(added.body.error).toBe(PLATFORM_PAID_REFUSED);
  });
});

describe("the database's rule, whatever the code does", () => {
  async function dbError(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
    try {
      await work;
    } catch (err) {
      return { code: pgErrorCode(err), constraint: pgConstraint(err) };
    }
    throw new Error("expected the database to refuse");
  }

  it("refuses moving a paid event to pending review or published without payouts", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: PAID });
    for (const to of ["pending_review", "published"]) {
      expect(
        await dbError(
          api.db.query(`select private.transition_event($1, array['draft']::public.event_status[], $2::public.event_status, 'approved', $3)`, [
            draft.eventId,
            to,
            admin.userId,
          ]),
        ),
      ).toEqual({ code: "23514", constraint: "events_paid_tickets_need_payouts" });
    }
    expect(await status(draft.eventId)).toBe("draft");
  });

  it("refuses a new paid ticket type on a published event without payouts, and lets an existing one be saved again", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: [...FREE, ...PAID] });
    await disablePayouts(api, organiser.organiserId);
    const save = (types: unknown[]) =>
      api.db.query(`select private.replace_ticket_types($1, $2::text::jsonb)`, [event.eventId, JSON.stringify(types)]);

    await save([...FREE, ...PAID]);
    expect(await dbError(save([...FREE, ...PAID, VIP]))).toEqual({ code: "23514", constraint: "ticket_types_paid_need_payouts" });
    expect(await dbError(save([{ ...FREE[0], priceCents: 100 }, ...PAID]))).toEqual({
      code: "23514",
      constraint: "ticket_types_paid_need_payouts",
    });
    expect(
      await dbError(api.db.query(`update public.ticket_types set price_cents = 100 where event_id = $1 and id = 'rsvp'`, [event.eventId])),
    ).toEqual({ code: "23514", constraint: "ticket_types_paid_need_payouts" });
    // Unpublishing (or rejecting) is never refused.
    expect((await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" })).status).toBe(200);
  });

  it("the new functions pin search_path and aren't client-executable", async () => {
    const rows = await api.db.query<{ proname: string; pinned: boolean; definer: boolean; client: boolean }>(
      `select p.proname,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as pinned,
              p.prosecdef as definer,
              has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) order by 1`,
      [["events_paid_tickets_need_payouts", "submit_event", "ticket_types_paid_need_payouts"]],
    );
    expect(rows).toEqual([
      { proname: "events_paid_tickets_need_payouts", pinned: true, definer: false, client: false },
      { proname: "submit_event", pinned: true, definer: false, client: false },
      { proname: "ticket_types_paid_need_payouts", pinned: true, definer: false, client: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Races: two sessions need a real server (PGlite is one connection). Run with
// TEST_DATABASE_URL (CLAUDE.md, "Quality gates").
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.TEST_DATABASE_URL)("payouts changing during a submit (real Postgres only)", () => {
  it("a submit waits for a payouts update in flight, then sees its result", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: PAID });
    await enablePayouts(api, organiser.organiserId);
    const other = postgres(serverUrl!, { max: 1, onnotice: () => {} });
    try {
      // A Stripe re-sync (connectRefresh) turning payouts off, not yet committed.
      await other.unsafe("begin");
      await other.unsafe(`update public.organisers set payouts_enabled = false where id = $1`, [organiser.organiserId]);
      const pending = submit(draft.eventId);
      await new Promise((r) => setTimeout(r, 200));
      await other.unsafe("commit");
      expectPayoutsRequired(await pending, PAYOUTS_REQUIRED_TO_SUBMIT);
      expect(await status(draft.eventId)).toBe("draft");
    } finally {
      await other.end();
    }
  });

  it("a payouts update waits for a submit in flight (organiser share-locked first)", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: PAID });
    await enablePayouts(api, organiser.organiserId);
    const one = postgres(serverUrl!, { max: 1, onnotice: () => {} });
    const two = postgres(serverUrl!, { max: 1, onnotice: () => {} });
    try {
      await one.unsafe("begin");
      expect(
        await one.unsafe(`select private.submit_event($1, $2, $3) as result`, [draft.eventId, organiser.organiserId, organiser.userId]),
      ).toEqual([{ result: "submitted" }]);
      const update = two.unsafe(`update public.organisers set payouts_enabled = false where id = $1 returning id`, [
        organiser.organiserId,
      ]);
      let updated = false;
      void update.then(() => {
        updated = true;
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(updated).toBe(false);
      await one.unsafe("commit");
      expect(await update).toHaveLength(1);
      expect(await status(draft.eventId)).toBe("pending_review");
    } finally {
      await one.end();
      await two.end();
    }
  });
});
