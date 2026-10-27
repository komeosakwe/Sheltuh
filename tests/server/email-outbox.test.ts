import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAIN_BUDGET_MS,
  drainEmailOutbox,
  EMAIL_RETRY_DELAYS_SECONDS,
  MAX_EMAIL_ATTEMPTS,
  retryDelaySeconds,
} from "@/lib/server/email-outbox";
import { refundTermsLine } from "@/lib/refund-policy";
import type { Db } from "@/lib/server/db";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import {
  adminEmailOutboxHealth,
  adminListEmailJobs,
  adminResendEmailJob,
  EMAIL_OVERDUE_AFTER_MINUTES,
  runEmailOutboxCron,
} from "@/lib/server/handlers/email-outbox";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import { orderReference } from "@/lib/server/order-reference";
import { EVENT_UNLISTED_TEXT } from "@/lib/server/ticket-email";
import { CRON_SECRET, sessionAmount, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let eventId: string;
let eventStartsAt: string;

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
  const event = await publishedEvent(api, organiser, admin, {
    ticketTypes: [{ id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  });
  eventId = event.eventId;
  eventStartsAt = event.startsAt;
  await enablePayouts(api, organiser.organiserId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

let session = 0;

/** A real paid order (checkout + signed webhook). Deferred work is left queued unless `runDeferred`. */
async function paidOrder(email = "fan@example.com", { runDeferred = false } = {}) {
  session += 1;
  await api.call(createCheckout, { params: { eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
  const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
  await api.send(stripeWebhook, paidWebhook(orderId, email));
  if (runDeferred) await api.runDeferred();
  return orderId;
}

async function paidWebhook(orderId: string, email = "fan@example.com") {
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${session}`,
        object: "checkout.session",
        client_reference_id: orderId,
        ...(await sessionAmount(api.db, orderId)),
        payment_status: "paid",
        payment_intent: `pi_${session}`,
        customer_details: { email },
      },
    },
  });
}

interface JobRow {
  id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  due_in: number;
  sent: boolean;
}

async function jobs(orderId?: string): Promise<JobRow[]> {
  return api.db.query<JobRow>(
    `select id::text as id, status, attempts, last_error,
            extract(epoch from next_attempt_at - now())::float8 as due_in, sent_at is not null as sent
       from private.email_outbox ${orderId ? "where order_id = $1" : ""} order by id`,
    orderId ? [orderId] : [],
  );
}

/** Makes every pending job due now (time travel for the retry schedule). */
async function makeDue() {
  await api.db.query(`update private.email_outbox set next_attempt_at = now() - interval '1 second' where status = 'pending'`);
}

/** A ticket email for an event that's no longer published: the no-longer-listed line, and none of its details. */
function expectUnlisted(email: { text: string; html: string }) {
  expect(email.text).toContain(EVENT_UNLISTED_TEXT);
  for (const body of [email.text, email.html]) {
    for (const detail of ["The Tote", "71 Johnston St", "8:00 pm", "March 2027"]) expect(body).not.toContain(detail);
  }
}

function cron(authorization?: string) {
  return api.send(
    runEmailOutboxCron,
    new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: authorization ? { authorization } : {} }),
  );
}

describe("retry schedule", () => {
  it("waits 1 min, 5 min, 30 min, 2 h, 6 h, then gives up after the 6th attempt", () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelaySeconds(n, () => 0.5))).toEqual([60, 300, 1800, 7200, 21600]);
    expect(retryDelaySeconds(6, () => 0.5)).toBeNull();
    expect(retryDelaySeconds(0, () => 0.5)).toBeNull();
    expect(MAX_EMAIL_ATTEMPTS).toBe(6);
  });

  it("jitters each delay by up to 20% either way", () => {
    expect(retryDelaySeconds(1, () => 0)).toBe(48);
    expect(retryDelaySeconds(1, () => 0.999999)).toBe(72);
    expect(retryDelaySeconds(5, () => 0)).toBe(17280);
  });

  it("with a runner every 5 minutes, retries land within minutes, and the last attempt within 11 hours", () => {
    const RUNNER_INTERVAL = 300;
    // Worst case: the longest jitter, and each due job then waits a whole interval for the next run.
    const attemptAt: number[] = [];
    let t = 0;
    for (let failed = 1; failed < MAX_EMAIL_ATTEMPTS; failed++) {
      t += retryDelaySeconds(failed, () => 0.999999)! + RUNNER_INTERVAL;
      attemptAt.push(t);
    }
    expect(attemptAt).toHaveLength(5); // the 2nd to the 6th attempt
    expect(attemptAt[0]).toBeLessThanOrEqual(6.5 * 60);
    expect(attemptAt[1]).toBeLessThanOrEqual(18 * 60);
    expect(attemptAt[4]).toBeLessThanOrEqual(11 * 3600);
    // And a burst of failures (an SMTP outage) is never retried within 45 seconds.
    expect(retryDelaySeconds(1, () => 0)).toBeGreaterThanOrEqual(45);
  });
});

describe("queueing", () => {
  it("a paid order gets exactly one job, sent straight after the response", async () => {
    const orderId = await paidOrder();
    expect(await jobs(orderId)).toMatchObject([{ status: "pending", attempts: 0, sent: false }]);
    expect(api.sendEmail).not.toHaveBeenCalled();

    await api.runDeferred();
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0].to).toBe("fan@example.com");
    expect(await jobs(orderId)).toMatchObject([{ status: "sent", attempts: 1, sent: true, last_error: null }]);
    const [order] = await api.db.query<{ emailed: boolean }>(
      `select tickets_emailed_at is not null as emailed from public.orders where id = $1`,
      [orderId],
    );
    expect(order.emailed).toBe(true);
  });

  it("the email says the event's refund policy, as stored on the event (docs/architecture.md, Refund policy)", async () => {
    await paidOrder("fan@example.com", { runDeferred: true });
    expect(api.sendEmail.mock.calls[0][0].text).toContain("Refund policy: No refunds for change of mind.");
    await api.db.query(`update public.events set refund_policy = 'days_before', refund_days = 10 where id = $1`, [eventId]);
    await paidOrder("fan@example.com", { runDeferred: true });
    const { text, html } = api.sendEmail.mock.calls[1][0];
    // Dated from the event's start (Sat 6 Mar 2027, 8:00 pm): until 10 days before, then closed.
    const line = refundTermsLine("days_before", 10, eventStartsAt);
    expect(line).toMatch(/^Refunds available until Wed 24 Feb 2027, 8:00 pm \(10 days before the event\)\.$|has closed/);
    expect(text).toContain(`Refund policy: ${line}`);
    expect(html).toContain(line);
  });

  it("a duplicate webhook, before or after the send, never queues or sends a second email", async () => {
    const orderId = await paidOrder();
    await api.send(stripeWebhook, paidWebhook(orderId)); // redelivered before the first send ran
    await api.runDeferred();
    await api.send(stripeWebhook, paidWebhook(orderId)); // and after
    await api.runDeferred();
    await drainEmailOutbox(api.deps);
    expect(await jobs(orderId)).toHaveLength(1);
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("two copies of the webhook at once still make one job and one email", async () => {
    await api.call(createCheckout, { params: { eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
    await Promise.all([api.send(stripeWebhook, paidWebhook(orderId)), api.send(stripeWebhook, paidWebhook(orderId))]);
    await api.runDeferred();
    expect(await jobs(orderId)).toHaveLength(1);
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("the attempt after a payment sends only that order's email, leaving other due jobs to the cron", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValueOnce(new Error("down"));
    const earlier = await paidOrder("earlier@example.com", { runDeferred: true });
    await makeDue();
    await paidOrder("later@example.com", { runDeferred: true });
    expect(api.sendEmail.mock.calls.map(([m]) => m.to)).toEqual(["earlier@example.com", "later@example.com"]);
    expect(await jobs(earlier)).toMatchObject([{ status: "pending", attempts: 1 }]);
  });

  it("orders that aren't paid get no job", async () => {
    await api.call(createCheckout, { params: { eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });
    await api.runDeferred();
    expect(await jobs()).toEqual([]);
  });
});

describe("SMTP failures", () => {
  it("keep the order paid, and retry on the schedule until the 6th attempt fails for good", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValue(new Error("421 Service not available"));
    const orderId = await paidOrder();
    const random = () => 0.5;

    for (let attempt = 1; attempt <= MAX_EMAIL_ATTEMPTS; attempt++) {
      if (attempt > 1) await makeDue();
      const summary = await drainEmailOutbox(api.deps, { random });
      expect(summary.claimed).toBe(1);
      const [job] = await jobs(orderId);
      expect(job.attempts).toBe(attempt);
      expect(job.last_error).toBe("421 Service not available");
      if (attempt < MAX_EMAIL_ATTEMPTS) {
        expect(job.status).toBe("pending");
        expect(job.due_in).toBeGreaterThan(EMAIL_RETRY_DELAYS_SECONDS[attempt - 1] - 5);
        expect(job.due_in).toBeLessThanOrEqual(EMAIL_RETRY_DELAYS_SECONDS[attempt - 1]);
        // Not due yet: another run takes nothing.
        expect((await drainEmailOutbox(api.deps)).claimed).toBe(0);
      } else {
        expect(job.status).toBe("failed");
      }
    }
    await makeDue();
    expect((await drainEmailOutbox(api.deps)).claimed).toBe(0);
    expect(api.sendEmail).toHaveBeenCalledTimes(MAX_EMAIL_ATTEMPTS);

    const [order] = await api.db.query<{ status: string; emailed: boolean }>(
      `select status::text, tickets_emailed_at is not null as emailed from public.orders where id = $1`,
      [orderId],
    );
    expect(order).toEqual({ status: "paid", emailed: false });
  });

  it("a send that recovers on a later attempt is recorded as sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValueOnce(new Error("timeout"));
    const orderId = await paidOrder("fan@example.com", { runDeferred: true });
    expect(await jobs(orderId)).toMatchObject([{ status: "pending", attempts: 1 }]);
    await makeDue();
    expect(await drainEmailOutbox(api.deps)).toEqual({ claimed: 1, sent: 1, retrying: 0, failed: 0 });
    expect(await jobs(orderId)).toMatchObject([{ status: "sent", attempts: 2, last_error: null }]);
  });

  it("a retry rebuilds the email with the ticket's QR image (nothing is stored in the outbox)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValueOnce(new Error("timeout"));
    await paidOrder("fan@example.com", { runDeferred: true });
    await makeDue();
    await drainEmailOutbox(api.deps);
    const [first, retry] = api.sendEmail.mock.calls.map(([m]) => m);
    // The wordmark, then the ticket's QR.
    expect(retry.inlineImages).toHaveLength(2);
    expect(retry.inlineImages!.map((i) => i.cid)).toEqual(["sheltuh-wordmark@sheltuh.com.au", "ticket-qr-1@sheltuh.com.au"]);
    expect(retry.inlineImages!.map((i) => i.cid)).toEqual(first.inlineImages!.map((i) => i.cid));
    for (const [i, image] of retry.inlineImages!.entries()) {
      expect(image.contentType).toBe("image/png");
      expect(retry.html).toContain(`src="cid:${image.cid}"`);
      expect(image.content.equals(first.inlineImages![i].content)).toBe(true);
    }
    const [code] = await api.db.query<{ code: string }>(`select code from public.tickets`);
    expect(retry.html).toContain(`alt="QR code for ticket ${code.code}.`);
  });

  it("a retry after the event is unpublished still sends the tickets, but no date, time or venue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValueOnce(new Error("timeout"));
    const orderId = await paidOrder("fan@example.com", { runDeferred: true });
    expect((await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId }, method: "POST" })).status).toBe(200);
    await makeDue();
    await drainEmailOutbox(api.deps);
    expect(await jobs(orderId)).toMatchObject([{ status: "sent", attempts: 2 }]);
    const [first, retry] = api.sendEmail.mock.calls.map(([m]) => m);
    expect(first.text).toContain("Venue: The Tote");
    expectUnlisted(retry);
    const [code] = await api.db.query<{ code: string }>(`select code from public.tickets where order_id = $1`, [orderId]);
    expect(retry.text).toContain(`Entry code: ${code.code}`);
  });

  it("are logged and stored without the address or the order id", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValue(new Error("550 5.1.1 <Mia.Secret@example.com>: Recipient address rejected"));
    const orderId = await paidOrder("Mia.Secret@example.com", { runDeferred: true });

    const [job] = await jobs(orderId);
    expect(job.last_error).toBe("550 5.1.1 <[address]>: Recipient address rejected");
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain(orderReference(orderId));
    expect(logged).not.toMatch(/Mia\.Secret/i);
    expect(logged).not.toContain(orderId);
  });

  it("an order that can no longer be emailed fails at once, without retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const orderId = await paidOrder();
    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [orderId]);
    await api.runDeferred();
    expect(await jobs(orderId)).toMatchObject([{ status: "failed", attempts: 1, last_error: "the order isn't paid" }]);
    expect(api.sendEmail).not.toHaveBeenCalled();
  });
});

