import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewEventStart } from "@/lib/server/admin-review-email";
import { PG_CHECK_VIOLATION, pgConstraint, pgErrorCode } from "@/lib/server/db";
import { adminApproveEvent } from "@/lib/server/handlers/admin";
import { buildFollowerNewEventsEmail } from "@/lib/server/follower-email";
import { buildFreeConfirmationEmail } from "@/lib/server/free-confirmation-email";
import { adminCreateEvent, adminGetEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { createEventDraft, getMyEvent, submitEventForReview, updateEventDraft } from "@/lib/server/handlers/events";
import { findEventById } from "@/lib/server/handlers/event-queries";
import { listFavourites, putFavourite } from "@/lib/server/handlers/favourites";
import { createCheckout, getOrderBySession, getOrderPayment } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { getTrendingEvents } from "@/lib/server/handlers/trending";
import { buildTicketEmail, formatTicketTime, ticketEmailRefundPolicy, ticketWhen } from "@/lib/server/ticket-email";
import type { AdminEventRecord, EventRecord, OrderRecord } from "@/lib/server/types";
import { DST_GAP_MESSAGE } from "@/lib/server/validation";
import { buildWaitlistAvailableEmail, when, where } from "@/lib/server/waitlist-email";
import { passTimeZone, passWhen } from "@/lib/server/wallet/pass-content";
import { STATE_CODES, wallClockParts, ZONES_BY_STATE } from "@/lib/time-zones";
import { TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, eventInput, insertOrder, publishedEvent, setUpPayouts, signUpAdmin, suburbPin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * Events Australia-wide, steps S3 and S4: every event has a state and an IANA
 * zone (supabase/migrations/20261110000000_event_place_time_zone.sql), read
 * everywhere its times are, and accepted on write (lib/server/event-input.ts
 * parsePlace).
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const PLACE_MIGRATION = "20261110000000_event_place_time_zone.sql";

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The fixture's event (8:00 pm – 11:30 pm on Sat 6 March 2027, local) in Fremantle, on Perth time. */
const PERTH = { suburb: "Fremantle", state: "WA", timeZone: "Australia/Perth" };
/** PERTH with the organiser's pin, which submitting needs (`location_required`). */
const PERTH_PINNED = { ...PERTH, location: suburbPin("Fremantle", "WA") };
/** 8:00 pm in Perth (+08:00, no daylight saving) and in Melbourne (+11:00 in March). */
const PERTH_8PM = "2027-03-06T12:00:00.000Z";
const MELBOURNE_8PM = "2027-03-06T09:00:00.000Z";

const create = (body: unknown, token = organiser.token) => api.call(createEventDraft, { token, body });
const organiserPatch = (eventId: string, body: unknown) =>
  api.call(updateEventDraft, { token: organiser.token, params: { eventId }, body, method: "PATCH" });
const adminPatch = (eventId: string, body: unknown) =>
  api.call(adminUpdateEvent, { token: admin.token, params: { eventId }, body, method: "PATCH" });

async function stored(eventId: string) {
  const [row] = await api.db.query<{ state: string; time_zone: string; suburb: string; starts_at: Date; ends_at: Date }>(
    `select state, time_zone, suburb, starts_at, ends_at from public.events where id = $1`,
    [eventId],
  );
  return { ...row, starts_at: new Date(row.starts_at).toISOString(), ends_at: new Date(row.ends_at).toISOString() };
}

/** The admin PATCH body that saves `event` with the fixture's fields and `overrides`. */
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

async function adminEvent(eventId: string): Promise<AdminEventRecord> {
  return (await api.call(adminGetEvent, { token: admin.token, params: { eventId } })).body as AdminEventRecord;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe("the columns", () => {
  it("an event that predates the migration reads VIC, Australia/Melbourne", { timeout: 120_000 }, async () => {
    const pg = new PGlite();
    try {
      await pg.exec(readFileSync(path.join(ROOT, "supabase/test/supabase-stubs.sql"), "utf8"));
      const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files.filter((f) => f < PLACE_MIGRATION)) {
        await pg.exec(readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8"));
      }
      await pg.exec(`
        insert into public.organisers (id, owner_user_id, display_name, contact_email, description, categories, status)
        values ('00000000-0000-0000-0000-0000000000a1', null, 'Old Org', 'old@sheltuh.example', 'Old.', '{art}', 'approved');
        insert into public.events (id, organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
                                   starts_at, ends_at)
        values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'old-event', 'Old', 'Old.',
                'art', 'Hall', '1 Main St', 'Fitzroy', '2027-01-01T09:00:00Z', '2027-01-01T12:00:00Z');`);
      await pg.exec(readFileSync(path.join(ROOT, "supabase/migrations", PLACE_MIGRATION), "utf8"));
      const { rows } = await pg.query(`select state, time_zone from public.events`);
      expect(rows).toEqual([{ state: "VIC", time_zone: "Australia/Melbourne" }]);
    } finally {
      await pg.close();
    }
  });

  it("events_place_check allows exactly the pairs in ZONES_BY_STATE (lib/time-zones.ts)", { timeout: 60_000 }, async () => {
    const event = await draftEvent(api, organiser);
    const allZones = [...new Set(Object.values(ZONES_BY_STATE).flat()), "Australia/Canberra", "UTC", ""];
    const states = [...STATE_CODES, "XX", "vic", ""];
    const allowed: string[] = [];
    for (const state of states) {
      for (const zone of allZones) {
        try {
          await api.db.query(`update public.events set state = $2, time_zone = $3 where id = $1`, [event.eventId, state, zone]);
          allowed.push(`${state} ${zone}`);
        } catch (err) {
          expect(pgErrorCode(err), `${state} ${zone}`).toBe(PG_CHECK_VIOLATION);
          expect(pgConstraint(err)).toBe("events_place_check");
        }
      }
    }
    const expected = STATE_CODES.flatMap((state) => ZONES_BY_STATE[state].map((zone) => `${state} ${zone}`));
    expect(allowed.sort()).toEqual(expected.sort());
  });

  it("refuses a missing state or zone", async () => {
    const event = await draftEvent(api, organiser);
    for (const column of ["state", "time_zone"]) {
      await expect(api.db.query(`update public.events set ${column} = null where id = $1`, [event.eventId])).rejects.toThrow();
    }
  });
});

describe("the database knows every zone", () => {
  /** Every zone an event may use: SQL reads its start `at time zone` the event's (public-events.ts, onOrAfter). */
  const ZONES = [...new Set(Object.values(ZONES_BY_STATE).flat())].sort();
  /** A winter instant (no daylight saving anywhere), besides the fixture's March start (daylight saving in the south-east). */
  const JULY = "2027-07-15T02:00:00.000Z";

  /** "YYYY-MM-DD HH:mm" in `zone` by the runtime's (ICU's) zone data. */
  function jsLocal(instant: string | Date, zone: string): string {
    const parts = wallClockParts(instant, zone);
    return `${parts.date} ${parts.time}`;
  }

  it("now() and an event's starts_at convert in each, agreeing with the runtime's zone data", { timeout: 60_000 }, async () => {
    const event = await draftEvent(api, organiser);
    const unknown: string[] = [];
    for (const zone of ZONES) {
      let row: { now_local: unknown; starts_local: string; july_local: string; starts_at: Date | string };
      try {
        [row] = await api.db.query(
          `select now() at time zone $1 as now_local,
                  to_char(starts_at at time zone $1, 'YYYY-MM-DD HH24:MI') as starts_local,
                  to_char($3::timestamptz at time zone $1, 'YYYY-MM-DD HH24:MI') as july_local,
                  starts_at
             from public.events where id = $2`,
          [zone, event.eventId, JULY],
        );
      } catch (err) {
        // Collected rather than thrown at the first, so a failure names every zone missing.
        if (err instanceof Error && /time zone .* not recognized/i.test(err.message)) {
          unknown.push(zone);
          continue;
        }
        throw err;
      }
      expect(row.now_local, zone).toBeTruthy();
      // Postgres's zone data and the runtime's agree on the wall clock, daylight saving included.
      expect(row.starts_local, `${zone} starts_at`).toBe(jsLocal(new Date(row.starts_at), zone));
      expect(row.july_local, `${zone} July`).toBe(jsLocal(JULY, zone));
    }
    expect(unknown, "zones this Postgres doesn't know").toEqual([]);
    expect(ZONES).toHaveLength(13);
  });

  it("each is in pg_timezone_names, and DEPLOYMENT.md's Supabase check lists exactly these", async () => {
    const rows = await api.db.query<{ name: string }>(
      `select name from pg_timezone_names where name = any($1::text[]) order by name`,
      [ZONES],
    );
    expect(rows.map((r) => r.name)).toEqual(ZONES);
    const deployment = readFileSync(path.join(ROOT, "docs/DEPLOYMENT.md"), "utf8");
    const listed = /from pg_timezone_names where name = any\('\{([^}]+)\}'\)/.exec(deployment)?.[1].split(",").sort();
    expect(listed).toEqual(ZONES);
  });

  it("an unknown zone is an error, not a silent UTC (so the checks above can fail)", async () => {
    await expect(api.db.query(`select now() at time zone $1`, ["Australia/Nowhere"])).rejects.toThrow(/not recognized/i);
  });
});

// ---------------------------------------------------------------------------
// Writing (S4)
// ---------------------------------------------------------------------------

describe("POST /api/events", () => {
  it("reads the times in the zone sent, and saves the state, zone and the locality's name", async () => {
    const res = await create(eventInput({ ...PERTH, suburb: "fremantle" }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ state: "WA", timeZone: "Australia/Perth", suburb: "Fremantle", startsAt: PERTH_8PM });
    expect(res.body.endsAt).toBe("2027-03-06T15:30:00.000Z");
    expect(await stored(res.body.eventId)).toMatchObject({ state: "WA", time_zone: "Australia/Perth", suburb: "Fremantle" });
  });

  it("without state and timeZone: Melbourne, and the suburb as typed (older clients)", async () => {
    const res = await create(eventInput({ suburb: "collingwood " }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ state: "VIC", timeZone: "Australia/Melbourne", suburb: "collingwood", startsAt: MELBOURNE_8PM });
  });

  it("saves the canonical name: a name shared across states stays in the state sent", async () => {
    const nsw = await create(eventInput({ suburb: "Richmond", state: "NSW", timeZone: "Australia/Sydney" }));
    expect(nsw.status).toBe(201);
    expect(nsw.body).toMatchObject({ suburb: "Richmond NSW", state: "NSW", timeZone: "Australia/Sydney" });
    // As the API returned it: found again, in the same state.
    const again = await organiserPatch(nsw.body.eventId, eventInput({ suburb: "Richmond NSW", state: "NSW", timeZone: "Australia/Sydney" }));
    expect(again.status).toBe(200);
    expect(again.body.suburb).toBe("Richmond NSW");

    const vic = await create(eventInput({ suburb: "Richmond", state: "VIC", timeZone: "Australia/Melbourne" }));
    expect(vic.body).toMatchObject({ suburb: "Richmond", state: "VIC" });
    const brisbane = await create(eventInput({ suburb: "Brisbane", state: "QLD", timeZone: "Australia/Brisbane" }));
    expect(brisbane.body).toMatchObject({ suburb: "Brisbane City", state: "QLD" });
  });

  it("accepts any zone the state uses, not only its default", async () => {
    const res = await create(eventInput({ suburb: "Broken Hill", state: "NSW", timeZone: "Australia/Broken_Hill" }));
    expect(res.status).toBe(201);
    // +10:30 in March (daylight saving).
    expect(res.body.startsAt).toBe("2027-03-06T09:30:00.000Z");
  });

  it("400 for a bad state, a zone the state doesn't use, or only one of the two", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ state: "XX", timeZone: "Australia/Perth" }, "state"],
      [{ state: "wa", timeZone: "Australia/Perth" }, "state"],
      [{ state: 6, timeZone: "Australia/Perth" }, "state"],
      [{ state: "WA", timeZone: "Australia/Melbourne" }, "timeZone"],
      [{ state: "ACT", timeZone: "Australia/Canberra" }, "timeZone"],
      [{ state: "WA", timeZone: "" }, "timeZone"],
      [{ state: "WA" }, "timeZone"],
      [{ timeZone: "Australia/Perth" }, "state"],
      [{ state: "WA", timeZone: null }, "timeZone"],
    ];
    for (const [place, field] of cases) {
      const res = await create(eventInput({ suburb: "Fremantle", ...place }));
      expect(res.status, JSON.stringify(place)).toBe(400);
      expect(Object.keys(res.body.fieldErrors), JSON.stringify(place)).toEqual([field]);
    }
    expect((await api.db.query(`select 1 from public.events`)).length).toBe(0);
  });

  it("400 fieldErrors.suburb for a suburb not in the state, with a near spelling when there is one", async () => {
    const elsewhere = await create(eventInput({ suburb: "Fremantle", state: "VIC", timeZone: "Australia/Melbourne" }));
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body.fieldErrors).toEqual({
      suburb: "We couldn't find that suburb in VIC. Check the spelling, or add the state it's in (“Richmond, NSW”).",
    });

    const typo = await create(eventInput({ suburb: "Fremantel", state: "WA", timeZone: "Australia/Perth" }));
    expect(typo.status).toBe(400);
    expect(typo.body.fieldErrors).toEqual({ suburb: "We couldn't find that suburb in WA. Did you mean Fremantle, WA?" });

    // Reported with the other fields' errors, all at once.
    const both = await create(eventInput({ suburb: "Nowhereville", title: "", state: "SA", timeZone: "Australia/Adelaide" }));
    expect(Object.keys(both.body.fieldErrors).sort()).toEqual(["suburb", "title"]);
  });

  it("400 fieldErrors.start / end for a time the clocks skip (Sydney, 2:30 am on the first Sunday of October)", async () => {
    const place = { suburb: "Sydney", state: "NSW", timeZone: "Australia/Sydney" };
    const gap = await create(eventInput({ ...place, start: { date: "2027-10-03", time: "02:30" }, end: { date: "2027-10-03", time: "05:00" } }));
    expect(gap.status).toBe(400);
    expect(gap.body.fieldErrors).toEqual({ start: DST_GAP_MESSAGE });
    const endGap = await create(eventInput({ ...place, start: { date: "2027-10-02", time: "23:00" }, end: { date: "2027-10-03", time: "02:15" } }));
    expect(endGap.body.fieldErrors).toEqual({ end: DST_GAP_MESSAGE });
    // Not a gap in Brisbane (no daylight saving), nor in Perth.
    const brisbane = await create(
      eventInput({ suburb: "Brisbane", state: "QLD", timeZone: "Australia/Brisbane", start: { date: "2027-10-03", time: "02:30" }, end: { date: "2027-10-03", time: "05:00" } }),
    );
    expect(brisbane.status).toBe(201);
    expect(brisbane.body.startsAt).toBe("2027-10-02T16:30:00.000Z");
  });

  it("a time the clocks repeat (Adelaide, 2:30 am on the first Sunday of April) is the earlier one", async () => {
    const res = await create(
      eventInput({
        suburb: "Adelaide",
        state: "SA",
        timeZone: "Australia/Adelaide",
        start: { date: "2027-04-04", time: "02:30" },
        end: { date: "2027-04-04", time: "05:00" },
      }),
    );
    expect(res.status).toBe(201);
    // ACDT (+10:30), not ACST (+09:30).
    expect(res.body.startsAt).toBe("2027-04-03T16:00:00.000Z");
  });
});

