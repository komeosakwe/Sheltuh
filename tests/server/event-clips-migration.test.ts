import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pgConstraint, pgErrorCode, type Db } from "@/lib/server/db";
import { createTestDb } from "./helpers/test-db";

/**
 * supabase/migrations/20261106000000_event_clips.sql (and
 * 20261106000100_event_clip_dimensions.sql's width and height): private.event_clips,
 * its touch trigger, private.put_event_clip / private.delete_event_clip and
 * the `event-clips` bucket, through SQL (the API comes in a later step).
 * Grants and search_path are in schema-grants.test.ts.
 */

let db: Db;
let reset: () => Promise<void>;
let serverUrl: string | undefined;

beforeAll(async () => {
  const testDb = await createTestDb();
  db = testDb.db;
  reset = testDb.reset;
  serverUrl = testDb.url;
});

const ADMIN = "00000000-0000-4000-8000-00000000000a";
const OWNER = "00000000-0000-4000-8000-00000000000b";
const OTHER_OWNER = "00000000-0000-4000-8000-00000000000c";
const MEMBER = "00000000-0000-4000-8000-00000000000d";

let organiserId: string;
let otherOrganiserId: string;

beforeEach(async () => {
  await reset();
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values
       ($1, 'admin@example.com', '{"role":"admin"}'), ($2, 'owner@example.com', '{}'),
       ($3, 'other@example.com', '{}'), ($4, 'member@example.com', '{}')`,
    [ADMIN, OWNER, OTHER_OWNER, MEMBER],
  );
  const organisers = await db.query<{ id: string }>(
    `insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, status)
     values ($1, 'Static Collective', 'hello@static.example', '', '{live-music}', 'approved'),
            ($2, 'Other Collective', 'hello@other.example', '', '{live-music}', 'approved')
     returning id`,
    [OWNER, OTHER_OWNER],
  );
  [organiserId, otherOrganiserId] = organisers.map((o) => o.id);
});

let slugCounter = 0;
async function event(status: string, organiser = organiserId): Promise<string> {
  slugCounter += 1;
  const [row] = await db.query<{ id: string }>(
    `insert into public.events (organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
                                starts_at, ends_at, status)
     values ($1, $2, 'Neon Static', '', 'live-music', 'The Tote', '71 Johnston St', 'Collingwood',
             now() + interval '30 days', now() + interval '30 days 3 hours', $3::public.event_status)
     returning id`,
    [organiser, `neon-static-${slugCounter}`, status],
  );
  return row.id;
}

const path = (eventId: string, upload = crypto.randomUUID()) => `clips/${eventId}/${upload}.mp4`;

interface ClipWrite {
  actor?: string;
  organiser?: string | null;
  path?: string | null;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  description?: string;
  reason?: string | null;
}

async function put(eventId: string, w: ClipWrite = {}) {
  const [row] = await db.query<{ result: string; old_object_path: string | null }>(
    `select * from private.put_event_clip($1::uuid, $2::uuid, $3::uuid, $4::text, $5::integer, $6::integer,
                                          $7::integer, $8::integer, $9::text, $10::text)`,
    [
      eventId,
      w.actor ?? OWNER,
      w.organiser === undefined ? organiserId : w.organiser,
      w.path === undefined ? path(eventId) : w.path,
      w.size ?? 4_000_000,
      w.duration ?? 12_000,
      w.width ?? 1080,
      w.height ?? 1920,
      w.description ?? "Four bands in a warehouse, crowd dancing under red lights.",
      w.reason ?? null,
    ],
  );
  return row;
}

async function del(eventId: string, w: { actor?: string; organiser?: string | null; reason?: string | null } = {}) {
  const [row] = await db.query<{ result: string; old_object_path: string | null }>(
    `select * from private.delete_event_clip($1::uuid, $2::uuid, $3::uuid, $4::text)`,
    [eventId, w.actor ?? OWNER, w.organiser === undefined ? organiserId : w.organiser, w.reason ?? null],
  );
  return row;
}

const asAdmin = { actor: ADMIN, organiser: null };

async function clipRow(eventId: string) {
  const [row] = await db.query<{
    object_path: string;
    size_bytes: number;
    duration_ms: number;
    width: number;
    height: number;
    description: string;
    version: string;
    rights: boolean;
  }>(
    `select object_path, size_bytes, duration_ms, width, height, description,
            floor(extract(epoch from updated_at) * 1000)::bigint::text as version,
            rights_confirmed_at is not null as rights
       from private.event_clips where event_id = $1`,
    [eventId],
  );
  return row;
}

async function eventVersion(eventId: string) {
  const [row] = await db.query<{ v: string }>(
    `select to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') as v from public.events where id = $1`,
    [eventId],
  );
  return row.v;
}

