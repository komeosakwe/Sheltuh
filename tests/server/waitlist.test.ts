import { createHash } from "node:crypto";
import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApproveEvent, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { adminGetEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { getEventAnalytics } from "@/lib/server/handlers/analytics";
import { adminListEmailJobs, adminResendEmailJob, runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { submitEventForReview, updateEventDraft } from "@/lib/server/handlers/events";
import { listFavourites, putFavourite } from "@/lib/server/handlers/favourites";
import { stripeWebhook } from "@/lib/server/handlers/orders";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { getTrendingEvents } from "@/lib/server/handlers/trending";
import {
  confirmWaitlist,
  getWaitlistStatus,
  joinWaitlist,
  leaveWaitlist,
  leaveWaitlistAsMember,
  WAITLIST_CLOSED,
  WAITLIST_EXTERNAL,
  WAITLIST_LIMITS,
  WAITLIST_NOT_SOLD_OUT,
} from "@/lib/server/handlers/waitlist";
import type { AdminEventRecord, EventRecord } from "@/lib/server/types";
import { CRON_SECRET, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import {
  approvedOrganiser,
  draftEvent,
  eventInput,
  insertOrder,
  publishedEvent,
  signUpAdmin,
} from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

// The waitlist for sold-out events: docs/architecture.md, "Waitlist";
// supabase/migrations/20261024000000_waitlist.sql.

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;

const GA = { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 2 };

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
  event = await publishedEvent(api, organiser, admin, { ticketTypes: [GA] });
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sha256 = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

async function setSold(ticketTypeId: string, sold: number, eventId = event.eventId) {
  await api.db.query(`update public.ticket_types set quantity_sold = $3 where event_id = $1 and id = $2`, [
    eventId,
    ticketTypeId,
    sold,
  ]);
}

async function soldOut(eventId = event.eventId) {
  await api.db.query(`update public.ticket_types set quantity_sold = quantity_available where event_id = $1`, [eventId]);
}

/**
 * Joins, then runs what was deferred until after the response (Deps.defer): a
 * guest's confirmation email is sent there. `joinOnly` doesn't.
 */
async function join(body: Record<string, unknown>, options: { token?: string; eventId?: string } = {}) {
  const res = await joinOnly(body, options);
  await api.runDeferred();
  return res;
}

function joinOnly(body: Record<string, unknown>, options: { token?: string; eventId?: string } = {}) {
  return api.call(joinWaitlist, { token: options.token, params: { eventId: options.eventId ?? event.eventId }, body });
}

function confirm(token: unknown) {
  return api.call(confirmWaitlist, { body: { token } });
}

function leave(token: unknown) {
  return api.call(leaveWaitlist, { body: { token } });
}

function status(token?: string, eventId = event.eventId) {
  return api.call(getWaitlistStatus, { token, params: { eventId } });
}

/** The token in the n-th email's link to `path` (its fragment). */
function tokenFromEmail(path: "/waitlist/confirm" | "/waitlist/leave", n = -1): string {
  const message = api.sendEmail.mock.calls.at(n)![0];
  const match = message.text.match(new RegExp(`${path}#token=([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no ${path} link in the email`);
  return match[1];
}

async function entries(eventId = event.eventId) {
  return api.db.query<{
    email: string;
    user_id: string | null;
    confirmed: boolean;
    left: boolean;
    notify_count: number;
  }>(
    `select email, user_id, confirmed_at is not null as confirmed, unsubscribed_at is not null as left, notify_count
       from private.event_waitlist where event_id = $1 order by created_at, id`,
    [eventId],
  );
}

/** A signed-in member with a verified email, on the event's (sold-out) waitlist. */
async function memberOnList(email?: string, eventId = event.eventId) {
  const user = await api.signUp({ email });
  const res = await join({}, { token: user.token, eventId });
  expect(res.status).toBe(201);
  return user;
}

/** A guest on the list through a confirmed emailed link. */
async function guestOnList(email: string) {
  expect((await join({ email })).status).toBe(202);
  expect((await confirm(tokenFromEmail("/waitlist/confirm"))).status).toBe(200);
}

async function waitlistJobs() {
  return api.db.query<{ email: string; status: string }>(
    `select w.email, j.status from private.email_outbox j join private.event_waitlist w on w.id = j.waitlist_entry_id
      order by j.id`,
  );
}

/** Emails sent to `to` so far. */
const sentTo = (to: string) => api.sendEmail.mock.calls.filter(([m]) => m.to === to).map(([m]) => m);

/** A paid order already fulfilled (its tickets counted in quantity_sold), with a Stripe payment intent. */
async function paidOrder(email: string, quantity: number, paymentIntent: string) {
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
  await api.db.query(
    `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
       subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status, stripe_payment_intent_id)
     values ($1, $2, $3, 'Neon Static', $4, $5::text::jsonb, 3000, 170, 3170, 170, 'paid', $6)`,
    [
      orderId,
      event.eventId,
      event.organiserId,
      email,
      JSON.stringify([{ ticketTypeId: "ga", ticketTypeName: "General admission", unitPriceCents: 3000, feePolicy: "buyer-pays", quantity }]),
      paymentIntent,
    ],
  );
  return orderId;
}

async function refundInFull(paymentIntent: string) {
  const res = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "charge.refunded",
      data: { object: { id: "ch_1", object: "charge", payment_intent: paymentIntent, amount_refunded: 3170, refunded: true } },
    }),
  );
  expect(res.status).toBe(200);
}

// ---------------------------------------------------------------------------

describe("sold-out data in public event payloads", () => {
  const TWO = [
    { id: "early", name: "Early bird", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 50 },
    { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 },
  ];

  async function bySlug(slug: string) {
    return (await api.call(getPublicEventBySlug, { params: { slug } })).body;
  }

  it("says whether each ticket type is sold out, and how many are left only when 10 or fewer", async () => {
    const two = await publishedEvent(api, organiser, admin, { title: "Two tiers", ticketTypes: TWO });
    let body = await bySlug(two.slug);
    expect(body.soldOut).toBe(false);
    expect(body.ticketTypes.map((t: object) => ({ ...t }))).toEqual([
      expect.objectContaining({ id: "early", quantityAvailable: 50, soldOut: false }),
      expect.objectContaining({ id: "ga", quantityAvailable: 50, soldOut: false }),
    ]);
    // 39 left: no count, so the stock (and the sales) aren't revealed.
    await setSold("early", 11, two.eventId);
    body = await bySlug(two.slug);
    expect(body.ticketTypes[0]).not.toHaveProperty("remaining");
    expect(JSON.stringify(body)).not.toMatch(/quantitySold|quantity_sold|"remaining":39/);
    // 10 left: shown. 1 left: shown.
    await setSold("early", 40, two.eventId);
    expect((await bySlug(two.slug)).ticketTypes[0]).toMatchObject({ soldOut: false, remaining: 10 });
    await setSold("early", 49, two.eventId);
    expect((await bySlug(two.slug)).ticketTypes[0]).toMatchObject({ soldOut: false, remaining: 1 });
    // One tier sold out, the other on sale: the event isn't sold out.
    await setSold("early", 50, two.eventId);
    body = await bySlug(two.slug);
    expect(body.ticketTypes[0]).toMatchObject({ soldOut: true, remaining: 0 });
    expect(body.ticketTypes[1]).toMatchObject({ soldOut: false });
    expect(body.ticketTypes[1]).not.toHaveProperty("remaining");
    expect(body.soldOut).toBe(false);
    // Every tier sold out: the event is.
    await setSold("ga", 50, two.eventId);
    body = await bySlug(two.slug);
    expect(body.soldOut).toBe(true);
    expect(body.ticketTypes.map((t: { soldOut: boolean }) => t.soldOut)).toEqual([true, true]);
  });

  it("is the same in the feed, favourites, the organiser's profile and trending", async () => {
    await soldOut();
    const others = [
      await publishedEvent(api, organiser, admin, { title: "Other one" }),
      await publishedEvent(api, (await approvedOrganiser(api, admin)) as { token: string }, admin, { title: "Other two" }),
    ];
    const pick = (items: { eventId: string }[]) => items.find((e) => e.eventId === event.eventId) as Record<string, unknown>;
    const expected = { soldOut: true, ticketTypes: [expect.objectContaining({ id: "ga", soldOut: true, remaining: 0 })] };

    expect(pick((await api.call(listPublicEvents)).body.items)).toMatchObject(expected);

    const fan = await api.signUp();
    await api.call(putFavourite, { token: fan.token, params: { eventId: event.eventId }, method: "PUT" });
    expect(pick((await api.call(listFavourites, { token: fan.token })).body.items)).toMatchObject(expected);

    const profile = (await api.call(getPublicOrganiserProfile, { params: { organiserId: organiser.organiserId } })).body;
    expect(pick(profile.upcomingEvents)).toMatchObject(expected);

    const ranked = [event.eventId, ...others.map((e) => e.eventId)];
    for (const [i, eventId] of ranked.entries()) {
      await api.db.query(
        `insert into private.trending_snapshot (rank, event_id, score, computed_at) values ($1, $2, 1, now())`,
        [i + 1, eventId],
      );
    }
    const trending = (await api.call(getTrendingEvents)).body.items.map((item: { event: { eventId: string } }) => item.event);
    expect(pick(trending)).toMatchObject(expected);
    expect(trending.find((e: { eventId: string }) => e.eventId === others[0].eventId)).toMatchObject({ soldOut: false });
  });

  it("is never sold out for an external event (no ticket types, stock unknown)", async () => {
    const external = await publishedEvent(api, organiser, admin, {
      title: "Elsewhere",
      ticketingMode: "external",
      externalTicketUrl: "https://www.humanitix.com/au/events/elsewhere",
      ticketTypes: [],
    });
    expect(await bySlug(external.slug)).toMatchObject({ soldOut: false, ticketTypes: [] });
  });
});

// ---------------------------------------------------------------------------

describe("joining", () => {
  beforeEach(async () => {
    await soldOut();
  });

  it("a signed-in member with a verified email joins at once with that email, idempotently, with no email sent", async () => {
    const user = await api.signUp({ email: "Mia@Example.com" });
    const first = await join({}, { token: user.token });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ status: "joined", maskedEmail: "M***@Example.com", alreadyJoined: false });
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    // Sending the same address (any case) is the same.
    const again = await join({ email: "mia@example.com" }, { token: user.token });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: "joined", alreadyJoined: true });
    expect(await entries()).toEqual([
      { email: "Mia@Example.com", user_id: user.userId, confirmed: true, left: false, notify_count: 0 },
    ]);
    expect(api.sendEmail).not.toHaveBeenCalled();
    expect((await status(user.token)).body).toEqual({ joined: true, maskedEmail: "M***@Example.com" });
  });

  it("a guest confirms by an emailed link; nothing is on the list until the link's page is confirmed", async () => {
    const res = await join({ email: "fan@example.com" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "confirmation_sent", expiresInHours: WAITLIST_LIMITS.confirmHours });
    expect(await entries()).toEqual([{ email: "fan@example.com", user_id: null, confirmed: false, left: false, notify_count: 0 }]);

    const message = api.sendEmail.mock.calls[0][0];
    expect(message.to).toBe("fan@example.com");
    expect(message.subject).toBe("Confirm the waitlist: Neon Static");
    expect(message.text).toContain(`${SITE_URL}/waitlist/confirm#token=`);
    expect(message.text).toContain("Joining doesn't reserve a ticket or charge you.");
    const token = tokenFromEmail("/waitlist/confirm");
    // Only a hash is stored.
    const [stored] = await api.db.query<{ token_hash: string }>(`select token_hash from private.event_waitlist_tokens`);
    expect(stored.token_hash).toBe(sha256(token));

    const confirmed = await confirm(token);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ status: "joined", eventTitle: "Neon Static", eventSlug: event.slug, ticketsAvailable: false });
    expect((await entries())[0]).toMatchObject({ confirmed: true });
    // Confirming again is harmless.
    expect((await confirm(token)).body).toMatchObject({ status: "joined" });
  });

  it("a member joining with another address, or without a verified email, confirms by link like a guest", async () => {
    const user = await api.signUp({ email: "me@example.com" });
    expect((await join({ email: "friend@example.com" }, { token: user.token })).status).toBe(202);
    const unverified = await api.signUp({ email: "new@example.com", emailVerified: false });
    // Unverified: the address must be sent.
    expect((await join({}, { token: unverified.token })).status).toBe(400);
    expect((await join({ email: "new@example.com" }, { token: unverified.token })).status).toBe(202);
    expect((await entries()).map((e) => [e.email, e.user_id, e.confirmed])).toEqual([
      ["friend@example.com", null, false],
      ["new@example.com", null, false],
    ]);
    expect(api.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("answers a guest the same whether the address is new, on the list, or over its hourly cap", async () => {
    await guestOnList("listed@example.com");
    api.sendEmail.mockClear();
    const onList = await join({ email: "LISTED@example.com" });
    const fresh = await join({ email: "fresh@example.com" });
    expect(onList.status).toBe(202);
    expect(onList.body).toEqual(fresh.body);
    // Already on the list: no email.
    expect(api.sendEmail.mock.calls.map(([m]) => m.to)).toEqual(["fresh@example.com"]);

    // 3 links per address per hour (normalised: +tags and Gmail dots are one person), across events.
    const other = await publishedEvent(api, organiser, admin, { title: "Another", ticketTypes: [GA] });
    await soldOut(other.eventId);
    api.sendEmail.mockClear();
    const answers = [];
    for (const [email, eventId] of [
      ["sam.lee@gmail.com", event.eventId],
      ["samlee+1@gmail.com", event.eventId],
      ["SamLee@googlemail.com", other.eventId],
      ["sam.lee+2@gmail.com", other.eventId],
    ]) {
      const res = await join({ email }, { eventId });
      answers.push([res.status, res.body]);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(api.sendEmail).toHaveBeenCalledTimes(WAITLIST_LIMITS.addressHourly.hits);
  });

  it("refuses with 503 for everyone once the platform's hourly or daily cap is used up, recording nothing", async () => {
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('waitlist_confirmations', now(), $1)`,
      [WAITLIST_LIMITS.platformHourly.hits],
    );
    const res = await join({ email: "any@example.com" });
    expect(res.status).toBe(503);
    expect(await entries()).toEqual([]);
    await api.db.query(`delete from private.platform_rate_limits`);
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('waitlist_confirmations_daily', now(), $1)`,
      [WAITLIST_LIMITS.platformDaily.hits],
    );
    expect((await join({ email: "any@example.com" })).status).toBe(503);
    expect(api.sendEmail).not.toHaveBeenCalled();
    // Members joining with their own verified email send nothing, so they're unaffected.
    expect((await join({}, { token: (await api.signUp()).token })).status).toBe(201);
  });

  it("emails a guest's link only after the response: no SMTP call before it", async () => {
    const res = await joinOnly({ email: "fan@example.com" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "confirmation_sent", expiresInHours: WAITLIST_LIMITS.confirmHours });
    expect(api.sendEmail).not.toHaveBeenCalled();
    await api.runDeferred();
    expect(sentTo("fan@example.com")).toHaveLength(1);
  });

  it("drops the link when the confirmation email can't be sent (the answer was already a 202)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.sendEmail.mockRejectedValueOnce(new Error("SMTP down for fan@example.com"));
    expect((await joinOnly({ email: "fan@example.com" })).status).toBe(202);
    await api.runDeferred();
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from private.event_waitlist_tokens`);
    expect(n).toBe(0);
    // The log line has no address.
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("fan@example.com");
  });

  it("the email's subject carries no control, invisible or text-direction characters from the event title", async () => {
    await api.db.query(`update public.events set title = $2 where id = $1`, [event.eventId, "Neon\u202E citatS\u200B\u2066 Night\u2028Two"]);
    expect((await join({ email: "fan@example.com" })).status).toBe(202);
    const [message] = sentTo("fan@example.com");
    expect(message.subject).toBe("Confirm the waitlist: Neon citatS Night Two");
    expect(message.subject).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  });

  it("validates the address and the event", async () => {
    expect((await join({ email: "not an email" })).status).toBe(400);
    expect((await join({ email: "a@b.com, c@d.com" })).body.fieldErrors).toHaveProperty("email");
    expect((await join({})).status).toBe(400);
    expect((await join({ email: "x@example.com" }, { eventId: "not-a-uuid" })).status).toBe(404);
    expect((await join({ email: "x@example.com" }, { eventId: crypto.randomUUID() })).status).toBe(404);
  });

  it("refuses an event that isn't sold out, is ticketed elsewhere, isn't published or has ended", async () => {
    const onSale = await publishedEvent(api, organiser, admin, { title: "On sale", ticketTypes: [GA] });
    const external = await publishedEvent(api, organiser, admin, {
      title: "Elsewhere",
      ticketingMode: "external",
      externalTicketUrl: "https://www.humanitix.com/au/events/elsewhere",
      ticketTypes: [],
    });
    const draft = await draftEvent(api, organiser, { title: "Draft" });
    await soldOut(draft.eventId);
    const ended = await publishedEvent(api, organiser, admin, { title: "Ended", ticketTypes: [GA] });
    await soldOut(ended.eventId);
    await api.db.query(
      `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = $1`,
      [ended.eventId],
    );
    const member = await api.signUp();
    for (const token of [undefined, member.token]) {
      const body = token ? {} : { email: "x@example.com" };
      expect((await join(body, { token, eventId: onSale.eventId })).body).toMatchObject({ error: WAITLIST_NOT_SOLD_OUT });
      expect((await join(body, { token, eventId: onSale.eventId })).status).toBe(409);
      expect((await join(body, { token, eventId: external.eventId })).body).toMatchObject({ error: WAITLIST_EXTERNAL });
      expect((await join(body, { token, eventId: draft.eventId })).status).toBe(404);
      const closed = await join(body, { token, eventId: ended.eventId });
      expect([closed.status, closed.body.error]).toEqual([409, WAITLIST_CLOSED]);
    }
    expect(api.sendEmail).not.toHaveBeenCalled();
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from private.event_waitlist`);
    expect(n).toBe(0);
  });
});

