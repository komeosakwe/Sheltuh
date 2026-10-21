import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pgConstraint, pgErrorCode } from "@/lib/server/db";
import { adminRejectEvent, adminSetEventTicketing, adminSuspendOrganiser } from "@/lib/server/handlers/admin";
import {
  adminCreateEvent,
  adminCreateOrganiser,
  adminDeleteEventImage,
  adminGetEvent,
  adminPutEventImage,
  adminUpdateEvent,
  EVENT_EDIT_CONFLICT,
  PLATFORM_PAID_REFUSED,
} from "@/lib/server/handlers/admin-authoring";
import { SHELTUH_TEAM_ACTOR } from "@/lib/api/types";
import { checkInTicket } from "@/lib/server/handlers/check-ins";
import { deleteEventImage, putEventImage } from "@/lib/server/handlers/event-images";
import { getMyEvent, listMyEvents, submitEventForReview, updateEventDraft } from "@/lib/server/handlers/events";
import { createCheckout, PLATFORM_PAID_CHECKOUT_REFUSED } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug } from "@/lib/server/handlers/public-events";
import type { Handler } from "@/lib/server/route";
import type { AdminEventRecord } from "@/lib/server/types";
import { SITE_URL, TestApi } from "./helpers/api";
import { application, approvedOrganiser, draftEvent, eventInput, insertOrder, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * Admin event authoring (docs/architecture.md, "Admin authoring";
 * supabase/migrations/20261022000100_admin_event_authoring.sql).
 */

const HUMANITIX = "https://events.humanitix.com/neon-static";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const FREE_TICKETS = [
  { id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 },
];

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

const platformOrganiserBody = {
  ...application,
  displayName: "Sheltüh Presents",
  contactEmail: "events@sheltuh.example",
  description: "Events Sheltüh lists on behalf of their organisers.",
};

async function platformOrganiser(): Promise<string> {
  const res = await api.call(adminCreateOrganiser, { token: admin.token, body: platformOrganiserBody });
  if (res.status !== 201) throw new Error(`adminCreateOrganiser failed: ${JSON.stringify(res.body)}`);
  return res.body.organiserId as string;
}

function createEvent(body: Record<string, unknown>, token = admin.token) {
  return api.call(adminCreateEvent, { token, body });
}

async function adminEvent(organiserId: string, overrides: Record<string, unknown> = {}): Promise<AdminEventRecord> {
  const res = await createEvent({ ...eventInput(), organiserId, ...overrides });
  if (res.status !== 201) throw new Error(`adminCreateEvent failed: ${JSON.stringify(res.body)}`);
  return res.body as AdminEventRecord;
}

/** The PATCH body that saves `event` as it is, with `overrides`. */
function editBody(event: AdminEventRecord, overrides: Record<string, unknown> = {}) {
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

function patch(eventId: string, body: unknown, token = admin.token) {
  return api.call(adminUpdateEvent, { token, params: { eventId }, body, method: "PATCH" });
}

function sendImage(handler: Handler<{ eventId: string }>, eventId: string, method: "PUT" | "DELETE", body?: BodyInit, token = admin.token) {
  return api.send(
    handler,
    new Request(`${SITE_URL}/api/test`, { method, headers: { authorization: `Bearer ${token}` }, body }),
    { eventId },
  );
}

async function dbError(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (err) {
    return { code: pgErrorCode(err), constraint: pgConstraint(err) };
  }
  throw new Error("expected the database to refuse");
}

async function eventCount() {
  const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from public.events`);
  return n;
}

// ---------------------------------------------------------------------------
// Who may
// ---------------------------------------------------------------------------

describe("admin authoring: access", () => {
  it("every route is 401 signed out and 403 for members and organisers", async () => {
    const member = await api.signUp();
    const event = await adminEvent(organiser.organiserId);
    const eventId = event.eventId;
    const calls: [string, (token?: string) => Promise<{ status: number }>][] = [
      ["create organiser", (token) => api.call(adminCreateOrganiser, { token, body: platformOrganiserBody })],
      ["create event", (token) => api.call(adminCreateEvent, { token, body: { ...eventInput(), organiserId: organiser.organiserId } })],
      ["get event", (token) => api.call(adminGetEvent, { token, params: { eventId } })],
      ["edit event", (token) => api.call(adminUpdateEvent, { token, params: { eventId }, body: editBody(event), method: "PATCH" })],
      ["put image", (token) => sendImage(adminPutEventImage, eventId, "PUT", PNG, token ?? "")],
      ["delete image", (token) => sendImage(adminDeleteEventImage, eventId, "DELETE", undefined, token ?? "")],
    ];
    for (const [name, call] of calls) {
      expect([name, (await call(undefined)).status]).toEqual([name, 401]);
      expect([name, (await call(member.token)).status]).toEqual([name, 403]);
      expect([name, (await call(organiser.token)).status]).toEqual([name, 403]);
    }
    // Nothing was written by any of them.
    expect(await eventCount()).toBe(1);
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from public.organisers`);
    expect(n).toBe(1);
  });

  it("an unknown or malformed event id is a 404", async () => {
    const unknown = crypto.randomUUID();
    expect((await api.call(adminGetEvent, { token: admin.token, params: { eventId: unknown } })).status).toBe(404);
    expect((await api.call(adminGetEvent, { token: admin.token, params: { eventId: "nope" } })).status).toBe(404);
    const event = await adminEvent(organiser.organiserId);
    expect((await patch(unknown, editBody(event))).status).toBe(404);
    expect((await patch("nope", editBody(event))).status).toBe(404);
    // A malformed id is a 404 before the body is validated.
    expect((await patch("nope", {})).status).toBe(404);
    expect((await api.call(adminSetEventTicketing, { token: admin.token, params: { eventId: "nope" }, body: {}, method: "PATCH" })).status).toBe(404);
    expect((await sendImage(adminPutEventImage, unknown, "PUT", PNG)).status).toBe(404);
    expect((await sendImage(adminDeleteEventImage, unknown, "DELETE")).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Platform-managed organisers
// ---------------------------------------------------------------------------

describe("POST /admin/organisers", () => {
  it("creates an approved organiser with no owner account, reviewed by the admin", async () => {
    const res = await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: { ...platformOrganiserBody, instagramHandle: "@sheltuh.presents", ownerUserId: admin.userId, status: "pending" },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      displayName: "Sheltüh Presents",
      contactEmail: "events@sheltuh.example",
      status: "approved",
      reviewedBy: admin.userId,
      instagramHandle: "sheltuh.presents",
      payoutsEnabled: false,
      recentEdits: [],
    });
    // The body can't set an owner or a status.
    expect(res.body.ownerUserId).toBeUndefined();
    const [row] = await api.db.query<{ owner_user_id: string | null; status: string }>(
      `select owner_user_id, status::text as status from public.organisers where id = $1`,
      [res.body.organiserId],
    );
    expect(row).toEqual({ owner_user_id: null, status: "approved" });
  });

  it("validates exactly like an organiser application", async () => {
    const empty = await api.call(adminCreateOrganiser, { token: admin.token, body: {} });
    expect(empty.status).toBe(400);
    expect(Object.keys(empty.body.fieldErrors).sort()).toEqual(["categories", "contactEmail", "description", "displayName"]);

    const bad = await api.call(adminCreateOrganiser, {
      token: admin.token,
      body: {
        ...platformOrganiserBody,
        contactEmail: "Events <events@sheltuh.example>",
        websiteUrl: "http://sheltuh.example",
        categories: ["karaoke"],
        xHandle: "not a handle",
        description: "Bio with a ‮ direction override",
      },
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fieldErrors).sort()).toEqual(["categories", "contactEmail", "description", "websiteUrl", "xHandle"]);
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from public.organisers`);
    expect(n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Creating events
// ---------------------------------------------------------------------------

describe("POST /admin/events", () => {
  it("creates a draft for an organiser's account, logged as created, which the organiser then sees", async () => {
    const res = await createEvent({ ...eventInput(), organiserId: organiser.organiserId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organiserId: organiser.organiserId,
      status: "draft",
      ticketingMode: "sheltuh",
      organiserPlatformManaged: false,
      ticketingLocked: false,
      moderationLog: [{ action: "created", by: admin.userId }],
    });
    const mine = await api.call(listMyEvents, { token: organiser.token });
    expect(mine.body.items.map((e: { eventId: string }) => e.eventId)).toEqual([res.body.eventId]);
    const own = await api.call(getMyEvent, { token: organiser.token, params: { eventId: res.body.eventId } });
    expect(own.body.moderationLog.map((l: { action: string }) => l.action)).toEqual(["created"]);
    // It isn't public.
    expect((await api.call(getPublicEventBySlug, { params: { slug: res.body.slug } })).status).toBe(404);
  });

  it("publishes in the same request through the approval path", async () => {
    const res = await createEvent({ ...eventInput(), organiserId: organiser.organiserId, publish: true });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("published");
    expect(res.body.ticketingLocked).toBe(true);
    expect(res.body.moderationLog.map((l: { action: string; by: string }) => [l.action, l.by])).toEqual([
      ["created", admin.userId],
      ["approved", admin.userId],
    ]);
    expect((await api.call(getPublicEventBySlug, { params: { slug: res.body.slug } })).status).toBe(200);
  });

  it("creates an external event for a platform-managed organiser", async () => {
    const platformId = await platformOrganiser();
    const res = await createEvent({
      ...eventInput({ ticketTypes: [] }),
      organiserId: platformId,
      ticketingMode: "external",
      externalTicketUrl: HUMANITIX,
      externalFree: true,
      publish: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organiserId: platformId,
      organiserName: "Sheltüh Presents",
      organiserPlatformManaged: true,
      status: "published",
      ticketingMode: "external",
      externalTicketUrl: HUMANITIX,
      externalFree: true,
      externalProvider: "Humanitix",
      ticketTypes: [],
    });
  });

  it("gives a second event with the same title its own slug", async () => {
    const first = await adminEvent(organiser.organiserId);
    const second = await adminEvent(organiser.organiserId);
    expect(first.slug).toBe("neon-static");
    expect(second.slug).toMatch(/^neon-static-[0-9a-f]{6}$/);
  });

  it("validates the event like an organiser's, plus the organiser and publish, all at once", async () => {
    const res = await createEvent({
      ...eventInput({ title: "", ticketingMode: "external", externalTicketUrl: "https://bit.ly/abc", ticketTypes: [] }),
      publish: "yes",
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["externalTicketUrl", "organiserId", "publish", "title"]);

    const paidFree = await createEvent({
      ...eventInput({ ticketTypes: [{ id: "a", name: "A", priceCents: 50, feePolicy: "buyer-pays", quantityAvailable: 1 }] }),
      organiserId: organiser.organiserId,
    });
    expect(paidFree.status).toBe(400);
    expect(paidFree.body.fieldErrors["ticketTypes[0].priceCents"]).toBeDefined();

    const unknown = await createEvent({ ...eventInput(), organiserId: crypto.randomUUID() });
    expect(unknown.status).toBe(400);
    expect(unknown.body.fieldErrors).toEqual({ organiserId: "No such organiser." });
    expect(await eventCount()).toBe(0);
  });

  it("refuses an organiser who isn't approved (409)", async () => {
    const applicant = await api.signUp();
    const [{ id }] = await api.db.query<{ id: string }>(
      `insert into public.organisers (owner_user_id, display_name, contact_email, description, categories)
       values ($1, 'Pending Co', 'p@example.com', 'x', '{art}') returning id`,
      [applicant.userId],
    );
    const res = await createEvent({ ...eventInput(), organiserId: id });
    expect(res.status).toBe(409);
    expect(res.body.fieldErrors.organiserId).toBeDefined();
    expect(await eventCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Editing events
// ---------------------------------------------------------------------------

describe("PATCH /admin/events/{id}", () => {
  it("edits a published event in place, logging each changed field's old and new value", async () => {
    const published = await publishedEvent(api, organiser, admin);
    const event = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: published.eventId } })).body;
    const ticketTypes = [
      { ...event.ticketTypes[0], quantityAvailable: 25 },
      { id: "vip", name: "VIP", priceCents: 6000, feePolicy: "organiser-absorbs", quantityAvailable: 5 },
    ];
    const res = await patch(event.eventId, editBody(event, { title: "Neon Static: Encore", ticketTypes, reason: "Venue asked." }));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    expect(res.body.title).toBe("Neon Static: Encore");
    expect(res.body.ticketTypes.map((t: { id: string }) => t.id)).toEqual(["ga", "vip"]);
    expect(res.body.updatedAt).not.toBe(event.updatedAt);

    const edited = res.body.moderationLog.at(-1);
    expect(edited).toMatchObject({ action: "edited", by: admin.userId, reason: "Venue asked." });
    expect(Object.keys(edited.changes).sort()).toEqual(["ticketTypes", "title"]);
    expect(edited.changes.title).toEqual({ old: "Neon Static", new: "Neon Static: Encore" });
    expect(edited.changes.ticketTypes.old).toEqual(event.ticketTypes);
    expect(edited.changes.ticketTypes.new).toEqual(ticketTypes);
    // The organiser sees the same entry on their event, by the Sheltüh team: an admin's id is only shown to admins.
    const own = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(own.body.moderationLog.at(-1)).toEqual({ ...edited, by: SHELTUH_TEAM_ACTOR });
    expect(JSON.stringify(own.body)).not.toContain(admin.userId);
    // Their own entries keep their id.
    expect(own.body.moderationLog.find((l: { action: string }) => l.action === "submitted").by).toBe(organiser.userId);
  });

  it("saving the same values changes and logs nothing", async () => {
    const event = await adminEvent(organiser.organiserId);
    const res = await patch(event.eventId, editBody(event));
    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(event.updatedAt);
    expect(res.body.moderationLog.map((l: { action: string }) => l.action)).toEqual(["created"]);
  });

  it("refuses a stale version (409) and saves nothing", async () => {
    const event = await adminEvent(organiser.organiserId);
    expect((await patch(event.eventId, editBody(event, { title: "First edit" }))).status).toBe(200);
    const stale = await patch(event.eventId, editBody(event, { title: "Second edit" }));
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: EVENT_EDIT_CONFLICT, fieldErrors: { expectedUpdatedAt: EVENT_EDIT_CONFLICT } });
    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    expect(current.title).toBe("First edit");
    expect(current.moderationLog.map((l: { action: string }) => l.action)).toEqual(["created", "edited"]);
  });

  it("an organiser's edit in between makes the admin's version stale", async () => {
    const event = await adminEvent(organiser.organiserId);
    const own = await api.call(updateEventDraft, {
      token: organiser.token,
      params: { eventId: event.eventId },
      body: eventInput({ title: "Organiser's title" }),
      method: "PATCH",
    });
    expect(own.status).toBe(200);
    expect((await patch(event.eventId, editBody(event, { title: "Admin's title" }))).status).toBe(409);
  });

  it("two admins saving the same version at once: exactly one wins", async () => {
    const otherAdmin = await signUpAdmin(api);
    const event = await adminEvent(organiser.organiserId);
    const results = await Promise.all([
      patch(event.eventId, editBody(event, { title: "Admin one" })),
      patch(event.eventId, editBody(event, { title: "Admin two" }), otherAdmin.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!.body.title;
    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    expect(current.title).toBe(winner);
    expect(current.moderationLog.filter((l: { action: string }) => l.action === "edited")).toHaveLength(1);
  });

  it("requires ticketingMode and a well-formed expectedUpdatedAt, and validates like an organiser's edit", async () => {
    const event = await adminEvent(organiser.organiserId);
    const res = await patch(event.eventId, {
      ...editBody(event, { suburb: "" }),
      ticketingMode: undefined,
      expectedUpdatedAt: "yesterday",
      publish: 1,
      reason: "\u0000",
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["expectedUpdatedAt", "publish", "reason", "suburb", "ticketingMode"]);
  });

  it("changes ticketing through the ticketing path, and needs a reason once the event has been approved", async () => {
    const published = await publishedEvent(api, organiser, admin);
    const event = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: published.eventId } })).body;
    const toExternal = { ticketingMode: "external", externalTicketUrl: HUMANITIX, ticketTypes: [] };

    const noReason = await patch(event.eventId, editBody(event, toExternal));
    expect(noReason.status).toBe(400);
    expect(noReason.body.fieldErrors.reason).toBeDefined();

    const res = await patch(event.eventId, editBody(event, { ...toExternal, reason: "Moved to Humanitix." }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ticketingMode: "external", externalTicketUrl: HUMANITIX, ticketTypes: [], status: "published" });
    const [ticketing, edited] = res.body.moderationLog.slice(-2);
    expect(ticketing).toMatchObject({
      action: "ticketing_changed",
      reason: "Moved to Humanitix.",
      changes: { ticketingMode: { old: "sheltuh", new: "external" }, externalTicketUrl: { old: null, new: HUMANITIX } },
    });
    expect(edited).toMatchObject({ action: "edited", changes: { ticketTypes: { old: event.ticketTypes, new: [] } } });
  });

  it("a draft that was never approved can change its ticketing without a reason", async () => {
    const event = await adminEvent(organiser.organiserId);
    const res = await patch(event.eventId, editBody(event, { ticketingMode: "external", externalTicketUrl: HUMANITIX, ticketTypes: [] }));
    expect(res.status).toBe(200);
    expect(res.body.ticketingMode).toBe("external");
  });

  it("refuses switching an event with orders to external (409), and a cut below what's sold (409)", async () => {
    const published = await publishedEvent(api, organiser, admin);
    const event = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: published.eventId } })).body;
    await insertOrder(api, event, "buyer@example.com");
    const external = await patch(event.eventId, editBody(event, {
      ticketingMode: "external", externalTicketUrl: HUMANITIX, ticketTypes: [], reason: "Moving.",
    }));
    expect(external.status).toBe(409);
    expect(external.body.fieldErrors).toEqual({ ticketingMode: "This event has orders." });

    await api.db.query(`update public.ticket_types set quantity_sold = 6 where event_id = $1`, [event.eventId]);
    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    const cut = await patch(event.eventId, editBody(current, { ticketTypes: [{ ...current.ticketTypes[0], quantityAvailable: 5 }] }));
    expect(cut.status).toBe(409);
    const after = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    expect(after.ticketingMode).toBe("sheltuh");
    expect(after.ticketTypes[0].quantityAvailable).toBe(10);
    expect(after.updatedAt).toBe(current.updatedAt);
  });

  it("publishes a draft, but not for an organiser who has been taken down", async () => {
    const event = await adminEvent(organiser.organiserId);
    const res = await patch(event.eventId, editBody(event, { publish: true }));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    expect(res.body.moderationLog.map((l: { action: string }) => l.action)).toEqual(["created", "approved"]);

    const second = await adminEvent(organiser.organiserId);
    await api.call(adminSuspendOrganiser, { token: admin.token, params: { organiserId: organiser.organiserId }, body: { reason: "Fake venue." } });
    const refused = await patch(second.eventId, editBody(second, { title: "New title", publish: true }));
    expect(refused.status).toBe(409);
    const after = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: second.eventId } })).body;
    expect(after).toMatchObject({ status: "draft", title: "Neon Static" });
  });

  it("leaves the B2 ticketing endpoint working on admin-authored events", async () => {
    const event = await adminEvent(organiser.organiserId, { publish: true });
    const res = await api.call(adminSetEventTicketing, {
      token: admin.token,
      params: { eventId: event.eventId },
      body: { ticketingMode: "external", externalTicketUrl: HUMANITIX, reason: "Organiser moved sales." },
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    expect(res.body.ticketingMode).toBe("external");
  });
});

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

describe("admin photos", () => {
  it("sets, replaces and removes a published event's photo, logging each", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const put = await sendImage(adminPutEventImage, event.eventId, "PUT", PNG);
    expect(put.status).toBe(200);
    expect(put.body.imageUrl).toMatch(new RegExp(`^/api/events/${event.eventId}/image\\?v=\\d+$`));
    expect((await sendImage(adminPutEventImage, event.eventId, "PUT", PNG)).status).toBe(200);
    const del = await sendImage(adminDeleteEventImage, event.eventId, "DELETE");
    expect(del.status).toBe(200);
    expect(del.body.imageUrl).toBeUndefined();
    // Nothing to remove: nothing logged.
    expect((await sendImage(adminDeleteEventImage, event.eventId, "DELETE")).status).toBe(200);

    const after = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    expect(after.status).toBe("published");
    expect(
      after.moderationLog.filter((l: { action: string }) => l.action === "edited").map((l: { changes: unknown }) => l.changes),
    ).toEqual([{ image: { old: null, new: "set" } }, { image: { old: "set", new: "set" } }, { image: { old: "set", new: null } }]);
  });

  it("a photo change is a new version: an admin's own photo save answers with it, and a save from before it is stale", async () => {
    const event = await adminEvent(organiser.organiserId);
    const put = await sendImage(adminPutEventImage, event.eventId, "PUT", PNG);
    expect(put.body.updatedAt).not.toBe(event.updatedAt);
    // The version loaded before the photo is stale; the one the photo save returned isn't.
    expect((await patch(event.eventId, editBody(event, { title: "Stale" }))).status).toBe(409);
    expect((await patch(event.eventId, editBody(put.body, { title: "Fresh" }))).status).toBe(200);
    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    const del = await sendImage(adminDeleteEventImage, event.eventId, "DELETE");
    expect(del.body.updatedAt).not.toBe(current.updatedAt);
    expect((await patch(event.eventId, editBody(current, { title: "Stale again" }))).status).toBe(409);
    // Nothing to delete: no new version.
    const noop = await sendImage(adminDeleteEventImage, event.eventId, "DELETE");
    expect(noop.body.updatedAt).toBe(del.body.updatedAt);
  });

  it("an organiser's photo swap after the admin opened the event makes the admin's publish stale (409): nothing published", async () => {
    const png = (tag: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag, tag, tag, tag]);
    const draft = await draftEvent(api, organiser);
    const organiserImage = (method: "PUT" | "DELETE", body?: BodyInit) =>
      sendImage(method === "PUT" ? putEventImage : deleteEventImage, draft.eventId, method, body, organiser.token);
    expect((await organiserImage("PUT", png(1))).status).toBe(200);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    await api.call(adminRejectEvent, { token: admin.token, params: { eventId: draft.eventId }, body: { reason: "Wrong date." } });
    const loaded = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: draft.eventId } })).body;

    // Still rejected, so the organiser may change the photo: a new version.
    const swapped = await organiserImage("PUT", png(9));
    expect(swapped.status).toBe(200);
    expect(swapped.body.updatedAt).not.toBe(loaded.updatedAt);
    const publish = await patch(draft.eventId, editBody(loaded, { publish: true }));
    expect(publish.status).toBe(409);
    expect(publish.body.fieldErrors).toEqual({ expectedUpdatedAt: EVENT_EDIT_CONFLICT });
    const after = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: draft.eventId } })).body;
    expect(after.status).toBe("rejected");

    // Removing the photo is a new version too.
    expect((await organiserImage("DELETE")).body.updatedAt).not.toBe(after.updatedAt);
    expect((await patch(draft.eventId, editBody(after, { publish: true }))).status).toBe(409);
    // Reloaded, the admin sees the current photo state, and can publish.
    const reloaded = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: draft.eventId } })).body;
    expect(reloaded.imageUrl).toBeUndefined();
    expect((await patch(draft.eventId, editBody(reloaded, { publish: true }))).body.status).toBe("published");
  });

  it("deleting an event with a photo still works (the photo goes with it)", async () => {
    const event = await adminEvent(organiser.organiserId);
    expect((await sendImage(adminPutEventImage, event.eventId, "PUT", PNG)).status).toBe(200);
    await api.db.query(`delete from public.events where id = $1`, [event.eventId]);
    expect(await api.db.query(`select 1 from public.event_images where event_id = $1`, [event.eventId])).toEqual([]);
  });

  it("uses the organiser upload's rules: 400 not an image, 413 over 2 MB", async () => {
    const event = await adminEvent(organiser.organiserId);
    const notImage = await sendImage(adminPutEventImage, event.eventId, "PUT", new Uint8Array([1, 2, 3, 4]));
    expect(notImage.status).toBe(400);
    expect(notImage.body.fieldErrors.image).toBeDefined();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await sendImage(adminPutEventImage, event.eventId, "PUT", big)).status).toBe(413);
    const after = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    expect(after.imageUrl).toBeUndefined();
    expect(after.moderationLog.map((l: { action: string }) => l.action)).toEqual(["created"]);
  });
});

// ---------------------------------------------------------------------------
// Platform-managed restrictions
// ---------------------------------------------------------------------------

describe("platform-managed organisers: no paid Sheltüh tickets; only admins at the door", () => {
  it("the API refuses paid ticket types on create and edit; free ones are fine", async () => {
    const platformId = await platformOrganiser();
    const paid = await createEvent({ ...eventInput(), organiserId: platformId });
    expect(paid.status).toBe(400);
    expect(paid.body).toEqual({ error: PLATFORM_PAID_REFUSED, fieldErrors: { ticketTypes: PLATFORM_PAID_REFUSED } });
    expect(await eventCount()).toBe(0);

    const free = await adminEvent(platformId, { ticketTypes: FREE_TICKETS, publish: true });
    expect(free.organiserPlatformManaged).toBe(true);
    const edit = await patch(free.eventId, editBody(free, {
      ticketTypes: [{ ...FREE_TICKETS[0], priceCents: 1500 }],
    }));
    expect(edit.status).toBe(400);
    expect(edit.body.fieldErrors).toEqual({ ticketTypes: PLATFORM_PAID_REFUSED });
  });

  it("the database refuses paid ticket types, paid orders, payouts, moves and owner removal", async () => {
    const platformId = await platformOrganiser();
    const free = await adminEvent(platformId, { ticketTypes: FREE_TICKETS, publish: true });

    expect(await dbError(api.db.query(`update public.ticket_types set price_cents = 1000 where event_id = $1`, [free.eventId])))
      .toEqual({ code: "23514", constraint: "ticket_types_platform_free_only" });
    expect(await dbError(api.db.query(
      `select private.replace_ticket_types($1, '[{"id":"p","name":"Paid","priceCents":2000,"feePolicy":"buyer-pays","quantityAvailable":5}]'::jsonb)`,
      [free.eventId],
    ))).toEqual({ code: "23514", constraint: "ticket_types_platform_free_only" });
    expect(await dbError(api.db.query(
      `insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents, buyer_fee_cents,
         total_cents, application_fee_cents, status)
       values ('ord_${"a".repeat(32)}', $1, $2, 'x', '[]'::jsonb, 2000, 130, 2130, 130, 'pending')`,
      [free.eventId, platformId],
    ))).toEqual({ code: "23514", constraint: "orders_platform_free_only" });
    expect(await dbError(api.db.query(
      `update public.organisers set stripe_account_id = 'acct_x', payouts_enabled = true where id = $1`, [platformId],
    ))).toEqual({ code: "23514", constraint: "organisers_platform_no_payouts" });

    // A paid event can't move to a platform-managed organiser, nor its organiser lose its owner.
    const paid = await publishedEvent(api, organiser, admin);
    expect(await dbError(api.db.query(`update public.events set organiser_id = $2 where id = $1`, [paid.eventId, platformId])))
      .toEqual({ code: "23514", constraint: "events_platform_free_only" });
    expect(await dbError(api.db.query(`update public.organisers set owner_user_id = null where id = $1`, [organiser.organiserId])))
      .toEqual({ code: "23514", constraint: "organisers_platform_free_only" });

    // A free order is fine.
    await insertOrder(api, free, "guest@example.com");
  });

  it("checkout refuses a paid ticket of a platform-managed organiser's event, even one stored before the rule", async () => {
    const platformId = await platformOrganiser();
    const event = await adminEvent(platformId, { ticketTypes: FREE_TICKETS, publish: true });
    // Dev seed data from before the migration: a paid ticket type the trigger would now refuse.
    await api.db.query(`alter table public.ticket_types disable trigger ticket_types_platform_free_only`);
    try {
      await api.db.query(`update public.ticket_types set price_cents = 2500 where event_id = $1`, [event.eventId]);
    } finally {
      await api.db.query(`alter table public.ticket_types enable trigger ticket_types_platform_free_only`);
    }
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "free", quantity: 1 }], buyerEmail: "buyer@example.com" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(PLATFORM_PAID_CHECKOUT_REFUSED);
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    // And it can't be saved again with its price.
    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    expect((await patch(event.eventId, editBody(current, { title: "Renamed" }))).status).toBe(400);
  });

  it("only an admin can check in, and the database refuses anyone else's check-in row for its events", async () => {
    const platformId = await platformOrganiser();
    const event = await adminEvent(platformId, { ticketTypes: FREE_TICKETS, publish: true });
    const scan = (token: string) =>
      api.call(checkInTicket, { token, params: { eventId: event.eventId }, body: { code: "7KQM2HXD", requestId: crypto.randomUUID() } });
    expect((await scan(admin.token)).body).toEqual({ outcome: "invalid" });
    expect((await scan(organiser.token)).status).toBe(404);
    expect(await dbError(api.db.query(
      `insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result)
       values ($1, null, $2, gen_random_uuid(), 'invalid')`,
      [event.eventId, organiser.userId],
    ))).toEqual({ code: "23514", constraint: "ticket_check_ins_actor_allowed" });
    expect(await dbError(api.db.query(
      `select * from private.check_in_ticket($1, $2, $3, null, gen_random_uuid(), 600, '5 minutes')`,
      [event.eventId, platformId, organiser.userId],
    ))).toEqual({ code: "23514", constraint: "ticket_check_ins_actor_allowed" });
  });
});

// ---------------------------------------------------------------------------
// Photo writes at once: two sessions need a real server (PGlite is one
// connection). Run with TEST_DATABASE_URL (CLAUDE.md, "Quality gates").
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.TEST_DATABASE_URL)("photo writes at once (real Postgres only)", () => {
  const IMAGE = Buffer.from(PNG);

  async function waitUntilBlocked(conn: postgres.Sql) {
    const [{ pid }] = await conn.unsafe("select pg_backend_pid() as pid");
    return async () => {
      for (let i = 0; ; i++) {
        const [row] = await api.db.query<{ wait_event_type: string | null }>(
          `select wait_event_type from pg_stat_activity where pid = $1`,
          [pid],
        );
        if (row?.wait_event_type === "Lock") return;
        if (i > 200) throw new Error("never blocked");
        await new Promise((r) => setTimeout(r, 25));
      }
    };
  }

  /** The organiser handler's write (lib/server/handlers/event-images.ts), on a connection of its own. */
  const organiserPut = (conn: postgres.Sql, eventId: string) =>
    conn.unsafe(
      `insert into public.event_images (event_id, content_type, data)
       select e.id, 'image/png', $2::bytea from public.events e
        where e.id = $1 and e.organiser_id = $3 and e.status in ('draft', 'rejected')
          for no key update of e
       on conflict (event_id) do update set content_type = excluded.content_type, data = excluded.data, updated_at = now()
       returning event_id`,
      [eventId, IMAGE, organiser.organiserId],
    );
  const adminPut = (conn: postgres.Sql, eventId: string) =>
    conn.unsafe(`select private.admin_put_event_image($1, $2, 'image/png', $3::bytea) as result`, [eventId, admin.userId, IMAGE]);

  it("an admin's and an organiser's photo write at once: the second waits on the event row, then both succeed (no deadlock)", async () => {
    const draft = await draftEvent(api, organiser);
    const [one, two] = [postgres(serverUrl!, { max: 1, onnotice: () => {} }), postgres(serverUrl!, { max: 1, onnotice: () => {} })];
    try {
      // The organiser's write has locked the event row (its first step) but not yet written the image.
      await two.unsafe("begin");
      await two.unsafe(`select 1 from public.events where id = $1 for no key update`, [draft.eventId]);
      // The admin's write waits on the event row before touching the image (were it to write the image
      // first, the organiser's insert below would wait on it while it waited on the event: a deadlock).
      await one.unsafe("begin");
      const blocked = await waitUntilBlocked(one);
      const adminPending = adminPut(one, draft.eventId).execute();
      await blocked();
      expect(await organiserPut(two, draft.eventId)).toHaveLength(1);
      await two.unsafe("commit");
      expect((await adminPending)[0].result).toBe("updated");
      await one.unsafe("commit");

      // And the other way round: the admin's write first, the organiser's waits.
      await one.unsafe("begin");
      await adminPut(one, draft.eventId);
      await two.unsafe("begin");
      const waiting = await waitUntilBlocked(two);
      const organiserPending = organiserPut(two, draft.eventId).execute();
      await waiting();
      await one.unsafe("commit");
      expect(await organiserPending).toHaveLength(1);
      await two.unsafe("commit");
    } finally {
      await one.end();
      await two.end();
    }
  });

  it("an admin's save racing a photo write waits for it, then is stale (409): nothing saved", async () => {
    const event = await adminEvent(organiser.organiserId);
    const one = postgres(serverUrl!, { max: 1, onnotice: () => {} });
    try {
      await one.unsafe("begin");
      await adminPut(one, event.eventId);
      // The PATCH (its own transaction, through the API) waits on the event row the photo write holds.
      const pending = patch(event.eventId, editBody(event, { title: "Raced" }));
      await new Promise((r) => setTimeout(r, 200));
      await one.unsafe("commit");
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.fieldErrors).toEqual({ expectedUpdatedAt: EVENT_EDIT_CONFLICT });
    } finally {
      await one.end();
    }
    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body;
    expect(current.title).toBe("Neon Static");
    expect(current.imageUrl).toBeDefined();
  });
});
