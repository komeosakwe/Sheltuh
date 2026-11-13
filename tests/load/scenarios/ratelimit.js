// Scenario 5: rate-limit verification. One client hammers one per-IP limited
// endpoint and checks the limit behaves: refused with a clean 429 (JSON
// `{error}`, `private, no-store`), never a 5xx, never more allowed than the
// limit, still refused until the window ends, and allowed again after it.
//
// Target: GET /api/orders/by-session/{id}/payment with a well-formed order id
// that doesn't exist. Every such read takes one hit on the client's
// `order_payment` allowance (CHECKOUT_RATE_LIMITS.paymentPerClient: 30 a
// minute, fixed window, lib/server/handlers/orders.ts) and answers 404; past
// it, 429. No Stripe call, no order, nothing written but the counter. It does
// lock this IP out of the payment page for up to a minute: don't run it from
// an address someone is buying tickets from.
//
// Retry-After: the app's 429s don't send one today (only the checkout's 409
// checkout_in_progress and its 503s do). The run records whether it's there
// (rate_limit_retry_after_present) and honours it when it is;
// EXPECT_RETRY_AFTER=1 makes its absence a failed check. Without it, recovery
// is measured by polling every RL_POLL_SECONDS.
//
//   k6 run -e BASE_URL=https://<staging-preview> tests/load/scenarios/ratelimit.js
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { createClient, header, jsonBody, randomHex } from "../lib/http.js";
import { buildThresholds, cloudOptions, envNumber, SUMMARY_TREND_STATS } from "../lib/profile.js";
import { resolveTarget } from "../lib/target.js";

const target = resolveTarget(__ENV, { scenario: "ratelimit", readOnlyCapable: false });

/** CHECKOUT_RATE_LIMITS.paymentPerClient: 30 per 1 minute (fixed window). */
const LIMIT = envNumber(__ENV, "RL_LIMIT", 30);
const WINDOW_SECONDS = envNumber(__ENV, "RL_WINDOW_SECONDS", 60);
const BURST = Math.max(LIMIT + 5, envNumber(__ENV, "RL_BURST", LIMIT + 15));
const POLL_SECONDS = envNumber(__ENV, "RL_POLL_SECONDS", 5);
const CYCLES = Math.max(1, Math.round(envNumber(__ENV, "RL_CYCLES", 2)));

export const options = {
  scenarios: {
    ratelimit: {
      executor: "per-vu-iterations",
      exec: "ratelimit",
      vus: 1,
      iterations: CYCLES,
      maxDuration: `${CYCLES * (WINDOW_SECONDS * 2 + 60)}s`,
    },
  },
  thresholds: buildThresholds("ratelimit", __ENV, {
    // A limit must refuse cleanly: no 5xx and no lost connections, ever.
    "server_errors_5xx{rg:ratelimit}": ["count<1"],
    // Allowed again once the window is over.
    rate_limit_recovered: ["rate==1"],
    rate_limit_recovery_seconds: [`max<=${WINDOW_SECONDS + 15}`],
  }),
  summaryTrendStats: SUMMARY_TREND_STATS,
  cloud: cloudOptions("Sheltuh: rate-limit verification", __ENV),
};

const retryAfterPresent = new Rate("rate_limit_retry_after_present");
const recovered = new Rate("rate_limit_recovered");
const recoverySeconds = new Trend("rate_limit_recovery_seconds");
const allowedInBurst = new Trend("rate_limit_allowed_in_burst");
const foreign429 = new Counter("rate_limit_foreign_429");

const client = createClient(target, __ENV);

function read(orderId) {
  return client.get(`/api/orders/by-session/${orderId}/payment`, {
    rg: "ratelimit",
    name: "/api/orders/by-session/[id]/payment (unknown order)",
    expect: [404, 429],
  });
}

/** Our 429: JSON `{error}`, never stored. A 429 without it came from somewhere else (e.g. Vercel's firewall). */
function isAppRefusal(res) {
  const body = jsonBody(res);
  return !!body && typeof body.error === "string" && body.error.length > 0;
}

export function ratelimit() {
  // A fresh unknown id each cycle: the limit is per client (IP), whatever the id.
  const orderId = `ord_${randomHex(16)}`;
  const statuses = [];
  let first429 = null;
  let first429At = 0;
  for (let i = 0; i < BURST; i++) {
    const res = read(orderId);
    statuses.push(res.status);
    if (res.status === 429 && first429 === null) {
      first429 = res;
      first429At = Date.now();
    }
  }

  const allowed = statuses.filter((s) => s === 404).length;
  allowedInBurst.add(allowed);
  // Fixed window: once refused, refused until the window ends (at most one reset can fall inside a burst).
  let resets = 0;
  for (let i = 1; i < statuses.length; i++) if (statuses[i - 1] === 429 && statuses[i] === 404) resets += 1;

  check(null, {
    "ratelimit: no 5xx or dropped requests": () => statuses.every((s) => s !== 0 && s < 500),
    "ratelimit: only 404 (allowed) or 429 (refused)": () => statuses.every((s) => s === 404 || s === 429),
    [`ratelimit: at most ${LIMIT} allowed before refusing`]: () => allowed <= LIMIT + (resets > 0 ? LIMIT : 0),
    "ratelimit: refused within the burst": () => first429 !== null,
    "ratelimit: stays refused until the window ends": () => resets <= 1,
  });
  if (first429 === null) {
    recovered.add(false);
    return;
  }

  const appRefusal = isAppRefusal(first429);
  if (!appRefusal) foreign429.add(1);
  const retryAfter = header(first429, "retry-after");
  retryAfterPresent.add(retryAfter !== undefined);
  check(first429, {
    "429: the app's JSON {error}": () => appRefusal,
    "429: private, no-store": (r) => String(header(r, "cache-control")).indexOf("no-store") !== -1,
  });
  if (__ENV.EXPECT_RETRY_AFTER === "1") {
    check(first429, { "429: has Retry-After": () => retryAfter !== undefined });
  }

  // Wait out the window: honour Retry-After when given, else poll.
  const retrySeconds = retryAfter !== undefined && /^\d+$/.test(String(retryAfter)) ? Number(retryAfter) : null;
  if (retrySeconds !== null) {
    check(first429, { "429: Retry-After is within the window": () => retrySeconds >= 1 && retrySeconds <= WINDOW_SECONDS });
    sleep(Math.min(retrySeconds, WINDOW_SECONDS) + 1);
  }
  let ok = false;
  const deadline = first429At + (WINDOW_SECONDS + 30) * 1000;
  while (Date.now() < deadline) {
    const res = read(orderId);
    if (res.status === 404) {
      ok = true;
      break;
    }
    sleep(POLL_SECONDS);
  }
  recovered.add(ok);
  if (ok) recoverySeconds.add((Date.now() - first429At) / 1000);
  check(null, { "ratelimit: allowed again after the window": () => ok });
  if (retrySeconds !== null) {
    check(null, { "ratelimit: allowed once Retry-After has passed": () => ok && Date.now() - first429At <= (retrySeconds + POLL_SECONDS + 5) * 1000 });
  }
}
