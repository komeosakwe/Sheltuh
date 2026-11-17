import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_ACCESS_HEADER } from "@/lib/api/types";
import type { Db } from "@/lib/server/db";
import { maskEmail } from "@/lib/server/email-address";
import { EMAIL_NO_MAIL_MESSAGE, EMAIL_TYPO_MESSAGE } from "@/lib/server/email-domain";
import { checkInTicket, undoCheckIn } from "@/lib/server/handlers/check-ins";
import { adminListEmailJobs } from "@/lib/server/handlers/email-outbox";
import {
  ADMIN_EMAIL_CHANGE_LIMIT,
  adminChangeOrderEmail,
  changeOrderEmail,
  ORDER_EMAIL_CHANGE_LIMITS,
} from "@/lib/server/handlers/order-email";
import { createCheckout, getOrderBySession, stripeWebhook } from "@/lib/server/handlers/orders";
import { orderAccessToken } from "@/lib/server/order-access";
import { orderReference } from "@/lib/server/order-reference";
import { embeddedSession, sessionAmount, stripeWebhookRequest, TestApi, WEBHOOK_SECRET } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";
import { googleWalletEnv } from "./helpers/wallet";
import { googleWalletConfigFromEnv, type GoogleWalletConfig } from "@/lib/server/wallet/config";

// Changing a paid order's email: the paying browser's one change and support's
// (supabase/migrations/20261127000000_order_email_changes.sql, lib/server/handlers/order-email.ts).

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let eventId: string;

const OLD = "fan@gmial-typo.example.net";
const NEW = "Fan.Right@example.com";

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
    ticketTypes: [
      { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 },
      { id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 },
    ],
  });
  eventId = event.eventId;
  await enablePayouts(api, organiser.organiserId);
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    n += 1;
    return embeddedSession(`cs_test_${n}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A paid card order made through the API (checkout, then the signed webhook), its first email sent. */
async function paidOrder(email = OLD, { ip }: { ip?: string } = {}) {
  const res = await api.call(createCheckout, {
    params: { eventId },
    body: { lineItems: [{ ticketTypeId: "ga", quantity: 2 }], buyerEmail: email },
    headers: ip ? { "x-forwarded-for": ip } : undefined,
  });
  expect(res.status).toBe(201);
  const orderId = res.body.orderId as string;
  const paid = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_paid_${orderId}`,
          object: "checkout.session",
          client_reference_id: orderId,
          ...(await sessionAmount(api.db, orderId)),
          payment_status: "paid",
          payment_intent: `pi_${orderId}`,
          customer_details: { email },
        },
      },
    }),
  );
  expect(paid.status).toBe(200);
  await api.runDeferred();
  api.sendEmail.mockClear();
  return { orderId, access: res.body.orderAccess as string };
}

function change(
  orderId: string,
  body: unknown,
  options: { access?: string | null; token?: string; ip?: string } = {},
) {
  return api.call(changeOrderEmail, {
    params: { sessionId: orderId },
    body,
    token: options.token,
    headers: {
      ...(options.access ? { [ORDER_ACCESS_HEADER]: options.access } : {}),
      ...(options.ip ? { "x-forwarded-for": options.ip } : {}),
    },
  });
}

const view = (orderId: string, access?: string) =>
  api.call(getOrderBySession, { params: { sessionId: orderId }, headers: access ? { [ORDER_ACCESS_HEADER]: access } : undefined });

async function orderRow(orderId: string) {
  const [row] = await api.db.query<{ buyer_email: string; tickets_emailed: boolean }>(
    `select buyer_email, tickets_emailed_at is not null as tickets_emailed from public.orders where id = $1`,
    [orderId],
  );
  return row;
}

async function changes(orderId: string) {
  return api.db.query<{ changed_by: string; admin_id: string | null; reason: string | null; old_email_masked: string | null; new_email_masked: string }>(
    `select changed_by, admin_id, reason, old_email_masked, new_email_masked from private.order_email_changes where order_id = $1 order by id`,
    [orderId],
  );
}

async function job(orderId: string) {
  const [row] = await api.db.query<{ id: string; status: string; attempts: number; lease_token: string | null; sent: boolean }>(
    `select id::text as id, status, attempts, lease_token, sent_at is not null as sent
       from private.email_outbox where order_id = $1 and kind = 'ticket_email'`,
    [orderId],
  );
  return row;
}

