// Scenario 2: on-sale spike. Tickets for one event go on sale: page loads
// jump from a trickle to ONSALE_PEAK_RATE a second (default 40) and stay
// there, people refresh the event, and a few of them get tickets:
//
// - viewers (always): the event page, its event JSON, Who's Going count,
//   photo, seat map and availability (a seated event only), the view beacon,
//   and a refresh of the event for 40% of them.
// - free_claims (when member accounts are given): signed-in members claim one
//   free ticket each on the seeded free event (CLAIM_TARGET=main) or on the
//   seeded scarce event (CLAIM_TARGET=scarce: a sell-out, and a threshold that
//   fails the run if more tickets were issued than exist).
// - paid_checkouts (CHECKOUT=1 only): card checkouts on the seeded paid event,
//   in Stripe TEST mode. Each one creates a Checkout Session, reads the payment
//   page, then cancels (expires the session and releases the ticket). Nobody
//   pays: no charge is ever made. A live-mode session aborts the run.
//
// Per-IP limits mean one load generator gets at most 10 paid checkouts a
// minute, 20 per event per 10 minutes and 60 in all (then 429
// client_rate_limited, counted in rate_limited_429, not a failure).
//
//   k6 run -e BASE_URL=https://<staging-preview> -e MEMBER_PASSWORD=… tests/load/scenarios/onsale.js
import { check, sleep } from "k6";
import exec from "k6/execution";
import { Counter } from "k6/metrics";
import { memberTokens } from "../lib/auth.js";
import { createClient, jsonBody, sameOriginPath, uuidv4 } from "../lib/http.js";
import { eventRef } from "../lib/journeys.js";
import { buildThresholds, cloudOptions, envNumber, loadScale, scaled, SUMMARY_TREND_STATS } from "../lib/profile.js";
import { seededEvent } from "../lib/seeded.js";
import { resolveTarget } from "../lib/target.js";

const target = resolveTarget(__ENV, { scenario: "onsale", readOnlyCapable: false });
if (target.readOnly) throw new Error("The on-sale scenario writes (claims, checkouts, view beacons): unset READ_ONLY.");

/** A JSON file next to the seed (paths are relative to this file), or null when it isn't there. */
function readJsonFile(path) {
  try {
    return JSON.parse(open(path));
  } catch {
    return null;
  }
}

const seed = readJsonFile(__ENV.SEED_FILE || "../seed/seed-output.local.json");
const memberFile = readJsonFile(__ENV.MEMBERS_FILE || "../seed/members.local.json");
const tokenFile = __ENV.MEMBER_TOKENS_FILE ? readJsonFile(__ENV.MEMBER_TOKENS_FILE) : null;

const smoke = __ENV.SMOKE === "1";
const scale = loadScale(__ENV);
const peak = scaled(envNumber(__ENV, "ONSALE_PEAK_RATE", 40), scale);
const claimTarget = __ENV.CLAIM_TARGET === "scarce" ? "scarce" : "main";
const haveMembers = !!(tokenFile && tokenFile.length) || !!(memberFile && memberFile.length && __ENV.MEMBER_PASSWORD);
const runClaims = __ENV.CLAIMS !== "0" && haveMembers;
const runCheckout = __ENV.CHECKOUT === "1";
// Stripe test mode allows about 25 requests a second; each checkout here makes 3 Stripe calls. 5 a second at most.
const checkoutsPerMin = Math.min(envNumber(__ENV, "CHECKOUTS_PER_MIN", 6), 300);
const claimsPerMin = envNumber(__ENV, "CLAIMS_PER_MIN", 12);
const scarceQuantity = envNumber(__ENV, "SCARCE_QUANTITY", seed && seed.scarce ? seed.scarce.quantity : 20);

const viewSlug = __ENV.ONSALE_SLUG || (__ENV.ONSALE_VIEW === "paid" ? seed && seed.paid && seed.paid.slug : seed && seed.onsale && seed.onsale.slug);
const claimSlug = claimTarget === "scarce" ? seed && seed.scarce && seed.scarce.slug : seed && seed.onsale && seed.onsale.slug;
const paidSlug = __ENV.ONSALE_PAID_SLUG || (seed && seed.paid && seed.paid.slug);

