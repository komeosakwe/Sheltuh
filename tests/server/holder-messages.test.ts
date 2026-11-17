import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSuspendOrganiser } from "@/lib/server/handlers/admin";
import { runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import {
  adminCancelHolderMessage,
  adminGetHolderMessage,
  adminListHolderMessages,
  getHolderMessages,
  HOLDER_MESSAGE_LIMITS,
  openStopHolderMessages,
  sendHolderMessage,
  stopHolderMessages,
} from "@/lib/server/handlers/holder-messages";
import type { EventRecord } from "@/lib/server/types";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import { application } from "./helpers/fixtures";
import { CRON_SECRET, SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, insertOrder, publishedEvent, selfPublishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// Messages to ticket holders: docs/architecture.md, "Messages to ticket holders";
// supabase/migrations/20261118000100_ticket_holder_messages.sql;
// lib/server/handlers/holder-messages.ts; lib/server/email-outbox.ts (deliverHolderMessage).

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

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
  event = await publish();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Publishes an event, then drops the admin review emails its submission queued. */
async function publish(who = organiser, overrides: Record<string, unknown> = {}) {
  const published = await publishedEvent(api, who, admin, overrides);
  await api.db.query(`delete from private.email_outbox`);
  return published;
}

/** Paid orders, one per address, made a day ago. */
async function holders(emails: string[], of: EventRecord = event) {
  const ids: string[] = [];
  for (const email of emails) ids.push(await insertOrder(api, of, email, "paid"));
  await api.db.query(`update public.orders set created_at = now() - interval '1 day' where event_id = $1`, [of.eventId]);
  return ids;
}

const LIMITS = HOLDER_MESSAGE_LIMITS;

/** The allowances of an organiser who has sent nothing. */
const FULL_ALLOWANCE = {
  eventToday: LIMITS.perEventPerDay,
  eventTotal: LIMITS.perEventTotal,
  organiserToday: LIMITS.perOrganiserPerDay,
};

const FIVE = ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"];

const SUBJECT = "Doors now open at 7pm";
const BODY = "Doors now open at 7pm instead of 8pm. Please bring photo ID for entry and arrive early.";

const validBody = (overrides: Record<string, unknown> = {}) => ({
  requestId: crypto.randomUUID(),
  subject: SUBJECT,
  body: BODY,
  attest: true,
  expectedRecipients: 5,
  ...overrides,
});

const get = (token?: string, eventId = event.eventId) =>
  api.call(getHolderMessages, { token, params: { eventId } });

/** POST as the organiser by default; `null` for no token. */
const post = (body: unknown, token: string | null = organiser.token, eventId = event.eventId) =>
  api.call(sendHolderMessage, { token: token ?? undefined, params: { eventId }, body });

/**
 * A day later: every message sent so far is over 24 hours old, so the rolling
 * day caps (the event's and the organiser's) are open again. The messages
 * still count towards the event's total.
 */
async function nextDay() {
  await api.db.query(`update private.holder_messages set created_at = created_at - interval '25 hours'`);
  await api.db.query(`delete from private.rate_limits`);
}

const cron = () =>
  api.send(
    runEmailOutboxCron,
    new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
  );

/** The messages sent to ticket holders (the setup's other emails aren't counted). */
function holderMails() {
  return api.sendEmail.mock.calls.map(([m]) => m).filter((m) => m.subject.startsWith(`${event.title}: `));
}

const jobs = () =>
  api.db.query<{ status: string; attempts: number; last_error: string | null }>(
    `select status, attempts, last_error from private.email_outbox where kind = 'holder_message' order by id`,
  );

const recipients = () =>
  api.db.query<{ sent: boolean; skip_reason: string | null }>(
    `select sent_at is not null as sent, skip_reason from private.holder_message_recipients order by id`,
  );

describe("GET /api/events/{eventId}/holder-messages", () => {
  it("shows the audience, what can be sent, the allowances and the history, and never an address", async () => {
    await holders(FIVE);
    const res = await get(organiser.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({
      eventId: event.eventId,
      audienceCount: 5,
      canSend: true,
      limits: HOLDER_MESSAGE_LIMITS,
      remaining: FULL_ALLOWANCE,
      messages: [],
    });

    expect((await post(validBody())).status).toBe(201);
    await api.runDeferred();
    const after = await get(organiser.token);
    expect(after.body.remaining).toEqual({
      eventToday: LIMITS.perEventPerDay - 1,
      eventTotal: LIMITS.perEventTotal - 1,
      organiserToday: LIMITS.perOrganiserPerDay - 1,
    });
    expect(after.body.messages).toEqual([
      {
        messageId: expect.any(String),
        subject: SUBJECT,
        body: BODY,
        recipientCount: 5,
        sentCount: 5,
        skippedCount: 0,
        createdAt: expect.any(String),
        cancelled: false,
      },
    ]);
    // No address anywhere in what an organiser reads.
    expect(JSON.stringify(res.body)).not.toContain("@");
    expect(JSON.stringify(after.body)).not.toContain("@");
  });

  it("counts one person once however many orders or address spellings, and not unpaid or refunded orders", async () => {
    await holders(["a@example.com", "A@example.com", "a+promo@example.com"]);
    for (const status of ["pending", "failed", "refunded", "oversold_refund_required"] as const) {
      await insertOrder(api, event, `${status}@example.com`, status);
    }
    expect((await get(organiser.token)).body.audienceCount).toBe(1);
  });

  it.each([
    ["no holders", async () => {}, "no_recipients"],
    ["an unpublished event", async () => void (await api.db.query(`update public.events set status = 'draft'`)), "not_published"],
    [
      "an event that ended more than 2 days ago",
      async () =>
        void (await api.db.query(`update public.events set starts_at = now() - interval '3 days', ends_at = now() - interval '2 days 1 hour'`)),
      "outside_window",
    ],
  ])("canSend is false with %s", async (_name, change, reason) => {
    await holders(FIVE);
    if (reason === "no_recipients") await api.db.query(`update public.orders set status = 'refunded'`);
    await change();
    const res = await get(organiser.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ canSend: false, blockedReason: reason });
  });

  it("reports an event sold on another site, and the used-up allowances", async () => {
    const external = await selfPublishedEvent(api, organiser, {
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon-static",
      ticketTypes: [],
    });
    expect((await get(organiser.token, external.eventId)).body).toMatchObject({ canSend: false, blockedReason: "external" });

    await holders(FIVE);
    for (let i = 0; i < LIMITS.perEventPerDay; i++) expect((await post(validBody())).status).toBe(201);
    expect((await get(organiser.token)).body).toMatchObject({
      canSend: false,
      blockedReason: "event_day_cap",
      remaining: {
        eventToday: 0,
        eventTotal: LIMITS.perEventTotal - LIMITS.perEventPerDay,
        organiserToday: LIMITS.perOrganiserPerDay - LIMITS.perEventPerDay,
      },
    });
  });

  it("401 without a token, 403 for a member or a pending organiser, 404 for another organiser's event or a bad id", async () => {
    expect((await get()).status).toBe(401);
    const member = await api.signUp();
    expect((await get(member.token)).status).toBe(403);
    const pending = await api.signUp();
    expect((await api.call(applyAsOrganiser, { token: pending.token, body: application })).status).toBe(201);
    expect((await get(pending.token)).status).toBe(403);

    const other = await approvedOrganiser(api, admin, { displayName: "Other Collective", contactEmail: "other@example.com" });
    const mine = await get(organiser.token);
    const theirs = await get(other.token);
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual({ error: "Event not found." });
    expect((await get(organiser.token, "not-a-uuid")).status).toBe(404);
    expect((await get(organiser.token, crypto.randomUUID())).status).toBe(404);
  });
});

describe("POST /api/events/{eventId}/holder-messages", () => {
  it("queues one message per address, answers 201 at once, and sends them after the response from Sheltüh with no Reply-To", async () => {
    await holders(FIVE);
    const res = await post(validBody());

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({ messageId: expect.any(String), recipientCount: 5, createdAt: expect.any(String), replayed: false });
    expect(holderMails()).toEqual([]);
    expect((await jobs()).map((j) => j.status)).toEqual(Array(5).fill("pending"));

    await api.runDeferred();

    const mails = holderMails();
    expect(mails.map((m) => m.to).sort()).toEqual(FIVE);
    for (const mail of mails) {
      expect(mail.subject).toBe(`${event.title}: ${SUBJECT}`);
      expect(mail.text).toContain(BODY);
      expect(mail.text).toContain("Static Collective");
      expect(mail.text).toContain("Sheltüh sent this for Static Collective. You’re getting it because you have tickets for");
      expect(mail.text).not.toContain("can’t see your address");
      expect(mail.text).toContain("Report this message: mailto:");
      expect(mail.html).toContain(BODY);
      const stop = /holder-messages\/stop#token=([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
      expect(stop).toBeDefined();
      expect(mail.headers).toEqual({
        "Auto-Submitted": "auto-generated",
        "List-Unsubscribe": `<${SITE_URL}/api/holder-messages/stop?token=${stop}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      });
      expect(Object.keys(mail.headers ?? {}).map((h) => h.toLowerCase())).not.toContain("reply-to");
      // The one recipient only: no other buyer's address in the message.
      for (const other of FIVE.filter((a) => a !== mail.to)) {
        expect(mail.text).not.toContain(other);
        expect(mail.html).not.toContain(other);
      }
    }
    expect((await jobs()).every((j) => j.status === "sent")).toBe(true);
    expect(await recipients()).toEqual(Array(5).fill({ sent: true, skip_reason: null }));

    // The cron has nothing more to send.
    await cron();
    expect(holderMails()).toHaveLength(5);
  });

  it("the organiser's text is escaped in the HTML", async () => {
    await holders(["a@example.com"]);
    const res = await post(validBody({ expectedRecipients: 1, body: "Doors at 7. Bring <b>ID</b> & a friend, \"please\".\nSecond line here." }));
    expect(res.status).toBe(201);
    await api.runDeferred();
    const [mail] = holderMails();
    expect(mail.html).toContain("Bring &#60;b&#62;ID&#60;/b&#62; &#38; a friend, &#34;please&#34;.<br>Second line here.");
    expect(mail.html).not.toContain("<b>ID</b>");
  });

  it("has no artwork in the announcement when the event has none, and attaches nothing inline", async () => {
    await holders(["a@example.com"]);
    expect((await post(validBody({ expectedRecipients: 1 }))).status).toBe(201);
    await api.runDeferred();
    const [mail] = holderMails();
    expect(mail.html).not.toContain("Event image for");
    expect(mail.html).toContain("/brand/sheltuh-wordmark-email.png");
    expect(mail.inlineImages ?? []).toEqual([]);
  });

  it("shows the event's artwork in the announcement when it has some", async () => {
    await holders(["a@example.com"]);
    await api.db.query(`insert into public.event_images (event_id, content_type, data) values ($1, 'image/png', '\\x89504e47'::bytea)`, [event.eventId]);
    expect((await post(validBody({ expectedRecipients: 1 }))).status).toBe(201);
    await api.runDeferred();
    const [mail] = holderMails();
    expect(mail.html).toMatch(new RegExp(`<img src="${SITE_URL}/api/events/${event.eventId}/image\\?v=\\d+" width="552" alt="Event image for `));
    expect(mail.inlineImages ?? []).toEqual([]);
  });

  it("a repeat of the same requestId is the same message: 200 replayed, no second send", async () => {
    await holders(FIVE);
    const body = validBody();
    const first = await post(body);
    const again = await post(body);
    const third = await post({ ...body, subject: "A different subject entirely" });

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ...first.body, replayed: true });
    expect(third.body.messageId).toBe(first.body.messageId);
    await api.runDeferred();
    expect(holderMails()).toHaveLength(5);
    expect(await jobs()).toHaveLength(5);
    // A replay costs no allowance.
    expect((await get(organiser.token)).body.remaining).toEqual({
      eventToday: LIMITS.perEventPerDay - 1,
      eventTotal: LIMITS.perEventTotal - 1,
      organiserToday: LIMITS.perOrganiserPerDay - 1,
    });
  });

  it("a double click (parallel posts of one requestId) sends once", async () => {
    await holders(FIVE);
    const body = validBody();
    const results = await Promise.all([post(body), post(body), post(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    await api.runDeferred();
    expect(holderMails()).toHaveLength(5);
  });

  describe("validation (400 with fieldErrors)", () => {
    it.each([
      ["a missing requestId", { requestId: undefined }, "requestId"],
      ["a requestId that isn't a uuid", { requestId: "abc" }, "requestId"],
      ["a missing subject", { subject: undefined }, "subject"],
      ["a subject under 5 characters", { subject: "Hi!!" }, "subject"],
      ["a subject over 100 characters", { subject: "x".repeat(101) }, "subject"],
      ["a subject on two lines", { subject: "Doors now\nopen at seven" }, "subject"],
      ["a subject with a link", { subject: "Details at example.com" }, "subject"],
      ["a missing body", { body: undefined }, "body"],
      ["a body under 20 characters", { body: "Doors at 7pm." }, "body"],
      ["a body over 1500 characters", { body: "x".repeat(1501) }, "body"],
      ["a body with a link", { body: "Doors now open at 7pm, details at https://example.com/x for everyone." }, "body"],
      ["a body with a bare domain", { body: "Doors now open at 7pm, details at sheltuh.com.au for everyone." }, "body"],
      ["a body with a .ru domain", { body: "Doors now open at 7pm, details at x.ru for everyone tonight." }, "body"],
      ["a body with a .top domain", { body: "Doors now open at 7pm, details at x.top for everyone tonight." }, "body"],
      ["a body with a .ai domain", { body: "Doors now open at 7pm, details at x.ai for everyone tonight." }, "body"],
      ["a body with a .cc domain", { body: "Doors now open at 7pm, details at x.cc for everyone tonight." }, "body"],
      ["a body with a .click domain", { body: "Doors now open at 7pm, details at x.click for everyone tonight." }, "body"],
      ["a body with a .uk domain", { body: "Doors now open at 7pm, details at x.uk for everyone tonight." }, "body"],
      ["a body with a .nz domain", { body: "Doors now open at 7pm, details at x.nz for everyone tonight." }, "body"],
      ["a body with is.gd", { body: "Doors now open at 7pm, details at is.gd/abc for everyone tonight." }, "body"],
      ["a body with goo.gl", { body: "Doors now open at 7pm, details at goo.gl/abc for everyone tonight." }, "body"],
      ["a body with rb.gy", { body: "Doors now open at 7pm, details at rb.gy/abc for everyone tonight." }, "body"],
      ["a body with lnkd.in", { body: "Doors now open at 7pm, details at lnkd.in/abc for everyone tonight." }, "body"],
      ["a body with a bare IPv4 address", { body: "Doors now open at 7pm, details at 203.0.113.5/login for everyone." }, "body"],
      ["a body with an obfuscated address", { body: "Doors now open at 7pm, write to a [at] b [dot] ru if you are lost." }, "body"],
      ["a body with an (at) address", { body: "Doors now open at 7pm, write to boss(at)example if you are lost." }, "body"],
      ["a subject with an unlisted TLD", { subject: "Details at x.ru now" }, "subject"],
      ["a body with an email address", { body: "Doors now open at 7pm, write to me at boss@example.org if lost." }, "body"],
      ["a body with a right-to-left override", { body: "Doors now open at 7pm ‮so please arrive early." }, "body"],
      ["a body with a zero-width space", { body: "Doors now open at 7pm so​ please arrive early." }, "body"],
      ["a body with a control character", { body: "Doors now open at 7pm\u0007 so please arrive early." }, "body"],
      ["a body that isn't text", { body: 12345678901234567890 }, "body"],
      ["no attest", { attest: undefined }, "attest"],
      ["attest false", { attest: false }, "attest"],
      ["attest as the string true", { attest: "true" }, "attest"],
      ["no expectedRecipients", { expectedRecipients: undefined }, "expectedRecipients"],
      ["expectedRecipients as a string", { expectedRecipients: "5" }, "expectedRecipients"],
      ["expectedRecipients 0", { expectedRecipients: 0 }, "expectedRecipients"],
      ["a fractional expectedRecipients", { expectedRecipients: 2.5 }, "expectedRecipients"],
    ])("%s", async (_name, change, field) => {
      await holders(FIVE);
      const res = await post({ ...validBody(), ...change });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toContain(field);
      expect(await jobs()).toEqual([]);
      expect(await api.db.query(`select 1 from private.holder_messages`)).toEqual([]);
    });

    it("times, prices, levels and abbreviations are not links", async () => {
      await holders(FIVE);
      const res = await post(
        validBody({
          subject: "Doors 7.30pm at St. Kilda",
          body: "Doors 7.30pm, music from 8.00. Level 2.5, tickets A$12.50 e.g. bring ID, i.e. photo ID. Mr. Lee on at 9 p.m. sharp.",
        }),
      );
      expect(res.status).toBe(201);
    });

    it("an @handle is fine; all the fields' errors come back together", async () => {
      await holders(FIVE);
      const fine = await post(validBody({ body: "Follow @staticcollective for the latest on tonight's doors and set times." }));
      expect(fine.status).toBe(201);
      const res = await post({ requestId: "x", subject: "", body: "", attest: false, expectedRecipients: -1 });
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["attest", "body", "expectedRecipients", "requestId", "subject"]);
    });

    it("cleans line endings and trailing spaces, and counts characters, not bytes", async () => {
      await holders(FIVE);
      const body = "Doors now open at 7pm.  \r\n\r\n\r\n\r\nPlease bring ID. \u{1F389}\u{1F389}\u{1F389}";
      const res = await post(validBody({ body }));
      expect(res.status).toBe(201);
      const [row] = await api.db.query<{ body: string }>(`select body from private.holder_messages`);
      expect(row.body).toBe("Doors now open at 7pm.\n\nPlease bring ID. \u{1F389}\u{1F389}\u{1F389}");
    });
  });

  describe("who can send", () => {
    it("401 without a token, 403 for a member, a pending or a suspended organiser", async () => {
      await holders(FIVE);
      expect((await post(validBody(), null)).status).toBe(401);
      const member = await api.signUp();
      expect((await post(validBody(), member.token)).status).toBe(403);
      const pending = await api.signUp();
      await api.call(applyAsOrganiser, { token: pending.token, body: application });
      expect((await post(validBody(), pending.token)).status).toBe(403);
      expect(
        (await api.call(adminSuspendOrganiser, { token: admin.token, params: { organiserId: organiser.organiserId }, method: "POST", body: { reason: "Testing." } })).status,
      ).toBe(200);
      expect((await post(validBody())).status).toBe(403);
      expect(await jobs()).toEqual([]);
    });

    it("404 for another organiser's event, a malformed id and an unknown event (nothing is sent)", async () => {
      await holders(FIVE);
      const other = await approvedOrganiser(api, admin, { displayName: "Other Collective", contactEmail: "other@example.com" });
      const res = await post(validBody(), other.token);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Event not found.");
      expect((await post(validBody(), organiser.token, "nope")).status).toBe(404);
      expect((await post(validBody(), organiser.token, crypto.randomUUID())).status).toBe(404);
      expect(await jobs()).toEqual([]);
      // Their own request id for my event isn't a replay either.
      const first = await post(validBody({ requestId: "11111111-1111-4111-8111-111111111111" }));
      expect(first.status).toBe(201);
      const probe = await post(validBody({ requestId: "11111111-1111-4111-8111-111111111111" }), other.token);
      expect(probe.status).toBe(404);
    });
  });

  describe("when a message can be sent (409)", () => {
    it("not for an unpublished event", async () => {
      await holders(FIVE);
      await api.db.query(`update public.events set status = 'draft'`);
      const res = await post(validBody());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("not_published");
    });

    it("not for an event sold on another site", async () => {
      const external = await selfPublishedEvent(api, organiser, {
        ticketingMode: "external",
        externalTicketUrl: "https://events.humanitix.com/neon-static",
        ticketTypes: [],
      });
      const res = await post(validBody(), organiser.token, external.eventId);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("external");
    });

    it("not when nobody holds a ticket", async () => {
      await insertOrder(api, event, "pending@example.com", "pending");
      const res = await post(validBody({ expectedRecipients: 1 }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("no_recipients");
    });

    it("until 2 days after the event ends, at any time before that, started or not", async () => {
      await holders(FIVE);
      const move = (ends: string) =>
        api.db.query(`update public.events set ends_at = now() - $1::interval, starts_at = now() - $1::interval - interval '3 hours'`, [ends]);
      await move("1 day 23 hours");
      expect((await post(validBody())).status).toBe(201);
      await move("2 days 1 minute");
      const late = await post(validBody());
      expect(late.status).toBe(409);
      expect(late.body.code).toBe("outside_window");
      // Not yet started (a day later: the first send used the day's allowance).
      await nextDay();
      await api.db.query(`update public.events set starts_at = now() + interval '30 days', ends_at = now() + interval '30 days 3 hours'`);
      expect((await post(validBody())).status).toBe(201);
    });

    it("not when the audience isn't the number the organiser confirmed, and it says what it is now", async () => {
      await holders(FIVE);
      await holders(["f@example.com"]);
      const res = await post(validBody({ expectedRecipients: 5 }));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "audience_changed", audienceCount: 6 });
      expect(await jobs()).toEqual([]);
      expect((await post(validBody({ expectedRecipients: 6 }))).status).toBe(201);
    });

    it("not when more than 1000 people hold tickets", async () => {
      await holders(["a@example.com"]);
      await api.db.query(
        `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items, subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status, created_at)
         select 'ord_bulk' || g, $1, $2, 'Bulk', 'bulk' || g || '@example.com', '[]'::jsonb, 0, 0, 0, 0, 'paid', now() - interval '1 day'
           from generate_series(1, 1000) g`,
        [event.eventId, organiser.organiserId],
      );
      const res = await post(validBody({ expectedRecipients: 1001 }));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "too_many", audienceCount: 1001 });
      const state = await get(organiser.token);
      expect(state.body).toMatchObject({ canSend: false, blockedReason: "too_many", audienceCount: 1001 });
    });
  });

  describe("allowances (429)", () => {
    it("an event can send its day's messages in 24 hours and its total in all", async () => {
      await holders(FIVE);
      let sent = 0;
      while (sent < LIMITS.perEventTotal) {
        // A day's worth, then the day cap stops the next one.
        for (let i = 0; i < LIMITS.perEventPerDay && sent < LIMITS.perEventTotal; i++) {
          expect((await post(validBody())).status).toBe(201);
          sent++;
        }
        if (sent < LIMITS.perEventTotal) {
          const over = await post(validBody());
          expect(over.status).toBe(429);
          expect(over.body.code).toBe("event_day_cap");
          // The last 24 hours, rolling: free again within a day.
          expect(over.headers.get("retry-after")).toBe("86400");
          await nextDay();
        }
      }
      // The total is what stops it now, the same day and on a fresh day.
      expect(sent).toBe(LIMITS.perEventTotal);
      expect((await post(validBody())).body.code).toBe("event_total_cap");
      await nextDay();
      const beyond = await post(validBody());
      expect(beyond.status).toBe(429);
      expect(beyond.body.code).toBe("event_total_cap");
      // A lifetime cap: no wait lifts it, so no Retry-After (not even the default).
      expect(beyond.headers.get("retry-after")).toBeNull();
      expect(beyond.body).toStrictEqual({ error: "This event has used all of its messages.", code: "event_total_cap" });
      expect((await get(organiser.token)).body).toMatchObject({
        canSend: false,
        blockedReason: "event_total_cap",
        remaining: { eventTotal: 0 },
      });
      expect(await api.db.query(`select 1 from private.holder_messages`)).toHaveLength(LIMITS.perEventTotal);
    });

    it("an organiser can send their day's messages across events, and an event's own day cap still applies", async () => {
      // The first event uses its own day cap; other events take the rest of the account's allowance.
      expect(LIMITS.perOrganiserPerDay).toBeGreaterThan(LIMITS.perEventPerDay);
      await holders(FIVE);
      for (let i = 0; i < LIMITS.perEventPerDay; i++) expect((await post(validBody())).status).toBe(201);
      for (let i = 0; i < LIMITS.perOrganiserPerDay - LIMITS.perEventPerDay; i++) {
        const next = await publish(organiser, { title: `Night ${i + 2}` });
        await holders(FIVE, next);
        expect((await post(validBody(), organiser.token, next.eventId)).status).toBe(201);
      }

      // The first event is over its own day cap: that answer comes first.
      const again = await post(validBody(), organiser.token, event.eventId);
      expect(again.status).toBe(429);
      expect(again.body.code).toBe("event_day_cap");

      // A new event is under its own cap, but the account is out of messages for the day.
      const extra = await publish(organiser, { title: "One Night Too Many" });
      await holders(FIVE, extra);
      const over = await post(validBody(), organiser.token, extra.eventId);
      expect(over.status).toBe(429);
      expect(over.body.code).toBe("rate_limited");
      expect(over.headers.get("retry-after")).toBe("86400"); // the account's 24-hour window
      expect((await get(organiser.token, extra.eventId)).body.remaining).toMatchObject({ eventToday: LIMITS.perEventPerDay, organiserToday: 0 });
      expect(await api.db.query(`select 1 from private.holder_messages`)).toHaveLength(LIMITS.perOrganiserPerDay);

      // Another organiser's allowance is their own.
      const other = await approvedOrganiser(api, admin, { displayName: "Other Collective", contactEmail: "other@example.com" });
      const theirs = await publish(other, { title: "Theirs Night" });
      await holders(FIVE, theirs);
      expect((await post(validBody(), other.token, theirs.eventId)).status).toBe(201);

      // A day later the account can send again.
      await nextDay();
      expect((await post(validBody(), organiser.token, extra.eventId)).status).toBe(201);
    });

    it("a refusal costs no allowance", async () => {
      await holders(FIVE);
      expect((await post(validBody({ expectedRecipients: 4 }))).status).toBe(409);
      expect((await post({ ...validBody(), attest: false })).status).toBe(400);
      expect((await get(organiser.token)).body.remaining).toEqual(FULL_ALLOWANCE);

      // Nor does a message refused for the event's day cap use the account's allowance.
      for (let i = 0; i < LIMITS.perEventPerDay; i++) expect((await post(validBody())).status).toBe(201);
      expect((await post(validBody())).status).toBe(429);
      expect((await get(organiser.token)).body.remaining.organiserToday).toBe(
        LIMITS.perOrganiserPerDay - LIMITS.perEventPerDay,
      );
    });

    it("racing sends of different messages for one event: exactly the day's allowance is queued", async () => {
      await holders(FIVE);
      const attempts = LIMITS.perEventPerDay + 4;
      const results = await Promise.all(Array.from({ length: attempts }, () => post(validBody())));
      expect(results.map((r) => r.status).sort()).toEqual([
        ...Array(LIMITS.perEventPerDay).fill(201),
        ...Array(attempts - LIMITS.perEventPerDay).fill(429),
      ]);
      expect(await api.db.query(`select 1 from private.holder_messages`)).toHaveLength(LIMITS.perEventPerDay);
      expect(await jobs()).toHaveLength(5 * LIMITS.perEventPerDay);
      expect(results.filter((r) => r.status === 429).every((r) => r.body.code === "event_day_cap")).toBe(true);
    });

    it("racing sends from one organiser's different events: exactly the account's day allowance is queued", async () => {
      const events = [event];
      for (let i = 1; i < LIMITS.perOrganiserPerDay + 3; i++) events.push(await publish(organiser, { title: `Night ${i + 1}` }));
      for (const e of events) await holders(FIVE, e);
      const results = await Promise.all(events.map((e) => post(validBody(), organiser.token, e.eventId)));
      expect(results.map((r) => r.status).sort()).toEqual([
        ...Array(LIMITS.perOrganiserPerDay).fill(201),
        ...Array(events.length - LIMITS.perOrganiserPerDay).fill(429),
      ]);
      expect(results.filter((r) => r.status === 429).every((r) => r.body.code === "rate_limited")).toBe(true);
      expect(await api.db.query(`select 1 from private.holder_messages`)).toHaveLength(LIMITS.perOrganiserPerDay);
    });
  });
});

describe("sending", () => {
  it("skips, records and does not retry a recipient whose order was refunded after the message was queued", async () => {
    const ids = await holders(FIVE);
    expect((await post(validBody())).status).toBe(201);
    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [ids[0]]);
    await api.runDeferred();

    expect(holderMails()).toHaveLength(4);
    expect(holderMails().map((m) => m.to)).not.toContain("a@example.com");
    const state = (await get(organiser.token)).body.messages[0];
    expect(state).toMatchObject({ recipientCount: 5, sentCount: 4, skippedCount: 1 });
    expect((await recipients()).filter((r) => r.skip_reason).map((r) => r.skip_reason)).toEqual(["the order isn't paid any more"]);
    await cron();
    expect(holderMails()).toHaveLength(4);
  });

  it.each([
    ["the event is unpublished", `update public.events set status = 'draft'`, "the event isn't published any more"],
    ["the organiser is suspended", `update public.organisers set status = 'rejected'`, "the organiser isn't approved any more"],
    ["the address isn't usable", `update public.orders set buyer_email = 'a, b@example.com'`, "the order has no usable email address"],
  ])("nothing is sent when %s after it was queued", async (_name, change, reason) => {
    await holders(["a@example.com"]);
    expect((await post(validBody({ expectedRecipients: 1 }))).status).toBe(201);
    await api.db.query(change);
    await api.runDeferred();
    await cron();
    expect(holderMails()).toEqual([]);
    expect(await jobs()).toEqual([{ status: "failed", attempts: 1, last_error: reason }]);
    expect(await recipients()).toEqual([{ sent: false, skip_reason: reason }]);
  });

  it("retries a failed send with the same message, and logs no address or text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await holders(["a@example.com"]);
    api.sendEmail.mockRejectedValueOnce(new Error("550 rejected a@example.com"));
    await post(validBody({ expectedRecipients: 1 }));
    await api.runDeferred();
    expect(await jobs()).toEqual([{ status: "pending", attempts: 1, last_error: expect.not.stringContaining("a@example.com") }]);
    await api.db.query(`update private.email_outbox set next_attempt_at = now()`);
    await cron();
    expect(await jobs()).toEqual([{ status: "sent", attempts: 2, last_error: null }]);
    // Tried twice: the first failed.
    expect(holderMails().map((m) => m.to)).toEqual(["a@example.com", "a@example.com"]);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("a@example.com");
    expect(logged).not.toContain(BODY);
    expect(logged).toContain("Holder message email job");
  });

  it("a recipient already marked sent isn't sent a second copy", async () => {
    await holders(["a@example.com"]);
    await post(validBody({ expectedRecipients: 1 }));
    await api.db.query(`update private.holder_message_recipients set sent_at = now()`);
    await api.runDeferred();
    expect(holderMails()).toEqual([]);
    expect(await jobs()).toEqual([{ status: "sent", attempts: 1, last_error: null }]);
  });

  it("over the platform's daily allowance a job waits an hour without using an attempt", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await holders(["a@example.com"]);
    await post(validBody({ expectedRecipients: 1 }));
    await api.db.query(`select private.take_platform_rate_limit('holder_messages_daily', 600, interval '1 day') from generate_series(1, 601)`);
    await api.runDeferred();
    expect(holderMails()).toEqual([]);
    const [job] = await api.db.query<{ status: string; attempts: number; secs: number }>(
      `select status, attempts, extract(epoch from (next_attempt_at - now()))::float as secs from private.email_outbox`,
    );
    expect(job).toMatchObject({ status: "pending", attempts: 0 });
    expect(job.secs).toBeGreaterThan(3500);
  });

  it("the cron sends what the after-response run didn't", async () => {
    await holders(FIVE);
    await post(validBody());
    await cron();
    expect(holderMails()).toHaveLength(5);
  });
});

