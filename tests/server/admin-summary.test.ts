import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminListEvents,
  adminListOrganisers,
  adminSummary,
  DOOR_EVENT_WINDOW_HOURS,
  MAX_EVENT_SEARCH_LENGTH,
  parseAdminSearch,
  PENDING_EVENT_SOON_HOURS,
} from "@/lib/server/handlers/admin";
import { adminCreateEvent, adminCreateOrganiser, adminGetEvent } from "@/lib/server/handlers/admin-authoring";
import { getMyEvent, submitEventForReview } from "@/lib/server/handlers/events";
import { getPublicEventBySlug } from "@/lib/server/handlers/public-events";
import { adminSetEventCuration } from "@/lib/server/handlers/trending";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import type { AdminSummary } from "@/lib/server/types";
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

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
});

const FREE_TICKETS = [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }];

async function summary(): Promise<AdminSummary> {
  const res = await api.call(adminSummary, { token: admin.token });
  expect(res.status).toBe(200);
  return res.body as AdminSummary;
}

/** Moves an event to start `startHours` from now and end `endHours` from now (negative: in the past). */
async function reschedule(eventId: string, startHours: number, endHours: number) {
  await api.db.query(
    `update public.events
        set starts_at = now() + make_interval(hours => $2::int), ends_at = now() + make_interval(hours => $3::int)
      where id = $1`,
    [eventId, startHours, endHours],
  );
}

async function pendingEvent(organiser: { token: string }, overrides: Record<string, unknown> = {}) {
  const draft = await draftEvent(api, organiser, overrides);
  const res = await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
  if (res.status !== 200) throw new Error(`submit failed: ${JSON.stringify(res.body)}`);
  return draft;
}

async function pendingApplication(overrides: Record<string, unknown> = {}) {
  const user = await api.signUp();
  const res = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, ...overrides } });
  if (res.status !== 201) throw new Error(`apply failed: ${JSON.stringify(res.body)}`);
  return res.body.organiserId as string;
}

async function platformOrganiser(): Promise<string> {
  const res = await api.call(adminCreateOrganiser, {
    token: admin.token,
    body: { ...application, displayName: "Sheltüh Presents", contactEmail: "events@sheltuh.example" },
  });
  if (res.status !== 201) throw new Error(`adminCreateOrganiser failed: ${JSON.stringify(res.body)}`);
  return res.body.organiserId as string;
}

async function platformEvent(organiserId: string, overrides: Record<string, unknown> = {}) {
  const res = await api.call(adminCreateEvent, {
    token: admin.token,
    body: { ...eventInput({ ticketTypes: FREE_TICKETS }), organiserId, publish: true, ...overrides },
  });
  if (res.status !== 201) throw new Error(`adminCreateEvent failed: ${JSON.stringify(res.body)}`);
  return res.body as { eventId: string };
}

async function insertReport(status: "open" | "actioned" | "dismissed", createdAt: string) {
  await api.db.query(
    `insert into private.user_reports (target_type, reason, status, created_at, resolved_at)
     values ('attendee', 'spam', $1, $2::timestamptz, case when $1 = 'open' then null else now() end)`,
    [status, createdAt],
  );
}

async function insertEmailJob(orderId: string, status: "pending" | "sending" | "sent" | "failed", attempts: number) {
  await api.db.query(
    `insert into private.email_outbox (kind, order_id, status, attempts, sent_at, lease_token, lease_expires_at)
     values ('ticket_email', $1, $2, $3,
             case when $2 = 'sent' then now() end,
             case when $2 = 'sending' then gen_random_uuid() end,
             case when $2 = 'sending' then now() + interval '1 minute' end)
     on conflict (order_id, kind) do update
       set status = excluded.status, attempts = excluded.attempts, sent_at = excluded.sent_at,
           lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at`,
    [orderId, status, attempts],
  );
}

function listEvents(query: Record<string, string>, token = admin.token) {
  return api.call(adminListEvents, { token, query });
}

const titles = (res: { body: { items: { title: string }[] } }) => res.body.items.map((e) => e.title);