async function backdateEvent(eventId: string) {
  // events_set_updated_at overwrites updated_at on update; switch it off for the backdate.
  await db.query(`alter table public.events disable trigger events_set_updated_at`);
  await db.query(`update public.events set updated_at = updated_at - interval '1 day' where id = $1`, [eventId]);
  await db.query(`alter table public.events enable trigger events_set_updated_at`);
}

async function log(eventId: string) {
  return db.query<{ action: string; actor_id: string; reason: string | null; details: unknown }>(
    `select action::text as action, actor_id, reason, details from public.event_moderation_log
      where event_id = $1 order by id`,
    [eventId],
  );
}

async function expectDbError(promise: Promise<unknown>, code: string, constraint?: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected a database error").not.toBeNull();
  expect(pgErrorCode(err)).toBe(code);
  if (constraint) expect(pgConstraint(err)).toBe(constraint);
}

describe("private.put_event_clip: an organiser", () => {
  it("attaches a clip to their own draft, unlogged, and bumps the event's version", async () => {
    const eventId = await event("draft");
    await backdateEvent(eventId);
    const before = await eventVersion(eventId);
    const objectPath = path(eventId);

    expect(await put(eventId, { path: objectPath })).toEqual({ result: "updated", old_object_path: null });
    expect(await clipRow(eventId)).toMatchObject({
      object_path: objectPath,
      size_bytes: 4_000_000,
      duration_ms: 12_000,
      description: "Four bands in a warehouse, crowd dancing under red lights.",
      rights: true,
    });
    expect(await eventVersion(eventId)).not.toBe(before);
    expect(await log(eventId)).toEqual([]);
  });

  it("can change a rejected event's clip too", async () => {
    const eventId = await event("rejected");
    expect((await put(eventId)).result).toBe("updated");
  });

  it("can't touch a pending or published event: not_editable, nothing written", async () => {
    for (const status of ["pending_review", "published"]) {
      const eventId = await event(status);
      expect(await put(eventId)).toEqual({ result: "not_editable", old_object_path: null });
      expect(await clipRow(eventId)).toBeUndefined();
    }
  });

  it("gets not_found for another organiser's event, an organiser they don't own, or no event", async () => {
    const theirs = await event("draft", otherOrganiserId);
    expect((await put(theirs)).result).toBe("not_found");
    // The right organiser for the event, but the actor doesn't own it.
    expect((await put(theirs, { organiser: otherOrganiserId, actor: OWNER })).result).toBe("not_found");
    expect((await put(theirs, { organiser: otherOrganiserId, actor: ADMIN })).result).toBe("not_found");
    expect((await put(crypto.randomUUID())).result).toBe("not_found");
    expect(await clipRow(theirs)).toBeUndefined();
  });

  it("replaying the same upload with the same description writes nothing; a new description updates it", async () => {
    const eventId = await event("draft");
    const objectPath = path(eventId);
    await put(eventId, { path: objectPath });
    const first = await clipRow(eventId);
    await backdateEvent(eventId);
    const eventBefore = await eventVersion(eventId);

    expect(await put(eventId, { path: objectPath })).toEqual({ result: "unchanged", old_object_path: null });
    expect(await clipRow(eventId)).toEqual(first);
    expect(await eventVersion(eventId)).toBe(eventBefore);

    expect(await put(eventId, { path: objectPath, description: "Crowd shot." })).toEqual({
      result: "updated",
      old_object_path: null,
    });
    const second = await clipRow(eventId);
    expect(second).toMatchObject({ object_path: objectPath, description: "Crowd shot." });
    expect(BigInt(second.version)).toBeGreaterThan(BigInt(first.version));
  });

  it("replacing returns the old object to delete, and always moves the version on", async () => {
    const eventId = await event("draft");
    const oldPath = path(eventId);
    await put(eventId, { path: oldPath });
    // A clip version from the future: the replacement still gets a later one.
    await db.query(`update private.event_clips set updated_at = now() + interval '1 hour' where event_id = $1`, [eventId]);
    const old = await clipRow(eventId);

    const newPath = path(eventId);
    expect(await put(eventId, { path: newPath, size: 9_000_000, duration: 15_500 })).toEqual({
      result: "updated",
      old_object_path: oldPath,
    });
    const replaced = await clipRow(eventId);
    expect(replaced).toMatchObject({ object_path: newPath, size_bytes: 9_000_000, duration_ms: 15_500 });
    expect(BigInt(replaced.version)).toBe(BigInt(old.version) + BigInt(1));
  });

  it("a description-only change (no path) needs a clip", async () => {
    const eventId = await event("draft");
    expect(await put(eventId, { path: null, description: "Crowd shot." })).toEqual({
      result: "no_clip",
      old_object_path: null,
    });
    const objectPath = path(eventId);
    await put(eventId, { path: objectPath });
    expect(await put(eventId, { path: null, description: "Crowd shot." })).toEqual({
      result: "updated",
      old_object_path: null,
    });
    expect(await clipRow(eventId)).toMatchObject({ object_path: objectPath, description: "Crowd shot." });
    expect((await put(eventId, { path: null, description: "Crowd shot." })).result).toBe("unchanged");
  });
});

