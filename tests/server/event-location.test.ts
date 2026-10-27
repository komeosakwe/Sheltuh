import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AUSTRALIA_BOUNDS } from "@/lib/geo";
import { PG_CHECK_VIOLATION, pgConstraint, pgErrorCode } from "@/lib/server/db";
import { PIN_OUTSIDE_AUSTRALIA } from "@/lib/server/event-input";
import { adminCreateEvent, adminGetEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { publishEvent } from "@/lib/server/handlers/event-publish";
import { createEventDraft, getMyEvent, submitEventForReview, updateEventDraft } from "@/lib/server/handlers/events";
import {
  PIN_RECHECK,
  PLACE_NOT_FOUND,
  PLACE_NOT_IN_AUSTRALIA,
  PLACES_PLATFORM_DAILY_CAPS,
  PLACES_QUOTA_TIME_ZONE,
  PLACES_RATE_LIMITS,
  PLACES_TOO_MANY,
  PLACES_UNAVAILABLE,
} from "@/lib/server/handlers/places";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { LOCATION_REQUIRED } from "@/lib/server/location-refusal";
import { PAYOUTS_REQUIRED_TO_PUBLISH } from "@/lib/server/payouts-refusal";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import type { AdminEventRecord, EventRecord, OrderRecord } from "@/lib/server/types";
import { AUCKLAND_PLACE_ID, SYDNEY_PLACE_ID, TestApi, TOTE_PLACE_ID } from "./helpers/api";
import { approvedOrganiser, draftEvent, eventInput, setUpPayouts, signUpAdmin, suburbPin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * An event's venue location (supabase/migrations/20261111000100_event_venue_location.sql;
 * docs/architecture.md, "Venue location"): a Google place id and the
 * organiser's own pin, never Google's coordinates; a confirmed pin needed to
 * publish or submit (owner decisions A-D1 and A-D3).
 */

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

/** The Tote's door, as an organiser would pin it (Collingwood VIC). */
const TOTE_PIN = { lat: -37.79794, lng: 144.98884 };
const MANUAL = { source: "manual_pin", pin: TOTE_PIN };
const PLACES = { source: "places", placeId: TOTE_PLACE_ID, pin: TOTE_PIN };

const create = (body: unknown, token = organiser.token) => api.call(createEventDraft, { token, body });
const patch = (eventId: string, body: unknown, token = organiser.token) =>
  api.call(updateEventDraft, { token, params: { eventId }, body, method: "PATCH" });
const publish = (eventId: string, token = organiser.token) =>
  api.call(publishEvent, { token, params: { eventId }, method: "POST" });
const submit = (eventId: string, token = organiser.token) =>
  api.call(submitEventForReview, { token, params: { eventId }, method: "POST" });

async function stored(eventId: string) {
  const [row] = await api.db.query<{ location_source: string; venue_place_id: string | null; venue_lat: number | null; venue_lng: number | null }>(
    `select location_source, venue_place_id, venue_lat, venue_lng from public.events where id = $1`,
    [eventId],
  );
  return { ...row, venue_lat: row.venue_lat === null ? null : Number(row.venue_lat), venue_lng: row.venue_lng === null ? null : Number(row.venue_lng) };
}

async function dbError(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (err) {
    return { code: pgErrorCode(err), constraint: pgConstraint(err) };
  }
  return {};
}

/** The admin PATCH body that saves `event` with the fixture's fields and `overrides`. */
function adminBody(event: AdminEventRecord, overrides: Record<string, unknown> = {}) {
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
// The columns
// ---------------------------------------------------------------------------

describe("the columns", () => {
  const setLocation = (eventId: string, source: string, placeId: string | null, lat: number | null, lng: number | null) =>
    api.db.query(
      `update public.events set location_source = $2, venue_place_id = $3, venue_lat = $4, venue_lng = $5 where id = $1`,
      [eventId, source, placeId, lat, lng],
    );

  it("an event saved without a location is legacy, with nothing stored and no `location` in any payload", async () => {
    const event = await draftEvent(api, organiser, { location: undefined });
    // draftEvent's default pin only applies without a `location` key: this one has the key, undefined (not sent).
    expect(await stored(event.eventId)).toEqual({ location_source: "legacy", venue_place_id: null, venue_lat: null, venue_lng: null });
    expect(event).not.toHaveProperty("location");
    const created = await api.call(adminCreateEvent, {
      token: admin.token,
      body: {
        ...eventInput({ title: "Admin listed", ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }] }),
        organiserId: organiser.organiserId,
        publish: true,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("location");
    const pub = await api.call(getPublicEventBySlug, { params: { slug: created.body.slug } });
    expect(pub.status).toBe(200);
    expect(pub.body).not.toHaveProperty("location");
  });

  it("events_venue_pin_bounds agrees with AUSTRALIA_BOUNDS (lib/geo.ts): the bounds themselves in, a hair past each out", async () => {
    const event = await draftEvent(api, organiser);
    const b = AUSTRALIA_BOUNDS;
    const mid = { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
    for (const [lat, lng] of [[b.south, mid.lng], [b.north, mid.lng], [mid.lat, b.west], [mid.lat, b.east]]) {
      await setLocation(event.eventId, "manual_pin", null, lat, lng);
    }
    const past = 0.000001;
    for (const [lat, lng] of [
      [b.south - past, mid.lng],
      [b.north + past, mid.lng],
      [mid.lat, b.west - past],
      [mid.lat, b.east + past],
      [Number.NaN, mid.lng],
      [mid.lat, Number.POSITIVE_INFINITY],
    ]) {
      expect(await dbError(setLocation(event.eventId, "manual_pin", null, lat, lng)), `${lat},${lng}`).toEqual({
        code: PG_CHECK_VIOLATION,
        constraint: "events_venue_pin_bounds",
      });
    }
  });

  it("refuses every combination the sources don't allow", async () => {
    const event = await draftEvent(api, organiser);
    const { lat, lng } = TOTE_PIN;
    const refused: [string, string | null, number | null, number | null, string][] = [
      ["legacy", null, lat, lng, "events_location_source_check"],
      ["legacy", TOTE_PLACE_ID, null, null, "events_location_source_check"],
      ["places", null, lat, lng, "events_location_source_check"],
      ["manual_pin", null, null, null, "events_location_source_check"],
      ["manual_pin", TOTE_PLACE_ID, lat, lng, "events_location_source_check"],
      ["google", null, lat, lng, "events_location_source_check"],
      ["manual_pin", null, lat, null, "events_venue_pin_pair"],
      ["places", "short", null, null, "events_venue_place_id_shape"],
      ["places", "ChIJ has spaces in it!", null, null, "events_venue_place_id_shape"],
    ];
    for (const [source, placeId, pinLat, pinLng, constraint] of refused) {
      expect(await dbError(setLocation(event.eventId, source, placeId, pinLat, pinLng)), `${source} ${placeId} ${pinLat}`).toEqual({
        code: PG_CHECK_VIOLATION,
        constraint,
      });
    }
    // Allowed: a place without a pin yet, a place with one, a pin alone, none.
    await setLocation(event.eventId, "places", TOTE_PLACE_ID, null, null);
    await setLocation(event.eventId, "places", TOTE_PLACE_ID, lat, lng);
    await setLocation(event.eventId, "manual_pin", null, lat, lng);
    await setLocation(event.eventId, "legacy", null, null, null);
  });

  it("the new and redefined functions pin search_path, aren't security definer or client-executable", async () => {
    const names = ["admin_edit_event", "create_event_draft", "edit_event_draft", "event_location_json", "publish_event", "submit_event"];
    const rows = await api.db.query<{ fn: string; pinned: boolean; definer: boolean; client: boolean }>(
      `select p.proname as fn,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as pinned,
              p.prosecdef as definer,
              has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as client
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any($1::text[]) order by 1`,
      [names],
    );
    expect(rows).toEqual(names.map((fn) => ({ fn, pinned: true, definer: false, client: false })));
    const columns = await api.db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `select column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'events'
          and column_name in ('location_source', 'venue_place_id', 'venue_lat', 'venue_lng') order by 1`,
    );
    expect(columns).toEqual([
      { column_name: "location_source", is_nullable: "NO", column_default: "'legacy'::text" },
      { column_name: "venue_lat", is_nullable: "YES", column_default: null },
      { column_name: "venue_lng", is_nullable: "YES", column_default: null },
      { column_name: "venue_place_id", is_nullable: "YES", column_default: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

describe("the organiser saves a location", () => {
  it("a Google place with the organiser's pin: checked with Google once, only the id and the pin stored", async () => {
    const res = await create(eventInput({ location: { ...PLACES, pin: { lat: -37.797941234, lng: 144.988836789 } } }));
    expect(res.status).toBe(201);
    // Rounded to 6 decimal places.
    expect(res.body.location).toEqual({ source: "places", placeId: TOTE_PLACE_ID, pin: { lat: -37.797941, lng: 144.988837 } });
    expect(api.places!.calls).toEqual([{ method: "verify", placeId: TOTE_PLACE_ID }]);
    expect(await stored(res.body.eventId)).toEqual({
      location_source: "places",
      venue_place_id: TOTE_PLACE_ID,
      venue_lat: -37.797941,
      venue_lng: 144.988837,
    });
    // The organiser's own fields stay what they typed (Google's address isn't written).
    expect(res.body).toMatchObject({ venueName: "The Tote", venueAddress: "71 Johnston St", suburb: "Collingwood" });
    expect((await api.call(getMyEvent, { token: organiser.token, params: { eventId: res.body.eventId } })).body.location).toEqual(
      res.body.location,
    );
  });

  it("a Google place before its pin is checked: saved, with no coordinates at all (never Google's)", async () => {
    const res = await create(eventInput({ location: { source: "places", placeId: TOTE_PLACE_ID } }));
    expect(res.status).toBe(201);
    expect(res.body.location).toEqual({ source: "places", placeId: TOTE_PLACE_ID });
    expect(await stored(res.body.eventId)).toMatchObject({ venue_lat: null, venue_lng: null });
  });

  it("a manual pin: no Google call, and it works without a Google key", async () => {
    api.places = undefined;
    const res = await create(eventInput({ location: MANUAL }));
    expect(res.status).toBe(201);
    expect(res.body.location).toEqual(MANUAL);
  });

  it("Google is asked only when the place id is new or changed", async () => {
    const event = (await create(eventInput({ location: { source: "places", placeId: TOTE_PLACE_ID } }))).body as EventRecord;
    expect(api.places!.count("verify")).toBe(1);
    // The same place, now with its pin: no call.
    const pinned = await patch(event.eventId, eventInput({ location: PLACES }));
    expect(pinned.status).toBe(200);
    expect(pinned.body.location).toEqual(PLACES);
    // No location sent: the stored one is kept, no call.
    const kept = await patch(event.eventId, eventInput({ title: "Renamed" }));
    expect(kept.status).toBe(200);
    expect(kept.body.location).toEqual(PLACES);
    expect(api.places!.count("verify")).toBe(1);
    // A manual pin, then the place again: asked again (it's new to the event).
    expect((await patch(event.eventId, eventInput({ location: MANUAL }))).body.location).toEqual(MANUAL);
    expect((await patch(event.eventId, eventInput({ location: PLACES }))).status).toBe(200);
    expect(api.places!.count("verify")).toBe(2);
  });

  it("null clears it: legacy again, and the payloads drop `location`", async () => {
    const event = await draftEvent(api, organiser, { location: PLACES });
    const res = await patch(event.eventId, eventInput({ location: null }));
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("location");
    expect(await stored(event.eventId)).toEqual({ location_source: "legacy", venue_place_id: null, venue_lat: null, venue_lng: null });
  });

  it("a place Google doesn't know, or outside Australia: 400 fieldErrors.location, nothing saved", async () => {
    const event = await draftEvent(api, organiser);
    for (const [placeId, message] of [
      ["ChIJunknownPlaceId00000001", PLACE_NOT_FOUND],
      [AUCKLAND_PLACE_ID, PLACE_NOT_IN_AUSTRALIA],
    ]) {
      const res = await patch(event.eventId, eventInput({ location: { source: "places", placeId } }));
      expect(res.status, placeId).toBe(400);
      expect(res.body.fieldErrors).toEqual({ location: message });
    }
    expect((await stored(event.eventId)).location_source).toBe("manual_pin");
    const created = await create(eventInput({ title: "Elsewhere", location: { source: "places", placeId: AUCKLAND_PLACE_ID } }));
    expect(created.status).toBe(400);
    const [{ count }] = await api.db.query<{ count: number }>(`select count(*)::int as count from public.events where title = 'Elsewhere'`);
    expect(count).toBe(0);
  });

  it("a place in another state than the event's: 400 fieldErrors.suburb", async () => {
    const res = await create(eventInput({ location: { source: "places", placeId: SYDNEY_PLACE_ID } }));
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({
      suburb: "That Google Maps place is in NSW, but Collingwood is in VIC. Check the suburb, or search for the venue again.",
    });
    // In Sydney, it's fine.
    const sydney = await create(
      eventInput({
        suburb: "Sydney",
        state: "NSW",
        timeZone: "Australia/Sydney",
        location: { source: "places", placeId: SYDNEY_PLACE_ID, pin: { lat: -33.8568, lng: 151.2153 } },
      }),
    );
    expect(sydney.status).toBe(201);
  });

  it("Google down, or no key: 503 places_unavailable with fieldErrors.location, nothing saved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    api.places!.failing = true;
    const down = await create(eventInput({ title: "Down", location: PLACES }));
    expect(down.status).toBe(503);
    expect(down.body).toMatchObject({ code: "places_unavailable", fieldErrors: { location: PLACES_UNAVAILABLE } });
    expect(down.headers.get("cache-control")).toBe("private, no-store");
    api.places = undefined;
    const unset = await create(eventInput({ title: "Down", location: PLACES }));
    expect(unset.status).toBe(503);
    expect(unset.body.code).toBe("places_unavailable");
    const [{ count }] = await api.db.query<{ count: number }>(`select count(*)::int as count from public.events where title = 'Down'`);
    expect(count).toBe(0);
    // A manual pin still saves.
    expect((await create(eventInput({ title: "Down", location: MANUAL }))).status).toBe(201);
  });

  it("a pin outside Australia, far from the suburb, or malformed: 400 fieldErrors.location", async () => {
    const cases: [unknown, string | RegExp][] = [
      [{ source: "manual_pin", pin: { lat: -36.8485, lng: 174.7633 } }, PIN_OUTSIDE_AUSTRALIA], // Auckland
      [{ source: "manual_pin", pin: { lat: 37.8, lng: 144.9 } }, PIN_OUTSIDE_AUSTRALIA],
      // Geelong, about 70 km from Collingwood.
      [{ source: "manual_pin", pin: { lat: -38.1499, lng: 144.3617 } }, /^The pin is more than 10 km outside Collingwood, VIC\. Move it onto the venue, or check the suburb\.$/],
      [{ source: "places", placeId: TOTE_PLACE_ID, pin: { lat: -38.1499, lng: 144.3617 } }, /^The pin is more than 10 km outside Collingwood, VIC\. Move it onto the venue, or check the suburb\.$/],
      [{ source: "manual_pin", pin: { lat: "-37.8", lng: "144.9" } }, "Put the pin on the venue."],
      [{ source: "manual_pin" }, "Put the pin on the venue."],
      [{ source: "manual_pin", pin: TOTE_PIN, placeId: TOTE_PLACE_ID }, "A dropped pin has no Google Maps place."],
      [{ source: "places", placeId: "not a place id" }, /^That Google Maps place isn't valid\./],
      [{ source: "places" }, /^That Google Maps place isn't valid\./],
      [{ source: "geocoder", pin: TOTE_PIN }, "Find the venue on Google Maps, or drop a pin on the map."],
      ["Collingwood", "Find the venue on Google Maps, or drop a pin on the map."],
      [[TOTE_PIN], "Find the venue on Google Maps, or drop a pin on the map."],
    ];
    for (const [location, message] of cases) {
      const res = await create(eventInput({ location }));
      expect(res.status, JSON.stringify(location)).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["location"]);
      if (typeof message === "string") expect(res.body.fieldErrors.location).toBe(message);
      else expect(res.body.fieldErrors.location).toMatch(message);
    }
    // Nothing asked of Google for a refused body.
    expect(api.places!.calls).toEqual([]);
  });

  it("an event save's Google check takes the account's details allowance: 429 fieldErrors.location past it, without asking Google", async () => {
    const [hourly] = PLACES_RATE_LIMITS.details;
    await api.db.query(`select private.take_rate_limit($1, $2, $3, $4::interval) from generate_series(1, $3)`, [
      organiser.userId,
      hourly.bucket,
      hourly.hits,
      hourly.window,
    ]);
    const event = await draftEvent(api, organiser);
    const res = await patch(event.eventId, eventInput({ location: PLACES }));
    expect(res.status).toBe(429);
    expect(res.body.fieldErrors).toEqual({ location: PLACES_TOO_MANY });
    const created = await create(eventInput({ title: "Limited", location: PLACES }));
    expect(created.status).toBe(429);
    expect(api.places!.calls).toEqual([]);
    expect((await stored(event.eventId)).location_source).toBe("manual_pin");
    // A manual pin, or the same place again, needs no Google check, so no allowance.
    expect((await patch(event.eventId, eventInput({ location: { source: "manual_pin", pin: { lat: -37.798, lng: 144.9888 } } }))).status).toBe(200);
  });

  it("an event save's Google check counts against the platform's daily cap: 503 places_unavailable past it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits)
       values ($1::text || ':' || to_char(now() at time zone $2, 'YYYY-MM-DD'), now(), $3)`,
      [PLACES_PLATFORM_DAILY_CAPS.details.bucket, PLACES_QUOTA_TIME_ZONE, PLACES_PLATFORM_DAILY_CAPS.details.hits],
    );
    const res = await create(eventInput({ location: PLACES }));
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: "places_unavailable", fieldErrors: { location: PLACES_UNAVAILABLE } });
    expect(api.places!.calls).toEqual([]);
    // Each check takes one from the account (the refused one too: the account's allowance is taken first)
    // and one from the platform.
    await api.db.query(`delete from private.platform_rate_limits`);
    expect((await create(eventInput({ location: PLACES }))).status).toBe(201);
    const [{ hits }] = await api.db.query<{ hits: number }>(
      `select hits from private.rate_limits where user_id = $1 and bucket = 'places_details_daily'`,
      [organiser.userId],
    );
    expect(hits).toBe(2);
    const [{ hits: platform }] = await api.db.query<{ hits: number }>(
      `select hits from private.platform_rate_limits where bucket like 'places_details_day:%'`,
    );
    expect(platform).toBe(1);
  });

  it("a new suburb or state without `location` while a pin or place is stored: 400 check the pin again, nothing saved", async () => {
    const pinned = await draftEvent(api, organiser);
    const placed = await draftEvent(api, organiser, { title: "Placed", location: PLACES });
    const moves = [
      { suburb: "Fitzroy" },
      { suburb: "Surry Hills", state: "NSW", timeZone: "Australia/Sydney" },
    ];
    for (const event of [pinned, placed]) {
      for (const move of moves) {
        const res = await patch(event.eventId, eventInput({ title: event.title, ...move }));
        expect(res.status, JSON.stringify(move)).toBe(400);
        expect(res.body.fieldErrors).toEqual({ location: PIN_RECHECK });
      }
      expect((await stored(event.eventId)).location_source).not.toBe("legacy");
      const [{ suburb }] = await api.db.query<{ suburb: string }>(`select suburb from public.events where id = $1`, [event.eventId]);
      expect(suburb).toBe("Collingwood");
    }
    // The same suburb (in any case), or a move that sends the location again, is fine.
    expect((await patch(pinned.eventId, eventInput({ suburb: "collingwood" }))).status).toBe(200);
    const fitzroy = suburbPin("Fitzroy")!;
    const moved = await patch(pinned.eventId, eventInput({ suburb: "Fitzroy", location: fitzroy }));
    expect(moved.status).toBe(200);
    expect(moved.body.location).toEqual(fitzroy);
    // A cleared location (the editor's null) too.
    expect((await patch(placed.eventId, eventInput({ title: "Placed", suburb: "Fitzroy", location: null }))).status).toBe(200);
    // An event with no location (legacy) moves freely.
    const legacy = await draftEvent(api, organiser, { title: "Legacy", location: null });
    expect((await patch(legacy.eventId, eventInput({ title: "Legacy", suburb: "Fitzroy" }))).status).toBe(200);
  });

  it("the pin's reach follows the event's own suburb and state", async () => {
    const fremantle = suburbPin("Fremantle", "WA")!;
    const perth = { suburb: "Fremantle", state: "WA", timeZone: "Australia/Perth" };
    expect((await create(eventInput({ ...perth, location: fremantle }))).status).toBe(201);
    // The Tote's pin isn't near Fremantle.
    const far = await create(eventInput({ ...perth, location: MANUAL }));
    expect(far.status).toBe(400);
    expect(far.body.fieldErrors.location).toMatch(/outside Fremantle/);
  });
});

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

describe("admins", () => {
  it("an admin's create with a Google place is checked with Google", async () => {
    const res = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ location: PLACES }), organiserId: organiser.organiserId },
    });
    expect(res.status).toBe(201);
    expect(res.body.location).toEqual(PLACES);
    expect(api.places!.count("verify")).toBe(1);
    const unknown = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ location: { source: "places", placeId: "ChIJunknownPlaceId00000001" } }), organiserId: organiser.organiserId },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.fieldErrors).toEqual({ location: PLACE_NOT_FOUND });
  });

  it("an admin's edit logs the change as changes.location, old and new; the same location is no change", async () => {
    const event = await draftEvent(api, organiser);
    const pin = suburbPin("Collingwood")!;
    expect(event.location).toEqual(pin);

    const same = await api.call(adminUpdateEvent, {
      token: admin.token,
      params: { eventId: event.eventId },
      body: adminBody(await adminEvent(event.eventId), { location: pin }),
      method: "PATCH",
    });
    expect(same.status).toBe(200);
    expect(same.body.moderationLog.filter((e: { action: string }) => e.action === "edited")).toEqual([]);

    const moved = await api.call(adminUpdateEvent, {
      token: admin.token,
      params: { eventId: event.eventId },
      body: adminBody(await adminEvent(event.eventId), { location: PLACES, reason: "Linked the venue" }),
      method: "PATCH",
    });
    expect(moved.status).toBe(200);
    expect(moved.body.location).toEqual(PLACES);
    expect(api.places!.count("verify")).toBe(1);
    const edited = moved.body.moderationLog.filter((e: { action: string }) => e.action === "edited");
    expect(edited).toHaveLength(1);
    expect(edited[0].changes).toEqual({ location: { old: pin, new: PLACES } });

    // Cleared: new is null. Absent: kept.
    const cleared = await api.call(adminUpdateEvent, {
      token: admin.token,
      params: { eventId: event.eventId },
      body: adminBody(await adminEvent(event.eventId), { location: null }),
      method: "PATCH",
    });
    expect(cleared.body).not.toHaveProperty("location");
    expect(cleared.body.moderationLog.at(-1).changes).toEqual({ location: { old: PLACES, new: null } });
    const kept = await api.call(adminUpdateEvent, {
      token: admin.token,
      params: { eventId: event.eventId },
      body: adminBody(await adminEvent(event.eventId), { title: "Renamed" }),
      method: "PATCH",
    });
    expect(kept.status).toBe(200);
    expect(kept.body.moderationLog.at(-1).changes).toEqual({ title: { old: "Neon Static", new: "Renamed" } });

    // The organiser sees the same change.
    const mine = (await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } })).body as EventRecord;
    expect(mine.moderationLog.find((e) => e.action === "edited")?.changes).toEqual({ location: { old: pin, new: PLACES } });
  });

  it("an admin's edit to another suburb without `location` while a pin is stored: 400 check the pin again", async () => {
    const event = await draftEvent(api, organiser);
    const res = await api.call(adminUpdateEvent, {
      token: admin.token,
      params: { eventId: event.eventId },
      body: adminBody(await adminEvent(event.eventId), { suburb: "Fitzroy", location: undefined }),
      method: "PATCH",
    });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toEqual({ location: PIN_RECHECK });
    const ok = await api.call(adminUpdateEvent, {
      token: admin.token,
      params: { eventId: event.eventId },
      body: adminBody(await adminEvent(event.eventId), { suburb: "Fitzroy", location: suburbPin("Fitzroy") }),
      method: "PATCH",
    });
    expect(ok.status).toBe(200);
  });

  it("an admin's Google check takes the admin's own details allowance", async () => {
    const [hourly] = PLACES_RATE_LIMITS.details;
    await api.db.query(`select private.take_rate_limit($1, $2, $3, $4::interval) from generate_series(1, $3)`, [
      admin.userId,
      hourly.bucket,
      hourly.hits,
      hourly.window,
    ]);
    const res = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ location: PLACES }), organiserId: organiser.organiserId },
    });
    expect(res.status).toBe(429);
    expect(res.body.fieldErrors).toEqual({ location: PLACES_TOO_MANY });
    expect(api.places!.calls).toEqual([]);
  });

  it("an admin can publish an event without a location (only organisers need one)", async () => {
    const res = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }] }), organiserId: organiser.organiserId, publish: true },
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("published");
    expect(res.body).not.toHaveProperty("location");
  });
});

// ---------------------------------------------------------------------------
// Publishing and submitting
// ---------------------------------------------------------------------------

describe("publishing and submitting need the organiser's pin", () => {
  const FREE = [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }];

  async function decisions(eventId: string) {
    return api.db.query<{ action: string }>(`select action::text from public.event_moderation_log where event_id = $1`, [eventId]);
  }

  it("no location: publish and submit are 409 location_required, nothing written", async () => {
    const event = await draftEvent(api, organiser, { ticketTypes: FREE, location: null });
    for (const res of [await publish(event.eventId), await submit(event.eventId)]) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "location_required", error: LOCATION_REQUIRED, fieldErrors: { location: LOCATION_REQUIRED } });
    }
    expect((await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } })).body.status).toBe("draft");
    expect(await decisions(event.eventId)).toEqual([]);
  });

  it("a Google place without its pin isn't enough; once the pin is checked it publishes", async () => {
    const event = await draftEvent(api, organiser, { ticketTypes: FREE, location: { source: "places", placeId: TOTE_PLACE_ID } });
    expect((await publish(event.eventId)).body.code).toBe("location_required");
    expect((await submit(event.eventId)).body.code).toBe("location_required");
    expect((await patch(event.eventId, eventInput({ ticketTypes: FREE, location: PLACES }))).status).toBe(200);
    const res = await publish(event.eventId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "published", location: PLACES });
  });

  it("a manual pin submits for review too", async () => {
    const event = await draftEvent(api, organiser, { ticketTypes: FREE, location: MANUAL });
    const res = await submit(event.eventId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_review");
  });

  it("payouts are asked for first, then the location", async () => {
    const event = await draftEvent(api, organiser, { location: null });
    const first = await publish(event.eventId);
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({ code: "payouts_required", error: PAYOUTS_REQUIRED_TO_PUBLISH });
    await setUpPayouts(api, organiser.organiserId);
    expect((await publish(event.eventId)).body.code).toBe("location_required");
  });

  it("an event already published (by an admin, without a location) is still a 200 to publish: nothing to do", async () => {
    const created = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ ticketTypes: FREE }), organiserId: organiser.organiserId, publish: true },
    });
    const res = await publish(created.body.eventId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
  });
});

// ---------------------------------------------------------------------------
// What's shown
// ---------------------------------------------------------------------------

describe("payloads and links", () => {
  it("the public shape carries the place id and the organiser's pin, and nothing else of the location", async () => {
    const event = await draftEvent(api, organiser, {
      ticketTypes: [{ id: "ga", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }],
      location: PLACES,
    });
    expect((await publish(event.eventId)).status).toBe(200);
    const bySlug = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(bySlug.body.location).toEqual(PLACES);
    const list = await api.call(listPublicEvents, { query: {} });
    expect(list.body.items[0].location).toEqual(PLACES);
  });

  it("the ticket email's directions go to the linked place, or the pin", () => {
    const base = {
      status: "published",
      venueName: "The Tote",
      venueAddress: "71 Johnston St",
      suburb: "Collingwood",
      startsAt: "2027-03-06T09:00:00.000Z",
      endsAt: "2027-03-06T12:30:00.000Z",
      title: "Neon Static",
      ticketTypes: [],
      moderationLog: [],
    } as unknown as EventRecord;
    const order = {
      orderId: "ord_0123456789abcdef0123456789abcdef",
      tickets: [],
      totalCents: 0,
      lineItems: [],
    } as unknown as OrderRecord;
    const place = buildTicketEmail(order, { ...base, location: PLACES } as EventRecord, "https://sheltuh.test").html;
    expect(place).toContain(`destination_place_id=${TOTE_PLACE_ID}`);
    const pinned = buildTicketEmail(order, { ...base, location: MANUAL } as EventRecord, "https://sheltuh.test").html;
    expect(pinned).toContain("destination=-37.79794,144.98884");
    const legacy = buildTicketEmail(order, base, "https://sheltuh.test").html;
    expect(legacy).toContain("destination=The%20Tote%2C%2071%20Johnston%20St");
    expect(legacy).not.toContain("destination_place_id");
  });
});