describe("GET /api/admin/summary", () => {
  it("is for admins only: 401 signed out, 403 for anyone else, private and uncached for an admin", async () => {
    const user = await api.signUp();
    expect((await api.call(adminSummary)).status).toBe(401);
    expect((await api.call(adminSummary, { token: "not-a-token" })).status).toBe(401);
    const forbidden = await api.call(adminSummary, { token: user.token });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.reportsOpen).toBeUndefined();

    const res = await api.call(adminSummary, { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is all zeros and nulls with nothing waiting", async () => {
    expect(await summary()).toEqual({
      reportsOpen: { count: 0, oldestAt: null },
      eventsPending: { count: 0, soonestStartsAt: null, startingSoon: 0, startingSoonHours: PENDING_EVENT_SOON_HOURS },
      organisersPending: { count: 0, oldestAt: null },
      emailsFailed: { count: 0 },
      emailsRetrying: { count: 0 },
      doorEvents: { count: 0, windowHours: DOOR_EVENT_WINDOW_HOURS },
    });
  });

  it("counts open reports only, with the oldest one's time", async () => {
    await insertReport("open", "2026-10-02T00:00:00Z");
    await insertReport("open", "2026-10-01T09:30:00Z");
    await insertReport("actioned", "2026-09-01T00:00:00Z");
    await insertReport("dismissed", "2026-09-02T00:00:00Z");
    expect((await summary()).reportsOpen).toEqual({ count: 2, oldestAt: "2026-10-01T09:30:00.000Z" });
  });

  it("counts events waiting for review; the soonest start and how many start within 72 hours ignore ended ones", async () => {
    const organiser = await approvedOrganiser(api, admin);
    await pendingEvent(organiser, { title: "Far off" });
    const soon = await pendingEvent(organiser, { title: "Tomorrow night" });
    await reschedule(soon.eventId, 30, 33);
    const now = await pendingEvent(organiser, { title: "On right now" });
    await reschedule(now.eventId, -1, 2);
    const ended = await pendingEvent(organiser, { title: "Already over" });
    await reschedule(ended.eventId, -10, -5);
    const later = await pendingEvent(organiser, { title: "In four days" });
    await reschedule(later.eventId, 96, 99);
    // Not pending: a draft and a published event, both starting soon.
    const draft = await draftEvent(api, organiser, { title: "Still a draft" });
    await reschedule(draft.eventId, 2, 4);
    const live = await publishedEvent(api, organiser, admin, { title: "Live" });
    await reschedule(live.eventId, 2, 4);

    const { eventsPending } = await summary();
    expect(eventsPending.count).toBe(5);
    expect(eventsPending.startingSoon).toBe(2);
    const [{ starts_at: soonest }] = await api.db.query<{ starts_at: Date | string }>(
      `select starts_at from public.events where id = $1`,
      [now.eventId],
    );
    expect(eventsPending.soonestStartsAt).toBe(new Date(soonest).toISOString());
  });

  it("counts organiser applications waiting for review, with the oldest one's last update", async () => {
    const first = await pendingApplication({ displayName: "First In" });
    await pendingApplication({ displayName: "Second In" });
    await approvedOrganiser(api, admin, { displayName: "Already Approved" });
    // Applied first, so its updated_at (set by the trigger, not settable here) is the oldest.
    const [{ updated_at: oldest }] = await api.db.query<{ updated_at: Date | string }>(
      `select updated_at from public.organisers where id = $1`,
      [first],
    );
    expect((await summary()).organisersPending).toEqual({ count: 2, oldestAt: new Date(oldest).toISOString() });
  });

  it("counts failed ticket emails, and pending ones only once an attempt has failed", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const event = await publishedEvent(api, organiser, admin);
    const job = async (status: "pending" | "sending" | "sent" | "failed", attempts: number) =>
      insertEmailJob(await insertOrder(api, event, "buyer@example.com"), status, attempts);
    await job("failed", 6);
    await job("failed", 6);
    await job("pending", 2);
    await job("pending", 0);
    await job("sending", 1);
    await job("sent", 1);
    const result = await summary();
    expect(result.emailsFailed).toEqual({ count: 2 });
    expect(result.emailsRetrying).toEqual({ count: 1 });
  });

  it("counts door check-ins: published, Sheltüh-ticketed, platform-managed events starting within 24 hours that haven't ended", async () => {
    const platformId = await platformOrganiser();
    const tonight = await platformEvent(platformId, { title: "Tonight" });
    await reschedule(tonight.eventId, 3, 6);
    const doorsOpen = await platformEvent(platformId, { title: "Doors open" });
    await reschedule(doorsOpen.eventId, -1, 2);
    const nextWeek = await platformEvent(platformId, { title: "Next week" });
    await reschedule(nextWeek.eventId, 24 * 7, 24 * 7 + 3);
    const over = await platformEvent(platformId, { title: "Over" });
    await reschedule(over.eventId, -6, -1);
    const external = await platformEvent(platformId, {
      title: "Elsewhere",
      ticketTypes: [],
      ticketingMode: "external",
      externalTicketUrl: "https://tickets.example.com/elsewhere",
    });
    await reschedule(external.eventId, 3, 6);
    const draft = await platformEvent(platformId, { title: "Platform draft", publish: false });
    await reschedule(draft.eventId, 3, 6);
    // An organiser with an account checks in their own events.
    const organiser = await approvedOrganiser(api, admin);
    const owned = await publishedEvent(api, organiser, admin, { title: "Owned" });
    await reschedule(owned.eventId, 3, 6);

    expect((await summary()).doorEvents).toEqual({ count: 2, windowHours: DOOR_EVENT_WINDOW_HOURS });
  });
});