describe("confirming", () => {
  beforeEach(async () => {
    await soldOut();
  });

  it("refuses malformed, unknown, expired and used links, and a closed waitlist", async () => {
    expect((await confirm("short")).status).toBe(400);
    expect((await confirm(undefined)).status).toBe(400);
    expect((await confirm("A".repeat(43))).status).toBe(404);

    await join({ email: "late@example.com" });
    const late = tokenFromEmail("/waitlist/confirm");
    await api.db.query(`update private.event_waitlist_tokens set expires_at = now() - interval '1 second'`);
    expect((await confirm(late)).status).toBe(410);

    // Confirmed, then left (signed in): the link can't put them back.
    const user = await api.signUp({ email: "used@example.com" });
    await join({ email: "used@example.com" });
    const used = tokenFromEmail("/waitlist/confirm");
    expect((await confirm(used)).status).toBe(200);
    expect((await api.call(leaveWaitlistAsMember, { token: user.token, params: { eventId: event.eventId }, method: "DELETE" })).status).toBe(204);
    expect((await confirm(used)).status).toBe(410);

    // The event ended (or was unpublished) before the link was confirmed.
    await join({ email: "closed@example.com" });
    const closed = tokenFromEmail("/waitlist/confirm");
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });
    const res = await confirm(closed);
    expect([res.status, res.body.error]).toEqual([409, WAITLIST_CLOSED]);
  });

  it("tells the guest when tickets are already back on sale", async () => {
    await join({ email: "fan@example.com" });
    await setSold("ga", 1);
    expect((await confirm(tokenFromEmail("/waitlist/confirm"))).body).toMatchObject({ ticketsAvailable: true });
  });
});

