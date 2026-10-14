import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_FAVOURITES } from "@/lib/api/types";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { deleteFavourite, listFavouriteIds, listFavourites, putFavourite } from "@/lib/server/handlers/favourites";
import type { EventRecord } from "@/lib/server/types";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let serverUrl: string | undefined;

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
  event = await publishedEvent(api, organiser, admin);
});

const params = (e: { eventId: string } = event) => ({ eventId: e.eventId });
const put = (token: string | undefined, e: { eventId: string } = event) =>
  api.call(putFavourite, { token, params: params(e), method: "PUT" });
const del = (token: string | undefined, e: { eventId: string } = event) =>
  api.call(deleteFavourite, { token, params: params(e), method: "DELETE" });
const list = (token: string | undefined, query?: Record<string, string>) => api.call(listFavourites, { token, query });
const ids = (token: string | undefined) => api.call(listFavouriteIds, { token });

async function rows(userId: string) {
  return api.db.query<{ event_id: string }>(`select event_id from public.event_favourites where user_id = $1`, [userId]);
}

/** Inserts favourites directly (for the cap), on a fresh published event each. */
async function fillFavourites(userId: string, count: number) {
  await api.db.query(
    `insert into public.event_favourites (user_id, event_id)
     select $1, e.id from public.events e where e.status = 'published' limit $2`,
    [userId, count],
  );
}

describe("favouriting", () => {
  it("needs a signed-in caller, but not a verified email", async () => {
    expect((await put(undefined)).status).toBe(401);
    expect((await del(undefined)).status).toBe(401);
    expect((await list(undefined)).status).toBe(401);
    expect((await ids(undefined)).status).toBe(401);

    const unverified = await api.signUp({ emailVerified: false });
    const res = await put(unverified.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eventId: event.eventId, favourited: true });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await rows(unverified.userId)).toEqual([{ event_id: event.eventId }]);
  });

  it("is idempotent, and concurrent PUTs leave one row", async () => {
    const m = await api.signUp();
    const results = await Promise.all(Array.from({ length: 5 }, () => put(m.token)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await rows(m.userId)).toHaveLength(1);
  });

  it("is a 404 for an unknown, malformed, draft or unpublished event", async () => {
    const m = await api.signUp();
    const draft = await draftEvent(api, organiser);
    for (const eventId of [crypto.randomUUID(), "not-a-uuid", draft.eventId]) {
      const res = await put(m.token, { eventId });
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    await api.call(adminUnpublishEvent, { token: admin.token, params: params(), body: { reason: "x" } });
    expect((await put(m.token)).status).toBe(404);
    expect(await rows(m.userId)).toEqual([]);
  });

  it(`caps each account at ${MAX_FAVOURITES}, counting hidden (unpublished) favourites too`, async () => {
    const m = await api.signUp();
    // MAX_FAVOURITES published events, the shared `event` among them.
    await api.db.query(
      `insert into public.events (organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
                                  starts_at, ends_at, status)
       select $1, 'bulk-' || g, 'Bulk ' || g, '', 'art', 'V', 'A', 'S', now() + interval '1 day', now() + interval '2 days', 'published'
         from generate_series(1, $2) g`,
      [organiser.organiserId, MAX_FAVOURITES],
    );
    await fillFavourites(m.userId, MAX_FAVOURITES - 1);
    const [{ id: spare }] = await api.db.query<{ id: string }>(
      `select e.id from public.events e where e.status = 'published'
          and not exists (select 1 from public.event_favourites f where f.event_id = e.id and f.user_id = $1) limit 1`,
      [m.userId],
    );
    const [{ id: another }] = await api.db.query<{ id: string }>(
      `select e.id from public.events e where e.status = 'published' and e.id <> $2
          and not exists (select 1 from public.event_favourites f where f.event_id = e.id and f.user_id = $1) limit 1`,
      [m.userId, spare],
    );

    expect((await put(m.token, { eventId: spare })).status).toBe(200);
    const over = await put(m.token, { eventId: another });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatch(/500/);
    // Re-favouriting one you have is still fine at the cap.
    expect((await put(m.token, { eventId: spare })).status).toBe(200);
    expect(await rows(m.userId)).toHaveLength(MAX_FAVOURITES);

    // A favourite whose event is unpublished still counts (rows are kept)...
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [spare]);
    expect((await put(m.token, { eventId: another })).status).toBe(409);
    // ...until it's removed.
    expect((await del(m.token, { eventId: spare })).status).toBe(200);
    expect((await put(m.token, { eventId: another })).status).toBe(200);
  });

  it("concurrent adds can't pass the cap (real Postgres serialises them; PGlite runs them one by one)", async () => {
    const m = await api.signUp();
    const extra = await Promise.all(Array.from({ length: 4 }, () => publishedEvent(api, organiser, admin)));
    const [{ result }] = await api.db.query<{ result: string }>(`select private.add_favourite($1, $2, 2) as result`, [
      m.userId,
      event.eventId,
    ]);
    expect(result).toBe("added");
    const results = await Promise.all(
      extra.map((e) =>
        api.db.query<{ result: string }>(`select private.add_favourite($1, $2, 2) as result`, [m.userId, e.eventId]),
      ),
    );
    expect(results.map(([r]) => r.result).sort()).toEqual(["added", "limit", "limit", "limit"]);
    expect(await rows(m.userId)).toHaveLength(2);
  });
});

