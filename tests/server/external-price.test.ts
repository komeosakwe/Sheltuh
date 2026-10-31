import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminSetEventTicketing } from "@/lib/server/handlers/admin";
import { adminCreateEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { createEventDraft, getMyEvent, updateEventDraft } from "@/lib/server/handlers/events";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import type { AdminEventRecord } from "@/lib/server/types";
import { TestApi } from "./helpers/api";
import {
  approvedOrganiser,
  draftEvent,
  eventInput,
  publishedEvent,
  selfPublishedEvent,
  signUpAdmin,
  suburbPin,
} from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * An external event's optional "price from" (docs/architecture.md, "External
 * ticketing"; supabase/migrations/20261114000000_external_price.sql).
 */

const HUMANITIX = "https://events.humanitix.com/neon-static";

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

function external(overrides: Record<string, unknown> = {}) {
  return { ticketingMode: "external", externalTicketUrl: HUMANITIX, ticketTypes: [], ...overrides };
}

const patch = (eventId: string, body: unknown) =>
  api.call(updateEventDraft, { token: organiser.token, params: { eventId }, body, method: "PATCH" });
const adminTicketing = (eventId: string, body: unknown) =>
  api.call(adminSetEventTicketing, { token: admin.token, params: { eventId }, body, method: "PATCH" });

async function storedPrice(eventId: string): Promise<number | null> {
  const [row] = await api.db.query<{ p: number | null }>(
    `select external_price_from_cents as p from public.events where id = $1`,
    [eventId],
  );
  return row.p;
}

describe("organiser: create and edit", () => {
  it("stores and returns the price of a paid external event", async () => {
    const event = await draftEvent(api, organiser, external({ externalPriceFromCents: 8900 }));
    expect(event).toMatchObject({ ticketingMode: "external", externalFree: false, externalPriceFromCents: 8900 });
    expect(await storedPrice(event.eventId)).toBe(8900);
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(mine.body.externalPriceFromCents).toBe(8900);
  });

  it("is optional: no price means no field", async () => {
    const event = await draftEvent(api, organiser, external());
    expect(event).not.toHaveProperty("externalPriceFromCents");
    expect(await storedPrice(event.eventId)).toBeNull();
    const blank = await draftEvent(api, organiser, external({ title: "Blank", externalPriceFromCents: "" }));
    expect(blank).not.toHaveProperty("externalPriceFromCents");
  });

  it("accepts the bounds, 1 cent and A$10,000", async () => {
    expect((await draftEvent(api, organiser, external({ externalPriceFromCents: 1 }))).externalPriceFromCents).toBe(1);
    expect((await draftEvent(api, organiser, external({ title: "Top", externalPriceFromCents: 1_000_000 }))).externalPriceFromCents)
      .toBe(1_000_000);
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["over A$10,000", 1_000_001],
    ["fractional cents", 89.5],
    ["a string", "8900"],
    ["not finite", Number.MAX_VALUE],
    ["a boolean", true],
  ])("rejects %s with a field error", async (_label, value) => {
    const res = await api.call(createEventDraft, {
      token: organiser.token,
      body: { ...eventInput(external({ externalPriceFromCents: value })), location: suburbPin("Collingwood") },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["externalPriceFromCents"]);
  });

  it("is refused for Sheltüh ticketing and for a free external event", async () => {
    const sheltuh = await api.call(createEventDraft, {
      token: organiser.token,
      body: { ...eventInput({ externalPriceFromCents: 5000 }), location: suburbPin("Collingwood") },
    });
    expect(sheltuh.status).toBe(400);
    expect(sheltuh.body.fieldErrors.externalPriceFromCents).toMatch(/another site/);
    const free = await api.call(createEventDraft, {
      token: organiser.token,
      body: { ...eventInput(external({ externalFree: true, externalPriceFromCents: 5000 })), location: suburbPin("Collingwood") },
    });
    expect(free.status).toBe(400);
    expect(Object.keys(free.body.fieldErrors)).toEqual(["externalPriceFromCents"]);
  });

  it("edits, keeps it when ticketingMode is left out, and clears it with null", async () => {
    const event = await draftEvent(api, organiser, external({ externalPriceFromCents: 8900 }));
    const changed = await patch(event.eventId, eventInput(external({ externalPriceFromCents: 12050 })));
    expect(changed.status).toBe(200);
    expect(changed.body.externalPriceFromCents).toBe(12050);

    // A client that predates external ticketing leaves the ticketing out: nothing is lost.
    const rest = eventInput({ ticketTypes: undefined });
    const kept = await patch(event.eventId, rest);
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ ticketingMode: "external", externalPriceFromCents: 12050 });

    const cleared = await patch(event.eventId, eventInput(external({ externalPriceFromCents: null })));
    expect(cleared.status).toBe(200);
    expect(cleared.body).not.toHaveProperty("externalPriceFromCents");
    expect(await storedPrice(event.eventId)).toBeNull();
  });

  it("is cleared when the event becomes free or Sheltüh-ticketed", async () => {
    const event = await draftEvent(api, organiser, external({ externalPriceFromCents: 8900 }));
    const free = await patch(event.eventId, eventInput(external({ externalFree: true })));
    expect(free.status).toBe(200);
    expect(await storedPrice(event.eventId)).toBeNull();

    const paid = await patch(event.eventId, eventInput(external({ externalPriceFromCents: 4000 })));
    expect(paid.status).toBe(200);
    const back = await patch(event.eventId, eventInput({ ticketingMode: "sheltuh" }));
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ ticketingMode: "sheltuh" });
    expect(back.body).not.toHaveProperty("externalPriceFromCents");
    expect(await storedPrice(event.eventId)).toBeNull();
  });

  it("an admin can change a published event's price", async () => {
    const event = await publishedEvent(api, organiser, admin, external({ externalPriceFromCents: 8900 }));
    const res = await adminTicketing(event.eventId, { ...external({ externalPriceFromCents: 9900 }), reason: "Price rise" });
    expect(res.status).toBe(200);
    expect(res.body.externalPriceFromCents).toBe(9900);
  });
});