describe("admin", () => {
  async function sendOne() {
    await holders(FIVE);
    const res = await post(validBody());
    return res.body.messageId as string;
  }
  /** As the admin by default; `null` for no token. */
  const list = (token: string | null = admin.token, query: Record<string, string> = {}) =>
    api.call(adminListHolderMessages, { token: token ?? undefined, query });
  const detail = (messageId: string, token: string | null = admin.token) =>
    api.call(adminGetHolderMessage, { token: token ?? undefined, params: { messageId } });
  const cancel = (messageId: string, token: string | null = admin.token) =>
    api.call(adminCancelHolderMessage, { token: token ?? undefined, params: { messageId }, method: "POST" });

  it("lists messages newest first without their text, filters by event, and shows one with its text and counts", async () => {
    const messageId = await sendOne();
    await api.runDeferred();
    const second = await publish(organiser, { title: "Second Night" });
    await holders(FIVE, second);
    const secondId = (await post(validBody(), organiser.token, second.eventId)).body.messageId as string;

    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body.items.map((m: { messageId: string }) => m.messageId)).toEqual([secondId, messageId]);
    expect(all.body.items[1]).toEqual({
      messageId,
      eventId: event.eventId,
      eventTitle: event.title,
      organiserName: "Static Collective",
      subject: SUBJECT,
      recipientCount: 5,
      sentCount: 5,
      skippedCount: 0,
      createdAt: expect.any(String),
      cancelled: false,
    });
    expect(JSON.stringify(all.body)).not.toContain(BODY);
    expect(JSON.stringify(all.body)).not.toContain("@");

    const filtered = await list(admin.token, { eventId: event.eventId });
    expect(filtered.body.items.map((m: { messageId: string }) => m.messageId)).toEqual([messageId]);
    expect((await list(admin.token, { eventId: "nope" })).status).toBe(400);
    const paged = await list(admin.token, { limit: "1" });
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.nextCursor).toEqual(expect.any(String));
    expect((await list(admin.token, { limit: "1", cursor: paged.body.nextCursor })).body.items[0].messageId).toBe(messageId);

    const one = await detail(messageId);
    expect(one.status).toBe(200);
    for (const res of [all, one]) expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(one.body).toMatchObject({ messageId, subject: SUBJECT, body: BODY, sentCount: 5 });
    expect(JSON.stringify(one.body)).not.toContain("@");
  });

  it("is for admins only: 401, 403, and 404 for an unknown or malformed id", async () => {
    const messageId = await sendOne();
    expect((await list(null)).status).toBe(401);
    expect((await detail(messageId, null)).status).toBe(401);
    expect((await cancel(messageId, null)).status).toBe(401);
    expect((await list(organiser.token)).status).toBe(403);
    expect((await detail(messageId, organiser.token)).status).toBe(403);
    expect((await cancel(messageId, organiser.token)).status).toBe(403);
    expect((await detail(messageId)).body.cancelled).toBe(false);
    expect((await detail(crypto.randomUUID())).status).toBe(404);
    expect((await detail("nope")).status).toBe(404);
    expect((await cancel(crypto.randomUUID())).status).toBe(404);
    expect((await cancel("nope")).status).toBe(404);
  });

  it("stopping a message sends nothing more: unsent recipients are skipped and recorded; stopping twice is fine", async () => {
    const messageId = await sendOne();
    const res = await cancel(messageId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ messageId, cancelled: true, cancelledAt: expect.any(String), body: BODY });
    expect((await cancel(messageId)).status).toBe(200);

    await api.runDeferred();
    await cron();
    expect(holderMails()).toEqual([]);
    expect((await jobs()).map((j) => j.last_error)).toEqual(Array(5).fill("an admin stopped the message"));
    expect((await detail(messageId)).body).toMatchObject({ sentCount: 0, skippedCount: 5, cancelled: true });
    expect((await get(organiser.token)).body.messages[0]).toMatchObject({ cancelled: true, sentCount: 0, skippedCount: 5 });
    // A stopped message still counts against the event's allowance.
    expect((await get(organiser.token)).body.remaining).toMatchObject({
      eventToday: LIMITS.perEventPerDay - 1,
      eventTotal: LIMITS.perEventTotal - 1,
    });
  });

  it("stopping after some were sent keeps those, and skips the rest", async () => {
    const messageId = await sendOne();
    // Sent so far: just one.
    const drain = await api.db.query<{ id: string }>(`select id::text from private.email_outbox order by id limit 4`);
    await api.db.query(`update private.email_outbox set next_attempt_at = now() + interval '1 hour' where id = any($1::bigint[])`, [
      drain.map((d) => d.id),
    ]);
    await api.runDeferred();
    expect(holderMails()).toHaveLength(1);
    await cancel(messageId);
    await api.db.query(`update private.email_outbox set next_attempt_at = now()`);
    await cron();
    expect(holderMails()).toHaveLength(1);
    expect((await detail(messageId)).body).toMatchObject({ sentCount: 1, skippedCount: 4 });
  });
});

