import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { melbourneDateOf } from "@/lib/server/analytics-range";
import {
  adminApproveEvent,
  adminListEvents,
  adminRejectEvent,
  adminSetEventTicketing,
  adminUnpublishEvent,
} from "@/lib/server/handlers/admin";
import {
  getAnalyticsOverview,
  getAnalyticsOverviewCsv,
  getEventAnalytics,
  getEventAnalyticsCsv,
} from "@/lib/server/handlers/analytics";
import { checkInTicket, EXTERNAL_CHECK_IN_REFUSED, getCheckInSummary, undoCheckIn } from "@/lib/server/handlers/check-ins";
import { OUTBOUND_RATE_LIMIT, recordOutboundClick } from "@/lib/server/handlers/event-views";
import { createEventDraft, getMyEvent, submitEventForReview, TICKETING_FROZEN, updateEventDraft } from "@/lib/server/handlers/events";
import { getGoingSummary, getMyGoing, putMyGoing } from "@/lib/server/handlers/going";
import { createCheckout, EXTERNAL_CHECKOUT_REFUSED } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { runHandler, type Handler } from "@/lib/server/route";
import type { EventRecord } from "@/lib/server/types";
import { SITE_URL, TestApi } from "./helpers/api";
import {
  approvedOrganiser,
  draftEvent,
  enablePayouts,
  eventInput,
  insertOrder,
  publishedEvent,
  signUpAdmin,
} from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * External ticketing (docs/architecture.md, "External ticketing";
 * supabase/migrations/20261022000000_external_ticketing.sql): events whose
 * tickets are sold on another site. The link's own rules are in
 * ticketing-url.test.ts.
 */

const HUMANITIX = "https://events.humanitix.com/neon-static";
const OWN_SITE = "https://www.my-venue.com.au/tickets/neon";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

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

const today = () => melbourneDateOf();

async function eventRow(eventId: string) {
  const [row] = await api.db.query<{
    ticketing_mode: string;
    external_ticket_url: string | null;
    external_free: boolean;
    is_free: boolean;
    ticket_types: number;
  }>(
    `select e.ticketing_mode, e.external_ticket_url, e.external_free, e.is_free,
            (select count(*)::int from public.ticket_types t where t.event_id = e.id) as ticket_types
       from public.events e where e.id = $1`,
    [eventId],
  );
  return row;
}

const patch = (token: string, eventId: string, body: unknown) =>
  api.call(updateEventDraft, { token, params: { eventId }, body, method: "PATCH" });
const adminPatch = (token: string, eventId: string, body: unknown) =>
  api.call(adminSetEventTicketing, { token, params: { eventId }, body, method: "PATCH" });
const unpublish = (eventId: string) =>
  api.call(adminUnpublishEvent, { token: admin.token, params: { eventId }, method: "POST" });

// ---------------------------------------------------------------------------
// Database constraints
// ---------------------------------------------------------------------------