describe("concurrent workers and leases", () => {
  it("concurrent drains send every job exactly once", async () => {
    const orderIds: string[] = [];
    for (let i = 0; i < 6; i++) orderIds.push(await paidOrder(`fan${i}@example.com`));
    const summaries = await Promise.all([1, 2, 3].map(() => drainEmailOutbox(api.deps)));
    expect(summaries.reduce((n, s) => n + s.sent, 0)).toBe(6);
    const recipients = api.sendEmail.mock.calls.map(([m]) => m.to).sort();
    expect(recipients).toEqual(orderIds.map((_, i) => `fan${i}@example.com`).sort());
    expect((await jobs()).every((j) => j.status === "sent")).toBe(true);
  });

  it("a job whose worker died is taken again once its lease expires; the old worker can't overwrite it", async () => {
    const orderId = await paidOrder();
    // A worker leases the job, then dies before finishing.
    const [stale] = await api.db.query<{ job_id: string; job_lease_token: string }>(
      `select job_id::text, job_lease_token from private.claim_email_jobs(1, '2 minutes', 6, null)`,
    );
    expect((await drainEmailOutbox(api.deps)).claimed).toBe(0); // still leased

    await api.db.query(`update private.email_outbox set lease_expires_at = now() - interval '1 second'`);
    expect(await drainEmailOutbox(api.deps)).toEqual({ claimed: 1, sent: 1, retrying: 0, failed: 0 });
    expect(await jobs(orderId)).toMatchObject([{ status: "sent", attempts: 2 }]);

    // The dead worker comes back and reports a failure: ignored.
    const [{ result }] = await api.db.query<{ result: string }>(
      `select private.finish_email_job($1::bigint, $2::uuid, false, 'late', '60 seconds'::interval) as result`,
      [stale.job_id, stale.job_lease_token],
    );
    expect(result).toBe("lease_lost");
    expect(await jobs(orderId)).toMatchObject([{ status: "sent", last_error: null }]);
  });

  it("a lease that expires on the last allowed attempt fails the job instead of trying a 7th time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const orderId = await paidOrder();
    await api.db.query(
      `update private.email_outbox set status = 'sending', attempts = 6, lease_token = gen_random_uuid(),
              lease_expires_at = now() - interval '1 second'`,
    );
    expect((await drainEmailOutbox(api.deps)).claimed).toBe(0);
    expect(await jobs(orderId)).toMatchObject([{ status: "failed", attempts: 6 }]);
    expect(api.sendEmail).not.toHaveBeenCalled();
  });
});