describe("the buyer's change (POST /orders/by-session/{id}/email)", () => {
  it("changes the address once: logged masked, the ticket email re-queued and sent to the new address only", async () => {
    const { orderId, access } = await paidOrder();
    expect(await job(orderId)).toMatchObject({ status: "sent", sent: true });

    const res = await change(orderId, { email: ` ${NEW} ` }, { access });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.result).toBe("changed");
    expect(res.body.order).toMatchObject({
      status: "paid",
      email: NEW,
      emailChange: { allowed: false, reason: "email_already_changed" },
      maskedEmail: maskEmail(NEW),
    });
    expect(await orderRow(orderId)).toEqual({ buyer_email: NEW, tickets_emailed: false });
    expect(await changes(orderId)).toEqual([
      { changed_by: "buyer", admin_id: null, reason: null, old_email_masked: "f***@gmial-typo.example.net", new_email_masked: "F***@example.com" },
    ]);
    expect(await job(orderId)).toMatchObject({ status: "pending", attempts: 0, lease_token: null, sent: false });

    await api.runDeferred();
    expect(api.sendEmail.mock.calls.map(([message]) => message.to)).toEqual([NEW]);
    expect(await orderRow(orderId)).toEqual({ buyer_email: NEW, tickets_emailed: true });

    // The one change is used up, whatever the address.
    const again = await change(orderId, { email: "third@example.com" }, { access });
    expect([again.status, again.body.code]).toEqual([409, "email_already_changed"]);
    expect(again.body.error).toContain("support@sheltuh.com.au");
    expect(await orderRow(orderId)).toMatchObject({ buyer_email: NEW });
  });

  it("the same address (ignoring case) is unchanged: nothing written, the change still there", async () => {
    const { orderId, access } = await paidOrder();
    const same = await change(orderId, { email: OLD.toUpperCase() }, { access });
    expect([same.status, same.body.result]).toEqual([200, "unchanged"]);
    expect(same.body.order.emailChange).toEqual({ allowed: true });
    expect(await changes(orderId)).toEqual([]);
    expect(await job(orderId)).toMatchObject({ status: "sent" });
    await api.runDeferred();
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect((await change(orderId, { email: NEW }, { access })).body.result).toBe("changed");
  });

  it("404, with the same body, for a malformed or unknown order and a missing or wrong token: nothing written", async () => {
    const { orderId, access } = await paidOrder();
    const other = await paidOrder("other@example.com");
    const unknown = "ord_0123456789abcdef0123456789abcdef";
    const answers = [
      await change("ord_nope", { email: NEW }, { access }),
      await change(unknown, { email: NEW }, { access: orderAccessToken(unknown, WEBHOOK_SECRET) }),
      await change(orderId, { email: NEW }),
      await change(orderId, { email: NEW }, { access: other.access }),
      await change(orderId, { email: NEW }, { access: access.slice(0, 60) }),
    ];
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Order not found." });
    }
    expect(await orderRow(orderId)).toMatchObject({ buyer_email: OLD });
    expect(await changes(orderId)).toEqual([]);
  });

  it("400 for the format, a listed typo and a domain that can't receive email (with the suggestion)", async () => {
    const { orderId, access } = await paidOrder();
    api.mailDomainAnswers.set("nomail.example.net", "no_mail");
    const format = await change(orderId, { email: "fan@" }, { access });
    expect([format.status, format.body.fieldErrors]).toEqual([400, { email: "Enter a valid email address." }]);
    const typo = await change(orderId, { email: "fan@hotmial.com" }, { access });
    expect(typo.body).toEqual({
      error: EMAIL_TYPO_MESSAGE,
      fieldErrors: { email: EMAIL_TYPO_MESSAGE },
      code: "email_typo",
      suggestion: "fan@hotmail.com",
    });
    const noMail = await change(orderId, { email: "fan@nomail.example.net" }, { access });
    expect([noMail.status, noMail.body.code, noMail.body.fieldErrors]).toEqual([400, "email_no_mail", { email: EMAIL_NO_MAIL_MESSAGE }]);
    expect(await changes(orderId)).toEqual([]);
  });

  it("an address with a confirmed account is support's (worded generically), except the signed-in buyer's own", async () => {
    const { orderId, access } = await paidOrder();
    const member = await api.signUp({ email: "Member@Example.com" });
    const refused = await change(orderId, { email: "member@example.com" }, { access });
    expect([refused.status, refused.body.code]).toEqual([409, "email_has_account"]);
    expect(refused.body.error).toBe("Contact support@sheltuh.com.au to use this address.");
    expect(refused.body.error).not.toMatch(/account/i);
    // Signed in as someone else: still refused.
    const stranger = await api.signUp();
    expect((await change(orderId, { email: "member@example.com" }, { access, token: stranger.token })).body.code).toBe("email_has_account");
    // An unconfirmed account's address is anyone's to use.
    await api.signUp({ email: "pending@example.com", emailVerified: false });
    const second = await paidOrder("second-typo@example.com");
    expect((await change(second.orderId, { email: "pending@example.com" }, { access: second.access })).body.result).toBe("changed");
    // The member themselves, signed in: allowed.
    const own = await change(orderId, { email: "member@example.com" }, { access, token: member.token });
    expect([own.status, own.body.result]).toEqual([200, "changed"]);
    expect(await orderRow(orderId)).toMatchObject({ buyer_email: "member@example.com" });
  });

  it("refused once the event has ended, a ticket was scanned (even if undone) or the order was refunded", async () => {
    const ended = await paidOrder("ended@example.com");
    await api.db.query(`update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = $1`, [eventId]);
    const afterwards = await view(ended.orderId, ended.access);
    expect(afterwards.body.emailChange).toEqual({ allowed: false, reason: "event_ended" });
    // Once the event is over the paying browser sees what anyone sees: the masked address, never the full one.
    expect(afterwards.body).not.toHaveProperty("email");
    expect(afterwards.body.maskedEmail).toBe(maskEmail("ended@example.com"));
    expect((await change(ended.orderId, { email: NEW }, { access: ended.access })).body.code).toBe("event_ended");
    await api.db.query(`update public.events set starts_at = now() + interval '7 days', ends_at = now() + interval '7 days 3 hours' where id = $1`, [eventId]);

    const scanned = await paidOrder("scanned@example.com");
    const [{ code }] = await api.db.query<{ code: string }>(`select code from public.tickets where order_id = $1 order by code limit 1`, [scanned.orderId]);
    const scan = await api.call(checkInTicket, { token: organiser.token, params: { eventId }, body: { code, requestId: crypto.randomUUID() } });
    expect(scan.body.outcome).toBe("admitted");
    const undo = await api.call(undoCheckIn, {
      token: organiser.token,
      params: { eventId, checkInId: scan.body.checkInId },
      body: { reason: "Scanned the wrong person" },
    });
    expect(undo.status).toBe(200);
    expect((await change(scanned.orderId, { email: NEW }, { access: scanned.access })).body.code).toBe("ticket_scanned");

    const refunded = await paidOrder("refunded@example.com");
    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [refunded.orderId]);
    const res = await change(refunded.orderId, { email: NEW }, { access: refunded.access });
    expect([res.status, res.body.code]).toEqual([409, "order_not_paid"]);
    for (const { orderId } of [ended, scanned, refunded]) expect(await changes(orderId)).toEqual([]);
  });

  it("a worker sending the old email loses its lease: its finish records nothing and the new address gets the tickets", async () => {
    const { orderId, access } = await paidOrder();
    // A worker took the job (a resend, say) and is mid-send.
    await api.db.query(`update private.email_outbox set status = 'pending', next_attempt_at = now() where order_id = $1`, [orderId]);
    const [claimed] = await api.db.query<{ job_id: string; job_lease_token: string }>(
      `select job_id::text, job_lease_token from private.claim_email_jobs(1, '2 minutes', 6, $1)`,
      [orderId],
    );
    expect((await change(orderId, { email: NEW }, { access })).body.result).toBe("changed");
    const [finished] = await api.db.query<{ r: string }>(`select private.finish_email_job($1::bigint, $2::uuid, true, null, null) as r`, [
      claimed.job_id,
      claimed.job_lease_token,
    ]);
    expect(finished.r).toBe("lease_lost");
    expect(await orderRow(orderId)).toEqual({ buyer_email: NEW, tickets_emailed: false });
    await api.runDeferred();
    expect(api.sendEmail.mock.calls.map(([message]) => message.to)).toEqual([NEW]);
  });

  it("an order whose sent job was purged (90 days on) gets a new one", async () => {
    const { orderId, access } = await paidOrder();
    await api.db.query(`delete from private.email_outbox where order_id = $1`, [orderId]);
    expect((await change(orderId, { email: NEW }, { access })).body.result).toBe("changed");
    expect(await job(orderId)).toMatchObject({ status: "pending", attempts: 0 });
    await api.runDeferred();
    expect(api.sendEmail.mock.calls.map(([message]) => message.to)).toEqual([NEW]);
  });

  it("per client: 10 an hour, every well-formed request; per order: 5 a day, only with the token", async () => {
    const { orderId, access } = await paidOrder();
    const ip = "203.0.113.20";
    // Without the token: 404s, which use the client's allowance but never the order's.
    for (let i = 0; i < ORDER_EMAIL_CHANGE_LIMITS.perClient.hits; i += 1) {
      expect((await change(orderId, { email: NEW }, { ip })).status).toBe(404);
    }
    const over = await change(orderId, { email: NEW }, { access, ip });
    expect([over.status, over.body.code, over.headers.get("retry-after")]).toEqual([429, "rate_limited", "3600"]);

    // Another connection, with the token: 5 for the order, whatever they are.
    for (let i = 0; i < ORDER_EMAIL_CHANGE_LIMITS.perOrder.hits; i += 1) {
      expect((await change(orderId, { email: "nope" }, { access, ip: "198.51.100.7" })).status).toBe(400);
    }
    const orderOver = await change(orderId, { email: NEW }, { access, ip: "192.0.2.44" });
    expect([orderOver.status, orderOver.body.code, orderOver.headers.get("retry-after")]).toEqual([429, "rate_limited", "86400"]);
    expect(await changes(orderId)).toEqual([]);
  });

  it("a free booking has no token and no change: 404", async () => {
    const res = await api.call(createCheckout, {
      params: { eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" },
    });
    expect(res.status).toBe(202);
    expect(res.body).not.toHaveProperty("orderAccess");
    const [{ id }] = await api.db.query<{ id: string }>(`select id from public.orders where total_cents = 0`);
    expect((await change(id, { email: NEW }, { access: orderAccessToken(id, WEBHOOK_SECRET) })).status).toBe(404);
  });
});