describe("private.delete_event_clip: an organiser", () => {
  it("removes their draft's clip and returns its object; a second call is unchanged", async () => {
    const eventId = await event("draft");
    const objectPath = path(eventId);
    await put(eventId, { path: objectPath });
    await backdateEvent(eventId);
    const before = await eventVersion(eventId);

    expect(await del(eventId)).toEqual({ result: "deleted", old_object_path: objectPath });
    expect(await clipRow(eventId)).toBeUndefined();
    expect(await eventVersion(eventId)).not.toBe(before);
    expect(await del(eventId)).toEqual({ result: "unchanged", old_object_path: null });
    expect(await log(eventId)).toEqual([]);
  });

  it("can't remove a published event's clip, or another organiser's", async () => {
    const eventId = await event("draft");
    await put(eventId);
    await db.query(`update public.events set status = 'published' where id = $1`, [eventId]);
    expect(await del(eventId)).toEqual({ result: "not_editable", old_object_path: null });
    expect(await clipRow(eventId)).toBeDefined();

    const theirs = await event("draft", otherOrganiserId);
    await put(theirs, { actor: OTHER_OWNER, organiser: otherOrganiserId });
    expect((await del(theirs)).result).toBe("not_found");
    expect(await clipRow(theirs)).toBeDefined();
  });
});

describe("an admin (no organiser)", () => {
  it("changes a published event's clip, logged 'edited' with the versions, description and reason", async () => {
    const eventId = await event("published");
    const firstPath = path(eventId);
    expect(await put(eventId, { ...asAdmin, path: firstPath, description: "Crowd shot.", reason: "Organiser's request" })).toEqual({
      result: "updated",
      old_object_path: null,
    });
    const first = await clipRow(eventId);

    expect(await put(eventId, { ...asAdmin, path: null, description: "Crowd shot, red lights." })).toEqual({
      result: "updated",
      old_object_path: null,
    });
    const second = await clipRow(eventId);

    const secondPath = path(eventId);
    expect(await put(eventId, { ...asAdmin, path: secondPath, description: "Crowd shot, red lights." })).toEqual({
      result: "updated",
      old_object_path: firstPath,
    });
    const third = await clipRow(eventId);

    // Nothing to change: nothing logged.
    expect((await put(eventId, { ...asAdmin, path: secondPath, description: "Crowd shot, red lights." })).result).toBe(
      "unchanged",
    );

    expect(await del(eventId, { ...asAdmin, reason: "Takedown" })).toEqual({ result: "deleted", old_object_path: secondPath });
    expect((await del(eventId, asAdmin)).result).toBe("unchanged");

    expect(await log(eventId)).toEqual([
      {
        action: "edited",
        actor_id: ADMIN,
        reason: "Organiser's request",
        details: {
          clip: { old: null, new: first.version },
          clipDescription: { old: null, new: "Crowd shot." },
        },
      },
      {
        action: "edited",
        actor_id: ADMIN,
        reason: null,
        details: { clipDescription: { old: "Crowd shot.", new: "Crowd shot, red lights." } },
      },
      { action: "edited", actor_id: ADMIN, reason: null, details: { clip: { old: second.version, new: third.version } } },
      { action: "edited", actor_id: ADMIN, reason: "Takedown", details: { clip: { old: third.version, new: null } } },
    ]);
  });

  it("works whatever the status", async () => {
    for (const status of ["draft", "pending_review", "rejected", "published"]) {
      const eventId = await event(status);
      expect((await put(eventId, asAdmin)).result).toBe("updated");
      expect((await del(eventId, asAdmin)).result).toBe("deleted");
    }
    expect((await put(crypto.randomUUID(), asAdmin)).result).toBe("not_found");
  });

  it("refuses an actor who isn't an admin, whatever the API passed", async () => {
    const eventId = await event("published");
    await expectDbError(put(eventId, { actor: MEMBER, organiser: null }), "42501");
    await expectDbError(put(eventId, { actor: OWNER, organiser: null }), "42501");
    await expectDbError(del(eventId, { actor: MEMBER, organiser: null }), "42501");
    expect(await clipRow(eventId)).toBeUndefined();
  });
});