describe("PATCH /api/events/{id}", () => {
  it("an older client re-saving a Perth event keeps its place and reads the times in Perth time", async () => {
    const created = (await create(eventInput(PERTH))).body as EventRecord;
    const res = await organiserPatch(created.eventId, eventInput({ suburb: "Fremantle", title: "Renamed" }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Renamed", state: "WA", timeZone: "Australia/Perth", startsAt: PERTH_8PM });
    expect(await stored(created.eventId)).toMatchObject({ state: "WA", time_zone: "Australia/Perth", starts_at: PERTH_8PM });
  });

  it("a Melbourne event round-trips unchanged without the fields", async () => {
    const created = await draftEvent(api, organiser);
    const res = await organiserPatch(created.eventId, eventInput());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "VIC", timeZone: "Australia/Melbourne", startsAt: MELBOURNE_8PM, suburb: "Collingwood" });
  });

  it("moves an event to another state with both fields, the times read in its new zone", async () => {
    const created = await draftEvent(api, organiser);
    const res = await organiserPatch(created.eventId, eventInput(PERTH));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "WA", timeZone: "Australia/Perth", suburb: "Fremantle", startsAt: PERTH_8PM });
    const own = await api.call(getMyEvent, { token: organiser.token, params: { eventId: created.eventId } });
    expect(own.body).toMatchObject({ state: "WA", timeZone: "Australia/Perth" });
  });

  it("400 with only one of the two, and nothing saved", async () => {
    const created = (await create(eventInput(PERTH))).body as EventRecord;
    const res = await organiserPatch(created.eventId, eventInput({ state: "SA" }));
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ timeZone: expect.any(String) });
    expect(await stored(created.eventId)).toMatchObject({ state: "WA", time_zone: "Australia/Perth", starts_at: PERTH_8PM });
  });
});