describe("GET /api/admin/events filters", () => {
  it("still needs an admin (401 / 403), whatever the filters", async () => {
    const user = await api.signUp();
    expect((await api.call(adminListEvents, { query: { status: "published", q: "x" } })).status).toBe(401);
    expect((await listEvents({ status: "published", q: "x", upcoming: "1" }, user.token)).status).toBe(403);
  });

  it("items carry organiserPlatformManaged (additive to EventRecord)", async () => {
    const platformId = await platformOrganiser();
    await platformEvent(platformId, { title: "Platform gig" });
    const organiser = await approvedOrganiser(api, admin);
    await publishedEvent(api, organiser, admin, { title: "Owned gig" });
    const res = await listEvents({ status: "published" });
    expect(res.status).toBe(200);
    const byTitle = Object.fromEntries(res.body.items.map((e: { title: string; organiserPlatformManaged: boolean }) => [e.title, e]));
    expect(byTitle["Platform gig"]).toMatchObject({ organiserPlatformManaged: true, status: "published" });
    expect(byTitle["Owned gig"]).toMatchObject({ organiserPlatformManaged: false, moderationLog: expect.any(Array) });
  });

  it("items carry the trending curation: boosted, excluded, and boost 1 / not excluded when never curated", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const boosted = await publishedEvent(api, organiser, admin, { title: "Boosted" });
    const excluded = await publishedEvent(api, organiser, admin, { title: "Excluded" });
    const uncurated = await publishedEvent(api, organiser, admin, { title: "Uncurated" });
    const reset = await publishedEvent(api, organiser, admin, { title: "Reset" });
    const pending = await pendingEvent(organiser, { title: "Pending boosted" });
    // Distinct starts, so the list's order (soonest first) is known.
    for (const [i, event] of [boosted, excluded, uncurated, reset].entries()) {
      await reschedule(event.eventId, 24 * (i + 1), 24 * (i + 1) + 3);
    }
    const curate = async (eventId: string, boost: number, isExcluded: boolean) => {
      const res = await api.call(adminSetEventCuration, {
        token: admin.token,
        method: "PUT",
        params: { eventId },
        body: { boost, excluded: isExcluded, reason: "Editorial pick" },
      });
      expect(res.status).toBe(200);
    };
    await curate(boosted.eventId, 1.5, false);
    await curate(excluded.eventId, 0.5, true);
    // A curation row that's back at the defaults reads like no row at all.
    await curate(reset.eventId, 2, true);
    await curate(reset.eventId, 1, false);
    await curate(pending.eventId, 1.25, false);

    const res = await listEvents({ status: "published" });
    expect(res.status).toBe(200);
    // One item per event, in the usual order: the join adds no rows.
    expect(titles(res)).toEqual(["Boosted", "Excluded", "Uncurated", "Reset"]);
    const curation = Object.fromEntries(
      res.body.items.map((e: { title: string; curation: unknown }) => [e.title, e.curation]),
    );
    expect(curation).toEqual({
      Boosted: { boost: 1.5, excluded: false },
      Excluded: { boost: 0.5, excluded: true },
      Uncurated: { boost: 1, excluded: false },
      Reset: { boost: 1, excluded: false },
    });
    // Any status, and the page boundary keeps every item's curation.
    expect((await listEvents({ status: "pending_review" })).body.items[0].curation).toEqual({ boost: 1.25, excluded: false });
    const page = await listEvents({ status: "published", limit: "1" });
    expect(page.body.items.map((e: { curation: unknown }) => e.curation)).toEqual([{ boost: 1.5, excluded: false }]);
    const next = await listEvents({ status: "published", limit: "1", cursor: page.body.nextCursor });
    expect(next.body.items.map((e: { curation: unknown }) => e.curation)).toEqual([{ boost: 0.5, excluded: true }]);

    // The single-event admin read carries it too; the organiser's and the public views never do.
    const one = await api.call(adminGetEvent, { token: admin.token, params: { eventId: excluded.eventId } });
    expect(one.body.curation).toEqual({ boost: 0.5, excluded: true });
    const own = await api.call(getMyEvent, { token: organiser.token, params: { eventId: excluded.eventId } });
    expect(own.status).toBe(200);
    expect(own.body).not.toHaveProperty("curation");
    const pub = await api.call(getPublicEventBySlug, { params: { slug: one.body.slug } });
    expect(pub.status).toBe(200);
    expect(pub.body).not.toHaveProperty("curation");
  });

  it("published defaults to upcoming; upcoming=0 (or false) brings back ended events; other statuses default to all", async () => {
    const organiser = await approvedOrganiser(api, admin);
    const past = await publishedEvent(api, organiser, admin, { title: "Last month" });
    await reschedule(past.eventId, -24 * 30, -24 * 30 + 3);
    const inProgress = await publishedEvent(api, organiser, admin, { title: "On now" });
    await reschedule(inProgress.eventId, -1, 2);
    await publishedEvent(api, organiser, admin, { title: "Next year" });
    const oldPending = await pendingEvent(organiser, { title: "Stale submission" });
    await reschedule(oldPending.eventId, -48, -45);
    await pendingEvent(organiser, { title: "Fresh submission" });

    expect(titles(await listEvents({ status: "published" }))).toEqual(["On now", "Next year"]);
    expect(titles(await listEvents({ status: "published", upcoming: "" }))).toEqual(["On now", "Next year"]);
    expect(titles(await listEvents({ status: "published", upcoming: "true" }))).toEqual(["On now", "Next year"]);
    expect(titles(await listEvents({ status: "published", upcoming: "0" }))).toEqual(["Last month", "On now", "Next year"]);
    expect(titles(await listEvents({ status: "published", upcoming: "false" }))).toEqual(["Last month", "On now", "Next year"]);

    // The review queue (the default status) still shows everything waiting, ended or not.
    expect(titles(await listEvents({}))).toEqual(["Stale submission", "Fresh submission"]);
    expect(titles(await listEvents({ status: "pending_review", upcoming: "1" }))).toEqual(["Fresh submission"]);
  });

  it("platformManaged=1 keeps platform-managed organisers' events; 0 keeps the rest", async () => {
    const platformId = await platformOrganiser();
    await platformEvent(platformId, { title: "Platform gig" });
    const organiser = await approvedOrganiser(api, admin);
    await publishedEvent(api, organiser, admin, { title: "Owned gig" });

    expect(titles(await listEvents({ status: "published", platformManaged: "1" }))).toEqual(["Platform gig"]);
    expect(titles(await listEvents({ status: "published", platformManaged: "false" }))).toEqual(["Owned gig"]);
    expect(titles(await listEvents({ status: "published" })).sort()).toEqual(["Owned gig", "Platform gig"]);
  });

  it("the door list: platformManaged and upcoming together", async () => {
    const platformId = await platformOrganiser();
    const done = await platformEvent(platformId, { title: "Done" });
    await reschedule(done.eventId, -10, -5);
    await platformEvent(platformId, { title: "Coming up" });
    expect(titles(await listEvents({ status: "published", platformManaged: "1", upcoming: "1" }))).toEqual(["Coming up"]);
  });

  it("q matches the title or the organiser's name, ignoring case and accents, combined with the other filters", async () => {
    const static_ = await approvedOrganiser(api, admin, { displayName: "Static Collective" });
    const cafe = await approvedOrganiser(api, admin, { displayName: "Café Rouge" });
    await publishedEvent(api, static_, admin, { title: "Neon Static" });
    await publishedEvent(api, static_, admin, { title: "Life Drawing" });
    await publishedEvent(api, cafe, admin, { title: "Jazz Brunch" });
    await pendingEvent(cafe, { title: "Jazz Supper" });

    expect(titles(await listEvents({ status: "published", q: "NEON" }))).toEqual(["Neon Static"]);
    // Same start time: the order between them is by (random) id, so compare as a set.
    expect(titles(await listEvents({ status: "published", q: "  static " })).sort()).toEqual(["Life Drawing", "Neon Static"]);
    expect(titles(await listEvents({ status: "published", q: "cafe" }))).toEqual(["Jazz Brunch"]);
    expect(titles(await listEvents({ status: "published", q: "ＪＡＺＺ" }))).toEqual(["Jazz Brunch"]);
    expect(titles(await listEvents({ status: "pending_review", q: "jazz" }))).toEqual(["Jazz Supper"]);
    expect(titles(await listEvents({ status: "published", q: "nothing like it" }))).toEqual([]);
    // Blank is no search.
    expect(titles(await listEvents({ status: "published", q: "   " }))).toHaveLength(3);
  });

  it("q's LIKE wildcards, escape character and quotes match literally, never as patterns or SQL", async () => {
    const organiser = await approvedOrganiser(api, admin);
    await publishedEvent(api, organiser, admin, { title: "100% Vinyl" });
    await publishedEvent(api, organiser, admin, { title: "Under_score" });
    await publishedEvent(api, organiser, admin, { title: "Plain show" });

    expect(titles(await listEvents({ status: "published", q: "%" }))).toEqual(["100% Vinyl"]);
    expect(titles(await listEvents({ status: "published", q: "_" }))).toEqual(["Under_score"]);
    expect(titles(await listEvents({ status: "published", q: "under score" }))).toEqual([]);
    expect(titles(await listEvents({ status: "published", q: "Plain_show" }))).toEqual([]);
    expect(titles(await listEvents({ status: "published", q: "\\" }))).toEqual([]);
    expect(titles(await listEvents({ status: "published", q: "' or 1=1 --" }))).toEqual([]);
    const injected = await listEvents({ status: "published", q: "'); drop table public.events; --" });
    expect(injected.status).toBe(200);
    expect(titles(await listEvents({ status: "published" }))).toHaveLength(3);
  });

  it("q is cut to 100 characters, and control characters (NUL included) are dropped rather than failing", async () => {
    const organiser = await approvedOrganiser(api, admin);
    await publishedEvent(api, organiser, admin, { title: "Neon Static" });

    const long = await listEvents({ status: "published", q: `neon${"x".repeat(500)}` });
    expect(long.status).toBe(200);
    expect(long.body.items).toEqual([]);
    expect(titles(await listEvents({ status: "published", q: `${" ".repeat(10)}neon${" ".repeat(200)}` }))).toEqual(["Neon Static"]);

    const nul = await listEvents({ status: "published", q: "ne\u0000on\u0007" });
    expect(nul.status).toBe(200);
    expect(titles(nul)).toEqual(["Neon Static"]);
    // The organiser search shares the parsing.
    const organisers = await api.call(adminListOrganisers, { token: admin.token, query: { status: "approved", q: "sta\u0000tic" } });
    expect(organisers.status).toBe(200);
    expect(organisers.body.items).toHaveLength(1);
  });

  it("400 for a boolean that isn't 1/0/true/false (fieldErrors name it), and for a bad status, as before", async () => {
    for (const [name, value] of [
      ["upcoming", "yes"],
      ["upcoming", "2"],
      ["platformManaged", "TRUE"],
      ["platformManaged", "null"],
    ] as const) {
      const res = await listEvents({ status: "published", [name]: value });
      expect(res.status, `${name}=${value}`).toBe(400);
      expect(res.body.fieldErrors).toEqual({ [name]: expect.any(String) });
    }
    expect((await listEvents({ status: "live" })).status).toBe(400);
    expect((await listEvents({ status: "published", cursor: "nope" })).status).toBe(400);
  });

  it("pages through filtered results with the cursor", async () => {
    const organiser = await approvedOrganiser(api, admin);
    for (let i = 1; i <= 3; i++) {
      const e = await publishedEvent(api, organiser, admin, { title: `Match ${i}` });
      await reschedule(e.eventId, i * 24, i * 24 + 2);
    }
    await publishedEvent(api, organiser, admin, { title: "Other" });
    const first = await listEvents({ status: "published", q: "match", limit: "2" });
    expect(titles(first)).toEqual(["Match 1", "Match 2"]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await listEvents({ status: "published", q: "match", limit: "2", cursor: first.body.nextCursor });
    expect(titles(second)).toEqual(["Match 3"]);
    expect(second.body.nextCursor).toBeUndefined();
  });
});

describe("parseAdminSearch", () => {
  it("removes control characters, trims, cuts and folds", () => {
    expect(parseAdminSearch(null, MAX_EVENT_SEARCH_LENGTH)).toBe("");
    expect(parseAdminSearch("  Café\u0000 ", MAX_EVENT_SEARCH_LENGTH)).toBe("cafe");
    expect(parseAdminSearch("\u0085\u009f\u007f", MAX_EVENT_SEARCH_LENGTH)).toBe("");
    expect(parseAdminSearch("abcdef", 3)).toBe("abc");
  });
});
