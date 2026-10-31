import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import {
  deleteMyExternalGoing,
  EXTERNAL_GOING_RATE_LIMIT,
  getExternalGoingSummary,
  getMyExternalGoing,
  putMyExternalGoing,
} from "@/lib/server/handlers/external-going";
import type { EventRecord } from "@/lib/server/types";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * The count-only "going" for external-ticket events (docs/architecture.md,
 * "External ticketing"; supabase/migrations/20261116000000_external_going.sql).
 */

const HUMANITIX = "https://events.humanitix.com/neon-static";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let sheltuhEvent: EventRecord;

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
  event = await publishedEvent(api, organiser, admin, {
    ticketingMode: "external",
    externalTicketUrl: HUMANITIX,
    ticketTypes: [],
  });
  sheltuhEvent = await publishedEvent(api, organiser, admin, { title: "Ours" });
});

const params = (e: { eventId: string } = event) => ({ eventId: e.eventId });
const put = (m: { token: string }, e: { eventId: string } = event) =>
  api.call(putMyExternalGoing, { token: m.token, params: params(e), method: "PUT" });
const del = (m: { token: string }, e: { eventId: string } = event) =>
  api.call(deleteMyExternalGoing, { token: m.token, params: params(e), method: "DELETE" });
const mine = (m: { token: string }, e: { eventId: string } = event) =>
  api.call(getMyExternalGoing, { token: m.token, params: params(e) });
const summary = (e: { eventId: string } = event) => api.call(getExternalGoingSummary, { params: params(e) });
const rows = async (e: { eventId: string } = event) =>
  api.db.query<{ user_id: string }>(`select user_id from private.external_event_going where event_id = $1`, [e.eventId]);

async function tap(n: number, e: { eventId: string } = event) {
  for (let i = 0; i < n; i++) expect((await put(await api.signUp(), e)).status).toBe(200);
}