describe("private.event_clips constraints", () => {
  it("binds the object path to its event and the server's naming", async () => {
    const eventId = await event("draft");
    const other = await event("draft");
    for (const bad of [
      path(other),
      `uploads/${eventId}/${crypto.randomUUID()}.mp4`,
      `clips/${eventId}/${crypto.randomUUID()}.mov`,
      `clips/${eventId}/../${crypto.randomUUID()}.mp4`,
      `clips/${eventId}/${crypto.randomUUID().toUpperCase()}.mp4`,
      `clips/${eventId}/x.mp4`,
    ]) {
      await expectDbError(put(eventId, { path: bad }), "23514", "event_clips_object_path_check");
    }
  });

  it("goes with its event (on delete cascade)", async () => {
    const eventId = await event("draft");
    const objectPath = path(eventId);
    await put(eventId, { path: objectPath });
    await db.query(`delete from public.events where id = $1`, [eventId]);
    expect(await clipRow(eventId)).toBeUndefined();
  });

  it("bounds the size it's shown at: each side 1–4096, at most 2.1 megapixels", async () => {
    const eventId = await event("draft");
    await expectDbError(put(eventId, { width: 0 }), "23514", "event_clips_width_check");
    await expectDbError(put(eventId, { height: 4097 }), "23514", "event_clips_height_check");
    await expectDbError(put(eventId, { width: 2000, height: 1100 }), "23514", "event_clips_pixels_check");
    expect((await put(eventId, { width: 1920, height: 1080 })).result).toBe("updated");
    expect(await clipRow(eventId)).toMatchObject({ width: 1920, height: 1080 });
  });

  it("a description-only change, or a replay, keeps the stored size", async () => {
    const eventId = await event("draft");
    const objectPath = path(eventId);
    await put(eventId, { path: objectPath, width: 1280, height: 720 });
    await put(eventId, { path: null, width: 99, height: 99, description: "Now with a new description." });
    await put(eventId, { path: objectPath, width: 98, height: 98, description: "And again." });
    expect(await clipRow(eventId)).toMatchObject({ width: 1280, height: 720, description: "And again." });
  });

  it("bounds size, duration and description", async () => {
    const eventId = await event("draft");
    await expectDbError(put(eventId, { size: 0 }), "23514", "event_clips_size_bytes_check");
    await expectDbError(put(eventId, { size: 10 * 1024 * 1024 + 1 }), "23514", "event_clips_size_bytes_check");
    await expectDbError(put(eventId, { duration: 0 }), "23514", "event_clips_duration_ms_check");
    await expectDbError(put(eventId, { duration: 15_501 }), "23514", "event_clips_duration_ms_check");
    for (const description of ["", " Crowd shot.", "Crowd shot. ", "x".repeat(301)]) {
      await expectDbError(put(eventId, { description }), "23514", "event_clips_description_check");
    }
    expect((await put(eventId, { size: 10 * 1024 * 1024, duration: 15_500, description: "x".repeat(300) })).result).toBe(
      "updated",
    );
  });
});

