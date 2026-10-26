import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { unavailablePositions } from "@/lib/seating/availability";
import { adminApproveEvent, adminSetEventTicketing, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { adminGetEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { getMyEvent, submitEventForReview, updateEventDraft } from "@/lib/server/handlers/events";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import {
  adminDeleteSeatMap,
  adminPutSeatMap,
  deleteSeatMap,
  getSeatAvailability,
  getSeatMap,
  putSeatMap,
  SEAT_AVAILABILITY_CACHE,
  SEAT_MAP_CACHE,
  SEAT_MAP_REDIRECT_CACHE,
} from "@/lib/server/handlers/seating";
import { MAX_SEAT_MAP_BODY_BYTES } from "@/lib/server/seat-map-input";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, eventInput, insertOrder, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { DEFAULT_ROWS, gridTemplate, SEATED_TIERS, seatedEvent, tierCounts } from "./helpers/seating";
import { createTestDb } from "./helpers/test-db";

// Seat maps (docs/architecture.md, "Reserved seating";
// supabase/migrations/20261101000000_reserved_seating.sql).

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

const put = (eventId: string, template: unknown, token = organiser.token) =>
  api.call(putSeatMap, { token, params: { eventId }, method: "PUT", body: { template } });

describe("the organiser's seat map", () => {
  it("saves a map on a draft: seated tiers get their unblocked seats as capacity; GA tiers are unchanged", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: SEATED_TIERS });
    const saved = await put(draft.eventId, gridTemplate(DEFAULT_ROWS));
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("private, no-store");
    expect(saved.body).toMatchObject({ eventId: draft.eventId, seatCount: 10, version: expect.any(Number) });
    expect(saved.body.template.sections[0].rows[1].seats[5]).toMatchObject({ id: "B6", blocked: true });

    expect(await tierCounts(api, draft.eventId)).toEqual({
      ga: { available: 10, sold: 0, seated: false },
      prem: { available: 4, sold: 0, seated: true },
      std: { available: 5, sold: 0, seated: true },
    });
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: draft.eventId } });
    expect(mine.body.seating).toEqual({ version: saved.body.version, seatCount: 10 });
    expect(mine.body.ticketTypes).toEqual([
      { id: "prem", name: "Premium", priceCents: 5000, feePolicy: "buyer-pays", quantityAvailable: 4, seated: true },
      { id: "std", name: "Standard", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 5, seated: true },
      { id: "ga", name: "Standing", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 },
    ]);
    // A map change is a new version of the event (the admin editor's expectedUpdatedAt).
    expect(Date.parse(mine.body.updatedAt)).toBeGreaterThan(Date.parse(draft.updatedAt));
  });

  it("keeps the version when nothing changed, and never reuses one", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: SEATED_TIERS });
    const first = await put(draft.eventId, gridTemplate(DEFAULT_ROWS));
    const same = await put(draft.eventId, gridTemplate(DEFAULT_ROWS));
    expect(same.body.version).toBe(first.body.version);
    const changed = await put(draft.eventId, gridTemplate([{ label: "A", tier: "prem", seats: 3 }]));
    expect(changed.body.version).toBeGreaterThan(first.body.version);
    expect(await tierCounts(api, draft.eventId)).toMatchObject({ prem: { available: 3, seated: true }, std: { seated: false } });
    // Deleted and made again: still a new version (the public map is cached under it).
    expect((await api.call(deleteSeatMap, { token: organiser.token, params: { eventId: draft.eventId }, method: "DELETE" })).status).toBe(204);
    const again = await put(draft.eventId, gridTemplate([{ label: "A", tier: "prem", seats: 3 }]));
    expect(again.body.version).toBeGreaterThan(changed.body.version);
  });

  it("checks the map with the shared validator, against the event's own ticket types", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: SEATED_TIERS });
    const unknownTier = await put(draft.eventId, gridTemplate([{ label: "A", tier: "vip", seats: 2 }]));
    expect(unknownTier.status).toBe(400);
    expect(unknownTier.body.fieldErrors).toEqual({ "template.sections[0].rows[0].seats[0].ticketTypeId": expect.any(String), "template.sections[0].rows[0].seats[1].ticketTypeId": expect.any(String) });
    const allBlocked = await put(draft.eventId, gridTemplate([{ label: "A", tier: "prem", seats: 2, blocked: [1, 2] }]));
    expect(allBlocked.status).toBe(400);
    expect((await put(draft.eventId, null)).body.fieldErrors).toEqual({ template: "Send a seat map." });
    const badLabel = gridTemplate(DEFAULT_ROWS);
    badLabel.sections[0].label = "Stalls\u0000";
    expect((await put(draft.eventId, badLabel)).body.fieldErrors).toHaveProperty(["template.sections[0].label"]);
    expect(await tierCounts(api, draft.eventId)).toMatchObject({ prem: { seated: false }, std: { seated: false } });
  });

  it("refuses more than 5 price tiers, in the database too", async () => {
    const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `Tier ${i}`, priceCents: 1000 + i * 100, feePolicy: "buyer-pays", quantityAvailable: 1 }));
    const draft = await draftEvent(api, organiser, { ticketTypes: tiers });
    const rows = tiers.map((t, i) => ({ label: String.fromCharCode(65 + i), tier: t.id, seats: 2 }));
    expect((await put(draft.eventId, gridTemplate(rows))).status).toBe(400);
    // The database's own check, whatever the API sends.
    await expect(
      api.db.query(`select private.write_seat_map($1, $2::text::jsonb)`, [draft.eventId, JSON.stringify({ ...gridTemplate(rows) })]),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await put(draft.eventId, gridTemplate(rows.slice(0, 5)))).status).toBe(200);
  });

  it("refuses a body over 1 MB before parsing it", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: SEATED_TIERS });
    const req = new Request(`${SITE_URL}/api/test`, {
      method: "PUT",
      headers: { authorization: `Bearer ${organiser.token}`, "content-type": "application/json" },
      body: JSON.stringify({ template: { pad: "x".repeat(MAX_SEAT_MAP_BODY_BYTES) } }),
    });
    expect((await api.send(putSeatMap, req, { eventId: draft.eventId })).status).toBe(413);
  });

  it("is the owner's only: 401 signed out, 403 without an approved organiser, 404 someone else's or no such event", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: SEATED_TIERS });
    const template = gridTemplate(DEFAULT_ROWS);
    expect((await api.call(putSeatMap, { params: { eventId: draft.eventId }, method: "PUT", body: { template } })).status).toBe(401);
    const stranger = await api.signUp();
    expect((await put(draft.eventId, template, stranger.token)).status).toBe(403);
    const other = await approvedOrganiser(api, admin);
    expect((await put(draft.eventId, template, other.token)).status).toBe(404);
    expect((await api.call(deleteSeatMap, { token: other.token, params: { eventId: draft.eventId }, method: "DELETE" })).status).toBe(404);
    expect((await put("not-a-uuid", template)).status).toBe(404);
    expect((await put(crypto.randomUUID(), template)).status).toBe(404);
  });

  it("freezes at first approval: pending review and approved-then-unpublished maps can't change", async () => {
    const { event } = await seatedEvent(api, organiser, admin, { publish: false });
    const params = { eventId: event.eventId };
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    expect((await put(event.eventId, gridTemplate([{ label: "A", tier: "prem", seats: 2 }]))).status).toBe(409);
    await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
    await api.call(adminUnpublishEvent, { token: admin.token, params, method: "POST" });
    const frozen = await put(event.eventId, gridTemplate([{ label: "A", tier: "prem", seats: 2 }]));
    expect(frozen.status).toBe(409);
    expect(frozen.body.error).toMatch(/locked/);
    expect((await api.call(deleteSeatMap, { token: organiser.token, params, method: "DELETE" })).status).toBe(409);
    // The database decides, not just the API.
    const [row] = await api.db.query<{ result: string }>(`select private.replace_seat_map($1, $2, '{}'::jsonb) as result`, [
      event.eventId,
      organiser.organiserId,
    ]);
    expect(row.result).toBe("frozen");
  });

  it("a ticket type with seats can't be removed, and an edit can't change its capacity", async () => {
    const { event } = await seatedEvent(api, organiser, admin, { publish: false });
    const params = { eventId: event.eventId };
    const removed = await api.call(updateEventDraft, {
      token: organiser.token,
      params,
      method: "PATCH",
      body: eventInput({ ticketTypes: SEATED_TIERS.filter((t) => t.id !== "prem") }),
    });
    expect(removed.status).toBe(409);
    expect(removed.body.fieldErrors.ticketTypes).toBeTruthy();
    const edited = await api.call(updateEventDraft, {
      token: organiser.token,
      params,
      method: "PATCH",
      body: eventInput({ ticketTypes: SEATED_TIERS.map((t) => ({ ...t, quantityAvailable: 99 })) }),
    });
    expect(edited.status).toBe(200);
    expect(await tierCounts(api, event.eventId)).toMatchObject({ prem: { available: 4 }, std: { available: 5 }, ga: { available: 99 } });
    // Whatever writes the row, a seated tier's capacity is its unblocked seats.
    await api.db.query(`update public.ticket_types set quantity_available = 500 where event_id = $1`, [event.eventId]);
    expect(await tierCounts(api, event.eventId)).toMatchObject({ prem: { available: 4 }, std: { available: 5 }, ga: { available: 500 } });
  });

  it("switching a draft to external ticketing removes the map; an external event can't have one", async () => {
    const { event } = await seatedEvent(api, organiser, admin, { publish: false });
    const params = { eventId: event.eventId };
    const switched = await api.call(updateEventDraft, {
      token: organiser.token,
      params,
      method: "PATCH",
      body: eventInput({ ticketingMode: "external", externalTicketUrl: "https://tickets.example.com/x", ticketTypes: [] }),
    });
    expect(switched.status).toBe(200);
    expect(switched.body.seating).toBeUndefined();
    expect(await api.db.query(`select 1 from public.event_seats where event_id = $1`, [event.eventId])).toEqual([]);
    expect((await put(event.eventId, gridTemplate(DEFAULT_ROWS))).status).toBe(409);
    await expect(
      api.db.query(`select private.write_seat_map($1, $2::text::jsonb)`, [event.eventId, JSON.stringify(gridTemplate([{ label: "A", tier: "x", seats: 1 }]))]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("an admin's seat map change", () => {
  it("replaces a published event's map while it has no orders, logged with the reason", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const params = { eventId: event.eventId };
    const before = await api.call(adminGetEvent, { token: admin.token, params });
    const replaced = await api.call(adminPutSeatMap, {
      token: admin.token,
      params,
      method: "PUT",
      body: { template: gridTemplate([{ label: "A", tier: "prem", seats: 6 }]), reason: "Venue moved the sound desk" },
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.version).toBeGreaterThan(map.version);
    const after = await api.call(adminGetEvent, { token: admin.token, params });
    const entry = after.body.moderationLog.at(-1);
    expect(entry).toMatchObject({
      action: "edited",
      by: admin.userId,
      reason: "Venue moved the sound desk",
      changes: { seatMap: { old: { version: map.version, seatCount: 10 }, new: { version: replaced.body.version, seatCount: 6 } } },
    });
    const own = await api.call(getMyEvent, { token: organiser.token, params });
    expect(own.body.moderationLog.at(-1).by).toBe("Sheltüh team");
    expect(await tierCounts(api, event.eventId)).toMatchObject({ prem: { available: 6, seated: true }, std: { seated: false } });

    // The admin editor's version from before the map change is now stale.
    const stale = await api.call(adminUpdateEvent, {
      token: admin.token,
      params,
      method: "PATCH",
      body: { ...eventInput({ ticketTypes: SEATED_TIERS }), ticketingMode: "sheltuh", expectedUpdatedAt: before.body.updatedAt },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.fieldErrors.expectedUpdatedAt).toBeTruthy();
  });

  it("needs a reason, refuses once there are orders (409), and can remove the map", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const params = { eventId: event.eventId };
    const template = gridTemplate([{ label: "A", tier: "prem", seats: 2 }]);
    const noReason = await api.call(adminPutSeatMap, { token: admin.token, params, method: "PUT", body: { template } });
    expect(noReason.status).toBe(400);
    expect(noReason.body.fieldErrors.reason).toBeTruthy();
    expect((await api.call(adminPutSeatMap, { token: organiser.token, params, method: "PUT", body: { template, reason: "x" } })).status).toBe(403);
    expect((await api.call(adminPutSeatMap, { token: admin.token, params: { eventId: crypto.randomUUID() }, method: "PUT", body: { template, reason: "x" } })).status).toBe(404);

    const orderId = await insertOrder(api, event, "someone@example.com", "failed");
    const refused = await api.call(adminPutSeatMap, { token: admin.token, params, method: "PUT", body: { template, reason: "Typo" } });
    expect(refused.status).toBe(409);
    expect(refused.body.fieldErrors.template).toBeTruthy();
    expect((await api.call(adminDeleteSeatMap, { token: admin.token, params, method: "DELETE", body: { reason: "Typo" } })).status).toBe(409);

    await api.db.query(`delete from public.orders where id = $1`, [orderId]);
    const removed = await api.call(adminDeleteSeatMap, { token: admin.token, params, method: "DELETE", body: { reason: "General admission after all" } });
    expect(removed.status).toBe(204);
    const after = await api.call(adminGetEvent, { token: admin.token, params });
    expect(after.body.seating).toBeUndefined();
    expect(after.body.moderationLog.at(-1).changes.seatMap).toEqual({ old: { version: expect.any(Number), seatCount: 10 }, new: null });
    expect(await tierCounts(api, event.eventId)).toMatchObject({ prem: { seated: false, available: 4 }, std: { seated: false, available: 5 } });
    // Nothing left to remove: nothing logged.
    const count = after.body.moderationLog.length;
    await api.call(adminDeleteSeatMap, { token: admin.token, params, method: "DELETE", body: { reason: "Again" } });
    expect((await api.call(adminGetEvent, { token: admin.token, params })).body.moderationLog).toHaveLength(count);
  });

  it("switching an event without orders to external removes its map, and the log says so", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const res = await api.call(adminSetEventTicketing, {
      token: admin.token,
      params: { eventId: event.eventId },
      method: "PATCH",
      body: { ticketingMode: "external", externalTicketUrl: "https://tickets.example.com/x", reason: "Sold elsewhere" },
    });
    expect(res.status).toBe(200);
    expect(res.body.seating).toBeUndefined();
    expect(res.body.ticketTypes).toEqual([]);
    expect(res.body.moderationLog.at(-1).changes.seatMap).toEqual({ old: { version: map.version, seatCount: 10 }, new: null });
  });
});

describe("never while the event has orders (defence in depth)", () => {
  it("the organiser's save and removal say has_orders (409); write_seat_map and clear_seat_map refuse too", async () => {
    const draft = await draftEvent(api, organiser, { ticketTypes: SEATED_TIERS });
    expect((await put(draft.eventId, gridTemplate(DEFAULT_ROWS))).status).toBe(200);
    // Not reachable through the API (a draft that was never approved has no orders): planted to prove the guard.
    await insertOrder(api, draft, null, "failed");
    const replaced = await put(draft.eventId, gridTemplate([{ label: "A", tier: "prem", seats: 2 }]));
    expect(replaced.status).toBe(409);
    expect(replaced.body.fieldErrors).toHaveProperty("template");
    const removed = await api.call(deleteSeatMap, { token: organiser.token, params: { eventId: draft.eventId }, method: "DELETE" });
    expect(removed.status).toBe(409);
    for (const [fn, args] of [
      ["select private.write_seat_map($1, $2::text::jsonb)", [draft.eventId, JSON.stringify(gridTemplate([{ label: "C", tier: "prem", seats: 1 }]))]],
      ["select private.clear_seat_map($1)", [draft.eventId]],
    ] as const) {
      await expect(api.db.query(fn, [...args])).rejects.toThrow(/event with orders/);
    }
    const [{ seats }] = await api.db.query<{ seats: number }>(
      `select count(*)::int as seats from public.event_seats where event_id = $1`,
      [draft.eventId],
    );
    expect(seats).toBe(10);
  });
});

describe("public reads", () => {
  it("a published event's map: cached for a long time at its current version only", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const params = { eventId: event.eventId };
    const current = await api.call(getSeatMap, { params, query: { v: String(map.version) } });
    expect(current.status).toBe(200);
    // A year in browsers (the versioned URL never changes), an hour at the
    // CDN (a takedown stops reaching new visitors within about an hour).
    expect(SEAT_MAP_CACHE).toBe("public, max-age=31536000, s-maxage=3600, immutable");
    expect(current.headers.get("cache-control")).toBe(SEAT_MAP_CACHE);
    expect(current.body).toEqual(map);
  });

  it("a published event's map at any other URL (no v, a stale, future or junk v): a no-store 307 to the current version, no body", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const params = { eventId: event.eventId };
    for (const query of [{}, { v: String(map.version - 1) }, { v: String(map.version + 1) }, { v: "x" }] as Record<string, string>[]) {
      const res = await api.call(getSeatMap, { params, query });
      expect(res.status).toBe(307);
      expect(res.headers.get("cache-control")).toBe(SEAT_MAP_REDIRECT_CACHE);
      expect(res.body).toBeUndefined();
      const location = new URL(res.headers.get("location")!);
      expect(location.searchParams.get("v")).toBe(String(map.version));
      expect([...location.searchParams.keys()]).toEqual(["v"]);
    }
    // A stale version after the map is replaced redirects to the new one.
    await api.call(adminPutSeatMap, {
      token: admin.token,
      params,
      method: "PUT",
      body: { template: gridTemplate([{ label: "A", tier: "prem", seats: 3 }, { label: "B", tier: "std", seats: 2 }]), reason: "Fix" },
    });
    const stale = await api.call(getSeatMap, { params, query: { v: String(map.version) } });
    expect(stale.status).toBe(307);
    const current = new URL(stale.headers.get("location")!).searchParams.get("v");
    expect(Number(current)).toBeGreaterThan(map.version);
    const fresh = await api.call(getSeatMap, { params, query: { v: current! } });
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("cache-control")).toBe(SEAT_MAP_CACHE);
  });

  it("before publishing, the owner gets the map at any v (never cached, no redirect)", async () => {
    const { event } = await seatedEvent(api, organiser, admin, { publish: false });
    for (const query of [{}, { v: "1" }] as Record<string, string>[]) {
      const res = await api.call(getSeatMap, { params: { eventId: event.eventId }, query, token: organiser.token });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("before publishing, only the owner and admins see the map or its availability (404 otherwise, never cached)", async () => {
    const { event } = await seatedEvent(api, organiser, admin, { publish: false });
    const params = { eventId: event.eventId };
    const other = await approvedOrganiser(api, admin);
    for (const handler of [getSeatMap, getSeatAvailability]) {
      expect((await api.call(handler, { params })).status).toBe(404);
      expect((await api.call(handler, { params, token: other.token })).status).toBe(404);
      for (const token of [organiser.token, admin.token]) {
        const res = await api.call(handler, { params, token });
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      }
    }
  });

  it("no map, or not an event: 404", async () => {
    const event = await publishedEvent(api, organiser, admin);
    expect((await api.call(getSeatMap, { params: { eventId: event.eventId } })).status).toBe(404);
    expect((await api.call(getSeatAvailability, { params: { eventId: event.eventId } })).status).toBe(404);
    expect((await api.call(getSeatMap, { params: { eventId: "nope" } })).status).toBe(404);
  });

  it("availability: blocked, sold and unexpired holds are one state; expired holds are free; 5 seconds at the CDN", async () => {
    const { event } = await seatedEvent(api, organiser, admin);
    const held = await insertOrder(api, event, null, "pending");
    const sold = await insertOrder(api, event, null, "paid");
    await api.db.query(
      `update public.event_seats set hold_order_id = $2, hold_expires_at = now() + interval '5 minutes' where event_id = $1 and id = 'A1'`,
      [event.eventId, held],
    );
    await api.db.query(
      `update public.event_seats set hold_order_id = $2, hold_expires_at = now() - interval '1 second' where event_id = $1 and id = 'A2'`,
      [event.eventId, held],
    );
    await api.db.query(`update public.event_seats set sold_order_id = $2 where event_id = $1 and id = 'B1'`, [event.eventId, sold]);
    const res = await api.call(getSeatAvailability, { params: { eventId: event.eventId } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(SEAT_AVAILABILITY_CACHE);
    expect(res.body).toMatchObject({ eventId: event.eventId, seatCount: 10 });
    // Positions: A1..A4 = 0..3, B1..B6 = 4..9 (B6 blocked).
    expect(unavailablePositions(res.body.unavailable, 10)).toEqual([0, 4, 9]);
  });

  it("the public event says it's seated; a general admission event's payload is unchanged", async () => {
    const { event, map } = await seatedEvent(api, organiser, admin);
    const ga = await publishedEvent(api, organiser, admin, { title: "Plain Gig" });
    const seated = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(seated.body.seating).toEqual({ version: map.version });
    expect(seated.body.ticketTypes.map((t: { id: string; seated?: boolean }) => [t.id, t.seated])).toEqual([
      ["prem", true],
      ["std", true],
      ["ga", undefined],
    ]);
    expect(Object.keys(seated.body.ticketTypes[2]).sort()).toEqual(["feePolicy", "id", "name", "priceCents", "quantityAvailable", "remaining", "soldOut"]);

    const plain = await api.call(getPublicEventBySlug, { params: { slug: ga.slug } });
    expect(Object.keys(plain.body)).toEqual([
      "organiserId",
      "eventId",
      "slug",
      "title",
      "description",
      "category",
      "venueName",
      "venueAddress",
      "suburb",
      "state",
      "timeZone",
      "startsAt",
      "endsAt",
      "organiserName",
      "ticketTypes",
      "soldOut",
      "ticketingMode",
      "externalFree",
      "externalProvider",
      "refundPolicy",
    ]);
    expect(plain.body.ticketTypes).toEqual([
      { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10, soldOut: false, remaining: 10 },
    ]);
    const list = await api.call(listPublicEvents, { query: {} });
    const item = list.body.items.find((e: { eventId: string }) => e.eventId === ga.eventId);
    expect(item).not.toHaveProperty("seating");
  });
});