// Needs two sessions at once, which only a real server has (PGlite is one
// connection). Run with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("the cap under forced interleaving (real Postgres only)", () => {
  it("a second add waits for the first to commit, then sees the cap", async () => {
    const m = await api.signUp();
    const second = await publishedEvent(api, organiser, admin);
    const first = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const other = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      // The first add, left uncommitted: its row is invisible to the second's count.
      await first.unsafe("begin");
      expect((await first.unsafe(`select private.add_favourite($1, $2, 1) as r`, [m.userId, event.eventId]))[0].r).toBe(
        "added",
      );
      const [{ pid }] = await other.unsafe("select pg_backend_pid() as pid");
      const pending = other.unsafe(`select private.add_favourite($1, $2, 1) as r`, [m.userId, second.eventId]).execute();
      // Wait until the second is blocked on the account's lock.
      for (let i = 0; ; i++) {
        const [row] = await api.db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (row?.wait_event_type === "Lock") break;
        if (i > 200) throw new Error("the second add never blocked");
        await new Promise((r) => setTimeout(r, 25));
      }
      await first.unsafe("commit");
      expect((await pending)[0].r).toBe("limit");
    } finally {
      await first.end();
      await other.end();
    }
    expect(await rows(m.userId)).toEqual([{ event_id: event.eventId }]);
  });
});

describe("removing", () => {
  it("is idempotent", async () => {
    const m = await api.signUp();
    await put(m.token);
    for (let i = 0; i < 2; i++) {
      const res = await del(m.token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ eventId: event.eventId, favourited: false });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(await rows(m.userId)).toEqual([]);
  });

  it("works for a favourite whose event was unpublished, but is a 404 for an unpublished event without one", async () => {
    const m = await api.signUp();
    const other = await api.signUp();
    await put(m.token);
    await api.call(adminUnpublishEvent, { token: admin.token, params: params(), body: { reason: "x" } });
    // Someone without a favourite learns nothing about the unpublished event.
    expect((await del(other.token)).status).toBe(404);
    expect((await del(m.token, { eventId: crypto.randomUUID() })).status).toBe(404);
    expect((await del(m.token, { eventId: "nope" })).status).toBe(404);
    expect((await del(m.token)).status).toBe(200);
    expect(await rows(m.userId)).toEqual([]);
  });

  it("only ever removes the caller's own favourite", async () => {
    const a = await api.signUp();
    const b = await api.signUp();
    await put(a.token);
    await put(b.token);
    await del(a.token);
    expect(await rows(a.userId)).toEqual([]);
    expect(await rows(b.userId)).toEqual([{ event_id: event.eventId }]);
  });
});