describe("GET /orders/by-session/{id} and the email", () => {
  it("the paying browser sees the full address and whether it may change it; others the masked address, and none once changed", async () => {
    const { orderId, access } = await paidOrder();
    const mine = await view(orderId, access);
    expect(mine.body).toMatchObject({ email: OLD, emailChange: { allowed: true }, maskedEmail: maskEmail(OLD) });
    const theirs = await view(orderId);
    expect(theirs.body.maskedEmail).toBe(maskEmail(OLD));
    expect(theirs.body).not.toHaveProperty("email");
    expect(theirs.body).not.toHaveProperty("emailChange");
    // Someone else's token is no token.
    const other = await paidOrder("other@example.com");
    expect(await view(orderId, other.access)).toMatchObject({ body: { maskedEmail: maskEmail(OLD) } });
    expect((await view(orderId, other.access)).body).not.toHaveProperty("email");

    await change(orderId, { email: NEW }, { access });
    const after = await view(orderId);
    expect(after.status).toBe(200);
    expect(after.body).not.toHaveProperty("maskedEmail");
    expect(after.body).not.toHaveProperty("email");
    expect(JSON.stringify(after.body)).not.toContain("example.com");
    expect((await view(orderId, access)).body).toMatchObject({ email: NEW, maskedEmail: maskEmail(NEW) });
  });
});