describe("admin authoring", () => {
  it("POST /admin/events takes the place like the organiser's create", async () => {
    const res = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput(PERTH), organiserId: organiser.organiserId },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ state: "WA", timeZone: "Australia/Perth", startsAt: PERTH_8PM });
    const bad = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ state: "TAS" }), organiserId: "nope" },
    });
    expect(Object.keys(bad.body.fieldErrors).sort()).toEqual(["organiserId", "timeZone"]);
  });

  it("an admin edit logs state and timeZone (old and new) with the moved times", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const res = await adminPatch(event.eventId, adminBody(await adminEvent(event.eventId), PERTH));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "WA", timeZone: "Australia/Perth", startsAt: PERTH_8PM });
    const [entry] = (res.body as AdminEventRecord).moderationLog.filter((e) => e.action === "edited");
    const changes = entry.changes!;
    expect(Object.keys(changes).sort()).toEqual(["endsAt", "startsAt", "state", "suburb", "timeZone"]);
    expect(changes).toMatchObject({
      suburb: { old: "Collingwood", new: "Fremantle" },
      state: { old: "VIC", new: "WA" },
      timeZone: { old: "Australia/Melbourne", new: "Australia/Perth" },
    });
    // Instants with an offset (the session's): the same local 8 pm, three hours later.
    const instant = (value: unknown) => new Date(value as string).toISOString();
    expect([instant(changes.startsAt!.old), instant(changes.startsAt!.new)]).toEqual([MELBOURNE_8PM, PERTH_8PM]);
    expect([instant(changes.endsAt!.old), instant(changes.endsAt!.new)]).toEqual(["2027-03-06T12:30:00.000Z", "2027-03-06T15:30:00.000Z"]);
  });

  it("an admin edit without the fields keeps the stored place and logs nothing for it", async () => {
    const created = (await create(eventInput(PERTH))).body as EventRecord;
    const unchanged = await adminPatch(created.eventId, adminBody(await adminEvent(created.eventId), { suburb: "Fremantle" }));
    expect(unchanged.status).toBe(200);
    expect(unchanged.body).toMatchObject({ state: "WA", timeZone: "Australia/Perth", startsAt: PERTH_8PM });
    expect((unchanged.body as AdminEventRecord).moderationLog.filter((e) => e.action === "edited")).toEqual([]);

    const renamed = await adminPatch(created.eventId, adminBody(await adminEvent(created.eventId), { suburb: "Fremantle", title: "Renamed" }));
    const [entry] = (renamed.body as AdminEventRecord).moderationLog.filter((e) => e.action === "edited");
    expect(entry.changes).toEqual({ title: { old: "Neon Static", new: "Renamed" } });
  });

  it("the DST gap and the suburb check apply to admin edits too, before anything is written", async () => {
    const created = await draftEvent(api, organiser);
    const res = await adminPatch(
      created.eventId,
      adminBody(await adminEvent(created.eventId), {
        suburb: "Hobart",
        state: "TAS",
        timeZone: "Australia/Hobart",
        start: { date: "2027-10-03", time: "02:00" },
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ start: DST_GAP_MESSAGE });
    expect(await stored(created.eventId)).toMatchObject({ state: "VIC" });
  });
});