describe("the database", () => {
  async function insertExternal(columns: string) {
    return api.db.query(
      `insert into public.events (organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
                                  starts_at, ends_at, ${columns.split("|")[0]})
       values ($1, $2, 'T', 'D', 'art', 'V', 'A', 'S', '2027-03-06T09:00:00Z', '2027-03-06T12:00:00Z', ${columns.split("|")[1]})`,
      [organiser.organiserId, `e-${crypto.randomUUID().slice(0, 8)}`],
    );
  }
  const base = `ticketing_mode, external_ticket_url, external_price_from_cents|'external', '${HUMANITIX}'`;

  it("holds the rule whatever the code sends", async () => {
    await expect(insertExternal(`${base}, 0`)).rejects.toThrow(/events_external_price_from/);
    await expect(insertExternal(`${base}, 1000001`)).rejects.toThrow(/events_external_price_from/);
    await expect(
      insertExternal(`ticketing_mode, external_ticket_url, external_free, is_free, external_price_from_cents|'external', '${HUMANITIX}', true, true, 500`),
    ).rejects.toThrow(/events_external_price_from/);
    await expect(
      api.db.query(
        `insert into public.events (organiser_id, slug, title, description, category, venue_name, venue_address, suburb,
                                    starts_at, ends_at, external_price_from_cents)
         values ($1, 'sheltuh-price', 'T', 'D', 'art', 'V', 'A', 'S', '2027-03-06T09:00:00Z', '2027-03-06T12:00:00Z', 500)`,
        [organiser.organiserId],
      ),
    ).rejects.toThrow(/events_external_price_from/);
    await insertExternal(`${base}, 1000000`);
  });

  it("existing events have no price", async () => {
    const event = await draftEvent(api, organiser);
    expect(await storedPrice(event.eventId)).toBeNull();
  });

  it("the six-argument admin_set_event_ticketing keeps the stored price where it can", async () => {
    const event = await draftEvent(api, organiser, external({ externalPriceFromCents: 8900 }));
    await api.db.query(
      `select private.admin_set_event_ticketing($1, $2, 'external', $3, false, 'same')`,
      [event.eventId, admin.userId, "https://www.my-venue.com.au/tickets"],
    );
    expect(await storedPrice(event.eventId)).toBe(8900);
    await api.db.query(`select private.admin_set_event_ticketing($1, $2, 'external', $3, true, 'free')`, [
      event.eventId,
      admin.userId,
      "https://www.my-venue.com.au/tickets",
    ]);
    expect(await storedPrice(event.eventId)).toBeNull();
  });
});

describe("publishing and the public payload", () => {
  it("a self-published event carries its price into the public list and page", async () => {
    const event = await selfPublishedEvent(api, organiser, external({ externalPriceFromCents: 8900 }));
    expect(event.externalPriceFromCents).toBe(8900);
    const page = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(page.body).toMatchObject({ ticketingMode: "external", externalPriceFromCents: 8900 });
    const list = await api.call(listPublicEvents);
    expect(list.body.items.find((e: { slug: string }) => e.slug === event.slug)).toEqual(page.body);
  });

  it("an approved event shows it; one without a price and a Sheltüh one have no field", async () => {
    const priced = await publishedEvent(api, organiser, admin, external({ title: "Priced", externalPriceFromCents: 100 }));
    const free = await publishedEvent(api, organiser, admin, external({ title: "Free", externalFree: true }));
    const here = await publishedEvent(api, organiser, admin, { title: "Here" });
    const list = await api.call(listPublicEvents);
    const byTitle = Object.fromEntries(list.body.items.map((e: { title: string }) => [e.title, e]));
    expect(byTitle.Priced.externalPriceFromCents).toBe(100);
    expect(byTitle.Free).not.toHaveProperty("externalPriceFromCents");
    expect(byTitle.Here).not.toHaveProperty("externalPriceFromCents");
    expect([priced, free, here]).toHaveLength(3);
  });

  it("a draft's price isn't public", async () => {
    const draft = await draftEvent(api, organiser, external({ externalPriceFromCents: 8900 }));
    const page = await api.call(getPublicEventBySlug, { params: { slug: draft.slug } });
    expect(page.status).toBe(404);
  });
});