// Needs two sessions at once, which only a real server has (PGlite is one
// connection). Run with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("skip-locked claims (real Postgres only)", () => {
  it("a second worker skips a job another worker is claiming, without waiting for it", async () => {
    const first = await paidOrder("a@example.com");
    const second = await paidOrder("b@example.com");
    const one = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const two = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      await one.unsafe("begin");
      const [a] = await one.unsafe(`select job_order_id from private.claim_email_jobs(1, '2 minutes', 6, null)`);
      const [b] = await two.unsafe(`select job_order_id from private.claim_email_jobs(1, '2 minutes', 6, null)`);
      expect(new Set([a.job_order_id, b.job_order_id])).toEqual(new Set([first, second]));
      const none = await two.unsafe(`select job_order_id from private.claim_email_jobs(1, '2 minutes', 6, null)`);
      expect(none).toHaveLength(0);
      await one.unsafe("commit");
    } finally {
      await one.end();
      await two.end();
    }
  });
});

describe("cron route", () => {
  it("refuses a missing or wrong secret, and everything when CRON_SECRET is unset", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await paidOrder();
    for (const auth of [undefined, "Bearer wrong", `Bearer ${CRON_SECRET}x`, CRON_SECRET, `Basic ${CRON_SECRET}`]) {
      const res = await cron(auth);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    api.cronSecret = undefined;
    expect((await cron("Bearer undefined")).status).toBe(401);
    expect((await cron("Bearer ")).status).toBe(401);
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("sends due jobs and reports counts only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await paidOrder("a@example.com");
    await paidOrder("b@example.com");
    api.sendEmail.mockRejectedValueOnce(new Error("busy"));
    const res = await cron(`Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({ claimed: 2, sent: 1, retrying: 1, failed: 0 });
    // The retry isn't due for a minute.
    expect((await cron(`Bearer ${CRON_SECRET}`)).body).toEqual({ claimed: 0, sent: 0, retrying: 0, failed: 0 });
  });
});

describe("cron route, called every 5 minutes", () => {
  it("with nothing due, answers with zeros in five queries, sends nothing and touches no job", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValueOnce(new Error("down"));
    await paidOrder("fan@example.com", { runDeferred: true }); // a retry, not due for a minute
    const stored = () =>
      api.db.query(
        `select status, attempts, next_attempt_at::text, updated_at::text, lease_token, last_error from private.email_outbox`,
      );
    const before = await stored();
    let queries = 0;
    const counting = new TestApi({
      query: async (text, params) => {
        queries += 1;
        return api.db.query(text, params);
      },
    });
    for (let run = 0; run < 3; run++) {
      queries = 0;
      const res = await counting.send(
        runEmailOutboxCron,
        new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ claimed: 0, sent: 0, retrying: 0, failed: 0 });
      // Four claims (ops alerts, everything else, then the organiser-published and organiser-joined emails)
      // and recording the run.
      expect(queries).toBe(5);
    }
    expect(counting.sendEmail).not.toHaveBeenCalled();
    expect(await stored()).toEqual(before);
  });

  it("three runs at once send every job exactly once", async () => {
    const orderIds: string[] = [];
    for (let i = 0; i < 6; i++) orderIds.push(await paidOrder(`fan${i}@example.com`));
    const results = await Promise.all([1, 2, 3].map(() => cron(`Bearer ${CRON_SECRET}`)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.reduce((n, r) => n + r.body.claimed, 0)).toBe(6);
    expect(results.reduce((n, r) => n + r.body.sent, 0)).toBe(6);
    expect(api.sendEmail.mock.calls.map(([m]) => m.to).sort()).toEqual(orderIds.map((_, i) => `fan${i}@example.com`).sort());
    expect((await jobs()).every((j) => j.status === "sent" && j.attempts === 1)).toBe(true);
  });
});

// Two runs on their own connections, truly at once: only a real server
// (PGlite is one connection). Run with TEST_DATABASE_URL.
describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrent cron runs (real Postgres only)", () => {
  it("two schedulers calling at the same time never send a job twice", async () => {
    const orderIds: string[] = [];
    for (let i = 0; i < 8; i++) orderIds.push(await paidOrder(`fan${i}@example.com`));
    const conns = [1, 2].map(() => postgres(serverUrl as string, { max: 2, onnotice: () => {} }));
    try {
      const runners = conns.map((sql) => {
        const db: Db = { query: async (text, params = []) => (await sql.unsafe(text, params as never[])) as never };
        const runner = new TestApi(db);
        // A slow SMTP server, so the two runs overlap for the whole drain.
        runner.sendEmail.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 40)));
        return runner;
      });
      const results = await Promise.all(
        runners.map((runner) =>
          runner.send(
            runEmailOutboxCron,
            new Request(`${SITE_URL}/api/cron/email-outbox`, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
          ),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      // Both runs took part, and between them sent each job once.
      expect(results.every((r) => r.body.sent > 0)).toBe(true);
      expect(results.reduce((n, r) => n + r.body.sent, 0)).toBe(8);
      const sentTo = runners.flatMap((runner) => runner.sendEmail.mock.calls.map(([m]) => m.to)).sort();
      expect(sentTo).toEqual(orderIds.map((_, i) => `fan${i}@example.com`).sort());
      expect((await jobs()).every((j) => j.status === "sent" && j.attempts === 1)).toBe(true);
    } finally {
      await Promise.all(conns.map((sql) => sql.end()));
    }
  });
});

describe("admin health", () => {
  const health = (token?: string) => api.call(adminEmailOutboxHealth, { token });

  it("only admins can see it", async () => {
    const member = await api.signUp();
    expect((await health()).status).toBe(401);
    expect((await health(member.token)).status).toBe(403);
    expect((await health(organiser.token)).status).toBe(403);
  });

  it("an empty outbox: zeros for every kind, no run recorded yet", async () => {
    const res = await health(admin.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const zeros = { due: 0, overdue: 0, waiting: 0, sending: 0, expiredLeases: 0, failed: 0, failedLast7Days: 0 };
    expect(res.body).toEqual({
      checkedAt: expect.any(String),
      overdueAfterMinutes: 15,
      cronSecretConfigured: true,
      totals: zeros,
      byKind: [
        "ticket_email",
        "waitlist_available",
        "organiser_new_events",
        "event_review",
        "organiser_review",
        "ops_alert",
        "event_published",
        "organiser_joined",
      ].map(
        (kind) => ({ kind, ...zeros }),
      ),
    });
    api.cronSecret = undefined;
    expect((await health(admin.token)).body.cronSecretConfigured).toBe(false);
  });

  it("counts due, overdue, waiting, sending, expired and failed jobs, with the oldest overdue age, and nothing personal", async () => {
    expect(EMAIL_OVERDUE_AFTER_MINUTES).toBe(15);
    const orders: string[] = [];
    for (let i = 0; i < 10; i++) orders.push(await paidOrder(`buyer${i}@example.com`));
    const set = (i: number, sql: string) =>
      api.db.query(`update private.email_outbox set ${sql} where order_id = $1`, [orders[i]]);
    const lease = (expires: string) =>
      `status = 'sending', attempts = 1, lease_token = gen_random_uuid(), lease_expires_at = now() ${expires}`;
    // 0: due just now. 1, 2: due 20 minutes and 2 hours ago (overdue).
    await set(1, `next_attempt_at = now() - interval '20 minutes'`);
    await set(2, `next_attempt_at = now() - interval '2 hours'`);
    // 3: leased by a worker that died 30 minutes ago (overdue); 4: 5 minutes ago (not yet); 5: being sent.
    await set(3, lease(`- interval '30 minutes'`));
    await set(4, lease(`- interval '5 minutes'`));
    await set(5, lease(`+ interval '1 minute'`));
    // 6: a retry in 10 minutes. 7: failed today; 8: failed 30 days ago. 9: sent.
    await set(6, `attempts = 1, next_attempt_at = now() + interval '10 minutes'`);
    await set(7, `status = 'failed', attempts = 6, last_error = '550 <[address]> rejected'`);
    await api.db.query(`alter table private.email_outbox disable trigger email_outbox_set_updated_at`);
    try {
      await set(8, `status = 'failed', attempts = 6, updated_at = now() - interval '30 days'`);
    } finally {
      await api.db.query(`alter table private.email_outbox enable trigger email_outbox_set_updated_at`);
    }
    await set(9, `status = 'sent', attempts = 1, sent_at = now()`);

    const res = await health(admin.token);
    expect(res.status).toBe(200);
    const expected = {
      due: 3,
      overdue: 3,
      oldestOverdueSeconds: expect.any(Number),
      waiting: 1,
      sending: 1,
      expiredLeases: 2,
      failed: 2,
      failedLast7Days: 1,
    };
    expect(res.body.totals).toEqual(expected);
    expect(res.body.byKind[0]).toEqual({ kind: "ticket_email", ...expected });
    expect(res.body.byKind.slice(1).every((k: { overdue: number; failed: number }) => k.overdue === 0 && k.failed === 0)).toBe(true);
    expect(res.body.totals.oldestOverdueSeconds).toBeGreaterThanOrEqual(7200);
    expect(res.body.totals.oldestOverdueSeconds).toBeLessThan(7260);

    // No address, order id, reference or lease token.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("@");
    for (const orderId of orders) {
      expect(raw).not.toContain(orderId);
      expect(raw).not.toContain(orderReference(orderId).replace("#", ""));
    }
    const tokens = await api.db.query<{ t: string }>(
      `select lease_token::text as t from private.email_outbox where lease_token is not null`,
    );
    expect(tokens).toHaveLength(3);
    for (const { t } of tokens) expect(raw).not.toContain(t);
  });

  it("shows when the cron route last finished a run, and its counts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await paidOrder("a@example.com");
    await paidOrder("b@example.com");
    api.sendEmail.mockRejectedValueOnce(new Error("busy"));
    expect((await health(admin.token)).body.lastCronRun).toBeUndefined();
    // A refused call records nothing.
    expect((await cron("Bearer wrong")).status).toBe(401);
    expect((await health(admin.token)).body.lastCronRun).toBeUndefined();

    expect((await cron(`Bearer ${CRON_SECRET}`)).status).toBe(200);
    const first = (await health(admin.token)).body;
    expect(first.lastCronRun).toEqual({ finishedAt: expect.any(String), claimed: 2, sent: 1, retrying: 1, failed: 0 });
    expect(Date.parse(first.lastCronRun.finishedAt)).toBeLessThanOrEqual(Date.parse(first.checkedAt));
    expect(first.totals).toMatchObject({ due: 0, waiting: 1, failed: 0 });

    // An empty run is recorded too: it shows the runner is alive.
    expect((await cron(`Bearer ${CRON_SECRET}`)).status).toBe(200);
    const second = (await health(admin.token)).body;
    expect(second.lastCronRun).toEqual({ finishedAt: expect.any(String), claimed: 0, sent: 0, retrying: 0, failed: 0 });
    expect(Date.parse(second.lastCronRun.finishedAt)).toBeGreaterThanOrEqual(Date.parse(first.lastCronRun.finishedAt));
    const rows = await api.db.query(`select name from private.cron_runs`);
    expect(rows).toEqual([{ name: "email_outbox" }]);
  });
});

describe("admin", () => {
  async function failedJob(email = "mia@example.com") {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValueOnce(new Error("down"));
    const orderId = await paidOrder(email, { runDeferred: true });
    await api.db.query(`update private.email_outbox set status = 'failed' where order_id = $1`, [orderId]);
    const [job] = await jobs(orderId);
    return { orderId, jobId: job.id };
  }

  const list = (token?: string, query?: Record<string, string>) => api.call(adminListEmailJobs, { token, query });
  const resend = (jobId: string, token?: string) =>
    api.call(adminResendEmailJob, { token, params: { jobId }, method: "POST" });

  it("only admins can list or resend", async () => {
    const { jobId } = await failedJob();
    const member = await api.signUp();
    expect((await list()).status).toBe(401);
    expect((await list(member.token)).status).toBe(403);
    expect((await list(organiser.token)).status).toBe(403);
    expect((await resend(jobId)).status).toBe(401);
    expect((await resend(jobId, member.token)).status).toBe(403);
    expect((await list(admin.token, { status: "nope" })).status).toBe(400);
  });

  it("lists jobs by status with the order reference and a masked address, never the order id or full address", async () => {
    const { orderId, jobId } = await failedJob();
    const res = await list(admin.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.items).toEqual([
      {
        jobId,
        kind: "ticket_email",
        status: "failed",
        attempts: 1,
        lastError: "down",
        createdAt: expect.any(String),
        orderReference: orderReference(orderId),
        orderStatus: "paid",
        eventTitle: "Neon Static",
        maskedEmail: "m***@example.com",
      },
    ]);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(orderId);
    expect(raw).not.toContain("mia@example.com");
    expect((await list(admin.token, { status: "sent" })).body.items).toEqual([]);
  });

  it("resends now with fresh attempts, at most once per 5 minutes per job", async () => {
    const { jobId } = await failedJob();
    const res = await resend(jobId, admin.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toMatchObject({ jobId, status: "pending", attempts: 0 });
    expect(JSON.stringify(res.body)).not.toContain("mia@example.com");

    await api.runDeferred();
    expect(await jobs()).toMatchObject([{ status: "sent", attempts: 1 }]);

    const again = await resend(jobId, admin.token);
    expect(again.status).toBe(429);
    await api.db.query(`update private.email_outbox set last_resend_at = now() - interval '6 minutes'`);
    expect((await resend(jobId, admin.token)).status).toBe(200);
  });

  it("a resend after the event is unpublished rebuilds the email without its date, time or venue", async () => {
    const { jobId } = await failedJob();
    expect((await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId }, method: "POST" })).status).toBe(200);
    expect((await resend(jobId, admin.token)).status).toBe(200);
    await api.runDeferred();
    expect(await jobs()).toMatchObject([{ status: "sent" }]);
    expectUnlisted(api.sendEmail.mock.calls.at(-1)![0]);
  });

  it("refuses a job that's being sent, and unknown or malformed ids", async () => {
    const { jobId } = await failedJob();
    await api.db.query(
      `update private.email_outbox set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '1 minute'`,
    );
    expect((await resend(jobId, admin.token)).status).toBe(409);
    for (const id of ["999999", "abc", "0", "-1", "1e3", "99999999999999999999"]) {
      expect((await resend(id, admin.token)).status).toBe(404);
    }
  });

  it("rate-limits each admin to 20 resends an hour", async () => {
    const { jobId } = await failedJob();
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'email_resends', now(), 20)`,
      [admin.userId],
    );
    expect((await resend(jobId, admin.token)).status).toBe(429);
    expect(await jobs()).toMatchObject([{ status: "failed" }]);
  });

  it("only resends that are queued use the allowance: unknown, in-progress and too-soon ones don't", async () => {
    const { jobId } = await failedJob();
    const hits = async () =>
      (await api.db.query<{ hits: number }>(
        `select hits from private.rate_limits where user_id = $1 and bucket = 'email_resends'`,
        [admin.userId],
      ))[0]?.hits;
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'email_resends', now(), 19)`,
      [admin.userId],
    );
    expect((await resend("999999", admin.token)).status).toBe(404);
    await api.db.query(
      `update private.email_outbox set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '1 minute'`,
    );
    expect((await resend(jobId, admin.token)).status).toBe(409);
    await api.db.query(
      `update private.email_outbox set status = 'failed', lease_token = null, lease_expires_at = null, last_resend_at = now()`,
    );
    expect((await resend(jobId, admin.token)).status).toBe(429);
    expect(await hits()).toBe(19);

    // The 20th real resend still goes through; the 21st is refused and changes nothing.
    await api.db.query(`update private.email_outbox set last_resend_at = now() - interval '6 minutes'`);
    expect((await resend(jobId, admin.token)).status).toBe(200);
    expect(await hits()).toBe(20);
    await api.runDeferred();
    await api.db.query(`update private.email_outbox set status = 'failed', last_resend_at = now() - interval '6 minutes'`);
    const over = await resend(jobId, admin.token);
    expect(over.status).toBe(429);
    expect(over.body.error).toMatch(/a lot of resends/);
    expect(await jobs()).toMatchObject([{ status: "failed" }]);
  });

  it("an admin over the allowance still gets 404 for an unknown job", async () => {
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'email_resends', now(), 21)`,
      [admin.userId],
    );
    expect((await resend("999999", admin.token)).status).toBe(404);
  });
});