describe("retention and constraints", () => {
  it("a message is deleted 12 months after it was sent, with its recipients and jobs; newer ones stay", async () => {
    await holders(FIVE);
    const old = (await post(validBody())).body.messageId as string;
    await api.runDeferred();
    await api.db.query(`delete from private.rate_limits`);
    await api.db.query(`update private.holder_messages set created_at = now() - interval '13 months' where id = $1`, [old]);
    await post(validBody());

    const [purged] = await api.db.query<{ holder_messages_deleted: number }>(`select * from private.purge_operational_data()`);
    expect(purged.holder_messages_deleted).toBe(1);
    expect((await api.db.query<{ id: string }>(`select id from private.holder_messages`)).map((r) => r.id)).not.toContain(old);
    expect(await api.db.query(`select 1 from private.holder_messages`)).toHaveLength(1);
    expect(await recipients()).toHaveLength(5);
    expect(await jobs()).toHaveLength(5);
  });

  it("the database refuses a message of the wrong length, an outbox job with two keys, and a repeated job for a recipient", async () => {
    await holders(["a@example.com"]);
    await post(validBody({ expectedRecipients: 1 }));
    await expect(api.db.query(`update private.holder_messages set subject = 'Hi'`)).rejects.toThrow();
    await expect(api.db.query(`update private.holder_messages set body = repeat('x', 1501)`)).rejects.toThrow();
    await expect(api.db.query(`update private.holder_messages set subject = E'two\\nlines here'`)).rejects.toThrow();
    const [order] = await api.db.query<{ id: string }>(`select id from public.orders`);
    await expect(
      api.db.query(
        `insert into private.email_outbox (kind, order_id, message_recipient_id)
         select 'holder_message', $1, id from private.holder_message_recipients`,
        [order.id],
      ),
    ).rejects.toThrow();
    await expect(
      api.db.query(`insert into private.email_outbox (kind, message_recipient_id) select 'holder_message', id from private.holder_message_recipients`),
    ).rejects.toThrow();
  });

  it("deleting the event's order deletes its recipient row and job", async () => {
    const [id] = await holders(["a@example.com"]);
    await post(validBody({ expectedRecipients: 1 }));
    await api.db.query(`delete from public.orders where id = $1`, [id]);
    expect(await recipients()).toEqual([]);
    expect(await jobs()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Opting out: "Stop messages from {organiser}"
// ---------------------------------------------------------------------------

describe("stopping an organiser's messages", () => {
  const stop = (token: unknown) => api.call(stopHolderMessages, { body: { token } });
  const stopOpen = (query: Record<string, string>) => api.callRaw(openStopHolderMessages, { query });
  const suppressions = () =>
    api.db.query<{ organiser_id: string; recipient_hash: string }>(
      `select organiser_id, recipient_hash from private.holder_message_suppressions`,
    );

  /** The stop token in the email sent to `to`. */
  function tokenFor(to: string): string {
    const mail = holderMails().find((m) => m.to === to);
    const token = /holder-messages\/stop#token=([A-Za-z0-9_-]{43})/.exec(mail?.text ?? "")?.[1];
    if (!token) throw new Error(`no stop link in the email to ${to}`);
    return token;
  }

  async function sendToFive() {
    await holders(FIVE);
    expect((await post(validBody())).status).toBe(201);
    await api.runDeferred();
  }

  it("every email carries its own random token; only its hash is stored", async () => {
    await sendToFive();
    const tokens = FIVE.map(tokenFor);
    expect(new Set(tokens).size).toBe(5);
    const rows = await api.db.query<{ token_hash: string }>(`select token_hash from private.holder_message_stop_tokens`);
    expect(rows).toHaveLength(5);
    for (const token of tokens) {
      expect(JSON.stringify(rows)).not.toContain(token);
      const [{ n }] = await api.db.query<{ n: number }>(
        `select count(*)::int as n from private.holder_message_stop_tokens where token_hash = encode(sha256($1::bytea), 'hex')`,
        [Buffer.from(token)],
      );
      expect(n).toBe(1);
    }
  });

  it("GET changes nothing: it redirects to the confirm page with the token in the fragment", async () => {
    await sendToFive();
    const token = tokenFor("a@example.com");
    const res = await stopOpen({ token });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${SITE_URL}/holder-messages/stop#token=${token}`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await suppressions()).toEqual([]);
    // A malformed token is never echoed.
    const bad = await stopOpen({ token: "x\r\nSet-Cookie: a=b" });
    expect(bad.headers.get("location")).toBe(`${SITE_URL}/holder-messages/stop`);
    expect((await stopOpen({})).headers.get("location")).toBe(`${SITE_URL}/holder-messages/stop`);
  });

  it("POST suppresses that inbox for that organiser (idempotent), naming the organiser", async () => {
    await sendToFive();
    const token = tokenFor("a@example.com");
    const res = await stop(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({ status: "stopped", organiserName: "Static Collective" });
    expect(await suppressions()).toEqual([{ organiser_id: organiser.organiserId, recipient_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect((await stop(token)).status).toBe(200);
    expect(await suppressions()).toHaveLength(1);
    // The address is never stored in the suppression.
    expect(JSON.stringify(await api.db.query(`select * from private.holder_message_suppressions`))).not.toContain("example.com");
  });

  it("a mail client's one-click POST (token in the query, form body) suppresses too", async () => {
    await sendToFive();
    const token = tokenFor("b@example.com");
    const res = await api.send(
      stopHolderMessages,
      new Request(`${SITE_URL}/api/holder-messages/stop?token=${token}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(res.status).toBe(200);
    expect(await suppressions()).toHaveLength(1);
  });

  it("a malformed, missing or unknown token is refused and suppresses nobody", async () => {
    await sendToFive();
    expect((await stop("short")).status).toBe(400);
    expect((await stop(undefined)).status).toBe(400);
    expect((await stop(12345)).status).toBe(400);
    expect((await stop("A".repeat(43))).status).toBe(404);
    expect(await suppressions()).toEqual([]);
  });

  it("a suppressed inbox leaves the audience count and the next send, for every event of the organiser, and only for that organiser", async () => {
    await sendToFive();
    await stop(tokenFor("a@example.com"));
    api.sendEmail.mockClear();
    // A day later, so the day's allowance doesn't get in the way.
    await nextDay();

    expect((await get(organiser.token)).body.audienceCount).toBe(4);
    // The count they confirmed before the opt-out is stale.
    const stale = await post(validBody());
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "audience_changed", audienceCount: 4 });
    expect((await post(validBody({ expectedRecipients: 4 }))).status).toBe(201);
    await api.runDeferred();
    expect(holderMails().map((m) => m.to).sort()).toEqual(FIVE.slice(1));

    // Another event of the same organiser: still nothing for them.
    const second = await publish(organiser, { title: "Second Night" });
    await holders(["a@example.com", "b@example.com"], second);
    expect((await get(organiser.token, second.eventId)).body.audienceCount).toBe(1);

    // Another organiser can still message them.
    const other = await approvedOrganiser(api, admin, { displayName: "Other Collective", contactEmail: "other@example.com" });
    const theirs = await publish(other, { title: "Theirs Night" });
    await holders(["a@example.com"], theirs);
    const sent = await api.call(sendHolderMessage, {
      token: other.token,
      params: { eventId: theirs.eventId },
      body: validBody({ expectedRecipients: 1 }),
    });
    expect(sent.status).toBe(201);
  });

  it("a message already queued for them is skipped at send time, with the reason recorded", async () => {
    await holders(FIVE);
    expect((await post(validBody())).status).toBe(201);
    // Stopped through an earlier message's link before this one went out.
    const [first] = await api.db.query<{ id: string; recipient_hash: string }>(
      `select r.id, r.recipient_hash from private.holder_message_recipients r
         join public.orders o on o.id = r.order_id where o.buyer_email = 'a@example.com'`,
    );
    await api.db.query(`insert into private.holder_message_suppressions (organiser_id, recipient_hash) values ($1, $2)`, [
      organiser.organiserId,
      first.recipient_hash,
    ]);
    await api.runDeferred();
    expect(holderMails().map((m) => m.to).sort()).toEqual(FIVE.slice(1));
    const rows = await api.db.query<{ skip_reason: string | null; sent: boolean }>(
      `select skip_reason, sent_at is not null as sent from private.holder_message_recipients where id = $1`,
      [first.id],
    );
    expect(rows).toEqual([{ skip_reason: "they asked to stop messages from this organiser", sent: false }]);
  });

  it("stopping marks the inbox's unsent rows from this organiser as skipped", async () => {
    await sendToFive();
    const token = tokenFor("c@example.com");
    // A second message is queued but not yet sent when they stop.
    await nextDay();
    expect((await post(validBody({ requestId: crypto.randomUUID() }))).status).toBe(201);
    await stop(token);
    const skipped = await api.db.query<{ skip_reason: string }>(
      `select skip_reason from private.holder_message_recipients where skip_reason is not null`,
    );
    expect(skipped).toEqual([{ skip_reason: "they asked to stop messages from this organiser" }]);
    api.sendEmail.mockClear();
    await api.runDeferred();
    expect(holderMails().map((m) => m.to)).not.toContain("c@example.com");
    expect(holderMails()).toHaveLength(4);
  });

  it("an earlier copy's link keeps working after a resend", async () => {
    await sendToFive();
    const token = tokenFor("a@example.com");
    await api.db.query(`update private.email_outbox set status = 'pending', sent_at = null, attempts = 0`);
    await api.db.query(`update private.holder_message_recipients set sent_at = null`);
    api.sendEmail.mockClear();
    await cron();
    const again = tokenFor("a@example.com");
    expect(again).not.toBe(token);
    expect((await stop(token)).status).toBe(200);
    expect((await stop(again)).status).toBe(200);
  });

  it("a refunded first order still reaches a holder with another paid order, and none reaches one with no paid order", async () => {
    const [first] = await holders(["a@example.com"]);
    await holders(["A@Example.com"]);
    await api.db.query(`update public.orders set created_at = now() - interval '2 days' where id = $1`, [first]);
    expect((await post(validBody({ expectedRecipients: 1 }))).status).toBe(201);
    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [first]);
    await api.runDeferred();
    expect(holderMails().map((m) => m.to)).toEqual(["A@Example.com"]);

    await api.db.query(`update public.orders set status = 'refunded'`);
    await nextDay();
    // (No audience left to send to.)
    expect((await post(validBody({ expectedRecipients: 1 }))).status).toBe(409);
  });

  it("deleting the message deletes its tokens and keeps the suppression", async () => {
    await sendToFive();
    await stop(tokenFor("a@example.com"));
    await api.db.query(`delete from private.holder_messages`);
    expect(await api.db.query(`select 1 from private.holder_message_stop_tokens`)).toEqual([]);
    expect(await suppressions()).toHaveLength(1);
  });
});