describe("status and leaving", () => {
  beforeEach(async () => {
    await soldOut();
  });

  it("status: signed in only; by account or verified email; 404 for an unpublished event", async () => {
    expect((await status()).status).toBe(401);
    const user = await api.signUp({ email: "fan@example.com" });
    expect((await status(user.token)).body).toEqual({ joined: false });
    // A guest link they confirmed with their (verified) address counts.
    await guestOnList("fan@example.com");
    const res = await status(user.token);
    expect(res.body).toEqual({ joined: true, maskedEmail: "f***@example.com" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // Someone else's entry never shows, nor an unverified address's.
    const unverified = await api.signUp({ email: "fan@example.com", emailVerified: false });
    expect((await status(unverified.token)).body).toEqual({ joined: false });
    expect((await status(user.token, "nope")).status).toBe(404);
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });
    expect((await status(user.token)).status).toBe(404);
  });

  it("a member's entry is by account or the exact address only, never a normalised match (+tag, Gmail dots)", async () => {
    await guestOnList("fan@example.com");
    const tagged = await api.signUp({ email: "fan+x@example.com" });
    expect((await status(tagged.token)).body).toEqual({ joined: false });
    // Leaving doesn't reach someone else's entry either.
    await api.call(leaveWaitlistAsMember, { token: tagged.token, params: { eventId: event.eventId }, method: "DELETE" });
    expect((await entries())[0]).toMatchObject({ email: "fan@example.com", left: false, user_id: null });
    // Joining with the tagged address finds the person on the list, but doesn't link that entry to the account.
    const joined = await join({}, { token: tagged.token });
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ alreadyJoined: true });
    expect(await entries()).toEqual([expect.objectContaining({ email: "fan@example.com", user_id: null })]);
    expect((await status(tagged.token)).body).toEqual({ joined: false });
    // The exact address, ignoring case, is theirs: linked.
    const owner = await api.signUp({ email: "Fan@Example.com" });
    expect((await status(owner.token)).body).toEqual({ joined: true, maskedEmail: "f***@example.com" });
    expect((await join({}, { token: owner.token })).status).toBe(200);
    expect((await entries())[0]).toMatchObject({ user_id: owner.userId });
  });

  it("a member leaves with DELETE, idempotently, whatever the event's state", async () => {
    const user = await memberOnList();
    const del = () => api.call(leaveWaitlistAsMember, { token: user.token, params: { eventId: event.eventId }, method: "DELETE" });
    expect((await api.call(leaveWaitlistAsMember, { params: { eventId: event.eventId }, method: "DELETE" })).status).toBe(401);
    expect((await del()).status).toBe(204);
    expect((await del()).status).toBe(204);
    expect((await status(user.token)).body).toEqual({ joined: false });
    expect((await entries())[0]).toMatchObject({ left: true });
    // Joining again puts them back.
    expect((await join({}, { token: user.token })).status).toBe(201);
    expect((await entries())[0]).toMatchObject({ left: false, confirmed: true });
  });

  it("leaving by a notification's link: 200 every time; malformed 400; unknown 404", async () => {
    await guestOnList("fan@example.com");
    await setSold("ga", 1);
    await api.runDeferred();
    await api.call(runEmailOutboxCron, { token: CRON_SECRET });
    const token = tokenFromEmail("/waitlist/leave");
    const res = await leave(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "left", eventTitle: "Neon Static" });
    expect((await leave(token)).body).toEqual({ status: "left", eventTitle: "Neon Static" });
    expect((await entries())[0]).toMatchObject({ left: true });
    expect((await leave("bad")).status).toBe(400);
    expect((await leave("B".repeat(43))).status).toBe(404);
    // A confirmation link isn't a leave link.
    await soldOut();
    expect((await join({ email: "other@example.com" })).status).toBe(202);
    expect((await leave(tokenFromEmail("/waitlist/confirm"))).status).toBe(404);
    // An unpublished event's title isn't public: the leave link still works, without it.
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, method: "POST" });
    expect((await leave(token)).body).toEqual({ status: "left" });
  });
});