// ---------------------------------------------------------------------------
// Reading (S3)
// ---------------------------------------------------------------------------

describe("payloads carry the place", () => {
  async function perthPublished() {
    const draft = (await create(eventInput(PERTH_PINNED))).body as EventRecord;
    await setUpPayouts(api, organiser.organiserId);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    const approved = await api.call(adminApproveEvent, { token: admin.token, params: { eventId: draft.eventId }, method: "POST" });
    expect(approved.status).toBe(200);
    return approved.body as EventRecord;
  }

  it("the public list, the slug, favourites and trending", async () => {
    const perth = await perthPublished();
    // Trending takes at most 2 events per organiser.
    const other = await approvedOrganiser(api, admin, { displayName: "Other Collective" });
    const others = [await publishedEvent(api, organiser, admin), await publishedEvent(api, other, admin)];
    const place = { state: "WA", timeZone: "Australia/Perth" };

    const bySlug = await api.call(getPublicEventBySlug, { params: { slug: perth.slug } });
    expect(bySlug.body).toMatchObject(place);
    const list = await api.call(listPublicEvents, { query: {} });
    expect(list.body.items.find((e: EventRecord) => e.eventId === perth.eventId)).toMatchObject(place);
    expect(list.body.items.find((e: EventRecord) => e.eventId === others[0].eventId)).toMatchObject({
      state: "VIC",
      timeZone: "Australia/Melbourne",
    });

    const member = await api.signUp();
    await api.call(putFavourite, { token: member.token, params: { eventId: perth.eventId }, method: "PUT" });
    const favourites = await api.call(listFavourites, { token: member.token });
    expect(favourites.body.items[0]).toMatchObject({ eventId: perth.eventId, ...place });

    // Three favourited events, starting in three days, make the trending list.
    for (const event of [perth, ...others]) {
      await api.db.query(
        `update public.events set starts_at = now() + interval '3 days', ends_at = now() + interval '3 days 3 hours' where id = $1`,
        [event.eventId],
      );
      await api.db.query(
        `with u as (insert into auth.users (id, email)
                    select gen_random_uuid(), gen_random_uuid()::text || '@fan.example' from generate_series(1, 3) returning id)
         insert into public.event_favourites (user_id, event_id, created_at) select id, $1, now() - interval '1 day' from u`,
        [event.eventId],
      );
    }
    // Approved at least 6 hours before.
    await api.db.query(`select private.refresh_trending(now() + interval '7 hours')`);
    const trending = await api.call(getTrendingEvents);
    expect(trending.body.items).toHaveLength(3);
    expect(trending.body.items.find((i: { event: EventRecord }) => i.event.eventId === perth.eventId).event).toMatchObject(place);
  });

  it("the ticket page and the payment page send the event's zone and state with its times", async () => {
    const perth = await perthPublished();
    const orderId = await insertOrder(api, perth, "fan@example.com", "paid");
    const order = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(order.body).toMatchObject({ eventStartsAt: PERTH_8PM, eventTimeZone: "Australia/Perth", eventState: "WA" });
    // The wallet passes take the zone from the same lookup.
    expect(passTimeZone(order.body)).toBe("Australia/Perth");
    expect(passWhen({ startsAt: PERTH_8PM, endsAt: perth.endsAt, timeZone: passTimeZone(order.body) })).toBe(
      "Sat 6 Mar, 8:00 pm – 11:30 pm AWST",
    );

    // Not while the event isn't published: no times, so no zone either.
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [perth.eventId]);
    const unlisted = await api.call(getOrderBySession, { params: { sessionId: orderId } });
    expect(unlisted.body).not.toHaveProperty("eventTimeZone");
    expect(unlisted.body).not.toHaveProperty("eventState");
    await api.db.query(`update public.events set status = 'published' where id = $1`, [perth.eventId]);

    const checkout = await api.call(createCheckout, {
      params: { eventId: perth.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }], buyerEmail: "fan@example.com" },
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(checkout.status).toBe(201);
    const payment = await api.call(getOrderPayment, {
      params: { sessionId: checkout.body.orderId },
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(payment.body).toMatchObject({ status: "open", eventStartsAt: PERTH_8PM, eventTimeZone: "Australia/Perth", eventState: "WA" });
  });
});

describe("GET /api/events?onOrAfter", () => {
  it("compares each event's start date in its own zone", async () => {
    // 11 pm on 6 March in Perth is 2 am on 7 March in Melbourne.
    const perthLate = await publishedEvent(api, organiser, admin, {
      ...PERTH,
      title: "Perth late",
      start: { date: "2027-03-06", time: "23:00" },
      end: { date: "2027-03-07", time: "01:00" },
    });
    // 12:30 am on 7 March in Melbourne is still 6 March in UTC.
    const melbourneEarly = await publishedEvent(api, organiser, admin, {
      title: "Melbourne early",
      start: { date: "2027-03-07", time: "00:30" },
      end: { date: "2027-03-07", time: "03:00" },
    });
    const ids = async (onOrAfter: string) =>
      ((await api.call(listPublicEvents, { query: { onOrAfter } })).body.items as EventRecord[]).map((e) => e.title).sort();

    expect(await ids("2027-03-06")).toEqual(["Melbourne early", "Perth late"]);
    expect(await ids("2027-03-07")).toEqual(["Melbourne early"]);
    expect(await ids("2027-03-08")).toEqual([]);
    expect(perthLate.startsAt).toBe("2027-03-06T15:00:00.000Z");
    expect(melbourneEarly.startsAt).toBe("2027-03-06T13:30:00.000Z");

    expect((await api.call(listPublicEvents, { query: { onOrAfter: "2027-02-30" } })).status).toBe(400);
    expect((await api.call(listPublicEvents, { query: { onOrAfter: "7 March" } })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

describe("emails say the event's own time", () => {
  const order = {
    orderId: "ord_abc",
    buyerEmail: "fan@example.com",
    totalCents: 6400,
    status: "paid",
    tickets: [{ ticketCode: "ABCD-EFGH", ticketTypeId: "ga", ticketTypeName: "GA" }],
  } as OrderRecord;

  it("the ticket email: Perth time (AWST), and the refund deadline in Perth time", async () => {
    const created = (await create(eventInput({ ...PERTH, refundPolicy: "days_before", refundDays: 7 }))).body as EventRecord;
    const event = { ...(await findEventById(api.db, created.eventId))!, status: "published" } as EventRecord;
    const email = buildTicketEmail(order, event, "https://sheltuh.com.au", new Date("2027-01-01T00:00:00Z"));
    expect(email.text).toContain("Date: Saturday 6 March 2027\nTime: 8:00 pm – 11:30 pm Perth time (AWST)");
    expect(email.html).toContain("8:00 pm – 11:30 pm Perth time (AWST)");
    expect(ticketEmailRefundPolicy(order, event, new Date("2027-01-01T00:00:00Z"))).toBe(
      "Refunds available until Sat 27 Feb, 8:00 pm (7 days before the event).",
    );
  });

  it("ACDT in Adelaide, and Canberra's label for the ACT", () => {
    const adelaide = { timeZone: "Australia/Adelaide", state: "SA" as const };
    expect(formatTicketTime("2027-03-06T09:30:00.000Z", "2027-03-06T12:00:00.000Z", adelaide)).toBe(
      "8:00 pm – 10:30 pm Adelaide time (ACDT)",
    );
    expect(formatTicketTime("2027-07-06T10:00:00.000Z", undefined, { timeZone: "Australia/Sydney", state: "ACT" })).toBe(
      "8:00 pm Canberra time (AEST)",
    );
  });

  it("crossing midnight is judged in the event's zone, not Melbourne's", () => {
    // 10 pm – 1 am in Perth (Sat to Sun) is 1 am – 4 am on Sunday in Melbourne.
    const start = "2027-03-06T14:00:00.000Z";
    const end = "2027-03-06T17:00:00.000Z";
    expect(ticketWhen(start, end, { timeZone: "Australia/Perth", state: "WA" })).toEqual({
      date: "Saturday 6 March – Sunday 7 March 2027",
      lines: ["Starts Saturday 6 March, 10:00 pm Perth time (AWST)", "Ends Sunday 7 March, 1:00 am Perth time (AWST)"],
    });
    expect(ticketWhen(start, end)).toEqual({ date: "Sunday 7 March 2027", lines: ["1:00 am – 4:00 am AEDT"] });
  });

  it("Melbourne's output is unchanged whether or not the zone is given", () => {
    const event = {
      title: "Paint",
      venueName: "Studio 5",
      venueAddress: "5 Smith St",
      suburb: "Fitzroy",
      startsAt: MELBOURNE_8PM,
      endsAt: "2027-03-06T11:00:00.000Z",
      status: "published",
    } as EventRecord;
    const now = new Date("2027-01-01T00:00:00Z");
    const plain = buildTicketEmail(order, event, "https://sheltuh.com.au", now);
    const zoned = buildTicketEmail(order, { ...event, state: "VIC", timeZone: "Australia/Melbourne" }, "https://sheltuh.com.au", now);
    expect(zoned.text).toBe(plain.text);
    expect(zoned.html).toBe(plain.html);
    expect(plain.text).toContain("Time: 8:00 pm – 10:00 pm AEDT");
    expect(when(event)).toBe("Saturday 6 March 2027, 8:00 pm – 10:00 pm AEDT");
    expect(reviewEventStart(MELBOURNE_8PM)).toBe("Saturday 6 March 2027, 8:00 pm AEDT");
  });

  it("waitlist, follower and free-confirmation emails use the event's zone", async () => {
    const created = (await create(eventInput(PERTH))).body as EventRecord;
    const event = (await findEventById(api.db, created.eventId))!;
    const line = "Saturday 6 March 2027, 8:00 pm – 11:30 pm Perth time (AWST)";
    expect(buildWaitlistAvailableEmail("fan@example.com", event, "https://x/e", "https://x/l").text).toContain(line);
    // The place as "Suburb, STATE" (owner decision D4).
    expect(where(event)).toBe(`${event.venueName}, Fremantle, WA`);
    expect(
      buildFollowerNewEventsEmail({
        to: "fan@example.com",
        organiserName: "Static",
        organiserId: event.organiserId,
        events: [event],
        total: 1,
        siteUrl: "https://x",
        unsubscribeLink: "https://x/u",
      }).text,
    ).toContain(line);
    expect(
      buildFreeConfirmationEmail("fan@example.com", event, [{ ticketTypeId: "ga", ticketTypeName: "GA", quantity: 1, unitPriceCents: 0, feePolicy: "buyer-pays" }], "https://x/c", 24).text,
    ).toContain(line);
  });

  it("the admins' review email reads the event's zone from the database", async () => {
    await setUpPayouts(api, organiser.organiserId);
    await api.runDeferred();
    api.sendEmail.mockClear();
    const created = (await create(eventInput(PERTH_PINNED))).body as EventRecord;
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: created.eventId }, method: "POST" });
    await api.runDeferred();
    const [[message]] = api.sendEmail.mock.calls;
    expect(message.text).toContain("Starts Saturday 6 March 2027, 8:00 pm Perth time (AWST)");
  });
});