describe("the event-clips bucket", () => {
  it("is private, capped at 10 MB, MP4 or QuickTime, with no storage policies", async () => {
    expect(
      await db.query(
        `select id, name, public, file_size_limit::text as limit, allowed_mime_types as types from storage.buckets`,
      ),
    ).toEqual([
      { id: "event-clips", name: "event-clips", public: false, limit: "10485760", types: ["video/mp4", "video/quicktime"] },
    ]);
    const [policies] = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_policy p join pg_class c on c.oid = p.polrelid
         join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'storage'`,
    );
    expect(policies.n).toBe(0);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrency (real Postgres only)", () => {
  async function waitUntilBlocked(conn: postgres.Sql) {
    const [{ pid }] = await conn.unsafe("select pg_backend_pid() as pid");
    return async () => {
      for (let i = 0; ; i++) {
        const [row] = await db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (row?.wait_event_type === "Lock") return;
        if (i > 200) throw new Error("never blocked");
        await new Promise((r) => setTimeout(r, 25));
      }
    };
  }

  const putSql = `select result from private.put_event_clip($1::uuid, $2::uuid, $3::uuid, $4::text, 4000000, 12000, 1080, 1920, 'Crowd shot.', null)`;

  it("an attach waiting on a submit sees the submitted event and writes nothing", async () => {
    const eventId = await event("draft");
    const one = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const two = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      await one.unsafe("begin");
      const [{ moved }] = await one.unsafe(
        `select private.transition_event($1, array['draft']::public.event_status[], 'pending_review', 'submitted', $2, null, $3) as moved`,
        [eventId, OWNER, organiserId],
      );
      expect(moved).toBe(true);
      const blocked = await waitUntilBlocked(two);
      const pending = two.unsafe(putSql, [eventId, OWNER, organiserId, path(eventId)]).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("not_editable");
      expect(await clipRow(eventId)).toBeUndefined();
    } finally {
      await one.end();
      await two.end();
    }
  });

  it("attach and submit at once: either the clip lands before the submit, or it's refused", async () => {
    for (let round = 0; round < 8; round++) {
      const eventId = await event("draft");
      const one = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
      const two = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
      try {
        const [[attach], [submit]] = await Promise.all([
          two.unsafe(putSql, [eventId, OWNER, organiserId, path(eventId)]),
          one.unsafe(
            `select private.transition_event($1, array['draft']::public.event_status[], 'pending_review', 'submitted', $2, null, $3) as moved`,
            [eventId, OWNER, organiserId],
          ),
        ]);
        expect(submit.moved).toBe(true);
        expect(["updated", "not_editable"]).toContain(attach.result);
        expect(Boolean(await clipRow(eventId))).toBe(attach.result === "updated");
      } finally {
        await one.end();
        await two.end();
      }
    }
  });

  it("an admin's clip writes and the organiser's and admin's photo writes on one event never deadlock", async () => {
    const eventId = await event("draft");
    const conns = Array.from({ length: 4 }, () => postgres(serverUrl as string, { max: 1, onnotice: () => {} }));
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    try {
      for (let round = 0; round < 6; round++) {
        const results = await Promise.allSettled([
          conns[0].unsafe(putSql, [eventId, ADMIN, null, path(eventId)]),
          // The organiser's photo upload, as lib/server/handlers/event-images.ts writes it.
          conns[1].unsafe(
            `insert into public.event_images (event_id, content_type, data)
             select e.id, 'image/jpeg', $2::bytea from public.events e
              where e.id = $1 and e.organiser_id = $3 and e.status in ('draft', 'rejected') for no key update of e
             on conflict (event_id) do update set data = excluded.data, updated_at = now()`,
            [eventId, jpeg, organiserId],
          ),
          conns[2].unsafe(`select private.admin_put_event_image($1, $2, 'image/jpeg', $3::bytea)`, [eventId, ADMIN, jpeg]),
          conns[3].unsafe(`select * from private.delete_event_clip($1, $2, $3, null)`, [eventId, OWNER, organiserId]),
        ]);
        for (const r of results) expect(r.status, r.status === "rejected" ? String(r.reason) : "").toBe("fulfilled");
      }
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  });
});