describe("database constraints", () => {
  async function insertEvent(columns: Record<string, unknown>) {
    const base: Record<string, unknown> = {
      organiser_id: organiser.organiserId,
      slug: `e-${crypto.randomUUID().slice(0, 8)}`,
      title: "T",
      description: "D",
      category: "art",
      venue_name: "V",
      venue_address: "A",
      suburb: "S",
      starts_at: "2027-03-06T09:00:00Z",
      ends_at: "2027-03-06T12:00:00Z",
      ...columns,
    };
    const keys = Object.keys(base);
    return api.db.query<{ id: string }>(
      `insert into public.events (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      keys.map((k) => base[k]),
    );
  }

  async function violation(work: () => Promise<unknown>): Promise<string> {
    try {
      await work();
    } catch (err) {
      return String((err as { constraint?: string; constraint_name?: string }).constraint ??
        (err as { constraint_name?: string }).constraint_name ?? (err as Error).message);
    }
    throw new Error("expected a constraint violation");
  }

  it("ties the mode to the link and the free flag", async () => {
    expect(await violation(() => insertEvent({ ticketing_mode: "elsewhere" }))).toBe("events_ticketing_mode_check");
    expect(await violation(() => insertEvent({ ticketing_mode: "external" }))).toBe("events_ticketing_fields");
    expect(await violation(() => insertEvent({ external_ticket_url: HUMANITIX }))).toBe("events_ticketing_fields");
    expect(await violation(() => insertEvent({ external_free: true }))).toBe("events_ticketing_fields");
    expect(
      await violation(() =>
        insertEvent({ ticketing_mode: "external", external_ticket_url: HUMANITIX, external_free: true, is_free: false }),
      ),
    ).toBe("events_external_is_free");
    expect(
      await violation(() => insertEvent({ ticketing_mode: "external", external_ticket_url: "https://bit.ly/x" })),
    ).toBe("events_external_ticket_url_valid");
    expect(
      await violation(() => insertEvent({ ticketing_mode: "external", external_ticket_url: "http://humanitix.com/x" })),
    ).toBe("events_external_ticket_url_valid");
    const [ok] = await insertEvent({
      ticketing_mode: "external",
      external_ticket_url: HUMANITIX,
      external_free: true,
      is_free: true,
    });
    expect(ok.id).toEqual(expect.any(String));
  });

  it("an external event can't have ticket types or orders, and can't become external while it has ticket types", async () => {
    const [ext] = await insertEvent({ ticketing_mode: "external", external_ticket_url: HUMANITIX });
    expect(
      await violation(() =>
        api.db.query(
          `select private.replace_ticket_types($1, '[{"id":"ga","name":"GA","priceCents":1000,"feePolicy":"buyer-pays","quantityAvailable":5}]'::jsonb)`,
          [ext.id],
        ),
      ),
    ).toBe("ticket_types_sheltuh_only");
    expect(
      await violation(() => insertOrder(api, { eventId: ext.id, organiserId: organiser.organiserId }, "a@example.com")),
    ).toBe("orders_sheltuh_only");

    const sheltuh = await draftEvent(api, organiser);
    expect(
      await violation(() =>
        api.db.query(
          `update public.events set ticketing_mode = 'external', external_ticket_url = $2 where id = $1`,
          [sheltuh.eventId, HUMANITIX],
        ),
      ),
    ).toBe("events_external_no_ticket_types");
  });

  it("existing events are Sheltüh-ticketed with no link", async () => {
    const event = await draftEvent(api, organiser);
    expect(await eventRow(event.eventId)).toMatchObject({
      ticketing_mode: "sheltuh",
      external_ticket_url: null,
      external_free: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Creating and editing
// ---------------------------------------------------------------------------

describe("creating an external event", () => {
  it("needs no ticket types; stores the parser's form of the link; is_free follows externalFree", async () => {
    const res = await api.call(createEventDraft, {
      token: organiser.token,
      body: eventInput(external({ externalTicketUrl: "  HTTPS://Events.Humanitix.COM/neon-static  ", externalFree: true })),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ticketingMode: "external",
      externalTicketUrl: HUMANITIX,
      externalFree: true,
      externalProvider: "Humanitix",
      ticketingLocked: false,
      ticketTypes: [],
    });
    expect(await eventRow(res.body.eventId)).toEqual({
      ticketing_mode: "external",
      external_ticket_url: HUMANITIX,
      external_free: true,
      is_free: true,
      ticket_types: 0,
    });
  });

  it("works without ticketTypes in the body, or with null; an unknown site has no provider name", async () => {
    const body = eventInput(external({ externalTicketUrl: OWN_SITE })) as Record<string, unknown>;
    delete body.ticketTypes;
    const res = await api.call(createEventDraft, { token: organiser.token, body });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ externalTicketUrl: OWN_SITE, externalProvider: null, externalFree: false });
    expect((await eventRow(res.body.eventId)).is_free).toBe(false);

    const withNull = await api.call(createEventDraft, { token: organiser.token, body: { ...body, ticketTypes: null } });
    expect(withNull.status).toBe(201);
  });

  it("a Sheltüh-ticketed event is unchanged: ticketingMode defaults to sheltuh and the new fields are filled in", async () => {
    const res = await api.call(createEventDraft, { token: organiser.token, body: eventInput() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ticketingMode: "sheltuh", externalFree: false, externalProvider: null });
    expect(res.body).not.toHaveProperty("externalTicketUrl");
  });

  it.each([
    [{ ticketingMode: "elsewhere" }, "ticketingMode"],
    [{ ticketingMode: 1 }, "ticketingMode"],
    [external({ externalTicketUrl: undefined }), "externalTicketUrl"],
    [external({ externalTicketUrl: "" }), "externalTicketUrl"],
    [external({ externalTicketUrl: 42 }), "externalTicketUrl"],
    [external({ externalTicketUrl: "https://bit.ly/abc" }), "externalTicketUrl"],
    [external({ externalTicketUrl: "http://humanitix.com/x" }), "externalTicketUrl"],
    [external({ externalTicketUrl: "https://127.0.0.1/x" }), "externalTicketUrl"],
    [external({ externalFree: "yes" }), "externalFree"],
    [
      external({
        ticketTypes: [{ id: "ga", name: "GA", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 5 }],
      }),
      "ticketTypes",
    ],
    [{ externalTicketUrl: HUMANITIX }, "externalTicketUrl"],
    [{ ticketingMode: "sheltuh", externalFree: true }, "externalFree"],
    [{ ticketingMode: "sheltuh", ticketTypes: [] }, "ticketTypes"],
  ])("refuses %j with a 400 on %s", async (overrides, field) => {
    const res = await api.call(createEventDraft, { token: organiser.token, body: eventInput(overrides) });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors).toHaveProperty(field);
  });

  it("the link's message explains the rule", async () => {
    const res = await api.call(createEventDraft, {
      token: organiser.token,
      body: eventInput(external({ externalTicketUrl: "https://bit.ly/abc" })),
    });
    expect(res.body.fieldErrors.externalTicketUrl).toMatch(/shorteners/);
  });
});

describe("editing a draft's ticketing", () => {
  it("switches between modes before the first approval (ticket types removed, then required again)", async () => {
    const draft = await draftEvent(api, organiser);
    const toExternal = await patch(organiser.token, draft.eventId, eventInput(external()));
    expect(toExternal.status).toBe(200);
    expect(toExternal.body).toMatchObject({ ticketingMode: "external", ticketTypes: [], externalTicketUrl: HUMANITIX });
    expect(await eventRow(draft.eventId)).toMatchObject({ ticket_types: 0, is_free: false });

    const freeNow = await patch(organiser.token, draft.eventId, eventInput(external({ externalTicketUrl: OWN_SITE, externalFree: true })));
    expect(freeNow.status).toBe(200);
    expect(await eventRow(draft.eventId)).toMatchObject({ external_ticket_url: OWN_SITE, external_free: true, is_free: true });

    // Switching back is explicit (without ticketingMode, an edit keeps the stored ticketing).
    expect((await patch(organiser.token, draft.eventId, eventInput({ ticketingMode: "sheltuh", ticketTypes: [] }))).status).toBe(400);
    const back = await patch(organiser.token, draft.eventId, eventInput({ ticketingMode: "sheltuh" }));
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ ticketingMode: "sheltuh", externalFree: false });
    expect(back.body).not.toHaveProperty("externalTicketUrl");
    expect(await eventRow(draft.eventId)).toEqual({
      ticketing_mode: "sheltuh",
      external_ticket_url: null,
      external_free: false,
      is_free: false,
      ticket_types: 1,
    });
  });

  it("a rejected event that was never approved can still change its link", async () => {
    const draft = await draftEvent(api, organiser, external());
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    await api.call(adminRejectEvent, {
      token: admin.token,
      params: { eventId: draft.eventId },
      body: { reason: "Wrong link" },
    });
    const res = await patch(organiser.token, draft.eventId, eventInput(external({ externalTicketUrl: OWN_SITE })));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ externalTicketUrl: OWN_SITE, ticketingLocked: false });
  });

  it("another organiser's event is a 404, and a published one a 409, as before", async () => {
    const event = await publishedEvent(api, organiser, admin, external());
    const rival = await approvedOrganiser(api, admin);
    expect((await patch(rival.token, event.eventId, eventInput(external()))).status).toBe(404);
    expect((await patch(organiser.token, event.eventId, eventInput(external()))).status).toBe(409);
  });
});

describe("the ticketing freezes once approved", () => {
  async function approvedThenUnpublished(overrides: Record<string, unknown> = external()) {
    const event = await publishedEvent(api, organiser, admin, overrides);
    expect(event.ticketingLocked).toBe(true);
    await unpublish(event.eventId);
    return event;
  }

  it("the organiser can't change the link of an event that has been approved (409, nothing changed)", async () => {
    const event = await approvedThenUnpublished();
    const res = await patch(organiser.token, event.eventId, eventInput(external({ externalTicketUrl: OWN_SITE })));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(TICKETING_FROZEN);
    expect(res.body.fieldErrors).toEqual({ externalTicketUrl: TICKETING_FROZEN });
    expect(await eventRow(event.eventId)).toMatchObject({ external_ticket_url: HUMANITIX });
  });

  it("nor its mode, either way", async () => {
    const ext = await approvedThenUnpublished();
    const toSheltuh = await patch(organiser.token, ext.eventId, eventInput({ ticketingMode: "sheltuh" }));
    expect(toSheltuh.status).toBe(409);
    expect(Object.keys(toSheltuh.body.fieldErrors).sort()).toEqual(["externalTicketUrl", "ticketingMode"]);

    const sheltuh = await approvedThenUnpublished({});
    const toExternal = await patch(organiser.token, sheltuh.eventId, eventInput(external()));
    expect(toExternal.status).toBe(409);
    expect(await eventRow(sheltuh.eventId)).toMatchObject({ ticketing_mode: "sheltuh", ticket_types: 1 });
  });

  it("an edit that leaves out ticketingMode keeps the stored ticketing: no 409, no conversion", async () => {
    const event = await approvedThenUnpublished(external({ externalFree: true }));
    // An older client: no ticketing fields at all.
    const renamed = await patch(organiser.token, event.eventId, eventInput({ title: "Renamed", ticketTypes: [] }));
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ title: "Renamed", ticketingMode: "external", externalTicketUrl: HUMANITIX, externalFree: true });
    // Sending Sheltüh ticket types for it is a 400 (never a quiet switch), and nothing changes.
    const withTickets = await patch(organiser.token, event.eventId, eventInput({ title: "Again" }));
    expect(withTickets.status).toBe(400);
    expect(withTickets.body.fieldErrors).toHaveProperty("ticketTypes");
    expect(await eventRow(event.eventId)).toMatchObject({ ticketing_mode: "external", external_ticket_url: HUMANITIX, external_free: true });
    // The free flag can still be changed without sending the mode.
    const notFree = await patch(organiser.token, event.eventId, eventInput({ ticketTypes: [], externalFree: false }));
    expect(notFree.status).toBe(200);
    expect(await eventRow(event.eventId)).toMatchObject({ external_free: false, is_free: false });
  });

  it("an unfrozen external draft is kept too when ticketingMode is left out", async () => {
    const draft = await draftEvent(api, organiser, external());
    const res = await patch(organiser.token, draft.eventId, eventInput({ title: "Renamed", ticketTypes: null }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ticketingMode: "external", externalTicketUrl: HUMANITIX });
  });

  it("everything else stays editable, the free flag included, and the same link can be sent back", async () => {
    const event = await approvedThenUnpublished();
    const res = await patch(
      organiser.token,
      event.eventId,
      eventInput(external({ title: "Renamed", externalTicketUrl: "HTTPS://events.humanitix.com/neon-static", externalFree: true })),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Renamed", externalFree: true, ticketingLocked: true });
    expect(await eventRow(event.eventId)).toMatchObject({ external_ticket_url: HUMANITIX, is_free: true });
  });

  it("getMyEvent reports the lock", async () => {
    const event = await approvedThenUnpublished();
    const res = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(res.body.ticketingLocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Admin changes
// ---------------------------------------------------------------------------

describe("PATCH /admin/events/{id}/ticketing", () => {
  it("needs an admin: 401 signed out, 403 for an organiser", async () => {
    const event = await publishedEvent(api, organiser, admin, external());
    const body = { ...external({ externalTicketUrl: OWN_SITE }), reason: "Fix" };
    expect((await api.call(adminSetEventTicketing, { params: { eventId: event.eventId }, body, method: "PATCH" })).status).toBe(401);
    expect((await adminPatch(organiser.token, event.eventId, body)).status).toBe(403);
    expect(await eventRow(event.eventId)).toMatchObject({ external_ticket_url: HUMANITIX });
  });

  it("validates like the organiser's form, and needs a reason", async () => {
    const event = await publishedEvent(api, organiser, admin, external());
    const noReason = await adminPatch(admin.token, event.eventId, external({ externalTicketUrl: OWN_SITE }));
    expect(noReason.status).toBe(400);
    expect(noReason.body.fieldErrors).toHaveProperty("reason");
    const badUrl = await adminPatch(admin.token, event.eventId, { ...external({ externalTicketUrl: "https://t.co/x" }), reason: "x" });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.fieldErrors).toHaveProperty("externalTicketUrl");
    const tooLong = await adminPatch(admin.token, event.eventId, { ...external(), reason: "x".repeat(501) });
    expect(tooLong.status).toBe(400);
    // The mode is required: a body without it never turns an external event back into a Sheltüh one.
    const noMode = await adminPatch(admin.token, event.eventId, { reason: "Tidy up" });
    expect(noMode.status).toBe(400);
    expect(noMode.body.fieldErrors).toHaveProperty("ticketingMode");
    expect(await eventRow(event.eventId)).toMatchObject({ ticketing_mode: "external", external_ticket_url: HUMANITIX });
  });

  it("404 for an unknown event or a malformed id", async () => {
    const body = { ...external(), reason: "Fix" };
    expect((await adminPatch(admin.token, crypto.randomUUID(), body)).status).toBe(404);
    expect((await adminPatch(admin.token, "nope", body)).status).toBe(404);
  });

  it("changes a published event's link and logs the old and new values with the reason", async () => {
    const event = await publishedEvent(api, organiser, admin, external());
    const res = await adminPatch(admin.token, event.eventId, {
      ...external({ externalTicketUrl: OWN_SITE }),
      reason: "Organiser moved ticket sales to their own site",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "published", externalTicketUrl: OWN_SITE, externalProvider: null });
    expect(res.body.moderationLog.at(-1)).toEqual({
      action: "ticketing_changed",
      by: admin.userId,
      at: expect.any(String),
      reason: "Organiser moved ticket sales to their own site",
      changes: { externalTicketUrl: { old: HUMANITIX, new: OWN_SITE } },
    });

    // The public page follows at once.
    const page = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(page.body.externalTicketUrl).toBe(OWN_SITE);
  });

  it("an unchanged submission changes and logs nothing", async () => {
    const event = await publishedEvent(api, organiser, admin, external());
    const res = await adminPatch(admin.token, event.eventId, { ...external(), reason: "Checked" });
    expect(res.status).toBe(200);
    expect(res.body.moderationLog.map((e: { action: string }) => e.action)).toEqual(["submitted", "approved"]);
  });

  it("moves a Sheltüh-ticketed event with no orders to external (its ticket types go), and logs every field", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const res = await adminPatch(admin.token, event.eventId, { ...external({ externalFree: true }), reason: "Sold elsewhere" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ticketingMode: "external", ticketTypes: [], externalFree: true });
    expect(res.body.moderationLog.at(-1).changes).toEqual({
      ticketingMode: { old: "sheltuh", new: "external" },
      externalTicketUrl: { old: null, new: HUMANITIX },
      externalFree: { old: false, new: true },
    });
    expect(await eventRow(event.eventId)).toMatchObject({ ticket_types: 0, is_free: true });
  });

  it("refuses to move an event with orders to external (409), whatever their status", async () => {
    const event = await publishedEvent(api, organiser, admin);
    await insertOrder(api, event, "buyer@example.com", "failed");
    const res = await adminPatch(admin.token, event.eventId, { ...external(), reason: "Sold elsewhere" });
    expect(res.status).toBe(409);
    expect(await eventRow(event.eventId)).toMatchObject({ ticketing_mode: "sheltuh", ticket_types: 1 });
  });

  it("moves an external event back to Sheltüh ticketing, with no ticket types (neither free nor paid)", async () => {
    const event = await publishedEvent(api, organiser, admin, external({ externalFree: true }));
    const res = await adminPatch(admin.token, event.eventId, { ticketingMode: "sheltuh", reason: "Selling on Sheltüh now" });
    expect(res.status).toBe(200);
    expect(await eventRow(event.eventId)).toEqual({
      ticketing_mode: "sheltuh",
      external_ticket_url: null,
      external_free: false,
      is_free: false,
      ticket_types: 0,
    });
  });

  it("the admin review queue shows the link, the site's name and the lock", async () => {
    const draft = await draftEvent(api, organiser, external({ externalTicketUrl: "https://xn--bcher-kva.de/tickets" }));
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    const queue = await api.call(adminListEvents, { token: admin.token, query: { status: "pending_review" } });
    expect(queue.body.items[0]).toMatchObject({
      ticketingMode: "external",
      externalTicketUrl: "https://xn--bcher-kva.de/tickets",
      externalProvider: null,
      ticketingLocked: false,
    });
    const approved = await api.call(adminApproveEvent, { token: admin.token, params: { eventId: draft.eventId }, method: "POST" });
    expect(approved.body.ticketingLocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Public payloads and pricing filters
// ---------------------------------------------------------------------------

describe("public payloads", () => {
  it("list, slug page and the other public shapes carry the ticketing fields", async () => {
    const ext = await publishedEvent(api, organiser, admin, external({ title: "Ext" }));
    await publishedEvent(api, organiser, admin, { title: "Here" });

    const page = await api.call(getPublicEventBySlug, { params: { slug: ext.slug } });
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      ticketingMode: "external",
      externalTicketUrl: HUMANITIX,
      externalFree: false,
      externalProvider: "Humanitix",
      ticketTypes: [],
    });
    expect(page.body).not.toHaveProperty("ticketingLocked");
    expect(page.body).not.toHaveProperty("moderationLog");

    const list = await api.call(listPublicEvents);
    const byTitle = Object.fromEntries(list.body.items.map((e: { title: string }) => [e.title, e]));
    expect(byTitle.Ext).toEqual(page.body);
    expect(byTitle.Here).toMatchObject({ ticketingMode: "sheltuh", externalFree: false, externalProvider: null });
    expect(byTitle.Here).not.toHaveProperty("externalTicketUrl");
  });

  it("pricing=free includes external events marked free; pricing=paid never includes external events", async () => {
    await publishedEvent(api, organiser, admin, external({ title: "Ext free", externalFree: true }));
    await publishedEvent(api, organiser, admin, external({ title: "Ext paid" }));
    await publishedEvent(api, organiser, admin, { title: "Paid gig" });
    await publishedEvent(api, organiser, admin, {
      title: "Free gig",
      ticketTypes: [{ id: "f", name: "Free", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    });
    const titles = async (pricing: string) =>
      (await api.call(listPublicEvents, { query: { pricing } })).body.items.map((e: { title: string }) => e.title).sort();
    expect(await titles("free")).toEqual(["Ext free", "Free gig"]);
    expect(await titles("paid")).toEqual(["Paid gig"]);
  });
});

// ---------------------------------------------------------------------------
// No checkout, Who's Going or check-in
// ---------------------------------------------------------------------------

describe("refusals for external events", () => {
  let event: EventRecord;

  beforeEach(async () => {
    event = await publishedEvent(api, organiser, admin, external({ externalFree: true }));
    await enablePayouts(api, organiser.organiserId);
  });

  it("checkout is a 409, free or paid, and Stripe is never called", async () => {
    for (const body of [
      { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] },
      { lineItems: [{ ticketTypeId: "free", quantity: 1 }], buyerEmail: "a@example.com" },
      {},
    ]) {
      const res = await api.call(createCheckout, { params: { eventId: event.eventId }, body });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(EXTERNAL_CHECKOUT_REFUSED);
    }
    expect(api.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await api.db.query(`select id from public.orders`)).toEqual([]);
  });

  it("a checkout that read the event before an admin made it external is refused by the database (409)", async () => {
    const sheltuh = await publishedEvent(api, organiser, admin, { title: "Racing" });
    // The handler read the event as Sheltüh-ticketed; the switch commits before the order is inserted.
    const { findEventById } = await import("@/lib/server/handlers/event-queries");
    const stale = await findEventById(api.db, sheltuh.eventId);
    await adminPatch(admin.token, sheltuh.eventId, { ...external(), reason: "Moved" });
    expect(stale?.ticketingMode).toBe("sheltuh");
    const res = await api.call(createCheckout, {
      params: { eventId: sheltuh.eventId },
      body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] },
    });
    expect(res.status).toBe(409);
  });

  it("Who's Going is closed: no count, no opt-in (404), never eligible", async () => {
    const member = await api.signUp();
    await api.db.query(`insert into public.profiles (user_id, display_name, adult_confirmed_at) values ($1, 'Member', now())`, [
      member.userId,
    ]);
    const summary = await api.call(getGoingSummary, { params: { eventId: event.eventId } });
    expect(summary.body).toEqual({ count: 0, closed: true, countHidden: false });
    const put = await api.call(putMyGoing, { token: member.token, params: { eventId: event.eventId }, method: "PUT" });
    expect(put.status).toBe(404);
    const me = await api.call(getMyGoing, { token: member.token, params: { eventId: event.eventId } });
    expect(me.body).toMatchObject({ going: false, eligible: false });
    // The database function refuses it too, whatever calls it.
    const [{ result }] = await api.db.query<{ result: string }>(`select private.set_going($1, $2, $3) as result`, [
      event.eventId,
      member.userId,
      member.email,
    ]);
    expect(result).toBe("event_unavailable");
  });

  it("check-in, its summary and undo are 409 for the organiser, and still 404 for anyone else", async () => {
    const params = { eventId: event.eventId };
    const scan = await api.call(checkInTicket, {
      token: organiser.token,
      params,
      body: { code: "7KQM-2HXD", requestId: crypto.randomUUID() },
    });
    expect(scan.status).toBe(409);
    expect(scan.body.error).toBe(EXTERNAL_CHECK_IN_REFUSED);
    // The refused scan rolled back whole (ticket_check_ins_guard): no check-in allowance used either.
    expect(await api.db.query(`select 1 from private.rate_limits where bucket = 'check_in'`)).toEqual([]);
    expect((await api.call(getCheckInSummary, { token: organiser.token, params })).status).toBe(409);
    const undo = await api.call(undoCheckIn, {
      token: organiser.token,
      params: { ...params, checkInId: crypto.randomUUID() },
      body: { reason: "Wrong person" },
    });
    expect(undo.status).toBe(409);
    expect(await api.db.query(`select id from public.ticket_check_ins`)).toEqual([]);

    const rival = await approvedOrganiser(api, admin);
    const rivalScan = await api.call(checkInTicket, {
      token: rival.token,
      params,
      body: { code: "7KQM-2HXD", requestId: crypto.randomUUID() },
    });
    expect(rivalScan.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Outbound-click beacon
// ---------------------------------------------------------------------------

function click(eventId: string, headers: Record<string, string> = {}, body = "{}") {
  return runHandler(
    recordOutboundClick as Handler<{ eventId: string }>,
    new Request(`${SITE_URL}/api/events/${eventId}/outbound`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": BROWSER_UA, "sec-fetch-site": "same-origin", ...headers },
      body,
    }),
    { eventId },
    api.deps,
  );
}

async function clicks(eventId: string) {
  return api.db.query<{ day: string; clicks: number; cap_reached: boolean }>(
    `select day::text as day, clicks, cap_reached from public.event_outbound_clicks where event_id = $1 order by day`,
    [eventId],
  );
}

describe("POST /events/{id}/outbound", () => {
  let event: EventRecord;

  beforeEach(async () => {
    event = await publishedEvent(api, organiser, admin, external());
  });

  it("counts a click per event per Melbourne day: 204, private, no cookie", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await click(event.eventId);
      expect(res.status).toBe(204);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(await clicks(event.eventId)).toEqual([{ day: today(), clicks: 3, cap_reached: false }]);
  });

  it("404 for anything but a published external event", async () => {
    const sheltuh = await publishedEvent(api, organiser, admin);
    const draft = await draftEvent(api, organiser, external());
    const unpublished = await publishedEvent(api, organiser, admin, external({ title: "Gone" }));
    await unpublish(unpublished.eventId);
    for (const eventId of [sheltuh.eventId, draft.eventId, unpublished.eventId, crypto.randomUUID(), "not-a-uuid"]) {
      expect((await click(eventId)).status, eventId).toBe(404);
    }
    expect(await api.db.query(`select * from public.event_outbound_clicks`)).toEqual([]);
  });

  it("ignores bots, prefetches, other sites, non-JSON beacons and oversized bodies (204, not counted)", async () => {
    const ignored: Record<string, string>[] = [
      { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" },
      { "user-agent": "curl/8.4.0" },
      { "user-agent": "" },
      { "sec-purpose": "prefetch" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { "content-type": "text/plain;charset=UTF-8" },
      { "content-type": "application/x-www-form-urlencoded" },
    ];
    for (const headers of ignored) expect((await click(event.eventId, headers)).status, JSON.stringify(headers)).toBe(204);
    const big = await click(event.eventId, { "content-length": "5000" }, "x".repeat(5000));
    expect(big.status).toBe(204);
    expect(await clicks(event.eventId)).toEqual([]);
    // A bot never even learns whether the event exists.
    expect((await click(crypto.randomUUID(), { "user-agent": "curl/8.4.0" })).status).toBe(204);
  });

  it("the body is never read: anything (or nothing) small counts the same", async () => {
    expect((await click(event.eventId, {}, "not json")).status).toBe(204);
    expect((await click(event.eventId, {}, "")).status).toBe(204);
    expect((await click(event.eventId, {}, JSON.stringify({ url: "https://evil.example", email: "a@b.c" }))).status).toBe(204);
    expect(await clicks(event.eventId)).toEqual([{ day: today(), clicks: 3, cap_reached: false }]);
  });

  it("once the day is flagged, a refused click writes nothing (no transaction id)", async () => {
    const limit = 2;
    // Counted, counted, then refused: the first refusal flags the day (a write).
    const outbound = () =>
      api.db.query<{ result: string; xid: string | null }>(
        `with r as (select private.record_outbound_click($1, $2, '1 minute'::interval) as result)
         select r.result, pg_current_xact_id_if_assigned()::text as xid from r`,
        [event.eventId, limit],
      );
    expect((await outbound())[0]).toEqual({ result: "recorded", xid: expect.any(String) });
    expect((await outbound())[0]).toEqual({ result: "recorded", xid: expect.any(String) });
    expect((await outbound())[0]).toEqual({ result: "rate_limited", xid: expect.any(String) });
    // Every refusal after that is plain reads: no row lock, no transaction id.
    for (let i = 0; i < 3; i++) expect((await outbound())[0]).toEqual({ result: "rate_limited", xid: null });
    expect(await clicks(event.eventId)).toEqual([{ day: today(), clicks: 2, cap_reached: true }]);
  });

  it("past the per-event cap, clicks aren't counted and the day is flagged (once)", async () => {
    await api.db.query(
      `insert into private.event_rate_limits (event_id, bucket, window_started_at, hits) values ($1, 'outbound', now(), $2)`,
      [event.eventId, OUTBOUND_RATE_LIMIT.hits - 1],
    );
    expect((await click(event.eventId)).status).toBe(204); // takes the last slot
    for (let i = 0; i < 3; i++) expect((await click(event.eventId)).status).toBe(204);
    expect(await clicks(event.eventId)).toEqual([{ day: today(), clicks: 1, cap_reached: true }]);
    // Views have their own cap: a click flood doesn't touch them.
    const [{ n }] = await api.db.query<{ n: number }>(
      `select count(*)::int as n from private.event_rate_limits where event_id = $1 and bucket = 'views'`,
      [event.eventId],
    );
    expect(n).toBe(0);
  });

  it("stores nothing about the visitor: the table is event, day, count and the cap flag", async () => {
    const columns = await api.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'event_outbound_clicks' order by ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(["event_id", "day", "clicks", "cap_reached"]);
  });

  it("purge_analytics deletes counts older than 25 months; deleting the event deletes them", async () => {
    await api.db.query(
      `insert into public.event_outbound_clicks (event_id, day, clicks) values
         ($1, ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date - 1, 5),
         ($1, (now() at time zone 'Australia/Melbourne')::date, 2)`,
      [event.eventId],
    );
    await api.db.query(`select * from private.purge_analytics()`);
    expect((await clicks(event.eventId)).map((r) => r.clicks)).toEqual([2]);

    const draft = await draftEvent(api, organiser, external());
    await api.db.query(`insert into public.event_outbound_clicks (event_id, day, clicks) values ($1, current_date, 1)`, [
      draft.eventId,
    ]);
    await api.db.query(`delete from public.event_moderation_log where event_id = $1`, [draft.eventId]);
    await api.db.query(`delete from public.events where id = $1`, [draft.eventId]);
    expect(await clicks(draft.eventId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe("analytics", () => {
  async function csvText(handler: Handler<{ eventId: string }> | Handler, params: Record<string, string> = {}, query = "") {
    const res = await runHandler(
      handler as Handler<Record<string, string>>,
      new Request(`${SITE_URL}/api/test.csv${query}`, { headers: { authorization: `Bearer ${organiser.token}` } }),
      params,
      api.deps,
    );
    expect(res.status).toBe(200);
    return res.text();
  }

  it("an external event's report has its ticket-link clicks per day and in total; a Sheltüh one has null", async () => {
    const ext = await publishedEvent(api, organiser, admin, external());
    const here = await publishedEvent(api, organiser, admin);
    await click(ext.eventId);
    await click(ext.eventId);

    const report = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: ext.eventId } });
    expect(report.status).toBe(200);
    expect(report.body.event.ticketingMode).toBe("external");
    expect(report.body.outboundClicks).toEqual({
      total: 2,
      unreliable: false,
      byDay: [{ date: today(), clicks: 2, unreliable: false }],
    });

    const compared = await api.call(getEventAnalytics, {
      token: organiser.token,
      params: { eventId: ext.eventId },
      query: { compare: "prevPeriod" },
    });
    expect(compared.body.outboundClicks.previous).toMatchObject({ total: 0, unreliable: false });

    const other = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: here.eventId } });
    expect(other.body.event.ticketingMode).toBe("sheltuh");
    expect(other.body.outboundClicks).toBeNull();
  });

  it("the overview has each external event's clicks and the organiser's total per day", async () => {
    const plain = await overview();
    expect(plain.body.outboundClicks).toBeNull();

    const ext = await publishedEvent(api, organiser, admin, external({ title: "Ext" }));
    await publishedEvent(api, organiser, admin, { title: "Here" });
    await click(ext.eventId);
    await api.db.query(`update public.event_outbound_clicks set cap_reached = true where event_id = $1`, [ext.eventId]);

    const res = await overview({ compare: "prevPeriod" });
    const byTitle = Object.fromEntries(res.body.events.map((e: { title: string }) => [e.title, e]));
    expect(byTitle.Ext).toMatchObject({
      ticketingMode: "external",
      outboundClicks: { total: 1, unreliable: true, previous: { total: 0, unreliable: false } },
    });
    expect(byTitle.Here.ticketingMode).toBe("sheltuh");
    expect(byTitle.Here).not.toHaveProperty("outboundClicks");
    expect(res.body.outboundClicks).toMatchObject({ total: 1, unreliable: true, previous: { total: 0 } });
    expect(res.body.outboundClicks.byDay.at(-1)).toEqual({ date: today(), clicks: 1, unreliable: true });
    expect(res.body.outboundClicks.byDay).toHaveLength(30);

    // Other organisers' clicks never show.
    const rival = await approvedOrganiser(api, admin);
    const rivalOverview = await api.call(getAnalyticsOverview, { token: rival.token });
    expect(rivalOverview.body.outboundClicks).toBeNull();
  });

  it("the CSVs add a ticket-link clicks section for external events only", async () => {
    const ext = await publishedEvent(api, organiser, admin, external({ title: "Ext" }));
    const here = await publishedEvent(api, organiser, admin, { title: "Here" });
    await click(ext.eventId);

    const extCsv = await csvText(getEventAnalyticsCsv, { eventId: ext.eventId });
    expect(extCsv).toContain(`"Date","Ticket link clicks"\r\n"${today()}","1"\r\n"Total","1"\r\n`);
    const hereCsv = await csvText(getEventAnalyticsCsv, { eventId: here.eventId });
    expect(hereCsv).not.toContain("Ticket link clicks");

    const all = await csvText(getAnalyticsOverviewCsv, {}, "?compare=prevPeriod");
    expect(all).toContain(`"Event (tickets sold elsewhere)","Ticket link clicks","Previous ticket link clicks"\r\n"Ext","1","0"\r\n"Total","1","0"\r\n`);
  });

  function overview(query?: Record<string, string>) {
    return api.call(getAnalyticsOverview, { token: organiser.token, query });
  }
});