describe("the paying browser after the event", () => {
  it("a changed order's token shows neither address once the event has ended, and says event_ended", async () => {
    const { orderId, access } = await paidOrder();
    expect((await change(orderId, { email: NEW }, { access })).status).toBe(200);
    expect((await view(orderId, access)).body).toMatchObject({ email: NEW });
    await api.db.query(`update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = $1`, [eventId]);
    const mine = await view(orderId, access);
    expect(mine.status).toBe(200);
    expect(mine.body.emailChange).toEqual({ allowed: false, reason: "event_ended" });
    expect(mine.body).not.toHaveProperty("email");
    expect(mine.body).not.toHaveProperty("maskedEmail");
    expect(JSON.stringify(mine.body)).not.toContain("example.com");
  });
});

describe("the change's answer is the confirmation page's order", () => {
  it("with the wallet buttons GET gives (withWallet)", async () => {
    api.googleWallet = (googleWalletConfigFromEnv(googleWalletEnv().env) as { config: GoogleWalletConfig }).config;
    const { orderId, access } = await paidOrder();
    const res = await change(orderId, { email: NEW }, { access });
    expect(res.status).toBe(200);
    expect(res.body.order.wallet).toEqual({ google: true, apple: false });
    expect(res.body.order.wallet).toEqual((await view(orderId, access)).body.wallet);
    expect(res.body.order).toEqual((await view(orderId, access)).body);
  });
});

