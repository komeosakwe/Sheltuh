import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BEFORE_YOU_GO_MAX_LENGTH, BEFORE_YOU_GO_MAX_LINES, validateBeforeYouGo } from "@/lib/before-you-go";
import { adminListEvents } from "@/lib/server/handlers/admin";
import { adminCreateEvent, adminGetEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { createEventDraft, getMyEvent, submitEventForReview, updateEventDraft } from "@/lib/server/handlers/events";
import { createCheckout, getOrderBySession } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { buildEventReminderEmail } from "@/lib/server/event-reminder-email";
import { buildFreeConfirmationEmail } from "@/lib/server/free-confirmation-email";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import type { AdminEventRecord, EventRecord } from "@/lib/server/types";
import { CRON_SECRET, SITE_URL, TestApi } from "./helpers/api";
import {
  approvedOrganiser,
  draftEvent,
  eventInput,
  insertOrder,
  publishedEvent,
  setUpPayouts,
  signUpAdmin,
  withoutHostCard,
} from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * "Before you go": the organiser's note for people going (docs/architecture.md,
 * "Before you go"; supabase/migrations/20261204000000_event_before_you_go.sql;
 * lib/before-you-go.ts, lib/server/event-input.ts parseBeforeYouGo).
 */

// The email builders, unchanged but watched: the outbox and the free booking must hand them the note.
vi.mock("@/lib/server/ticket-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/ticket-email")>();
  return { ...real, buildTicketEmail: vi.fn(real.buildTicketEmail) };
});
vi.mock("@/lib/server/event-reminder-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/event-reminder-email")>();
  return { ...real, buildEventReminderEmail: vi.fn(real.buildEventReminderEmail) };
});
vi.mock("@/lib/server/free-confirmation-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/free-confirmation-email")>();
  return { ...real, buildFreeConfirmationEmail: vi.fn(real.buildFreeConfirmationEmail) };
});

const LATTE_EXAMPLES = [
  "Doors open 5:00 pm · last entry 8:00 pm.",
  "18+ event — bring photo ID that matches the ticket holder name.",
  "Phone-free night: scan in with your phone, then it goes into a locked pouch until you leave. It unlocks at the exit.",
];
const NOTE = LATTE_EXAMPLES.join("\n");

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
  vi.mocked(buildTicketEmail).mockClear();
  vi.mocked(buildEventReminderEmail).mockClear();
  vi.mocked(buildFreeConfirmationEmail).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const create = (body: Record<string, unknown>, token = organiser.token) =>
  api.call(createEventDraft, { token, body: eventInput(body) });
const patch = (eventId: string, body: Record<string, unknown>, token = organiser.token) =>
  api.call(updateEventDraft, { token, params: { eventId }, body: eventInput(body), method: "PATCH" });

/** The organiser's submit for review (their paid event needs payouts first). */
async function submit(eventId: string) {
  await setUpPayouts(api, organiser.organiserId);
  const res = await api.call(submitEventForReview, { token: organiser.token, params: { eventId }, method: "POST" });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("pending_review");
}

async function stored(eventId: string): Promise<string | null> {
  const [row] = await api.db.query<{ note: string | null }>(`select before_you_go as note from public.events where id = $1`, [eventId]);
  return row.note;
}