describe("listing", () => {
  it("lists only the caller's published favourites, newest favourite first, in the feed's public shape", async () => {
    const m = await api.signUp();
    const other = await api.signUp();
    const second = await publishedEvent(api, organiser, admin, { title: "Second" });
    const third = await publishedEvent(api, organiser, admin, { title: "Third" });
    await put(m.token, event);
    await put(m.token, second);
    await put(m.token, third);
    await put(other.token, event);
    // Distinct, known times (several inserts can share one now()).
    await api.db.query(
      `update public.event_favourites set created_at = case event_id
         when $2::uuid then now() - interval '3 hours' when $3::uuid then now() - interval '1 hour' else now() - interval '2 hours' end
        where user_id = $1`,
      [m.userId, event.eventId, second.eventId],
    );
    await api.call(adminUnpublishEvent, { token: admin.token, params: params(third), body: { reason: "x" } });

    const res = await list(m.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.items.map((e: { eventId: string }) => e.eventId)).toEqual([second.eventId, event.eventId]);
    expect(res.body.nextCursor).toBeUndefined();
    const item = res.body.items[1];
    expect(Object.keys(item).sort()).toEqual(
      [
        "organiserId",
        "eventId",
        "slug",
        "title",
        "description",
        "category",
        "venueName",
        "venueAddress",
        "suburb",
        "startsAt",
        "endsAt",
        "organiserName",
        "ticketTypes",
        "favouritedAt",
      ].sort(),
    );
    expect(item).not.toHaveProperty("status");
    expect(item).not.toHaveProperty("moderationLog");

    const idsRes = await ids(m.token);
    expect(idsRes.status).toBe(200);
    expect(idsRes.headers.get("cache-control")).toBe("private, no-store");
    expect(idsRes.body).toEqual({ eventIds: [second.eventId, event.eventId] });

    // Republishing brings the kept row back.
    await api.db.query(`update public.events set status = 'published' where id = $1`, [third.eventId]);
    expect((await ids(m.token)).body.eventIds).toContain(third.eventId);
  });

  it("paginates", async () => {
    const m = await api.signUp();
    const events = [event, ...(await Promise.all([1, 2].map(() => publishedEvent(api, organiser, admin))))];
    for (const e of events) await put(m.token, e);
    const first = await list(m.token, { limit: "2" });
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await list(m.token, { limit: "2", cursor: first.body.nextCursor });
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeUndefined();
    const seen = [...first.body.items, ...second.body.items].map((e: { eventId: string }) => e.eventId).sort();
    expect(seen).toEqual(events.map((e) => e.eventId).sort());
    expect((await list(m.token, { cursor: "garbage" })).status).toBe(400);
  });

  it("pages over published favourites only, so hidden ones never shorten a page or add an empty one", async () => {
    const m = await api.signUp();
    const [a, b, hidden] = await Promise.all([1, 2, 3].map(() => publishedEvent(api, organiser, admin)));
    for (const e of [a, b, hidden]) await put(m.token, e);
    // The hidden one is the newest favourite.
    await api.db.query(
      `update public.event_favourites set created_at = now() + case when event_id = $2 then interval '1 hour' else interval '0' end
        where user_id = $1`,
      [m.userId, hidden.eventId],
    );
    await api.call(adminUnpublishEvent, { token: admin.token, params: params(hidden), body: { reason: "x" } });
    const page = await list(m.token, { limit: "2" });
    expect(page.body.items).toHaveLength(2);
    expect(page.body.nextCursor).toBeUndefined();
  });
});

describe("deletion", () => {
  it("deleting the account or the event deletes its favourites", async () => {
    const a = await api.signUp();
    const b = await api.signUp();
    const second = await publishedEvent(api, organiser, admin);
    await put(a.token);
    await put(b.token);
    await put(b.token, second);
    await api.db.query(`delete from auth.users where id = $1`, [a.userId]);
    expect(await rows(a.userId)).toEqual([]);
    await api.db.query(`delete from public.events where id = $1`, [second.eventId]);
    expect(await rows(b.userId)).toEqual([{ event_id: event.eventId }]);
  });
});