describe("a deploy ahead of its migration", () => {
  it("the confirmation page falls back to the masked email (warned once); other database errors still fail it", async () => {
    const { orderId, access } = await paidOrder();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let failWith = "42P01";
    // The test database as one without the migration: the change log and its functions don't exist.
    const db: Db = {
      query: async (text, params) => {
        if (text.includes("to_regclass('private.order_email_changes')")) return [{ missing: failWith === "42P01" }] as never;
        if (text.includes("order_email_change")) throw Object.assign(new Error("does not exist"), { code: failWith });
        return api.db.query(text, params);
      },
    };
    const before = new TestApi(db);
    for (const headers of [undefined, { [ORDER_ACCESS_HEADER]: access }]) {
      const res = await before.call(getOrderBySession, { params: { sessionId: orderId }, headers });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "paid", maskedEmail: maskEmail(OLD) });
      expect(res.body).not.toHaveProperty("email");
    }
    expect(warn).toHaveBeenCalledTimes(1);
    failWith = "57014"; // a statement timeout: not a missing migration
    expect((await before.call(getOrderBySession, { params: { sessionId: orderId } })).status).toBe(500);
    expect(error).toHaveBeenCalled();
  });
});

describe("the admin's change (POST /admin/emails/{jobId}/change-email)", () => {
  /** As `admin` unless another token (or null: none) is given. */
  const adminChange = (jobId: string, body: unknown, token: string | null = admin.token) =>
    api.call(adminChangeOrderEmail, { params: { jobId }, body, token: token ?? undefined });

  it("401, 403, 404 and 400 before anything is written", async () => {
    const { orderId } = await paidOrder();
    const { id } = await job(orderId);
    const member = await api.signUp();
    expect((await adminChange(id, { email: NEW, reason: "Buyer called" }, null)).status).toBe(401);
    expect((await adminChange(id, { email: NEW, reason: "Buyer called" }, member.token)).status).toBe(403);
    expect((await adminChange("12abc", { email: NEW, reason: "Buyer called" })).status).toBe(404);
    expect((await adminChange("999999", { email: NEW, reason: "Buyer called" })).status).toBe(404);
    const noReason = await adminChange(id, { email: NEW });
    expect([noReason.status, Object.keys(noReason.body.fieldErrors)]).toEqual([400, ["reason"]]);
    expect((await adminChange(id, { email: NEW, reason: "ok" })).body.fieldErrors).toEqual({ reason: "Must be at least 3 characters." });
    // The reason is kept in full; the log keeps addresses masked only.
    // Full-width "＠" and "．" too (NFKC): the reason is tested as it would read.
    for (const reason of [`Buyer asked to move it from ${OLD}`, "Typo: fan.right@example.com was meant", "Meant fan.right＠example．com"]) {
      const withAddress = await adminChange(id, { email: NEW, reason });
      expect([withAddress.status, withAddress.body.fieldErrors]).toEqual([400, { reason: "Leave email addresses out of the reason." }]);
    }
    api.mailDomainAnswers.set("nomail.example.net", "no_mail");
    expect((await adminChange(id, { email: "fan@nomail.example.net", reason: "Buyer called" })).body.code).toBe("email_no_mail");
    // A special-use name can't receive email: refused without a lookup, for support too.
    const lookups = api.mailDomainLookups.length;
    expect((await adminChange(id, { email: "fan@mail.internal", reason: "Buyer called" })).body.code).toBe("email_no_mail");
    expect(api.mailDomainLookups).toHaveLength(lookups);
    expect(await changes(orderId)).toEqual([]);
  });

  it("any time and any address (the typo list skipped, an account's included), logged with the admin and reason", async () => {
    const { orderId, access } = await paidOrder();
    // The buyer used their change, a ticket was scanned and the event has ended: support still can.
    await change(orderId, { email: "first@example.com" }, { access });
    const [{ code }] = await api.db.query<{ code: string }>(`select code from public.tickets where order_id = $1 limit 1`, [orderId]);
    await api.call(checkInTicket, { token: organiser.token, params: { eventId }, body: { code, requestId: crypto.randomUUID() } });
    await api.db.query(`update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = $1`, [eventId]);
    await api.signUp({ email: "member@gmial.com" });
    const { id } = await job(orderId);
    api.sendEmail.mockClear();

    const res = await adminChange(id, { email: "member@gmial.com", reason: "Buyer confirmed by phone" });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("changed");
    expect(res.body.job).toMatchObject({
      jobId: id,
      status: "pending",
      maskedEmail: "m***@gmial.com",
      orderReference: orderReference(orderId),
      emailChanges: [
        { changedBy: "admin", reason: "Buyer confirmed by phone", oldMaskedEmail: "f***@example.com", newMaskedEmail: "m***@gmial.com" },
        { changedBy: "buyer", oldMaskedEmail: "f***@gmial-typo.example.net", newMaskedEmail: "f***@example.com" },
      ],
    });
    expect(res.body.job.emailChanges[1]).not.toHaveProperty("reason");
    expect(JSON.stringify(res.body)).not.toContain("member@gmial.com");
    expect((await changes(orderId)).at(-1)).toMatchObject({ changed_by: "admin", admin_id: admin.userId });
    await api.runDeferred();
    expect(api.sendEmail.mock.calls.map(([message]) => message.to)).toEqual(["member@gmial.com"]);

    const same = await adminChange(id, { email: "MEMBER@gmial.com", reason: "Again" });
    expect([same.status, same.body.result]).toEqual([200, "unchanged"]);
    expect(same.body.job.emailChanges).toHaveLength(2);
  });

  it("ends self-serve: the paying browser can't change it again (409 changed_by_support) and sees no address, full or masked", async () => {
    const SUPPORT_SET = "right.one@example.org";
    for (const buyerFirst of [false, true]) {
      const { orderId, access } = await paidOrder();
      if (buyerFirst) expect((await change(orderId, { email: NEW }, { access })).status).toBe(200);
      const res = await adminChange((await job(orderId)).id, { email: SUPPORT_SET, reason: "Buyer confirmed by phone" });
      expect(res.status).toBe(200);

      const mine = await view(orderId, access);
      expect(mine.status).toBe(200);
      expect(mine.body.emailChange).toEqual({ allowed: false, reason: "changed_by_support" });
      expect(mine.body).not.toHaveProperty("email");
      expect(mine.body).not.toHaveProperty("maskedEmail");
      expect(JSON.stringify(mine.body)).not.toContain("example.org");
      const theirs = await view(orderId);
      expect(theirs.body).not.toHaveProperty("maskedEmail");
      expect(theirs.body).not.toHaveProperty("emailChange");

      const again = await change(orderId, { email: OLD }, { access });
      expect([again.status, again.body.code]).toEqual([409, "changed_by_support"]);
      expect(again.body.error).toBe("Contact support@sheltuh.com.au to change this email again.");
      expect(JSON.stringify(again.body)).not.toContain("example.org");
      expect(await orderRow(orderId)).toMatchObject({ buyer_email: SUPPORT_SET });
      expect((await changes(orderId)).map((c) => c.changed_by)).toEqual(buyerFirst ? ["buyer", "admin"] : ["admin"]);
      // Support still can.
      expect((await adminChange((await job(orderId)).id, { email: OLD, reason: "Buyer asked again" })).status).toBe(200);
      expect(await orderRow(orderId)).toMatchObject({ buyer_email: OLD });
    }
  });

  it("refuses a refunded order and a free booking (409); over 20 an hour, 429 with the change undone", async () => {
    const refunded = await paidOrder("refunded@example.com");
    await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [refunded.orderId]);
    const notPaid = await adminChange((await job(refunded.orderId)).id, { email: NEW, reason: "Buyer asked" });
    expect([notPaid.status, notPaid.body.code]).toEqual([409, "order_not_paid"]);

    const member = await api.signUp({ email: "rsvp@example.com" });
    const free = await api.call(createCheckout, {
      params: { eventId },
      token: member.token,
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "rsvp@example.com" },
    });
    expect(free.status).toBe(201);
    const [{ id: freeId }] = await api.db.query<{ id: string }>(`select id from public.orders where total_cents = 0`);
    const notCard = await adminChange((await job(freeId)).id, { email: NEW, reason: "Buyer asked" });
    expect([notCard.status, notCard.body.code]).toEqual([409, "order_not_card"]);

    const { orderId } = await paidOrder();
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'order_email_changes', now(), $2)`,
      [admin.userId, ADMIN_EMAIL_CHANGE_LIMIT.hits],
    );
    const over = await adminChange((await job(orderId)).id, { email: NEW, reason: "Buyer asked" });
    expect([over.status, over.headers.get("retry-after")]).toEqual([429, "3600"]);
    expect(await orderRow(orderId)).toMatchObject({ buyer_email: OLD });
    expect(await changes(orderId)).toEqual([]);
    expect(await job(orderId)).toMatchObject({ status: "sent" });
  });

  it("GET /admin/emails?reference finds an order's ticket email in any status", async () => {
    const { orderId } = await paidOrder();
    await paidOrder("other@example.com");
    const list = (query: Record<string, string>) => api.call(adminListEmailJobs, { token: admin.token, query });
    for (const reference of [orderReference(orderId), orderReference(orderId).slice(1).toLowerCase()]) {
      const res = await list({ reference, status: "failed" });
      expect(res.status).toBe(200);
      expect(res.body.items.map((j: { orderReference: string }) => j.orderReference)).toEqual([orderReference(orderId)]);
      expect(res.body.items[0].status).toBe("sent");
    }
    expect((await list({ reference: "#XYZ" })).status).toBe(400);
    expect((await list({ reference: "1234567" })).status).toBe(400);
    expect((await list({ reference: "00000000" })).body.items).toEqual([]);
  });
});

describe("private.mask_email", () => {
  it("is maskEmail exactly", async () => {
    for (const email of ["mia@example.com", "M@x.co", "a.b+c@sub.example.com.au", "no-at-sign", "@example.com", "x@y@z.com", "é@example.com"]) {
      const [row] = await api.db.query<{ masked: string }>(`select private.mask_email($1) as masked`, [email]);
      expect(row.masked, email).toBe(maskEmail(email));
    }
    const [none] = await api.db.query<{ masked: string | null }>(`select private.mask_email(null) as masked`);
    expect(none.masked).toBeNull();
  });

  it("the log is append-only", async () => {
    const { orderId, access } = await paidOrder();
    await change(orderId, { email: NEW }, { access });
    await expect(api.db.query(`update private.order_email_changes set new_email_masked = 'x***@evil.example'`)).rejects.toThrow(/append-only/);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("races (real Postgres only)", () => {
  /** A TestApi of its own connection, so two requests really run at once. */
  function connectedApi(sql: postgres.Sql) {
    const db: Db = { query: async (text, params = []) => (await sql.unsafe(text, params as never[])) as never };
    return new TestApi(db);
  }

  it("two changes at once: one 200, one 409 email_already_changed, one log row", async () => {
    const { orderId, access } = await paidOrder();
    const conns = [1, 2].map(() => postgres(serverUrl as string, { max: 1, onnotice: () => {} }));
    try {
      const results = await Promise.all(
        conns.map((sql, i) =>
          connectedApi(sql).call(changeOrderEmail, {
            params: { sessionId: orderId },
            body: { email: `racer${i}@example.com` },
            headers: { [ORDER_ACCESS_HEADER]: access },
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe("email_already_changed");
      expect(await changes(orderId)).toHaveLength(1);
    } finally {
      await Promise.all(conns.map((sql) => sql.end()));
    }
  });

  it("a buyer's change racing support's: the buyer's lands first or is refused (changed_by_support), never after", async () => {
    const { orderId, access } = await paidOrder();
    const { id } = await job(orderId);
    const conns = [1, 2].map(() => postgres(serverUrl as string, { max: 1, onnotice: () => {} }));
    try {
      const adminApi = connectedApi(conns[0]);
      const adminToken = adminApi.tokenFor({ userId: admin.userId, emailVerified: true, isAdmin: true });
      const [byAdmin, byBuyer] = await Promise.all([
        adminApi.call(adminChangeOrderEmail, {
          params: { jobId: id },
          body: { email: "support.set@example.com", reason: "Buyer confirmed by phone" },
          token: adminToken,
        }),
        connectedApi(conns[1]).call(changeOrderEmail, {
          params: { sessionId: orderId },
          body: { email: NEW },
          headers: { [ORDER_ACCESS_HEADER]: access },
        }),
      ]);
      expect(byAdmin.status).toBe(200);
      expect(await orderRow(orderId)).toMatchObject({ buyer_email: "support.set@example.com" });
      if (byBuyer.status === 200) expect((await changes(orderId)).map((c) => c.changed_by)).toEqual(["buyer", "admin"]);
      else expect([byBuyer.status, byBuyer.body.code, (await changes(orderId)).length]).toEqual([409, "changed_by_support", 1]);
    } finally {
      await Promise.all(conns.map((sql) => sql.end()));
    }
  });

  it("a change racing the worker's finish (job, then order) never deadlocks", async () => {
    const { orderId, access } = await paidOrder();
    await api.db.query(`update private.email_outbox set status = 'pending', next_attempt_at = now() where order_id = $1`, [orderId]);
    const [claimed] = await api.db.query<{ job_id: string; job_lease_token: string }>(
      `select job_id::text, job_lease_token from private.claim_email_jobs(1, '2 minutes', 6, $1)`,
      [orderId],
    );
    const worker = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const buyer = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      const [finished, changed] = await Promise.all([
        worker.unsafe(`select private.finish_email_job($1::bigint, $2::uuid, true, null, null) as r`, [claimed.job_id, claimed.job_lease_token]),
        connectedApi(buyer).call(changeOrderEmail, {
          params: { sessionId: orderId },
          body: { email: NEW },
          headers: { [ORDER_ACCESS_HEADER]: access },
        }),
      ]);
      expect(changed.status).toBe(200);
      // Whichever went first: the send was recorded and then re-queued, or its lease was lost.
      expect(["sent", "lease_lost"]).toContain(finished[0].r);
      expect(await job(orderId)).toMatchObject({ status: "pending", attempts: 0 });
    } finally {
      await worker.end();
      await buyer.end();
    }
  });

  it("a change racing a full refund: either the change lands first or it's refused, never both", async () => {
    const { orderId, access } = await paidOrder();
    const refunder = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    const buyer = postgres(serverUrl as string, { max: 1, onnotice: () => {} });
    try {
      const [, changed] = await Promise.all([
        refunder.unsafe(`select result from private.record_payment_refund($1, $2, true, $3, null, 'evt_race')`, [
          `pi_${orderId}`,
          999_999,
          `ch_${orderId}`,
        ]),
        connectedApi(buyer).call(changeOrderEmail, {
          params: { sessionId: orderId },
          body: { email: NEW },
          headers: { [ORDER_ACCESS_HEADER]: access },
        }),
      ]);
      const [row] = await api.db.query<{ status: string; buyer_email: string }>(`select status::text as status, buyer_email from public.orders where id = $1`, [orderId]);
      expect(row.status).toBe("refunded");
      if (changed.status === 200) expect(row.buyer_email).toBe(NEW);
      else expect([changed.status, changed.body.code, row.buyer_email]).toEqual([409, "order_not_paid", OLD]);
    } finally {
      await refunder.end();
      await buyer.end();
    }
  });
});
