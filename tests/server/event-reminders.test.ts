import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { confirmFreeOrder } from "@/lib/server/handlers/free-orders";
import { createCheckout } from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { CRON_SECRET, SITE_URL, TestApi } from "./helpers/api";
import { drainEmailOutbox } from "@/lib/server/email-outbox";
import { ticketPageLink } from "@/lib/server/ticket-email";
import { approvedOrganiser, insertOrder, publishedEvent, selfPublishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// Event reminders: docs/architecture.md, "Event reminders";
// supabase/migrations/20261118000000_event_reminders.sql;
// lib/server/email-outbox.ts (deliverEventReminder);
// lib/server/handlers/email-outbox.ts (queueEventReminders).

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

const cron = () =>
  api.send(
    runEmailOutboxCron,
    new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
  );

/** An instant, from a wall-clock time in a zone ("2027-03-06 20:00" in "Australia/Perth"), as the database reads it. */
async function at(local: string, timeZone: string): Promise<string> {
  const [row] = await api.db.query<{ t: string }>(`select (($1::text)::timestamp at time zone $2)::text as t`, [local, timeZone]);
  return row.t;
}

async function plusHour(instant: string): Promise<string> {
  const [row] = await api.db.query<{ t: string }>(`select ($1::text::timestamptz + interval '1 hour')::text as t`, [instant]);
  return row.t;
}

/** Runs the queueing as the cron route would at `now` (default: the real time). */
async function queue(now?: string, fromHour = 0): Promise<number> {
  const [row] = await api.db.query<{ n: number }>(
    `select private.queue_event_reminders(100, coalesce($1::text::timestamptz, now()), $2) as n`,
    [now ?? null, fromHour],
  );
  return row.n;
}

const reminders = () =>
  api.db.query<{ event_id: string; order_id: string }>(`select event_id, order_id from private.event_reminders order by queued_at, id`);

const jobs = () =>
  api.db.query<{ id: string; status: string; attempts: number; last_error: string | null; secs: number }>(
    `select id::text, status, attempts, last_error, extract(epoch from (next_attempt_at - now()))::float as secs
       from private.email_outbox where kind = 'event_reminder' order by id`,
  );

/** A published event with paid orders (one per address), all older than a day; its times and zone are then set. */
async function eventWith(
  buyers: string[],
  when: { start: string; end: string; zone?: string; state?: string },
  overrides: Record<string, unknown> = {},
): Promise<{ event: EventRecord; orderIds: string[] }> {
  const event = await publish(overrides);
  const orderIds: string[] = [];
  for (const [i, email] of buyers.entries()) {
    const orderId = await insertOrder(api, event, email, "paid");
    orderIds.push(orderId);
    // Oldest first, in the order given.
    await api.db.query(`update public.orders set created_at = now() - interval '1 day' + make_interval(secs => $2) where id = $1`, [orderId, i]);
  }
  await setTimes(event.eventId, when);
  return { event, orderIds };
}

async function setTimes(eventId: string, when: { start: string; end: string; zone?: string; state?: string }) {
  await api.db.query(
    `update public.events set state = $5, time_zone = $4, starts_at = $2::text::timestamptz, ends_at = $3::text::timestamptz where id = $1`,
    [eventId, when.start, when.end, when.zone ?? "Australia/Melbourne", when.state ?? "VIC"],
  );
}

/** An event `hours` from now, lasting 3 hours. */
async function soon(buyers: string[], hours: number, overrides: Record<string, unknown> = {}) {
  const [row] = await api.db.query<{ s: string; e: string }>(
    `select (now() + make_interval(hours => $1::integer))::text as s, (now() + make_interval(hours => $1::integer + 3))::text as e`,
    [hours],
  );
  return eventWith(buyers, { start: row.s, end: row.e }, overrides);
}

/** The reminders sent so far (the setup's review and ticket emails aren't counted). */
function reminderMails() {
  return api.sendEmail.mock.calls.map(([m]) => m).filter((m) => /^(Today|Tomorrow): /.test(m.subject));
}

function sentTo(email: string) {
  return reminderMails().filter((m) => m.to === email);
}

/** Publishes an event, then drops the admin review emails its submission queued (so a cron run sends reminders only). */
async function publish(overrides: Record<string, unknown> = {}) {
  const event = await publishedEvent(api, organiser, admin, overrides);
  await api.db.query(`delete from private.email_outbox where kind <> 'event_reminder'`);
  return event;
}

describe("who is reminded, and when (by the event's own zone)", () => {
  // [zone, state, event starts (local), now (local), reminded?]
  const cases: [string, string, string, string, string, boolean][] = [
    ["Melbourne: tomorrow, from local midnight", "Australia/Melbourne", "VIC", "2027-03-06 20:00", "2027-03-05 00:00", true],
    ["Melbourne: the day after tomorrow, a minute before midnight", "Australia/Melbourne", "VIC", "2027-03-06 20:00", "2027-03-04 23:59", false],
    ["Melbourne: today, more than 3 hours away", "Australia/Melbourne", "VIC", "2027-03-06 08:00", "2027-03-06 04:30", true],
    ["Melbourne: today, less than 3 hours away", "Australia/Melbourne", "VIC", "2027-03-06 08:00", "2027-03-06 05:30", false],
    ["Melbourne: tomorrow's last minute", "Australia/Melbourne", "VIC", "2027-03-07 23:59", "2027-03-06 12:00", true],
    ["Melbourne: local midnight after tomorrow", "Australia/Melbourne", "VIC", "2027-03-08 00:00", "2027-03-06 12:00", false],
    // Daylight saving ends Sunday 4 April 2027 at 3 am: a 25-hour day.
    ["April changeover: Sunday evening, from Saturday midnight", "Australia/Melbourne", "VIC", "2027-04-04 20:00", "2027-04-03 00:00", true],
    ["April changeover: Sunday evening, Friday 11:59 pm", "Australia/Melbourne", "VIC", "2027-04-04 20:00", "2027-04-02 23:59", false],
    ["April changeover: Sunday's last minute, from Saturday midnight (49 hours on)", "Australia/Melbourne", "VIC", "2027-04-04 23:59", "2027-04-03 00:00", true],
    ["April changeover: Monday midnight is not tomorrow", "Australia/Melbourne", "VIC", "2027-04-05 00:00", "2027-04-03 00:00", false],
    // Daylight saving starts Sunday 3 October 2027 at 2 am: a 23-hour day.
    ["October changeover: Sunday evening, from Saturday midnight", "Australia/Melbourne", "VIC", "2027-10-03 20:00", "2027-10-02 00:00", true],
    ["October changeover: Sunday's last minute, from Saturday midnight", "Australia/Melbourne", "VIC", "2027-10-03 23:59", "2027-10-02 00:00", true],
    ["October changeover: Monday midnight is not tomorrow", "Australia/Melbourne", "VIC", "2027-10-04 00:00", "2027-10-02 00:00", false],
    // Perth is UTC+8 all year: 23:30 on Thursday there is already Friday in Melbourne.
    ["Perth: tomorrow, from local midnight", "Australia/Perth", "WA", "2027-03-06 07:00", "2027-03-05 00:30", true],
    ["Perth: Thursday 11:30 pm is not yet Friday there, though it is in Melbourne", "Australia/Perth", "WA", "2027-03-06 07:00", "2027-03-04 23:30", false],
    // Lord Howe is UTC+11 in summer, +10:30 in winter, and moves by 30 minutes.
    ["Lord Howe: tomorrow, from local midnight", "Australia/Lord_Howe", "NSW", "2027-03-06 09:00", "2027-03-05 00:10", true],
    ["Lord Howe: ten to midnight the day before that", "Australia/Lord_Howe", "NSW", "2027-03-06 09:00", "2027-03-04 23:50", false],
    ["Lord Howe, April changeover: Sunday evening, from Saturday midnight", "Australia/Lord_Howe", "NSW", "2027-04-04 20:00", "2027-04-03 00:00", true],
    ["Lord Howe, April changeover: Friday 11:59 pm", "Australia/Lord_Howe", "NSW", "2027-04-04 20:00", "2027-04-02 23:59", false],
  ];

  it.each(cases)("%s", async (_name, zone, state, start, now, reminded) => {
    const startsAt = await at(start, zone);
    await eventWith(["fan@example.com"], { start: startsAt, end: await plusHour(startsAt), zone, state });

    expect(await queue(await at(now, zone))).toBe(reminded ? 1 : 0);
    expect((await reminders()).length).toBe(reminded ? 1 : 0);
    expect((await jobs()).length).toBe(reminded ? 1 : 0);
  });

  it("p_from_hour holds tomorrow's events until the event's local clock reaches it, never today's", async () => {
    await eventWith(["tomorrow@example.com"], {
      start: await at("2027-03-06 20:00", "Australia/Perth"),
      end: await at("2027-03-06 23:00", "Australia/Perth"),
      zone: "Australia/Perth",
      state: "WA",
    });
    const sixAm = await at("2027-03-05 06:00", "Australia/Perth");
    const eightAm = await at("2027-03-05 08:00", "Australia/Perth");
    expect(await queue(sixAm, 8)).toBe(0);
    expect(await queue(eightAm, 8)).toBe(1);

    await reset();
    organiser = await approvedOrganiser(api, (admin = await signUpAdmin(api)));
    await eventWith(["today@example.com"], {
      start: await at("2027-03-06 20:00", "Australia/Perth"),
      end: await at("2027-03-06 23:00", "Australia/Perth"),
      zone: "Australia/Perth",
      state: "WA",
    });
    // The morning of the event, before the hour: today's events don't wait.
    expect(await queue(await at("2027-03-06 06:00", "Australia/Perth"), 8)).toBe(1);
  });

  it("rejects an hour outside 0 to 23", async () => {
    await expect(queue(undefined, 24)).rejects.toThrow();
  });
});

describe("which orders and events qualify", () => {
  it("reminds the buyer of a paid order, once per person per event, however many orders or tickets", async () => {
    const { orderIds } = await soon(["a@example.com", "A@Example.com", "b+tag@example.com", "b@example.com", "c@example.com"], 20);

    expect(await queue()).toBe(3);
    expect(await queue()).toBe(0);
    expect((await reminders()).length).toBe(3);
    expect((await jobs()).length).toBe(3);

    await cron();
    expect(reminderMails().map((m) => m.to).sort()).toEqual(["a@example.com", "b+tag@example.com", "c@example.com"]);
    // The inbox's oldest order is the one reminded: its ticket page is the link.
    const [a] = sentTo("a@example.com");
    expect(a.text).toContain(`${SITE_URL}/checkout/success?session_id=${orderIds[0]}`);
    const [b] = sentTo("b+tag@example.com");
    expect(b.text).toContain(`session_id=${orderIds[2]}`);
    await cron();
    expect(reminderMails()).toHaveLength(3);
  });

  it("ignores pending, failed, refunded and oversold orders; a partly refunded paid order is still reminded", async () => {
    const event = await publish();
    for (const status of ["pending", "failed", "refunded", "oversold_refund_required"] as const) {
      await insertOrder(api, event, `${status}@example.com`, status);
    }
    const partly = await insertOrder(api, event, "partly@example.com", "paid");
    await api.db.query(`update public.orders set amount_refunded_cents = 100 where id = $1`, [partly]);
    await api.db.query(`update public.orders set created_at = now() - interval '1 day' where event_id = $1`, [event.eventId]);
    const [row] = await api.db.query<{ s: string; e: string }>(
      `select (now() + interval '20 hours')::text as s, (now() + interval '23 hours')::text as e`,
    );
    await setTimes(event.eventId, { start: row.s, end: row.e });

    expect(await queue()).toBe(1);
    await cron();
    expect(reminderMails().map((m) => m.to)).toEqual(["partly@example.com"]);
  });

  it("includes a free member order and a confirmed guest order, not a guest who never confirmed", async () => {
    const free = await publish({
      ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 }],
    });
    const member = await api.signUp({ email: "member@example.com" });
    const book = (email: string, token?: string) =>
      api.call(createCheckout, {
        token,
        params: { eventId: free.eventId },
        body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: email },
      });
    expect((await book("member@example.com", member.token)).status).toBe(201);
    expect((await book("guest@example.com")).status).toBe(202);
    await api.runDeferred();
    const message = api.sendEmail.mock.calls.map(([m]) => m).find((m) => m.to === "guest@example.com")!;
    const token = message.text.match(/\/checkout\/confirm#token=([A-Za-z0-9_-]+)/)![1];
    expect((await api.call(confirmFreeOrder, { body: { token } })).status).toBe(200);
    expect((await book("unconfirmed@example.com")).status).toBe(202);
    await api.runDeferred();

    await api.db.query(`update public.orders set created_at = now() - interval '1 day' where event_id = $1`, [free.eventId]);
    const [row] = await api.db.query<{ s: string; e: string }>(
      `select (now() + interval '20 hours')::text as s, (now() + interval '23 hours')::text as e`,
    );
    await setTimes(free.eventId, { start: row.s, end: row.e });

    expect(await queue()).toBe(2);
    await cron();
    expect(reminderMails().map((m) => m.to).sort()).toEqual(["guest@example.com", "member@example.com"]);
  });

  it("none for an event that isn't published, an organiser that isn't approved, or one sold on another site", async () => {
    const { event } = await soon(["a@example.com"], 20);
    await api.db.query(`update public.events set status = 'draft' where id = $1`, [event.eventId]);
    expect(await queue()).toBe(0);
    await api.db.query(`update public.events set status = 'published' where id = $1`, [event.eventId]);
    await api.db.query(`update public.organisers set status = 'rejected' where id = $1`, [organiser.organiserId]);
    expect(await queue()).toBe(0);
    await api.db.query(`update public.organisers set status = 'approved' where id = $1`, [organiser.organiserId]);

    const other = await approvedOrganiser(api, admin, { displayName: "Other Collective", contactEmail: "other@example.com" });
    const external = await selfPublishedEvent(api, other, {
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon-static",
      ticketTypes: [],
    });
    const [row] = await api.db.query<{ s: string; e: string }>(
      `select (now() + interval '20 hours')::text as s, (now() + interval '23 hours')::text as e`,
    );
    await setTimes(external.eventId, { start: row.s, end: row.e });
    // An external event can't have orders (orders_sheltuh_only); nothing to find even if it were in the window.
    expect(await queue()).toBe(1);
    expect((await reminders()).map((r) => r.event_id)).toEqual([event.eventId]);
  });

  it("a buyer under 6 hours old waits until their order is 6 hours old; an event under 3 hours away reminds nobody", async () => {
    const { event } = await soon([], 20);
    await insertOrder(api, event, "late@example.com", "paid");
    expect(await queue()).toBe(0);

    await api.db.query(`update public.orders set created_at = now() - interval '5 hours 59 minutes' where event_id = $1`, [event.eventId]);
    expect(await queue()).toBe(0);
    await api.db.query(`update public.orders set created_at = now() - interval '6 hours 1 minute' where event_id = $1`, [event.eventId]);
    expect(await queue()).toBe(1);

    // Not reminded in the last 3 hours, however old the order is by then.
    await soon(["near@example.com"], 2);
    expect(await queue()).toBe(0);
    const eight = await soon([], 8);
    await insertOrder(api, eight.event, "tight@example.com", "paid");
    await api.db.query(`update public.orders set created_at = now() - interval '1 hour' where buyer_email = 'tight@example.com'`);
    expect(await queue()).toBe(0);
    const [later] = await api.db.query<{ t: string }>(`select (now() + interval '5 hours 1 minute')::text as t`);
    // 6 hours old by then, but the event is 2 hours 59 minutes away: no reminder.
    expect(await queue(later.t)).toBe(0);
    expect((await reminders()).length).toBe(1);

    // Someone whose order is old enough in a later run is still reminded (the first run doesn't close the window).
    await insertOrder(api, event, "next@example.com", "paid");
    await api.db.query(`update public.orders set created_at = now() - interval '1 day' where buyer_email = 'next@example.com'`);
    expect(await queue()).toBe(1);
    expect(await queue()).toBe(0);
  });

  it("parallel cron runs queue and send each reminder once", async () => {
    await soon(["a@example.com", "b@example.com", "c@example.com", "d@example.com"], 20);

    await Promise.all([cron(), cron(), cron(), cron(), cron()]);
    await cron();

    expect((await reminders()).length).toBe(4);
    const to = reminderMails().map((m) => m.to).sort();
    expect(to).toEqual(["a@example.com", "b@example.com", "c@example.com", "d@example.com"]);
    expect((await jobs()).every((j) => j.status === "sent")).toBe(true);
  });

  it("direct parallel queueing calls queue a reminder once (a held advisory lock leaves the work to the first)", async () => {
    await soon(["a@example.com", "b@example.com"], 20);
    const counts = await Promise.all([queue(), queue(), queue(), queue(), queue()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    expect((await reminders()).length).toBe(2);
    expect((await jobs()).length).toBe(2);
  });

  it("a release that leases every kind (without naming one) never takes a reminder or a holder message", async () => {
    const { event } = await soon(["a@example.com"], 20);
    expect(await queue()).toBe(1);
    await api.db.query(
      `insert into private.holder_messages (event_id, organiser_id, request_id, subject, body, recipient_count, attested_at)
       values ($1, $2, gen_random_uuid(), 'Doors at seven', 'Doors are at seven tonight, see you there.', 1, now())`,
      [event.eventId, organiser.organiserId],
    );
    await api.db.query(
      `insert into private.holder_message_recipients (message_id, order_id, recipient_hash)
       select m.id, o.id, private.email_recipient_hash(o.buyer_email) from private.holder_messages m, public.orders o`,
    );
    await api.db.query(`insert into private.email_outbox (kind, message_recipient_id) select 'holder_message', id from private.holder_message_recipients`);

    const unnamed = await api.db.query(`select * from private.lease_outbox_jobs(10, interval '2 minutes', 6, null, null)`);
    expect(unnamed).toEqual([]);
    const named = await api.db.query<{ job_kind: string }>(
      `select * from private.lease_outbox_jobs(10, interval '2 minutes', 6, null, 'event_reminder')`,
    );
    expect(named.map((j) => j.job_kind)).toEqual(["event_reminder"]);
  });

  describe("the drain's budget", () => {
    /** Ticket-email jobs for the `n` newest orders: queued after the reminders, so only the phase order puts them first. */
    const queueTicketEmails = (n: number) =>
      api.db.query(
        `insert into private.email_outbox (kind, order_id)
         select 'ticket_email', o.id from public.orders o order by o.created_at desc limit $1`,
        [n],
      );
    const ticketMails = () => api.sendEmail.mock.calls.map(([m]) => m).filter((m) => m.subject.startsWith("Your tickets"));
    const buyers = (n: number) => Array.from({ length: n }, (_, i) => `fan${i}@example.com`);

    it("sends tickets first, and reminders only within their share, so a burst of reminders never starves a ticket email", async () => {
      await soon(buyers(12), 20);
      expect(await queue()).toBe(12);
      await queueTicketEmails(3);

      const summary = await drainEmailOutbox(api.deps, { maxJobs: 10 });
      expect(ticketMails()).toHaveLength(3);
      // 60% of 10 for reminders, however many are waiting: 6.
      expect(reminderMails()).toHaveLength(6);
      expect(summary.claimed).toBe(9);
      // The rest wait for the next run.
      const next = await drainEmailOutbox(api.deps, { maxJobs: 10 });
      expect(next.claimed).toBe(6);
      expect(reminderMails()).toHaveLength(12);
    });

    it("with the default budget of 100, reminders take at most 60 of a run", async () => {
      await soon(buyers(70), 20);
      expect(await queue()).toBe(70);
      const summary = await drainEmailOutbox(api.deps);
      expect(summary.claimed).toBe(60);
      expect(reminderMails()).toHaveLength(60);
    });

    it("a drain for the reminder kind alone (a named kind) is not cut to the share", async () => {
      await soon(buyers(8), 20);
      expect(await queue()).toBe(8);
      const summary = await drainEmailOutbox(api.deps, { kind: "event_reminder", maxJobs: 10 });
      expect(summary.claimed).toBe(8);
    });

    it("tickets fill the whole budget when there are enough of them, and reminders wait", async () => {
      await soon(buyers(12), 20);
      expect(await queue()).toBe(12);
      await queueTicketEmails(12);
      const summary = await drainEmailOutbox(api.deps, { maxJobs: 10 });
      expect(summary.claimed).toBe(10);
      expect(ticketMails()).toHaveLength(10);
      expect(reminderMails()).toHaveLength(0);
    });
  });

  it("a purge of sent jobs doesn't send a reminder again", async () => {
    await soon(["a@example.com"], 20);
    await cron();
    expect(reminderMails()).toHaveLength(1);
    await api.db.query(`update private.email_outbox set sent_at = now() - interval '100 days' where kind = 'event_reminder'`);
    await api.db.query(`select * from private.purge_operational_data()`);
    expect(await jobs()).toEqual([]);
    expect(await queue()).toBe(0);
    await cron();
    expect(reminderMails()).toHaveLength(1);
  });

  it("the reminder record of an event that ended over a year ago is purged", async () => {
    const { event } = await soon(["a@example.com"], 20);
    expect(await queue()).toBe(1);
    await setTimes(event.eventId, {
      start: (await api.db.query<{ t: string }>(`select (now() - interval '13 months')::text as t`))[0].t,
      end: (await api.db.query<{ t: string }>(`select (now() - interval '13 months' + interval '3 hours')::text as t`))[0].t,
    });
    const [purged] = await api.db.query<{ event_reminders_deleted: number }>(`select * from private.purge_operational_data()`);
    expect(purged.event_reminders_deleted).toBe(1);
    expect(await reminders()).toEqual([]);
    expect(await jobs()).toEqual([]);
  });
});

describe("the reminder email", () => {
  it("is addressed to the buyer, says today or tomorrow in the event's zone, and is an automatic message with no unsubscribe", async () => {
    const { event } = await soon(["fan@example.com"], 20);
    await cron();

    const [message] = sentTo("fan@example.com");
    expect(message.subject).toMatch(/^(Today|Tomorrow): Neon Static$/);
    expect(message.text).toContain(event.venueName);
    expect(message.text).toContain("View your tickets: ");
    expect(message.text).toContain("Hosted by Static Collective");
    expect(message.headers).toEqual({ "Auto-Submitted": "auto-generated" });
    expect(message.html).not.toContain("List-Unsubscribe");
    expect(message.text).not.toMatch(/unsubscribe/i);
    expect(message.inlineImages?.length).toBe(1);
  });

  it("is skipped, not retried, when the order was refunded since it was queued", async () => {
    const { orderIds } = await soon(["fan@example.com"], 20);
    expect(await queue()).toBe(1);
    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [orderIds[0]]);
    await cron();
    await cron();
    expect(reminderMails()).toEqual([]);
    const [job] = await jobs();
    expect(job).toMatchObject({ status: "failed", last_error: "the order isn't paid any more" });
  });

  it("is still sent when the order it was queued for was refunded but the holder has another paid order, to that order's tickets", async () => {
    const { event, orderIds } = await soon(["fan@example.com"], 20);
    // A second paid order by the same person (another spelling of the address), made later.
    const second = await insertOrder(api, event, "FAN@Example.com", "paid");
    await api.db.query(`update public.orders set created_at = now() - interval '12 hours' where id = $1`, [second]);
    expect(await queue()).toBe(1);
    expect(await reminders()).toEqual([{ event_id: event.eventId, order_id: orderIds[0] }]);
    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [orderIds[0]]);

    await cron();
    const [message] = reminderMails();
    expect(message.to).toBe("FAN@Example.com");
    expect(message.text).toContain(`View your tickets: ${ticketPageLink(SITE_URL, second)}`);
    expect(message.text).not.toContain(orderIds[0]);
    expect(await jobs()).toEqual([expect.objectContaining({ status: "sent" })]);
  });

  it("is skipped only when no paid order is left for that person, not when someone else's order remains", async () => {
    const { event, orderIds } = await soon(["fan@example.com", "other@example.com"], 20);
    expect(await queue()).toBe(2);
    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [orderIds[0]]);
    await insertOrder(api, event, "third@example.com", "paid");
    await cron();
    expect(reminderMails().map((m) => m.to)).toEqual(["other@example.com"]);
    const states = await jobs();
    expect(states.map((j) => j.status).sort()).toEqual(["failed", "sent"]);
    expect(states.find((j) => j.status === "failed")?.last_error).toBe("the order isn't paid any more");
  });

  it.each([
    ["the event was unpublished", `update public.events set status = 'draft'`, "the event isn't published any more"],
    ["the event has started", `update public.events set starts_at = now() - interval '1 minute'`, "the event has started"],
    ["the event moved a week out", `update public.events set starts_at = now() + interval '7 days', ends_at = now() + interval '7 days 3 hours'`, "the event is further off now"],
    ["the organiser was suspended", `update public.organisers set status = 'rejected'`, "the organiser isn't approved any more"],
    ["the order has no usable address", `update public.orders set buyer_email = 'not an address'`, "the order has no usable email address"],
  ])("is skipped, not retried, when %s after it was queued", async (_name, change, reason) => {
    await soon(["fan@example.com"], 20);
    expect(await queue()).toBe(1);
    await api.db.query(change);
    await cron();
    await cron();
    expect(reminderMails()).toEqual([]);
    const [job] = await jobs();
    expect(job).toMatchObject({ status: "failed", last_error: reason });
  });

  it("moved to the day after tomorrow (still inside the lead window): waits, never says Tomorrow, uses no attempt", async () => {
    await soon(["fan@example.com"], 20);
    expect(await queue()).toBe(1);
    // 00:30 the day after tomorrow in Melbourne: 24.5 to 48.5 hours away whatever the time now, so inside the
    // 50-hour lead window, but two calendar days off.
    await api.db.query(
      `update public.events
          set starts_at = (((now() at time zone 'Australia/Melbourne')::date + 2) + time '00:30') at time zone 'Australia/Melbourne',
              ends_at = (((now() at time zone 'Australia/Melbourne')::date + 2) + time '03:30') at time zone 'Australia/Melbourne',
              time_zone = 'Australia/Melbourne', state = 'VIC'`,
    );
    vi.spyOn(console, "info").mockImplementation(() => {});
    await cron();
    expect(reminderMails()).toEqual([]);
    const [job] = await jobs();
    expect(job).toMatchObject({ status: "pending", attempts: 0, last_error: "the event isn't tomorrow yet" });
    expect(job.secs).toBeGreaterThan(6 * 3600 - 100);
    expect(job.secs).toBeLessThanOrEqual(6 * 3600);
  });

  it("retries a failed send, and keeps the platform's daily allowance for sent reminders only", async () => {
    await soon(["fan@example.com"], 20);
    api.sendEmail.mockRejectedValueOnce(new Error("smtp down for fan@example.com"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await cron();
    const [failed] = await jobs();
    expect(failed.status).toBe("pending");
    expect(failed.attempts).toBe(1);
    expect(failed.last_error).not.toContain("fan@example.com");
    const [bucket] = await api.db.query<{ hits: number }>(
      `select hits from private.platform_rate_limits where bucket = 'event_reminders_daily'`,
    );
    expect(bucket.hits).toBe(1);
  });

  it("over the platform's daily allowance a job waits an hour without using an attempt", async () => {
    await soon(["fan@example.com"], 20);
    vi.spyOn(console, "info").mockImplementation(() => {});
    await api.db.query(`select private.take_platform_rate_limit('event_reminders_daily', 800, interval '1 day') from generate_series(1, 801)`);

    await cron();

    expect(reminderMails()).toEqual([]);
    const [job] = await jobs();
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(job.secs).toBeGreaterThan(3500);
    expect(job.secs).toBeLessThanOrEqual(3600);
  });

  it("a cron run before the migration is applied still sends the rest (undefined_function is tolerated)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = api.db;
    const old = new TestApi({
      query: async (text, params) => {
        if (/select private\.queue_event_reminders/.test(text)) {
          throw Object.assign(new Error("function does not exist"), { code: "42883" });
        }
        if (/to_regprocedure\('private\.queue_event_reminders/.test(text)) return [{ missing: true }] as never;
        return real.query(text, params);
      },
    });
    const res = await old.send(
      runEmailOutboxCron,
      new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("queue_event_reminders is missing"));
  });

  it("another queueing failure is logged by SQLSTATE only and the run goes on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = api.db;
    const broken = new TestApi({
      query: async (text, params) => {
        if (/select private\.queue_event_reminders/.test(text)) {
          throw Object.assign(new Error("deadlock detected for fan@example.com"), { code: "40P01" });
        }
        return real.query(text, params);
      },
    });
    const res = await broken.send(
      runEmailOutboxCron,
      new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith("Email outbox: queueing event reminders failed (SQLSTATE 40P01); sending what is due.");
  });
});