describe("admin", () => {
  const editBody = (event: AdminEventRecord, overrides: Record<string, unknown> = {}) => ({
    ...eventInput(),
    ticketTypes: event.ticketTypes,
    ticketingMode: event.ticketingMode,
    externalTicketUrl: event.externalTicketUrl ?? null,
    externalFree: event.externalFree,
    ...(event.externalPriceFromCents === undefined ? {} : { externalPriceFromCents: event.externalPriceFromCents }),
    expectedUpdatedAt: event.updatedAt,
    ...overrides,
  });
  const adminEdit = (eventId: string, body: unknown) =>
    api.call(adminUpdateEvent, { token: admin.token, params: { eventId }, body, method: "PATCH" });

  async function adminEvent(overrides: Record<string, unknown> = {}): Promise<AdminEventRecord> {
    const res = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput(), organiserId: organiser.organiserId, ...overrides },
    });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body as AdminEventRecord;
  }

  it("creates with a price, edits it (logged as ticketing_changed) and clears it", async () => {
    const event = await adminEvent(external({ externalPriceFromCents: 8900 }));
    expect(event.externalPriceFromCents).toBe(8900);

    const edited = await adminEdit(event.eventId, editBody(event, { externalPriceFromCents: 9900 }));
    expect(edited.status).toBe(200);
    expect(edited.body.externalPriceFromCents).toBe(9900);
    expect(edited.body.moderationLog.at(-1)).toMatchObject({
      action: "ticketing_changed",
      changes: { externalPriceFromCents: { old: 8900, new: 9900 } },
    });

    const cleared = await adminEdit(event.eventId, editBody(edited.body, { externalPriceFromCents: null }));
    expect(cleared.status).toBe(200);
    expect(cleared.body).not.toHaveProperty("externalPriceFromCents");
    expect(cleared.body.moderationLog.at(-1).changes).toEqual({ externalPriceFromCents: { old: 9900, new: null } });
  });

  it("validates like the organiser's form", async () => {
    const bad = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput(external({ externalPriceFromCents: 0 })), organiserId: organiser.organiserId },
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fieldErrors)).toEqual(["externalPriceFromCents"]);

    const sheltuh = await adminEvent();
    const res = await adminEdit(sheltuh.eventId, editBody(sheltuh, { externalPriceFromCents: 500 }));
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.externalPriceFromCents).toBeTruthy();
  });

  it("a change to the price alone needs no reason, and switching to Sheltüh ticketing clears and logs it", async () => {
    const event = await adminEvent(external({ externalPriceFromCents: 8900 }));
    const res = await adminTicketing(event.eventId, { ...external({ externalPriceFromCents: 7500 }), reason: "Corrected" });
    expect(res.status).toBe(200);
    expect(res.body.moderationLog.at(-1).changes).toEqual({ externalPriceFromCents: { old: 8900, new: 7500 } });

    const back = await adminTicketing(event.eventId, {
      ticketingMode: "sheltuh",
      reason: "Back to Sheltüh",
    });
    expect(back.status).toBe(200);
    expect(back.body).not.toHaveProperty("externalPriceFromCents");
    expect(back.body.moderationLog.at(-1).changes).toMatchObject({ externalPriceFromCents: { old: 7500, new: null } });
  });

  it("is admin-only on the ticketing route (401 signed out, 403 organiser) and validates", async () => {
    const event = await adminEvent(external());
    const body = { ...external({ externalPriceFromCents: 500 }), reason: "x" };
    expect((await api.call(adminSetEventTicketing, { params: { eventId: event.eventId }, body, method: "PATCH" })).status).toBe(401);
    expect(
      (await api.call(adminSetEventTicketing, { token: organiser.token, params: { eventId: event.eventId }, body, method: "PATCH" })).status,
    ).toBe(403);
    const bad = await adminTicketing(event.eventId, { ...body, externalPriceFromCents: 1_000_001 });
    expect(bad.status).toBe(400);
    expect(bad.body.fieldErrors.externalPriceFromCents).toBeTruthy();
  });
});