describe("the organiser's create and edit", () => {
  it("stores the note, returns it on the organiser's record, and has no field without one", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: NOTE });
    expect(event.beforeYouGo).toBe(NOTE);
    expect(await stored(event.eventId)).toBe(NOTE);
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(mine.body.beforeYouGo).toBe(NOTE);

    const none = await draftEvent(api, organiser, { title: "No note" });
    expect(none).not.toHaveProperty("beforeYouGo");
    expect(await stored(none.eventId)).toBeNull();
  });

  it("cleans it: line endings, trailing spaces, blank-line runs and the ends", async () => {
    const event = await draftEvent(api, organiser, {
      beforeYouGo: "  \r\n Doors 7 pm.   \r\n\r\n\r\n\r\nLast entry 10 pm.\t\rBring ID.  \n\n ",
    });
    expect(event.beforeYouGo).toBe("Doors 7 pm.\n\nLast entry 10 pm.\nBring ID.");
  });

  it("stores empty, blank and null as no note", async () => {
    for (const blank of ["", "   ", " \r\n\t\n ", null]) {
      const res = await create({ title: `Blank ${JSON.stringify(blank)}`, beforeYouGo: blank });
      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty("beforeYouGo");
      expect(await stored(res.body.eventId)).toBeNull();
    }
  });

  it("keeps HTML-like text as the characters typed (plain text, never markup)", async () => {
    const html = `<b>Doors</b> open at 7 & the bar's "cash only" <script>alert(1)</script>`;
    const event = await draftEvent(api, organiser, { beforeYouGo: html });
    expect(event.beforeYouGo).toBe(html);
    expect(await stored(event.eventId)).toBe(html);
  });

  it(`takes up to ${BEFORE_YOU_GO_MAX_LENGTH} characters, counted as people see them`, async () => {
    const exact = await create({ beforeYouGo: "a".repeat(BEFORE_YOU_GO_MAX_LENGTH) });
    expect(exact.status).toBe(201);
    // 500 emoji are 1000 UTF-16 units but 500 characters, as the database's char_length counts them.
    const emoji = await create({ title: "Emoji", beforeYouGo: "🎟".repeat(BEFORE_YOU_GO_MAX_LENGTH) });
    expect(emoji.status).toBe(201);
    // Spaces cleaning removes don't count.
    const padded = await create({ title: "Padded", beforeYouGo: `   ${"b".repeat(BEFORE_YOU_GO_MAX_LENGTH)}   \n\n` });
    expect(padded.status).toBe(201);

    for (const tooLong of ["a".repeat(BEFORE_YOU_GO_MAX_LENGTH + 1), "x".repeat(BEFORE_YOU_GO_MAX_LENGTH * 4 + 1)]) {
      const res = await create({ beforeYouGo: tooLong });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toEqual({ beforeYouGo: `Must be ${BEFORE_YOU_GO_MAX_LENGTH} characters or fewer.` });
    }
  });

  it(`takes up to ${BEFORE_YOU_GO_MAX_LINES} lines of text; a blank line between two doesn't count`, async () => {
    const five = Array.from({ length: 5 }, (_, i) => `Line ${i + 1}`);
    expect((await create({ beforeYouGo: five.join("\n") })).status).toBe(201);
    const spaced = await create({ title: "Spaced", beforeYouGo: five.join("\n\n") });
    expect(spaced.status).toBe(201);
    expect(spaced.body.beforeYouGo).toBe(five.join("\n\n"));

    const six = await create({ beforeYouGo: [...five, "Line 6"].join("\r\n") });
    expect(six.status).toBe(400);
    expect(six.body.fieldErrors).toEqual({ beforeYouGo: "Keep it to 5 lines or fewer." });
  });

  it("refuses links, web and email addresses", async () => {
    for (const text of [
      "Tickets at https://example.com/door",
      "See www.venue.example for parking",
      "Map: thevenue.com.au/map",
      "Questions? hello@venue.example",
      "Questions? hello [at] venue [dot] com",
    ]) {
      const res = await create({ beforeYouGo: text });
      expect(res.status, text).toBe(400);
      expect(res.body.fieldErrors.beforeYouGo, text).toMatch(/can't include (links or web|email) addresses/);
    }
    // Times, prices and abbreviations aren't addresses.
    const fine = await create({ beforeYouGo: "Doors 7.30pm, A$12.50 at the door, St. Kilda entrance, e.g. the side gate" });
    expect(fine.status).toBe(201);
  });

  it("refuses control, invisible and text-direction characters, stacked marks and anything but text", async () => {
    for (const text of ["Doors\u0007 open", "Doors\u0000", "Doors ‮open", "Do​ors", `Z${"́".repeat(6)}`]) {
      const res = await create({ beforeYouGo: text });
      expect(res.status, JSON.stringify(text)).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["beforeYouGo"]);
    }
    for (const value of [42, true, ["Doors"], { text: "Doors" }]) {
      const res = await create({ beforeYouGo: value });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors).toEqual({ beforeYouGo: "Write the note as text, or leave it blank." });
    }
  });

  it("reports its error with the other fields' at once", async () => {
    const res = await create({ title: "", beforeYouGo: "x".repeat(BEFORE_YOU_GO_MAX_LENGTH + 1) });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["beforeYouGo", "title"]);
  });

  it("an edit keeps it when the field isn't sent, replaces it, and clears it with null or blank", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: NOTE });
    const kept = await patch(event.eventId, { title: "Renamed" });
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ title: "Renamed", beforeYouGo: NOTE });

    const replaced = await patch(event.eventId, { beforeYouGo: "Doors at 6." });
    expect(replaced.body.beforeYouGo).toBe("Doors at 6.");

    const cleared = await patch(event.eventId, { beforeYouGo: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).not.toHaveProperty("beforeYouGo");
    expect(await stored(event.eventId)).toBeNull();

    await patch(event.eventId, { beforeYouGo: "Back again." });
    const blanked = await patch(event.eventId, { beforeYouGo: "  " });
    expect(blanked.body).not.toHaveProperty("beforeYouGo");
    expect(await stored(event.eventId)).toBeNull();
  });

  it("an invalid edit writes nothing", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: NOTE });
    const res = await patch(event.eventId, { title: "Changed", beforeYouGo: "Map at venue.com" });
    expect(res.status).toBe(400);
    const [row] = await api.db.query<{ title: string }>(`select title from public.events where id = $1`, [event.eventId]);
    expect(row.title).toBe("Neon Static");
    expect(await stored(event.eventId)).toBe(NOTE);
  });

  it("follows the edit rules of the other fields: not while in review or published", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: NOTE });
    await submit(event.eventId);
    const res = await patch(event.eventId, { beforeYouGo: "Changed in review" });
    expect(res.status).toBe(409);
    expect(await stored(event.eventId)).toBe(NOTE);
  });

  it("the editor's check (lib/before-you-go.ts) agrees with the API on the examples", async () => {
    for (const text of [NOTE, "", "  "]) expect(validateBeforeYouGo(text)).toBeNull();
    expect(validateBeforeYouGo(["1", "2", "3", "4", "5", "6"].join("\n"))).toBe("Keep it to 5 lines or fewer.");
    expect(validateBeforeYouGo("See venue.com")).toMatch(/links or web addresses/);
    expect(validateBeforeYouGo("Mail a@b.example")).toMatch(/can't include/);
    expect(validateBeforeYouGo("a".repeat(501))).toMatch(/500 characters/);
  });
});

