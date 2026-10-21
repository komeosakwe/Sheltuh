import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAIN_BUDGET_MS,
  drainEmailOutbox,
  EMAIL_RETRY_DELAYS_SECONDS,
  MAX_EMAIL_ATTEMPTS,
  retryDelaySeconds,
} from "@/lib/server/email-outbox";
import { adminListEmailJobs, adminResendEmailJob, runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import { orderReference } from "@/lib/server/order-reference";
import { CRON_SECRET, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let eventId: string;

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

function paidWebhook(orderId: string, email = "fan@example.com") {
  return stripeWebhookRequest({
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${session}`,
        object: "checkout.session",
        client_reference_id: orderId,
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
    expect(retry.inlineImages!.map((i) => i.cid)).toEqual(first.inlineImages!.map((i) => i.cid));
    for (const [i, image] of retry.inlineImages!.entries()) {
      expect(image.contentType).toBe("image/png");
      expect(retry.html).toContain(`src="cid:${image.cid}"`);
      expect(image.content.equals(first.inlineImages![i].content)).toBe(true);
    }
    const [code] = await api.db.query<{ code: string }>(`select code from public.tickets`);
    expect(retry.html).toContain(`alt="QR code for ticket ${code.code}.`);
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