describe("tapping 'I'm going' on an external event", () => {
  it("toggles on and off, and is idempotent either way", async () => {
    const m = await api.signUp();
    expect((await mine(m)).body).toEqual({ going: false, open: true });
    for (let i = 0; i < 2; i++) {
      const res = await put(m);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ going: true, open: true });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(await rows()).toEqual([{ user_id: m.userId }]);
    expect((await mine(m)).body).toEqual({ going: true, open: true });
    for (let i = 0; i < 2; i++) {
      const res = await del(m);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ going: false, open: true });
    }
    expect(await rows()).toEqual([]);
  });

  it("needs a signed-in caller (401) with a verified email (403) on PUT; the other routes need a sign-in only", async () => {
    expect((await api.call(putMyExternalGoing, { params: params(), method: "PUT" })).status).toBe(401);
    expect((await api.call(getMyExternalGoing, { params: params() })).status).toBe(401);
    expect((await api.call(deleteMyExternalGoing, { params: params(), method: "DELETE" })).status).toBe(401);
    const unverified = await api.signUp({ emailVerified: false });
    expect((await put(unverified)).status).toBe(403);
    expect(await rows()).toEqual([]);
    expect((await mine(unverified)).status).toBe(200);
    expect((await del(unverified)).status).toBe(200);
  });

  it("is refused for a Sheltüh-ticketed event (409), a missing or malformed one (404)", async () => {
    const m = await api.signUp();
    const res = await put(m, sheltuhEvent);
    expect(res.status).toBe(409);
    expect(await rows(sheltuhEvent)).toEqual([]);
    expect((await put(m, { eventId: crypto.randomUUID() })).status).toBe(404);
    expect((await put(m, { eventId: "nope" })).status).toBe(404);
    expect((await mine(m, { eventId: "nope" })).status).toBe(404);
    // Its status reads as closed, not as an error.
    expect((await mine(m, sheltuhEvent)).body).toEqual({ going: false, open: false });
  });

  it("is refused once the event has ended (409), keeps the old tap out of the count, and undo still works", async () => {
    const m = await api.signUp();
    expect((await put(m)).status).toBe(200);
    await api.db.query(
      `update public.events set starts_at = now() - interval '5 hours', ends_at = now() - interval '1 hour' where id = $1`,
      [event.eventId],
    );
    expect((await put(await api.signUp())).status).toBe(409);
    expect((await mine(m)).body).toEqual({ going: false, open: false });
    expect((await summary()).body).toEqual({ count: 0, closed: true, countHidden: false });
    expect((await del(m)).status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it("is refused for an unpublished event (404), and the public count is 404 too", async () => {
    const m = await api.signUp();
    expect((await put(m)).status).toBe(200);
    await api.call(adminUnpublishEvent, { token: admin.token, params: params(), body: { reason: "x" } });
    expect((await put(await api.signUp())).status).toBe(404);
    expect((await mine(m)).status).toBe(404);
    expect((await summary()).status).toBe(404);
    expect((await del(m)).status).toBe(200);
  });

  it("is limited to 30 taps and undos an hour per member (429), counting both", async () => {
    const m = await api.signUp();
    for (let i = 0; i < EXTERNAL_GOING_RATE_LIMIT.hits; i++) {
      expect((await (i % 2 === 0 ? put(m) : del(m))).status).toBe(200);
    }
    expect((await put(m)).status).toBe(429);
    expect((await del(m)).status).toBe(429);
    // Another member is unaffected.
    expect((await put(await api.signUp())).status).toBe(200);
  });

  it("the database function refuses what the handler would, whoever calls it", async () => {
    const m = await api.signUp();
    const call = async (eventId: string, userId: string) =>
      (await api.db.query<{ r: string }>(`select private.set_external_going($1, $2) as r`, [eventId, userId]))[0].r;
    expect(await call(event.eventId, m.userId)).toBe("going");
    expect(await call(sheltuhEvent.eventId, m.userId)).toBe("not_external");
    expect(await call(crypto.randomUUID(), m.userId)).toBe("event_unavailable");
    expect(await call(event.eventId, crypto.randomUUID())).toBe("user_unavailable");
  });
});

describe("the public count", () => {
  it("is withheld below three (0, 1 and 2 look the same), then shown, cacheable and with no names", async () => {
    const hidden = { count: 0, closed: false, countHidden: true };
    expect((await summary()).body).toEqual(hidden);
    await tap(2);
    expect((await summary()).body).toEqual(hidden);
    await tap(1);
    const res = await summary();
    expect(res.body).toEqual({ count: 3, closed: false, countHidden: false });
    expect(res.headers.get("cache-control")).toMatch(/^public, .*s-maxage=/);
    expect(JSON.stringify(res.body)).not.toMatch(/user|email|name/i);
    await tap(1);
    expect((await summary()).body).toMatchObject({ count: 4 });
  });

  it("is closed for a Sheltüh-ticketed event, and counts only that event", async () => {
    await tap(3);
    expect((await summary(sheltuhEvent)).body).toEqual({ count: 0, closed: true, countHidden: false });
    const other = await publishedEvent(api, organiser, admin, {
      title: "Another",
      ticketingMode: "external",
      externalTicketUrl: HUMANITIX,
      ticketTypes: [],
    });
    expect((await summary(other)).body).toMatchObject({ countHidden: true });
  });

  it("404s for a missing or malformed event id", async () => {
    expect((await summary({ eventId: crypto.randomUUID() })).status).toBe(404);
    expect((await summary({ eventId: "nope" })).status).toBe(404);
  });
});

describe("retention and cascades", () => {
  it("deleting a member's account removes their taps, and the count follows", async () => {
    const members = [await api.signUp(), await api.signUp(), await api.signUp()];
    for (const m of members) expect((await put(m)).status).toBe(200);
    expect((await summary()).body).toMatchObject({ count: 3 });
    await api.db.query(`delete from auth.users where id = $1`, [members[0].userId]);
    expect((await rows()).map((r) => r.user_id).sort()).toEqual([members[1].userId, members[2].userId].sort());
    expect((await summary()).body).toMatchObject({ countHidden: true });
  });

  it("deleting the event removes its taps", async () => {
    await tap(2);
    await api.db.query(`delete from public.events where id = $1`, [event.eventId]);
    expect(await api.db.query(`select 1 from private.external_event_going`)).toEqual([]);
  });

  it("purge_social_data deletes taps 30 days after the event ended, and no sooner", async () => {
    const old = await publishedEvent(api, organiser, admin, {
      title: "Old",
      ticketingMode: "external",
      externalTicketUrl: HUMANITIX,
      ticketTypes: [],
    });
    const m = await api.signUp();
    await put(m, old);
    await put(m, event);
    const endedDaysAgo = (e: EventRecord, days: number) =>
      api.db.query(
        `update public.events set starts_at = now() - make_interval(days => $2) - interval '3 hours',
                                  ends_at = now() - make_interval(days => $2) where id = $1`,
        [e.eventId, days],
      );
    await endedDaysAgo(old, 29);
    await api.db.query(`select * from private.purge_social_data()`);
    expect(await rows(old)).toHaveLength(1);
    await endedDaysAgo(old, 31);
    await api.db.query(`select * from private.purge_social_data()`);
    expect(await rows(old)).toEqual([]);
    expect(await rows(event)).toHaveLength(1);
  });

  it("clients can't reach the table or the functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      const [t] = await api.db.query<{ ok: boolean }>(
        `select has_table_privilege($1, 'private.external_event_going', 'select') as ok`,
        [role],
      );
      expect(t.ok).toBe(false);
      const [f] = await api.db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'private.set_external_going(uuid, uuid)', 'execute') as ok`,
        [role],
      );
      expect(f.ok).toBe(false);
    }
  });
});