describe("who can set and read it", () => {
  it("401 signed out, 403 for an account that isn't an approved organiser", async () => {
    const anon = await api.call(createEventDraft, { body: eventInput({ beforeYouGo: NOTE }) });
    expect(anon.status).toBe(401);
    const member = await api.signUp();
    const res = await create({ beforeYouGo: NOTE }, member.token);
    expect(res.status).toBe(403);
  });

  it("another organiser's event is a 404 to read and to edit, and stays as it was", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: NOTE });
    const other = await approvedOrganiser(api, admin, { displayName: "Other Collective", contactEmail: "other@example.com" });

    const read = await api.call(getMyEvent, { token: other.token, params: { eventId: event.eventId } });
    expect(read.status).toBe(404);
    expect(read.body).not.toHaveProperty("beforeYouGo");

    const edit = await patch(event.eventId, { beforeYouGo: "Hijacked" }, other.token);
    expect(edit.status).toBe(404);
    expect(await stored(event.eventId)).toBe(NOTE);
  });

  it("is public on a published event's page and in the feed, the same in both", async () => {
    const event = await publishedEvent(api, organiser, admin, { beforeYouGo: NOTE });
    const page = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(page.status).toBe(200);
    expect(page.body.beforeYouGo).toBe(NOTE);
    const list = await api.call(listPublicEvents);
    const item = list.body.items.find((e: { slug: string }) => e.slug === event.slug);
    expect(item).toEqual(withoutHostCard(page.body));

    const plain = await publishedEvent(api, organiser, admin, { title: "Plain" });
    const plainPage = await api.call(getPublicEventBySlug, { params: { slug: plain.slug } });
    expect(plainPage.body).not.toHaveProperty("beforeYouGo");
  });

  it("a draft's note isn't public", async () => {
    const draft = await draftEvent(api, organiser, { beforeYouGo: NOTE });
    const page = await api.call(getPublicEventBySlug, { params: { slug: draft.slug } });
    expect(page.status).toBe(404);
    const list = await api.call(listPublicEvents);
    expect(JSON.stringify(list.body)).not.toContain("Phone-free");
  });

  it("admins see it in the review queue and on the event", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: NOTE });
    await submit(event.eventId);
    const queue = await api.call(adminListEvents, { token: admin.token, query: { status: "pending_review" } });
    expect(queue.status).toBe(200);
    expect(queue.body.items.find((e: { eventId: string }) => e.eventId === event.eventId).beforeYouGo).toBe(NOTE);
    const one = await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } });
    expect(one.body.beforeYouGo).toBe(NOTE);
  });
});

