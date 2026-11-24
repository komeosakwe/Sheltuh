import postgres from "postgres";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganiserEventSummary } from "@/lib/api/types";
import { calculateBookingFeeCents } from "@/lib/fees";
import { addDays, melbourneDateOf } from "@/lib/server/analytics-range";
import { adminRejectEvent, adminSuspendOrganiser, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { getAnalyticsOverview, getEventAnalytics } from "@/lib/server/handlers/analytics";
import { putEventImage } from "@/lib/server/handlers/event-images";
import { recordEventView } from "@/lib/server/handlers/event-views";
import { getMyEvent, submitEventForReview } from "@/lib/server/handlers/events";
import { followOrganiser, unfollowOrganiser } from "@/lib/server/handlers/follows";
import {
  EVENTS_WITH_STAGE,
  deltaPct,
  getMyEventsSummary,
  getMyOverview,
  LIFETIME_GROSS_SQL,
  NEW_FOLLOWERS_SQL,
  ORGANISER_SUMMARY_LIMIT,
} from "@/lib/server/handlers/organiser-summary";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import type { EventRecord } from "@/lib/server/types";
import { embeddedSession, sessionAmount, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { application, approvedOrganiser, draftEvent, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { testPng } from "./helpers/images";
import { createTestDb } from "./helpers/test-db";

/**
 * GET /organisers/me/overview and GET /organisers/me/events/summary
 * (docs/architecture.md, "Organiser dashboard summaries").
 */

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

const PAID = [{ id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }];
const FREE = [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 40 }];
const HUMANITIX = "https://events.humanitix.com/neon-static";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
/** What one A$30 buyer-pays ticket brings in (lib/fees.ts): the price and its booking fee. */
const GA_GROSS = 3000 + calculateBookingFeeCents(3000);

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const overview = (token: string | undefined) => api.call(getMyOverview, { token });
const summary = (token: string | undefined, query?: Record<string, string>) => api.call(getMyEventsSummary, { token, query });

const when = (date: string) => ({ start: { date, time: "19:00" }, end: { date, time: "23:00" } });

let sessionCounter = 0;

/** A paid order through the real checkout and webhook (prices and fees from the API, never the test). */
async function paidOrder(eventId: string, quantity: number, buyerName = "Alex Buyer") {
  sessionCounter += 1;
  api.stripe.checkout.sessions.create.mockResolvedValueOnce(embeddedSession(`cs_test_sum_${sessionCounter}`));
  const res = await api.call(createCheckout, {
    params: { eventId },
    body: { lineItems: [{ ticketTypeId: "ga", quantity }], buyerName },
  });
  expect(res.status).toBe(201);
  const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
  const webhook = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_test_sum_${sessionCounter}`,
          object: "checkout.session",
          client_reference_id: orderId,
          ...(await sessionAmount(api.db, orderId)),
          payment_status: "paid",
          payment_intent: `pi_test_sum_${sessionCounter}`,
          customer_details: { email: `buyer${sessionCounter}@example.com` },
        },
      },
    }),
  );
  expect(webhook.status).toBe(200);
  return orderId;
}

/** A signed-in member's free booking (issued straight away). */
async function freeBooking(eventId: string, quantity: number) {
  const member = await api.signUp();
  const res = await api.call(createCheckout, {
    token: member.token,
    params: { eventId },
    body: { lineItems: [{ ticketTypeId: "rsvp", quantity }], buyerEmail: member.email, buyerName: "Free Fan" },
  });
  expect(res.status).toBe(201);
}

/** A full refund made in Stripe (charge.refunded): the order is refunded and its tickets go back on sale. */
async function refundInFull(orderId: string) {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const [order] = await api.db.query<{ stripe_payment_intent_id: string; total_cents: number }>(
    `select stripe_payment_intent_id, total_cents from public.orders where id = $1`,
    [orderId],
  );
  const res = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "charge.refunded",
      data: {
        object: {
          id: `ch_${order.stripe_payment_intent_id}`,
          object: "charge",
          payment_intent: order.stripe_payment_intent_id,
          amount_refunded: order.total_cents,
          refunded: true,
        },
      },
    }),
  );
  expect(res.status).toBe(200);
  const [after] = await api.db.query<{ status: string }>(`select status::text as status from public.orders where id = $1`, [orderId]);
  expect(after.status).toBe("refunded");
  vi.restoreAllMocks();
}

const backdate = (orderId: string, interval: string) =>
  api.db.query(`update public.orders set created_at = now() - $2::interval where id = $1`, [orderId, interval]);

function view(eventId: string) {
  return api.send(
    recordEventView,
    new Request(`${SITE_URL}/api/events/${eventId}/view`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": BROWSER_UA },
      body: "{}",
    }),
    { eventId },
  );
}

async function follow(member: { token: string }, organiserId = organiser.organiserId) {
  const res = await api.call(followOrganiser, { token: member.token, params: { organiserId }, body: {} });
  expect(res.status).toBe(201);
}

async function pendingOrganiser() {
  const user = await api.signUp();
  await api.call(applyAsOrganiser, { token: user.token, body: application });
  return user;
}

/** Everything a response could leak about buyers: their emails and names, and the `ord_…` credential. */
function expectNoBuyerData(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/@example\.com/);
  expect(text).not.toContain("ord_");
  expect(text).not.toContain("Alex Buyer");
  expect(text).not.toContain("Free Fan");
}

const titles = (items: { title: string }[]) => items.map((e) => e.title);

/** One event of each stage (and an external one), dated so the list order is known. */
async function eventOfEachStage() {
  const external = await publishedEvent(api, organiser, admin, {
    title: "External",
    ...when("2027-02-01"),
    ticketingMode: "external",
    externalTicketUrl: HUMANITIX,
    ticketTypes: [],
  });
  const soldOut = await publishedEvent(api, organiser, admin, {
    title: "Sold out",
    ...when("2027-02-15"),
    ticketTypes: [{ ...PAID[0], quantityAvailable: 2 }],
  });
  await paidOrder(soldOut.eventId, 2);
  const live = await publishedEvent(api, organiser, admin, { title: "Live", ...when("2027-03-06"), ticketTypes: PAID });
  const draft = await draftEvent(api, organiser, { title: "Draft", ...when("2027-04-01") });
  const inReview = await draftEvent(api, organiser, { title: "In review", ...when("2027-04-02") });
  await api.call(submitEventForReview, { token: organiser.token, params: { eventId: inReview.eventId }, method: "POST" });
  const rejected = await draftEvent(api, organiser, { title: "Changes needed", ...when("2027-04-03") });
  await api.call(submitEventForReview, { token: organiser.token, params: { eventId: rejected.eventId }, method: "POST" });
  const rejectRes = await api.call(adminRejectEvent, {
    token: admin.token,
    params: { eventId: rejected.eventId },
    body: { reason: "Add a photo." },
  });
  expect(rejectRes.status).toBe(200);
  const unpublished = await publishedEvent(api, organiser, admin, { title: "Unpublished", ...when("2027-04-04") });
  const unpublishRes = await api.call(adminUnpublishEvent, {
    token: admin.token,
    params: { eventId: unpublished.eventId },
    body: { reason: "Wrong venue." },
  });
  expect(unpublishRes.status).toBe(200);
  const past = await publishedEvent(api, organiser, admin, { title: "Past", ticketTypes: PAID });
  await paidOrder(past.eventId, 1);
  await api.db.query(
    `update public.events set starts_at = now() - interval '10 days', ends_at = now() - interval '9 days' where id = $1`,
    [past.eventId],
  );
  return { external, soldOut, live, draft, inReview, rejected, unpublished, past };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe("access", () => {
  it("needs a signed-in, approved organiser; errors are private too", async () => {
    for (const res of [await overview(undefined), await summary(undefined)]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    const pending = await pendingOrganiser();
    const member = await api.signUp();
    for (const user of [pending, member, admin]) {
      for (const res of [await overview(user.token), await summary(user.token)]) {
        expect(res.status).toBe(403);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      }
    }
  });

  it("a suspended organiser is a 403 on both, private, with none of their events", async () => {
    const event = await publishedEvent(api, organiser, admin, { title: "Before the takedown", ticketTypes: PAID });
    expect((await summary(organiser.token)).status).toBe(200);
    const suspended = await api.call(adminSuspendOrganiser, {
      token: admin.token,
      params: { organiserId: organiser.organiserId },
      body: { reason: "Fake venue." },
    });
    expect(suspended.status).toBe(200);
    for (const res of [await overview(organiser.token), await summary(organiser.token)]) {
      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(JSON.stringify(res.body)).not.toContain(event.eventId);
    }
  });

  it("a new organiser gets empty summaries", async () => {
    const res = await overview(organiser.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const today = melbourneDateOf();
    expect(res.body).toEqual({
      thisWeek: {
        range: { from: addDays(today, -6), to: today },
        ticketsSold: 0,
        views: 0,
        viewsUnreliable: false,
        // The test database starts counting views today.
        viewsComplete: false,
        newFollowers: 0,
      },
      highlight: null,
      upcoming: [],
      draftsCount: 0,
      performance: [],
    });

    const list = await summary(organiser.token);
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("private, no-store");
    expect(list.body).toEqual({
      items: [],
      counts: {
        all: 0,
        live: 0,
        drafts: 0,
        past: 0,
        byStage: { live: 0, sold_out: 0, ended: 0, in_review: 0, changes_needed: 0, unpublished: 0, draft: 0 },
      },
    });
  });

  it("only ever covers the caller's own events: another organiser's events, sales and followers stay out", async () => {
    const mine = await publishedEvent(api, organiser, admin, { title: "Mine", ticketTypes: PAID });
    await paidOrder(mine.eventId, 2);
    await follow(await api.signUp());
    const rival = await approvedOrganiser(api, admin, { displayName: "Rival" });

    const theirs = await overview(rival.token);
    expect(theirs.status).toBe(200);
    expect(theirs.body).toMatchObject({ highlight: null, upcoming: [], performance: [], draftsCount: 0 });
    expect(theirs.body.thisWeek).toMatchObject({ ticketsSold: 0, newFollowers: 0 });
    const theirList = await summary(rival.token);
    expect(theirList.body.items).toEqual([]);
    expect(theirList.body.counts.all).toBe(0);
    expect(JSON.stringify([theirs.body, theirList.body])).not.toContain(mine.eventId);

    // And theirs don't show up in mine.
    const rivalEvent = await publishedEvent(api, rival, admin, { title: "Rival's", ticketTypes: PAID });
    await paidOrder(rivalEvent.eventId, 3);
    const own = await overview(organiser.token);
    expect(own.body.thisWeek.ticketsSold).toBe(2);
    expect(titles((await summary(organiser.token)).body.items)).toEqual(["Mine"]);
    expect(JSON.stringify(own.body)).not.toContain(rivalEvent.eventId);
  });

  it("an admin who is also an organiser sees only their own organiser's events", async () => {
    await publishedEvent(api, organiser, admin, { title: "Someone else's" });
    const applied = await api.call(applyAsOrganiser, { token: admin.token, body: application });
    const { adminApproveOrganiser } = await import("@/lib/server/handlers/admin");
    await api.call(adminApproveOrganiser, { token: admin.token, params: { organiserId: applied.body.organiserId }, method: "POST" });
    const list = await summary(admin.token);
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
    expect((await overview(admin.token)).body.upcoming).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Events tab
// ---------------------------------------------------------------------------

describe("GET /organisers/me/events/summary", () => {
  it("gives each event its stage, in order, with counts per filter", async () => {
    const e = await eventOfEachStage();
    const res = await summary(organiser.token);
    expect(res.status).toBe(200);
    // Not ended soonest first, then ended.
    expect(res.body.items.map((i: OrganiserEventSummary) => [i.title, i.stage])).toEqual([
      ["External", "live"],
      ["Sold out", "sold_out"],
      ["Live", "live"],
      ["Draft", "draft"],
      ["In review", "in_review"],
      ["Changes needed", "changes_needed"],
      ["Unpublished", "unpublished"],
      ["Past", "ended"],
    ]);
    expect(res.body.nextCursor).toBeUndefined();
    expect(res.body.counts).toEqual({
      all: 8,
      live: 3,
      drafts: 4,
      past: 1,
      byStage: { live: 2, sold_out: 1, ended: 1, in_review: 1, changes_needed: 1, unpublished: 1, draft: 1 },
    });

    const byTitle = Object.fromEntries(res.body.items.map((i: OrganiserEventSummary) => [i.title, i]));
    // Sales so far, and the reason only where the organiser has something to fix.
    expect(byTitle["Sold out"]).toMatchObject({ ticketsSold: 2, capacity: 2, grossCents: 2 * GA_GROSS, netCents: 2 * 3000, free: false });
    expect(byTitle["Live"]).toMatchObject({ ticketsSold: 0, capacity: 10, grossCents: 0, free: false });
    expect(byTitle["Past"]).toMatchObject({ ticketsSold: 1, capacity: 10, grossCents: GA_GROSS });
    expect(byTitle["Changes needed"].rejectionReason).toBe("Add a photo.");
    expect(byTitle["Unpublished"].rejectionReason).toBe("Wrong venue.");
    for (const title of ["Live", "Draft", "In review", "Past"]) expect(byTitle[title]).not.toHaveProperty("rejectionReason");
    // External: sold elsewhere, no Sheltüh numbers.
    expect(byTitle["External"]).toMatchObject({
      ticketingMode: "external",
      ticketsSold: 0,
      capacity: 0,
      grossCents: 0,
      netCents: 0,
      free: false,
    });
    // The rest of an event's card.
    expect(byTitle["Live"]).toEqual({
      eventId: e.live.eventId,
      title: "Live",
      slug: e.live.slug,
      stage: "live",
      startsAt: e.live.startsAt,
      endsAt: e.live.endsAt,
      timeZone: "Australia/Melbourne",
      state: "VIC",
      venueName: "The Tote",
      suburb: "Collingwood",
      ticketingMode: "sheltuh",
      free: false,
      ticketsSold: 0,
      capacity: 10,
      grossCents: 0,
      netCents: 0,
    });
    expectNoBuyerData(res.body);

    // Each filter, with the same counts.
    const filtered = async (filter: string) => {
      const page = await summary(organiser.token, { filter });
      expect(page.status).toBe(200);
      expect(page.body.counts).toEqual(res.body.counts);
      return titles(page.body.items);
    };
    expect(await filtered("all")).toEqual(titles(res.body.items));
    expect(await filtered("live")).toEqual(["External", "Sold out", "Live"]);
    expect(await filtered("drafts")).toEqual(["Draft", "In review", "Changes needed", "Unpublished"]);
    expect(await filtered("past")).toEqual(["Past"]);
  });

  it("pages with a cursor and refuses an unknown filter or a bad cursor", async () => {
    for (const date of ["2027-03-01", "2027-03-02", "2027-03-03"]) {
      await draftEvent(api, organiser, { title: date, ...when(date) });
    }
    const first = await summary(organiser.token, { limit: "2" });
    expect(titles(first.body.items)).toEqual(["2027-03-01", "2027-03-02"]);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(first.body.counts.all).toBe(3);
    const second = await summary(organiser.token, { limit: "2", cursor: first.body.nextCursor });
    expect(titles(second.body.items)).toEqual(["2027-03-03"]);
    expect(second.body.nextCursor).toBeUndefined();

    const badFilter = await summary(organiser.token, { filter: "sold_out" });
    expect(badFilter.status).toBe(400);
    expect(badFilter.body.fieldErrors).toHaveProperty("filter");
    expect((await summary(organiser.token, { cursor: "nope" })).status).toBe(400);
  });

  it("counts free events as free and leaves refunded, pending and failed orders out of the gross", async () => {
    const free = await publishedEvent(api, organiser, admin, { title: "Free", ticketTypes: FREE });
    await freeBooking(free.eventId, 3);
    const paid = await publishedEvent(api, organiser, admin, { title: "Paid", ...when("2027-03-07"), ticketTypes: PAID });
    await paidOrder(paid.eventId, 1);
    await refundInFull(await paidOrder(paid.eventId, 2));
    // A checkout that was never paid.
    api.stripe.checkout.sessions.create.mockResolvedValueOnce(embeddedSession("cs_test_never_paid"));
    await api.call(createCheckout, { params: { eventId: paid.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity: 1 }] } });

    const items = (await summary(organiser.token)).body.items as OrganiserEventSummary[];
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
    expect(byTitle.Free).toMatchObject({ free: true, ticketsSold: 3, capacity: 40, grossCents: 0 });
    expect(byTitle.Paid).toMatchObject({ free: false, ticketsSold: 1, grossCents: GA_GROSS, netCents: 3000 });
    // The lifetime gross is the analytics gross over the event's whole life.
    const analytics = await api.call(getEventAnalytics, { token: organiser.token, params: { eventId: paid.eventId } });
    expect(byTitle.Paid.grossCents).toBe(analytics.body.totals.grossCents);
    expect(byTitle.Paid.netCents).toBe(analytics.body.totals.netCents);
  });

  it("carries the event's photo as its own record does", async () => {
    const draft = await draftEvent(api, organiser, { title: "With a photo" });
    const put = await api.send(
      putEventImage,
      new Request(`${SITE_URL}/api/test?fx=20&fy=35`, {
        method: "PUT",
        headers: { authorization: `Bearer ${organiser.token}` },
        body: testPng(),
      }),
      { eventId: draft.eventId },
    );
    expect(put.status).toBe(200);
    const record = (await api.call(getMyEvent, { token: organiser.token, params: { eventId: draft.eventId } })).body as EventRecord;
    const [item] = (await summary(organiser.token)).body.items as OrganiserEventSummary[];
    expect(item.imageUrl).toBe(record.imageUrl);
    expect(item.imageUrl).toMatch(/^\/api\/events\/.+\/image\?v=\d+$/);
    expect(item.imageFocus).toEqual({ x: 20, y: 35 });
  });
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

describe("GET /organisers/me/overview", () => {
  it("adds up this week, picks the banner and the next events, and compares each event's week with the one before", async () => {
    const external = await publishedEvent(api, organiser, admin, {
      title: "External",
      ...when("2027-01-10"),
      ticketingMode: "external",
      externalTicketUrl: HUMANITIX,
      ticketTypes: [],
    });
    const noSales = await publishedEvent(api, organiser, admin, { title: "No sales yet", ...when("2027-01-20"), ticketTypes: PAID });
    const free = await publishedEvent(api, organiser, admin, { title: "Free", ...when("2027-02-10"), ticketTypes: FREE });
    const paid = await publishedEvent(api, organiser, admin, { title: "Paid", ...when("2027-03-06"), ticketTypes: PAID });
    await draftEvent(api, organiser, { title: "A draft" });

    // Paid: 2 this week, 1 the week before, 1 long ago, and a refunded one this week (left out).
    await paidOrder(paid.eventId, 2);
    await backdate(await paidOrder(paid.eventId, 1), "8 days 12 hours");
    await backdate(await paidOrder(paid.eventId, 1), "20 days");
    await refundInFull(await paidOrder(paid.eventId, 1));
    // Free: 3 this week.
    await freeBooking(free.eventId, 3);

    await view(paid.eventId);
    await view(paid.eventId);
    await view(free.eventId);
    await api.db.query(`update private.analytics_settings set views_tracked_since = '2020-01-01'`);

    // Followers: one this week, one followed earlier, one who followed this week and left.
    const [stays, earlier, left] = [await api.signUp(), await api.signUp(), await api.signUp()];
    for (const member of [stays, earlier, left]) await follow(member);
    await api.db.query(
      `update public.organiser_follows set created_at = now() - interval '8 days 12 hours' where user_id = $1`,
      [earlier.userId],
    );
    await api.call(unfollowOrganiser, { token: left.token, params: { organiserId: organiser.organiserId }, method: "DELETE" });

    const res = await overview(organiser.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = res.body;
    const today = melbourneDateOf();
    expect(body.thisWeek).toEqual({
      range: { from: addDays(today, -6), to: today },
      ticketsSold: 5,
      views: 3,
      viewsUnreliable: false,
      viewsComplete: true,
      newFollowers: 1,
    });
    // The same numbers as the analytics overview for the same days.
    const analytics = await api.call(getAnalyticsOverview, {
      token: organiser.token,
      query: { from: addDays(today, -6), to: today },
    });
    expect(body.thisWeek.ticketsSold).toBe(analytics.body.totals.ticketsSold);
    expect(body.thisWeek.views).toBe(analytics.body.totals.views);
    expect(body.thisWeek.viewsUnreliable).toBe(analytics.body.totals.viewsUnreliable);

    // The banner: the soonest Sheltüh-ticketed event that has sold something (not "No sales yet", not external).
    expect(body.highlight).toMatchObject({ eventId: free.eventId, title: "Free", stage: "live", ticketsSold: 3, capacity: 40, free: true });
    // The next two live events, external included.
    expect(titles(body.upcoming)).toEqual(["External", "No sales yet"]);
    expect(body.upcoming[0]).toMatchObject({ eventId: external.eventId, ticketingMode: "external", ticketsSold: 0, capacity: 0 });
    expect(body.draftsCount).toBe(1);

    // Performance: Sheltüh-ticketed live events, soonest first, lifetime gross and this week against the week before.
    expect(body.performance).toEqual([
      {
        eventId: noSales.eventId,
        title: "No sales yet",
        stage: "live",
        free: false,
        ticketsSold: 0,
        capacity: 10,
        grossCents: 0,
        netCents: 0,
        ticketsThisWeek: 0,
        ticketsPreviousWeek: 0,
        deltaPct: null,
      },
      {
        eventId: free.eventId,
        title: "Free",
        stage: "live",
        free: true,
        ticketsSold: 3,
        capacity: 40,
        grossCents: 0,
        netCents: 0,
        ticketsThisWeek: 3,
        ticketsPreviousWeek: 0,
        deltaPct: null,
      },
      {
        eventId: paid.eventId,
        title: "Paid",
        stage: "live",
        free: false,
        // The refunded ticket went back on sale.
        ticketsSold: 4,
        capacity: 10,
        grossCents: 4 * GA_GROSS,
        netCents: 4 * 3000,
        ticketsThisWeek: 2,
        ticketsPreviousWeek: 1,
        deltaPct: 100,
      },
    ]);
    expectNoBuyerData(body);
  });

  it("shows no banner for a sold-out, started or ended event, and lists sold-out events as upcoming", async () => {
    const soldOut = await publishedEvent(api, organiser, admin, {
      title: "Sold out",
      ...when("2027-02-15"),
      ticketTypes: [{ ...PAID[0], quantityAvailable: 2 }],
    });
    await paidOrder(soldOut.eventId, 2);
    const started = await publishedEvent(api, organiser, admin, { title: "On now", ticketTypes: PAID });
    await paidOrder(started.eventId, 1);
    await api.db.query(
      `update public.events set starts_at = now() - interval '1 hour', ends_at = now() + interval '3 hours' where id = $1`,
      [started.eventId],
    );
    const ended = await publishedEvent(api, organiser, admin, { title: "Ended", ticketTypes: PAID });
    await paidOrder(ended.eventId, 1);
    await api.db.query(`update public.events set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = $1`, [
      ended.eventId,
    ]);

    const body = (await overview(organiser.token)).body;
    expect(body.highlight).toBeNull();
    expect(titles(body.upcoming)).toEqual(["On now", "Sold out"]);
    expect(body.performance.map((p: { title: string; stage: string }) => [p.title, p.stage])).toEqual([
      ["On now", "live"],
      ["Sold out", "sold_out"],
    ]);
  });
});

describe("rate limit", () => {
  const usedUp = (userId: string, hits: number) =>
    api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, $2, now(), $3)
       on conflict (user_id, bucket) do update set window_started_at = now(), hits = excluded.hits`,
      [userId, ORGANISER_SUMMARY_LIMIT.bucket, hits],
    );

  it("60 reads a minute per account across both, then 429 rate_limited with Retry-After; other accounts unaffected", async () => {
    expect(ORGANISER_SUMMARY_LIMIT).toEqual({ bucket: "organiser_summary", hits: 60, window: "1 minute" });
    const event = await publishedEvent(api, organiser, admin, { title: "Mine", ticketTypes: PAID });
    // Both reads take from the same allowance.
    expect((await overview(organiser.token)).status).toBe(200);
    expect((await summary(organiser.token)).status).toBe(200);
    const [row] = await api.db.query<{ hits: number }>(
      `select hits from private.rate_limits where user_id = $1 and bucket = 'organiser_summary'`,
      [organiser.userId],
    );
    expect(row.hits).toBe(2);

    await usedUp(organiser.userId, ORGANISER_SUMMARY_LIMIT.hits - 1);
    expect((await summary(organiser.token)).status).toBe(200);
    for (const res of [await overview(organiser.token), await summary(organiser.token)]) {
      expect([res.status, res.body.code]).toEqual([429, "rate_limited"]);
      expect(res.headers.get("retry-after")).toBe("60");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(JSON.stringify(res.body)).not.toContain(event.eventId);
    }

    const rival = await approvedOrganiser(api, admin, { displayName: "Rival" });
    expect((await overview(rival.token)).status).toBe(200);

    // A new window starts a minute later.
    await api.db.query(
      `update private.rate_limits set window_started_at = now() - interval '61 seconds' where user_id = $1 and bucket = 'organiser_summary'`,
      [organiser.userId],
    );
    expect((await overview(organiser.token)).status).toBe(200);
  });

  it("is taken only after the organiser check: refused callers use no allowance", async () => {
    const member = await api.signUp();
    expect((await overview(undefined)).status).toBe(401);
    expect((await summary(member.token)).status).toBe(403);
    const rows = await api.db.query(`select 1 from private.rate_limits where bucket = 'organiser_summary'`);
    expect(rows).toEqual([]);
  });
});