describe("drain budget", () => {
  it("stops claiming after 30 seconds, so the last send fits in the cron route's 60", async () => {
    expect(DRAIN_BUDGET_MS).toBe(30_000);
    await paidOrder("a@example.com");
    await paidOrder("b@example.com");
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    // Each send takes 20 s: after the first, 20 s have passed (claim the next), after the second 40 s (stop).
    api.sendEmail.mockImplementation(async () => {
      now += 20_000;
    });
    await paidOrder("c@example.com");
    expect(await drainEmailOutbox(api.deps)).toEqual({ claimed: 2, sent: 2, retrying: 0, failed: 0 });
    expect(await drainEmailOutbox(api.deps)).toMatchObject({ claimed: 1 });
  });
});

describe("code deployed before 20261107000000_admin_review_emails.sql is applied", () => {
  it("falls back to claim_email_outbox: ticket emails still go out, review emails wait for the migration", async () => {
    const draft = await draftEvent(api, organiser);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
    const orderId = await paidOrder();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const jobs = () =>
      api.db.query<{ kind: string; status: string; attempts: number }>(
        `select kind, status, attempts from private.email_outbox where order_id = $1 or event_id = $2 order by kind`,
        [orderId, draft.eventId],
      );

    // As before the migration: no private.lease_outbox_jobs.
    await api.db.query(
      `alter function private.lease_outbox_jobs(integer, interval, integer, text, text) rename to lease_outbox_jobs_hidden`,
    );
    try {
      expect(await drainEmailOutbox(api.deps)).toMatchObject({ claimed: 1, sent: 1 });
    } finally {
      await api.db.query(
        `alter function private.lease_outbox_jobs_hidden(integer, interval, integer, text, text) rename to lease_outbox_jobs`,
      );
    }
    expect(api.sendEmail).toHaveBeenCalledTimes(1);
    expect(api.sendEmail.mock.calls[0][0].to).toBe("fan@example.com");
    expect(await jobs()).toEqual([
      { kind: "event_review", status: "pending", attempts: 0 },
      { kind: "ticket_email", status: "sent", attempts: 1 },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("@");

    // Once it's applied, the next run sends the review email that waited.
    expect(await drainEmailOutbox(api.deps)).toMatchObject({ claimed: 1, sent: 1 });
    expect((await jobs())[0]).toMatchObject({ kind: "event_review", status: "sent" });
  });
});