describe("an admin's create and edit", () => {
  const editBody = (event: AdminEventRecord, overrides: Record<string, unknown> = {}) => ({
    ...eventInput(),
    ticketTypes: event.ticketTypes,
    ticketingMode: event.ticketingMode,
    expectedUpdatedAt: event.updatedAt,
    ...overrides,
  });
  const adminEdit = (eventId: string, body: unknown) =>
    api.call(adminUpdateEvent, { token: admin.token, params: { eventId }, body, method: "PATCH" });

  it("creates with a note, edits it (logged with old and new), keeps it unsent, and clears it", async () => {
    const created = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ beforeYouGo: NOTE }), organiserId: organiser.organiserId },
    });
    expect(created.status).toBe(201);
    const event = created.body as AdminEventRecord;
    expect(event.beforeYouGo).toBe(NOTE);

    const edited = await adminEdit(event.eventId, editBody(event, { beforeYouGo: "Doors at 6." }));
    expect(edited.status).toBe(200);
    expect(edited.body.beforeYouGo).toBe("Doors at 6.");
    expect(edited.body.moderationLog.at(-1)).toMatchObject({
      action: "edited",
      changes: { beforeYouGo: { old: NOTE, new: "Doors at 6." } },
    });

    // Not sent: kept, and nothing else changed, so nothing is written or logged.
    const logLength = edited.body.moderationLog.length;
    const unchanged = await adminEdit(event.eventId, editBody(edited.body));
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.beforeYouGo).toBe("Doors at 6.");
    expect(unchanged.body.moderationLog).toHaveLength(logLength);

    const cleared = await adminEdit(event.eventId, editBody(unchanged.body, { beforeYouGo: null }));
    expect(cleared.status).toBe(200);
    expect(cleared.body).not.toHaveProperty("beforeYouGo");
    expect(cleared.body.moderationLog.at(-1).changes).toEqual({ beforeYouGo: { old: "Doors at 6.", new: null } });
  });

  it("an admin can change a published event's note; the organiser sees the change as Sheltüh's", async () => {
    const event = await publishedEvent(api, organiser, admin, { beforeYouGo: NOTE });
    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body as AdminEventRecord;
    const res = await adminEdit(event.eventId, editBody(current, { beforeYouGo: "Doors moved to 8 pm." }));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    const page = await api.call(getPublicEventBySlug, { params: { slug: event.slug } });
    expect(page.body.beforeYouGo).toBe("Doors moved to 8 pm.");
    const mine = await api.call(getMyEvent, { token: organiser.token, params: { eventId: event.eventId } });
    expect(mine.body.moderationLog.at(-1)).toMatchObject({ action: "edited", changes: { beforeYouGo: { new: "Doors moved to 8 pm." } } });
  });

  it("validates like the organiser's form", async () => {
    const res = await api.call(adminCreateEvent, {
      token: admin.token,
      body: { ...eventInput({ beforeYouGo: "Map: venue.com" }), organiserId: organiser.organiserId },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["beforeYouGo"]);
  });
});