const scenarios = {
  viewers: {
    executor: "ramping-arrival-rate",
    exec: "viewer",
    timeUnit: "1s",
    startRate: smoke ? 1 : Math.max(1, Math.round(peak / 20)),
    preAllocatedVUs: smoke ? 2 : peak * 2,
    maxVUs: smoke ? 5 : peak * 8,
    stages: smoke
      ? [{ duration: "20s", target: 1 }]
      : [
          // Before the on-sale: a trickle of people waiting on the page.
          { duration: "1m", target: Math.max(1, Math.round(peak / 20)) },
          // The on-sale moment: everyone at once.
          { duration: "15s", target: peak },
          { duration: "3m", target: peak },
          { duration: "1m", target: Math.max(1, Math.round(peak / 4)) },
          { duration: "30s", target: 0 },
        ],
  },
};
if (runClaims) {
  scenarios.free_claims = {
    executor: "constant-arrival-rate",
    exec: "freeClaim",
    timeUnit: "1m",
    rate: smoke ? 2 : claimsPerMin,
    duration: smoke ? "20s" : "3m",
    startTime: smoke ? "0s" : "75s",
    preAllocatedVUs: 5,
    maxVUs: 30,
  };
}
if (runCheckout) {
  scenarios.paid_checkouts = {
    executor: "constant-arrival-rate",
    exec: "paidCheckout",
    timeUnit: "1m",
    rate: smoke ? 2 : checkoutsPerMin,
    duration: smoke ? "20s" : "3m",
    startTime: smoke ? "0s" : "75s",
    preAllocatedVUs: 5,
    maxVUs: 60,
  };
}

const extraThresholds = {
  // A live-mode Stripe session is a misconfigured target: never acceptable.
  live_stripe_sessions: ["count<1"],
};
if (runClaims && claimTarget === "scarce") {
  // Never more tickets issued than the scarce event has (each claim is 1 ticket).
  extraThresholds["free_claims_created{target:scarce}"] = [`count<=${scarceQuantity}`];
}

export const options = {
  scenarios,
  thresholds: buildThresholds("onsale", __ENV, extraThresholds),
  summaryTrendStats: SUMMARY_TREND_STATS,
  cloud: cloudOptions("Sheltuh: on-sale spike", __ENV),
};

const claimsCreated = new Counter("free_claims_created");
const claimsRefused = new Counter("free_claims_refused");
const checkoutResults = new Counter("paid_checkout_results");
const liveStripe = new Counter("live_stripe_sessions");

/** The event's reference plus its first free and first paid ticket type ids. */
function withTicketTypes(body) {
  const ref = eventRef(body);
  const types = Array.isArray(body.ticketTypes) ? body.ticketTypes : [];
  const free = types.find((t) => t.priceCents === 0);
  const paid = types.find((t) => t.priceCents > 0);
  ref.freeTicketTypeId = free ? free.id : null;
  ref.paidTicketTypeId = paid ? paid.id : null;
  return ref;
}

export function setup() {
  const client = createClient(target, __ENV);
  const view = withTicketTypes(seededEvent(client, __ENV, viewSlug, "on-sale"));
  let claim = null;
  let members = [];
  if (runClaims) {
    claim = withTicketTypes(seededEvent(client, __ENV, claimSlug, `${claimTarget} free`));
    if (!claim.freeTicketTypeId) throw new Error(`The ${claimTarget} free event has no free ticket type.`);
    members = memberTokens(__ENV, memberFile, tokenFile);
    // An expired or wrong token would turn a claim into a guest booking, which emails a link: check each first.
    for (const m of members) {
      const res = client.get("/api/favourites/ids", { rg: "setup", name: "token check", token: m.token, expect: [200, 401] });
      if (res.status !== 200) throw new Error("A member token was refused (HTTP 401): sign in again or refresh MEMBER_TOKENS_FILE.");
    }
    if (members.length === 0) throw new Error("No member accounts: run the seed with --members, or give MEMBER_TOKENS_FILE.");
  }
  let paid = null;
  if (runCheckout) {
    paid = withTicketTypes(seededEvent(client, __ENV, paidSlug, "paid"));
    if (!paid.paidTicketTypeId) throw new Error("The paid on-sale event has no paid ticket type.");
  }
  console.log(
    `onsale: ${target.baseUrl}, peak ${peak} page loads/s, claims ${runClaims ? `${claimsPerMin}/min on ${claimTarget} by ${members.length} members` : "off"}, ` +
      `paid checkouts ${runCheckout ? `${checkoutsPerMin}/min` : "off"}`,
  );
  return { view, claim, paid, members };
}

const client = createClient(target, __ENV);
const beacons = __ENV.VIEW_BEACONS !== "0";

/** One person on the event page around the on-sale. */
export function viewer(data) {
  const ev = data.view;
  client.get(`/events/${ev.slug}`, { rg: "page", name: "/events/[slug]", discardBody: true });
  const reqs = [
    { path: `/api/events/slug/${ev.slug}`, spec: { rg: "event", name: "/api/events/slug/[slug]", cacheable: true } },
    { path: `/api/events/${ev.eventId}/going`, spec: { rg: "going", name: "/api/events/[id]/going" } },
  ];
  const img = sameOriginPath(ev.imageUrl, target.baseUrl);
  if (img) reqs.push({ path: img, spec: { rg: "image", name: "/api/events/[id]/image", cacheable: true, discardBody: true } });
  if (ev.seatingVersion !== null) {
    reqs.push({ path: `/api/events/${ev.eventId}/seat-map?v=${ev.seatingVersion}`, spec: { rg: "seats", name: "/api/events/[id]/seat-map", cacheable: true } });
    reqs.push({ path: `/api/events/${ev.eventId}/seat-availability`, spec: { rg: "seats", name: "/api/events/[id]/seat-availability", cacheable: true } });
  }
  const [detail] = client.batch(reqs);
  const body = jsonBody(detail);
  check(detail, { "event: has ticketTypes[]": () => !!body && Array.isArray(body.ticketTypes) });
  if (beacons) {
    client.post(`/api/events/${ev.eventId}/view`, { rg: "beacon", name: "/api/events/[id]/view", json: { source: "instagram" }, expect: [204] });
  }
  if (Math.random() < 0.4) {
    // Waiting for tickets: refresh what's left.
    sleep(2 + Math.random() * 3);
    client.get(`/api/events/slug/${ev.slug}`, { rg: "event", name: "/api/events/slug/[slug]", cacheable: true });
    if (ev.seatingVersion !== null) {
      client.get(`/api/events/${ev.eventId}/seat-availability`, { rg: "seats", name: "/api/events/[id]/seat-availability", cacheable: true });
    }
  }
}