// ---------------------------------------------------------------------------

describe("notifications when tickets free up", () => {
  beforeEach(async () => {
    await soldOut();
  });

  async function fiveOnList() {
    const emails = ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"];
    for (const email of emails) await memberOnList(email);
    return emails;
  }

  it("a full refund in Stripe frees a ticket: the first 3 on the list (3 per ticket left) are emailed, in join order", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await setSold("ga", 1);
    await paidOrder("buyer@example.com", 1, "pi_1");
    await setSold("ga", 2);
    const emails = await fiveOnList();
    expect(await waitlistJobs()).toEqual([]);

    await refundInFull("pi_1");
    expect((await waitlistJobs()).map((j) => j.email)).toEqual(emails.slice(0, 3));
    await api.runDeferred();
    expect(api.sendEmail.mock.calls.map(([m]) => m.to)).toEqual(emails.slice(0, 3));
    expect((await waitlistJobs()).map((j) => j.status)).toEqual(["sent", "sent", "sent"]);

    const message = sentTo("a@example.com")[0];
    expect(message.subject).toBe("Tickets are available again: Neon Static");
    expect(message.text).toContain(`Get tickets: ${SITE_URL}/events/${event.slug}#tickets`);
    expect(message.text).toContain("first come, first served");
    expect(message.text).toMatch(new RegExp(`Leave the waitlist .*: ${SITE_URL}/waitlist/leave#token=[A-Za-z0-9_-]{43}`));
    expect(message.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/sheltuh\.test\/waitlist\/leave#token=[A-Za-z0-9_-]{43}>$/);
    expect(message.html).toContain("#ff4800");
    expect(message.html).toContain(`href="${SITE_URL}/events/${event.slug}#tickets"`);
    // Its leave link works; every email has its own.
    expect((await leave(tokenFromEmail("/waitlist/leave", 0))).status).toBe(200);
    expect(new Set([0, 1, 2].map((n) => tokenFromEmail("/waitlist/leave", n))).size).toBe(3);
    expect((await entries()).map((e) => e.notify_count)).toEqual([1, 1, 1, 0, 0]);
  });

  it("notifies each person at most once per freeing, and tops up to the target when more is freed", async () => {
    await setSold("ga", 0);
    await paidOrder("one@example.com", 1, "pi_1");
    await paidOrder("two@example.com", 1, "pi_2");
    await setSold("ga", 2);
    await fiveOnList();

    await refundInFull("pi_1");
    // A redelivery frees nothing more, and calling the round again changes nothing.
    await refundInFull("pi_1");
    const [{ queued }] = await api.db.query<{ queued: number }>(`select private.notify_waitlist($1) as queued`, [event.eventId]);
    expect(queued).toBe(0);
    expect((await waitlistJobs()).length).toBe(3);

    // 2 left now: the target is 6, so the remaining 2 people are told; nobody twice.
    await refundInFull("pi_2");
    const jobs = await waitlistJobs();
    expect(jobs.map((j) => j.email).sort()).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "d@example.com",
      "e@example.com",
    ]);
  });

  it("after the 12-hour window, a new freeing tells people never told first", async () => {
    await setSold("ga", 0);
    await paidOrder("one@example.com", 1, "pi_1");
    await paidOrder("two@example.com", 1, "pi_2");
    await setSold("ga", 2);
    const emails = await fiveOnList();
    await refundInFull("pi_1");
    await api.runDeferred();
    // Someone bought the freed ticket, then 13 hours pass.
    await setSold("ga", 2);
    await api.db.query(`update private.event_waitlist set notified_at = notified_at - interval '13 hours'`);
    await api.db.query(`delete from private.email_outbox`);
    await refundInFull("pi_2");
    // 1 left again: 3 people, the 2 never told, then the earliest told.
    expect((await waitlistJobs()).map((j) => j.email)).toEqual([emails[3], emails[4], emails[0]]);
  });

  it("an admin raising capacity, or adding a ticket type, notifies the list", async () => {
    await memberOnList("a@example.com");
    const current = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body as AdminEventRecord;
    const body = {
      ...eventInput(),
      ticketingMode: "sheltuh",
      expectedUpdatedAt: current.updatedAt,
      ticketTypes: [{ ...GA, quantityAvailable: 3 }],
    };
    const res = await api.call(adminUpdateEvent, { token: admin.token, params: { eventId: event.eventId }, body, method: "PATCH" });
    expect(res.status).toBe(200);
    expect((await waitlistJobs()).map((j) => j.email)).toEqual(["a@example.com"]);
    await api.runDeferred();
    expect(sentTo("a@example.com")).toHaveLength(1);

    // A new ticket type, once the first email's window has passed.
    await setSold("ga", 3);
    await api.db.query(`update private.event_waitlist set notified_at = now() - interval '13 hours'`);
    const latest = (await api.call(adminGetEvent, { token: admin.token, params: { eventId: event.eventId } })).body as AdminEventRecord;
    const added = await api.call(adminUpdateEvent, {
      token: admin.token,
      params: { eventId: event.eventId },
      body: {
        ...body,
        expectedUpdatedAt: latest.updatedAt,
        ticketTypes: [
          { ...GA, quantityAvailable: 3 },
          { id: "late", name: "Late release", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 5 },
        ],
      },
      method: "PATCH",
    });
    expect(added.status).toBe(200);
    await api.runDeferred();
    expect(sentTo("a@example.com")).toHaveLength(2);
  });

  it("an event published again with tickets left (the organiser raised capacity while it was a draft) notifies the list", async () => {
    await memberOnList("a@example.com");
    const params = { eventId: event.eventId };
    await api.call(adminUnpublishEvent, { token: admin.token, params, method: "POST" });
    const edited = await api.call(updateEventDraft, {
      token: organiser.token,
      params,
      body: eventInput({ ticketTypes: [{ ...GA, quantityAvailable: 4 }] }),
      method: "PATCH",
    });
    expect(edited.status).toBe(200);
    // A draft: nobody is told yet.
    expect(await waitlistJobs()).toEqual([]);
    await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
    expect((await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" })).status).toBe(200);
    expect((await waitlistJobs()).map((j) => j.email)).toEqual(["a@example.com"]);
    await api.runDeferred();
    expect(sentTo("a@example.com")).toHaveLength(1);
  });

  it("a failure queueing the emails never fails the change that freed the tickets (a warning instead)", async () => {
    await memberOnList("a@example.com");
    await api.db.query(`alter function private.notify_waitlist(uuid) rename to notify_waitlist_saved`);
    try {
      await api.db.query(`create function private.notify_waitlist(p_event_id uuid) returns integer
        language plpgsql set search_path = '' as $$ begin raise exception 'outbox broken'; end $$`);
      await setSold("ga", 1);
      const [{ quantity_sold }] = await api.db.query<{ quantity_sold: number }>(
        `select quantity_sold from public.ticket_types where event_id = $1`,
        [event.eventId],
      );
      expect(quantity_sold).toBe(1);
      expect(await waitlistJobs()).toEqual([]);
    } finally {
      await api.db.query(`drop function if exists private.notify_waitlist(uuid)`);
      await api.db.query(`alter function private.notify_waitlist_saved(uuid) rename to notify_waitlist`);
    }
  });

  it("an expired or abandoned checkout frees nothing (pending orders hold no tickets), so nobody is told", async () => {
    await memberOnList("a@example.com");
    const orderId = await insertOrder(api, event, "x@example.com", "pending");
    const res = await api.send(
      stripeWebhook,
      stripeWebhookRequest({
        type: "checkout.session.expired",
        data: { object: { id: "cs_x", object: "checkout.session", client_reference_id: orderId } },
      }),
    );
    expect(res.status).toBe(200);
    expect(await waitlistJobs()).toEqual([]);
  });

  it("skips people who left, people who've bought, and stops at the platform's daily cap", async () => {
    const left = await memberOnList("left@example.com");
    await api.call(leaveWaitlistAsMember, { token: left.token, params: { eventId: event.eventId }, method: "DELETE" });
    await memberOnList("buyer@example.com");
    await insertOrder(api, event, "Buyer@Example.com", "paid");
    await memberOnList("waiting@example.com");
    await setSold("ga", 1);
    expect((await waitlistJobs()).map((j) => j.email)).toEqual(["waiting@example.com"]);

    await api.db.query(`delete from private.email_outbox`);
    await api.db.query(`update private.event_waitlist set notified_at = null`);
    await setSold("ga", 2);
    await api.db.query(
      `insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('waitlist_notifications_daily', now(), 500)
       on conflict (bucket) do update set window_started_at = now(), hits = 500`,
    );
    await setSold("ga", 1);
    expect(await waitlistJobs()).toEqual([]);
  });

  it("doesn't send a queued email to someone who has left since, or once it's sold out again", async () => {
    const user = await memberOnList("a@example.com");
    await memberOnList("b@example.com");
    await setSold("ga", 1);
    expect((await waitlistJobs()).length).toBe(2);
    await api.call(leaveWaitlistAsMember, { token: user.token, params: { eventId: event.eventId }, method: "DELETE" });
    const cron = await api.call(runEmailOutboxCron, { token: CRON_SECRET });
    expect(cron.body).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
    expect(api.sendEmail.mock.calls.map(([m]) => m.to)).toEqual(["b@example.com"]);

    // Queued, then the freed ticket sold before the email went: not sent.
    await api.db.query(`delete from private.email_outbox`);
    await api.db.query(`update private.event_waitlist set notified_at = null`);
    await setSold("ga", 2);
    await setSold("ga", 1);
    await setSold("ga", 2);
    api.sendEmail.mockClear();
    await api.call(runEmailOutboxCron, { token: CRON_SECRET });
    expect(api.sendEmail).not.toHaveBeenCalled();
  });

  it("retries a waitlist email that failed to send; the log names no address", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await memberOnList("a@example.com");
    api.sendEmail.mockRejectedValueOnce(new Error("421 try later for a@example.com"));
    await setSold("ga", 1);
    expect((await api.call(runEmailOutboxCron, { token: CRON_SECRET })).body).toMatchObject({ claimed: 1, retrying: 1 });
    expect(await waitlistJobs()).toEqual([{ email: "a@example.com", status: "pending" }]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("a@example.com");
    await api.db.query(`update private.email_outbox set next_attempt_at = now()`);
    await api.call(runEmailOutboxCron, { token: CRON_SECRET });
    expect(await waitlistJobs()).toEqual([{ email: "a@example.com", status: "sent" }]);
  });

  it("keeps waitlist emails out of the admin email list and resend", async () => {
    await memberOnList("a@example.com");
    await setSold("ga", 1);
    const list = await api.call(adminListEmailJobs, { token: admin.token, query: { status: "pending" } });
    expect(list.body.items).toEqual([]);
    const [{ id }] = await api.db.query<{ id: string }>(`select id::text as id from private.email_outbox`);
    const res = await api.call(adminResendEmailJob, { token: admin.token, params: { jobId: id }, method: "POST" });
    expect(res.status).toBe(404);
  });

  it("the database ties each outbox kind to its key", async () => {
    await expect(api.db.query(`insert into private.email_outbox (kind) values ('waitlist_available')`)).rejects.toThrow();
    await expect(api.db.query(`insert into private.email_outbox (kind) values ('ticket_email')`)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("privacy", () => {
  it("organisers see only a count (on the list now) in the event's analytics", async () => {
    await soldOut();
    await memberOnList("a@example.com");
    await guestOnList("b@example.com");
    const left = await memberOnList("c@example.com");
    await api.call(leaveWaitlistAsMember, { token: left.token, params: { eventId: event.eventId }, method: "DELETE" });
    await join({ email: "unconfirmed@example.com" });

    const res = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: event.eventId } });
    expect(res.status).toBe(200);
    expect(res.body.waitlistCount).toBe(2);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com/);
  });

  it("purge_social_data deletes entries 30 days after the event ends, stale unconfirmed ones, people who left, and expired links", async () => {
    await soldOut();
    const past = await publishedEvent(api, organiser, admin, { title: "Past", ticketTypes: [GA] });
    await soldOut(past.eventId);
    await memberOnList("past@example.com", past.eventId);
    await memberOnList("kept@example.com");
    const left = await memberOnList("left@example.com");
    await api.call(leaveWaitlistAsMember, { token: left.token, params: { eventId: event.eventId }, method: "DELETE" });
    await join({ email: "stale@example.com" });
    await join({ email: "fresh@example.com" });

    await api.db.query(
      `update public.events set starts_at = now() - interval '32 days', ends_at = now() - interval '31 days' where id = $1`,
      [past.eventId],
    );
    await api.db.query(`update private.event_waitlist set unsubscribed_at = now() - interval '31 days' where email = 'left@example.com'`);
    // Its only link was requested 9 days ago.
    await api.db.query(`update private.event_waitlist set created_at = now() - interval '9 days' where email = 'stale@example.com'`);
    await api.db.query(
      `update private.event_waitlist_tokens t set created_at = now() - interval '9 days', expires_at = now() - interval '8 days'
         from private.event_waitlist w where w.id = t.entry_id and w.email = 'stale@example.com'`,
    );
    await api.db.query(
      `update private.event_waitlist_tokens t set expires_at = now() - interval '8 days'
         from private.event_waitlist w where w.id = t.entry_id and w.email = 'fresh@example.com'`,
    );

    const [counts] = await api.db.query(`select waitlist_entries_deleted, waitlist_tokens_deleted from private.purge_social_data()`);
    expect(counts).toEqual({ waitlist_entries_deleted: 3, waitlist_tokens_deleted: 1 });
    const remaining = await api.db.query<{ email: string }>(`select email from private.event_waitlist order by email`);
    expect(remaining.map((r) => r.email)).toEqual(["fresh@example.com", "kept@example.com"]);
    const [again] = await api.db.query(`select waitlist_entries_deleted, waitlist_tokens_deleted from private.purge_social_data()`);
    expect(again).toEqual({ waitlist_entries_deleted: 0, waitlist_tokens_deleted: 0 });
  });

  it("deleting an account deletes the entries it joined with", async () => {
    await soldOut();
    const user = await memberOnList("gone@example.com");
    await api.db.query(`delete from auth.users where id = $1`, [user.userId]);
    expect(await entries()).toEqual([]);
  });
});

// Two sessions at once: only a real server (PGlite is one connection). Run
// with TEST_DATABASE_URL (see CLAUDE.md, "Quality gates").
describe.skipIf(!process.env.TEST_DATABASE_URL)("concurrency (real Postgres only)", () => {
  async function connections() {
    return [
      postgres(serverUrl as string, { max: 1, onnotice: () => {} }),
      postgres(serverUrl as string, { max: 1, onnotice: () => {} }),
    ];
  }

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

  beforeEach(async () => {
    await soldOut();
  });

  it("two rounds for one event at once: the second waits, then finds everyone already told", async () => {
    for (const email of ["a@example.com", "b@example.com", "c@example.com", "d@example.com"]) await memberOnList(email);
    // One ticket left, with nobody told yet (as if freed by SQL with the triggers' round still to run).
    await api.db.query(`alter table public.ticket_types disable trigger ticket_types_waitlist_release_update`);
    try {
      await setSold("ga", 1);
    } finally {
      await api.db.query(`alter table public.ticket_types enable trigger ticket_types_waitlist_release_update`);
    }
    const [one, two] = await connections();
    const round = (conn: postgres.Sql) => conn.unsafe(`select private.notify_waitlist($1) as queued`, [event.eventId]);
    try {
      await one.unsafe("begin");
      expect((await round(one))[0].queued).toBe(3);
      const blocked = await waitUntilBlocked(two);
      const pending = round(two).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].queued).toBe(0);
    } finally {
      await one.end();
      await two.end();
    }
    expect((await waitlistJobs()).length).toBe(3);
  });

  it("two refunds of the same ticket type at once: each frees one, and the list is told once per person", async () => {
    await setSold("ga", 0);
    await paidOrder("one@example.com", 1, "pi_1");
    await paidOrder("two@example.com", 1, "pi_2");
    await setSold("ga", 2);
    for (const email of ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com", "f@example.com", "g@example.com"]) {
      await memberOnList(email);
    }
    const [one, two] = await connections();
    const refund = (conn: postgres.Sql, pi: string) =>
      conn.unsafe(`select result from private.record_payment_refund($1, 3170, true)`, [pi]);
    try {
      await one.unsafe("begin");
      expect((await refund(one, "pi_1"))[0].result).toBe("refunded");
      const blocked = await waitUntilBlocked(two);
      const pending = refund(two, "pi_2").execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].result).toBe("refunded");
    } finally {
      await one.end();
      await two.end();
    }
    const jobs = await waitlistJobs();
    // 1 left after the first (3 told), 2 after the second (target 6: 3 more), nobody twice.
    expect(jobs.length).toBe(6);
    expect(new Set(jobs.map((j) => j.email)).size).toBe(6);
  });

  it("a member's two joins at once: one joins, the other finds them on the list", async () => {
    const user = await api.signUp({ email: "mia@example.com" });
    const [one, two] = await connections();
    const call = (conn: postgres.Sql) =>
      conn.unsafe(`select private.join_waitlist($1, 'mia@example.com', $2) as r`, [event.eventId, user.userId]);
    try {
      await one.unsafe("begin");
      expect((await call(one))[0].r).toBe("joined");
      const blocked = await waitUntilBlocked(two);
      const pending = call(two).execute();
      await blocked();
      await one.unsafe("commit");
      expect((await pending)[0].r).toBe("already_joined");
    } finally {
      await one.end();
      await two.end();
    }
    expect((await entries()).length).toBe(1);
  });
});