describe("the emails' and the ticket page's data", () => {
  const FREE = [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 }];

  const cron = () =>
    api.send(
      runEmailOutboxCron,
      new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    );
  const ticketPage = async (orderId: string) => (await api.call(getOrderBySession, { params: { sessionId: orderId } })).body;

  /** A free order booked by a member with their own verified email: issued straight away, its ticket email queued. */
  async function memberFreeOrder(eventId: string) {
    const member = await api.signUp({ email: `member-${crypto.randomUUID().slice(0, 8)}@example.com` });
    const res = await api.call(createCheckout, {
      token: member.token,
      params: { eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: member.email },
    });
    expect(res.status).toBe(201);
    return new URL(res.body.url).searchParams.get("session_id") as string;
  }

  it("the ticket email's event and the ticket page carry the note", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE, beforeYouGo: NOTE });
    const orderId = await memberFreeOrder(event.eventId);
    await api.runDeferred();
    await cron();
    const calls = vi.mocked(buildTicketEmail).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)![1].beforeYouGo).toBe(NOTE);

    const page = await ticketPage(orderId);
    expect(page).toMatchObject({ status: "paid", eventListed: true, beforeYouGo: NOTE });
  });

  it("the ticket page leaves it out once the event isn't published, and when there's none", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE, beforeYouGo: NOTE });
    const orderId = await memberFreeOrder(event.eventId);
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    const page = await ticketPage(orderId);
    expect(page.eventListed).toBe(false);
    expect(page).not.toHaveProperty("beforeYouGo");

    const plain = await publishedEvent(api, organiser, admin, { title: "Plain", ticketTypes: FREE });
    expect(await ticketPage(await memberFreeOrder(plain.eventId))).not.toHaveProperty("beforeYouGo");
  });

  it("the ticket page leaves it out of an order that isn't paid", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE, beforeYouGo: NOTE });
    const orderId = await insertOrder(api, event, "refunded@example.com", "refunded");
    const page = await ticketPage(orderId);
    expect(page.status).toBe("refunded");
    expect(page).not.toHaveProperty("beforeYouGo");
  });

  it("the free-ticket confirmation's event carries the note", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: FREE, beforeYouGo: NOTE });
    const res = await api.call(createCheckout, {
      params: { eventId: event.eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" },
    });
    expect(res.status).toBe(202);
    const calls = vi.mocked(buildFreeConfirmationEmail).mock.calls;
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as EventRecord).beforeYouGo).toBe(NOTE);
  });

  it("the reminder's event carries the note", async () => {
    const event = await publishedEvent(api, organiser, admin, { beforeYouGo: NOTE });
    await api.db.query(`delete from private.email_outbox where kind <> 'event_reminder'`);
    const orderId = await insertOrder(api, event, "goer@example.com", "paid");
    await api.db.query(`update public.orders set created_at = now() - interval '1 day' where id = $1`, [orderId]);
    await api.db.query(
      `update public.events set starts_at = now() + interval '20 hours', ends_at = now() + interval '23 hours' where id = $1`,
      [event.eventId],
    );
    const [{ n }] = await api.db.query<{ n: number }>(`select private.queue_event_reminders(100, now(), 0) as n`);
    expect(n).toBe(1);
    await cron();
    const calls = vi.mocked(buildEventReminderEmail).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].event.beforeYouGo).toBe(NOTE);
  });
});

describe("the database", () => {
  async function setNote(note: string) {
    const event = await draftEvent(api, organiser, { title: `DB ${crypto.randomUUID().slice(0, 6)}` });
    return api.db.query(`update public.events set before_you_go = $2 where id = $1`, [event.eventId, note]);
  }

  it("holds the limits whatever the code sends", async () => {
    for (const bad of [
      "",
      " Doors",
      "Doors\n",
      "Doors\r\nopen",
      "a\n\n\nb",
      "Doors\u0007",
      "x".repeat(501),
      ["1", "2", "3", "4", "5", "6"].join("\n"),
    ]) {
      await expect(setNote(bad), JSON.stringify(bad)).rejects.toThrow(/events_before_you_go_check/);
    }
    for (const good of [NOTE, "x".repeat(500), "🎟".repeat(500), ["1", "2", "3", "4", "5"].join("\n\n"), "Tab\tinside"]) {
      await expect(setNote(good)).resolves.toBeDefined();
    }
  });

  it("the edit functions keep a stored note for a caller that doesn't send the key (the deploy window)", async () => {
    const event = await draftEvent(api, organiser, { beforeYouGo: NOTE });
    const fields = { ...eventInput(), startsAt: event.startsAt, endsAt: event.endsAt, ticketingMode: "sheltuh" };
    const [row] = await api.db.query<{ result: string }>(
      `select private.edit_event_draft($1, $2, $3::text::jsonb, $4::text::jsonb) as result`,
      [event.eventId, organiser.organiserId, JSON.stringify(fields), JSON.stringify(event.ticketTypes)],
    );
    expect(row.result).toBe("updated");
    expect(await stored(event.eventId)).toBe(NOTE);
  });
});