/** A signed-in member claims one free ticket with their own (verified) email: issued at once, 201. */
export function freeClaim(data) {
  const ev = data.claim;
  const member = data.members[exec.scenario.iterationInTest % data.members.length];
  const res = client.post(`/api/events/${ev.eventId}/checkout`, {
    rg: "claim",
    name: "checkout (free, member)",
    token: member.token,
    headers: { "Idempotency-Key": uuidv4() },
    json: { lineItems: [{ ticketTypeId: ev.freeTicketTypeId, quantity: 1 }], buyerEmail: member.email, buyerName: "Load Test" },
    // 409: sold out, or this member already has their 4 free tickets for the event. 429: their 10 a day.
    expect: [201, 409, 429],
  });
  const body = jsonBody(res) || {};
  if (res.status === 201) {
    claimsCreated.add(1, { target: claimTarget });
    check(res, { "claim: issued at once (confirmation page URL)": () => String(body.url).indexOf("/checkout/success?session_id=ord_") !== -1 });
  } else if (res.status === 409) {
    const soldOut = /ran out|sold out/i.test(String(body.error));
    claimsRefused.add(1, { target: claimTarget, reason: soldOut ? "sold_out" : "limit" });
    check(res, { "claim: 409 says why": () => typeof body.error === "string" && body.error.length > 0 });
  } else if (res.status === 429) {
    claimsRefused.add(1, { target: claimTarget, reason: "member_daily" });
  }
}

/** A card checkout in Stripe TEST mode, then the payment page's read, then Back (cancel). Nobody pays. */
export function paidCheckout(data) {
  const ev = data.paid;
  const res = client.post(`/api/events/${ev.eventId}/checkout`, {
    rg: "checkout",
    name: "checkout (paid)",
    headers: { "Idempotency-Key": uuidv4() },
    json: { lineItems: [{ ticketTypeId: ev.paidTicketTypeId, quantity: 1 }], buyerName: "Load Test" },
    // 429 client_rate_limited: this IP's checkouts (10 a minute, 20 per event and 60 in all per 10 minutes).
    expect: [201, 409, 429],
    timeout: "60s",
  });
  const body = jsonBody(res) || {};
  if (res.status === 429) {
    checkoutResults.add(1, { result: "rate_limited" });
    check(res, { "checkout: 429 is client_rate_limited": () => body.code === "client_rate_limited" });
    return;
  }
  if (res.status !== 201) {
    checkoutResults.add(1, { result: `refused_${res.status}` });
    return;
  }
  checkoutResults.add(1, { result: "created" });
  const orderId = body.orderId;
  check(res, { "checkout: returns an order id and the payment page": () => /^ord_[0-9a-f]{32}$/.test(String(orderId)) && String(body.url).indexOf("/checkout/pay") !== -1 });
  if (!/^ord_[0-9a-f]{32}$/.test(String(orderId))) return;

  sleep(1 + Math.random() * 2);
  const pay = client.get(`/api/orders/by-session/${orderId}/payment`, {
    rg: "payment",
    name: "/api/orders/by-session/[id]/payment",
    expect: [200, 409, 429],
  });
  const payment = jsonBody(pay) || {};
  if (typeof payment.clientSecret === "string") {
    if (payment.clientSecret.indexOf("cs_live_") === 0) {
      liveStripe.add(1);
      exec.test.abort("A LIVE-mode Stripe Checkout Session was created: this deployment has live keys. Stopped. Cancel it in Stripe now.");
    }
    check(pay, { "payment: Stripe TEST mode session": () => payment.clientSecret.indexOf("cs_test_") === 0 });
  }

  sleep(2 + Math.random() * 3);
  const cancel = client.post(`/api/orders/by-session/${orderId}/cancel`, {
    rg: "cancel",
    name: "/api/orders/by-session/[id]/cancel",
    expect: [200],
    timeout: "60s",
  });
  const cancelled = jsonBody(cancel) || {};
  check(cancel, { "cancel: released": () => cancelled.status === "released" });
}