describe("deltaPct", () => {
  it("is the rounded change, or null without a previous week", () => {
    expect(deltaPct(2, 1)).toBe(100);
    expect(deltaPct(9, 10)).toBe(-10);
    expect(deltaPct(0, 3)).toBe(-100);
    expect(deltaPct(1, 3)).toBe(-67);
    expect(deltaPct(5, 0)).toBeNull();
    expect(deltaPct(0, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Query plans
// ---------------------------------------------------------------------------

/**
 * The plan for `sql` with sequential scans discouraged, so a usable index
 * shows up even on the test database's tiny tables. One connection: the
 * setting must apply to the EXPLAIN.
 */
async function plan(sql: string, params: unknown[]): Promise<string> {
  if (serverUrl) {
    const conn = postgres(serverUrl, { max: 1, onnotice: () => {} });
    try {
      return await conn.begin(async (tx) => {
        await tx.unsafe(`set local enable_seqscan = off`);
        const rows = await tx.unsafe(`explain ${sql}`, params as never[]);
        return rows.map((r) => Object.values(r)[0]).join("\n");
      });
    } finally {
      await conn.end();
    }
  }
  await api.db.query(`set enable_seqscan = off`);
  try {
    const rows = await api.db.query(`explain ${sql}`, params);
    return rows.map((r) => Object.values(r)[0]).join("\n");
  } finally {
    await api.db.query(`reset enable_seqscan`);
  }
}

describe("query plans", () => {
  it("reads the organiser's events, their orders and follows through indexes", async () => {
    const event = await publishedEvent(api, organiser, admin, { ticketTypes: PAID });
    await paidOrder(event.eventId, 1);
    await follow(await api.signUp());
    const today = melbourneDateOf();

    const events = await plan(`with ev as (${EVENTS_WITH_STAGE}) select ev.* from ev`, [organiser.organiserId]);
    expect(events).not.toMatch(/Seq Scan on events\b/);
    expect(events).toMatch(/events_organiser_created_idx/);

    const gross = await plan(LIFETIME_GROSS_SQL, [[event.eventId], organiser.organiserId]);
    expect(gross).not.toMatch(/Seq Scan on orders\b/);

    const followers = await plan(NEW_FOLLOWERS_SQL, [organiser.organiserId, addDays(today, -6), today]);
    expect(followers).toMatch(/organiser_follows_organiser_idx/);
  });
});
