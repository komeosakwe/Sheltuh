// Load shapes and pass/fail thresholds shared by the scenarios. Plain
// JavaScript with no k6 imports (unit-tested by tests/load/k6-scripts.test.ts).

/**
 * p95 / p99 latency targets in milliseconds per route group (the `rg` tag on
 * every request). Measured from a load generator in Australia against the
 * Sydney region (vercel.json pins syd1). LATENCY_SLACK multiplies them all,
 * e.g. 1.5 when the generator is overseas.
 */
export const LATENCY_TARGETS = {
  // HTML pages: a function render with one database read for the metadata (event, organiser pages).
  page: [1500, 3000],
  // GET /api/events (feed pages): CDN-shared for 60 s, so mostly cache hits unless CACHE_BUST=1.
  feed: [600, 1500],
  // GET /api/events?q=… : never cached, an ILIKE over title/venue/suburb/organiser/description.
  search: [900, 2000],
  // GET /api/events/slug/{slug}: CDN-shared for 15 s.
  event: [500, 1200],
  // GET /api/events/{id}/going and …/external-going: the going one is never cached.
  going: [500, 1200],
  // GET /api/events/{id}/image: bytes from the database, CDN-shared for an hour at the current v.
  image: [1000, 2500],
  // GET /api/organisers/{id}/logo
  logo: [800, 2000],
  // GET /api/organisers/{id}/profile
  profile: [600, 1500],
  // GET /api/events/trending: CDN-shared for 5 minutes.
  trending: [500, 1200],
  // GET /events/{slug}/calendar.ics
  calendar: [800, 2000],
  // POST /api/events/{id}/view: two small upserts, capped per event per minute.
  beacon: [600, 1500],
  // GET /api/events/{id}/seat-availability and seat-map
  seats: [500, 1200],
  // POST /api/events/{id}/checkout (paid): one Stripe Checkout Session create, from Sydney to Stripe's US API.
  checkout: [3000, 6000],
  // GET /api/orders/by-session/{id}/payment: one Stripe session retrieve.
  payment: [1500, 3000],
  // POST /api/orders/by-session/{id}/cancel: Stripe session expire, then the database.
  cancel: [2000, 4000],
  // POST /api/events/{id}/checkout (free, member): private.place_free_order, plus a Supabase Auth check.
  claim: [1500, 3000],
  // POST …/check-ins: Supabase Auth check, then private.check_in_ticket. The scanner gives up at 8 s.
  checkin: [800, 2000],
  // GET …/check-ins (the door's counters and recent scans)
  checkin_summary: [800, 2000],
  // The rate-limit target (GET …/payment with an unknown id: 404 or 429, no Stripe call)
  ratelimit: [600, 1500],
};

/** Route groups each scenario sends requests in (and so gets latency thresholds for). */
export const SCENARIO_GROUPS = {
  browse: ["page", "feed", "search", "event", "going", "image", "logo", "profile", "trending", "calendar", "beacon"],
  onsale: ["page", "event", "going", "image", "seats", "beacon", "claim", "checkout", "payment", "cancel"],
  checkin: ["checkin", "checkin_summary"],
  ratelimit: ["ratelimit"],
};
SCENARIO_GROUPS.soak = SCENARIO_GROUPS.browse;

/** A positive number from the environment, or `fallback`. */
export function envNumber(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number (got ${JSON.stringify(raw)}).`);
  return n;
}

/** LOAD_SCALE (default 1): multiplies every VU count and arrival rate, e.g. 0.1 for a first small run. */
export function loadScale(env) {
  const scale = envNumber(env, "LOAD_SCALE", 1);
  if (scale <= 0 || scale > 5) throw new Error("LOAD_SCALE must be above 0 and at most 5.");
  return scale;
}

/** `n` scaled, rounded, and at least `min`. */
export function scaled(n, scale, min = 1) {
  return Math.max(min, Math.round(n * scale));
}

/** k6 stages with every target scaled (targets of 0 stay 0). */
export function scaleStages(stages, scale) {
  return stages.map((s) => ({ duration: s.duration, target: s.target === 0 ? 0 : scaled(s.target, scale) }));
}

/**
 * The thresholds for a scenario's route groups:
 * - http_req_failed below 1%. Expected answers (each request declares them,
 *   429s from rate limits among them) don't count as failures: lib/http.js.
 *   Also aborts the run (to stop spending) if over 20% fail for 30 s.
 * - checks above 99%.
 * - p95 and p99 per route group (LATENCY_TARGETS times LATENCY_SLACK), on
 *   expected responses only.
 * `extra` adds a scenario's own (e.g. no 5xx at all from the rate-limit target).
 *
 * @typedef {Record<string, Array<string | { threshold: string, abortOnFail?: boolean, delayAbortEval?: string }>>} Thresholds
 * @param {string} scenario
 * @param {Record<string, string | undefined>} env
 * @param {Thresholds} [extra]
 * @returns {Thresholds}
 */
export function buildThresholds(scenario, env, extra = {}) {
  const groups = SCENARIO_GROUPS[scenario];
  if (!groups) throw new Error(`Unknown scenario ${scenario}`);
  const slack = envNumber(env, "LATENCY_SLACK", 1);
  if (slack <= 0) throw new Error("LATENCY_SLACK must be above 0.");
  /** @type {Thresholds} */
  const thresholds = {
    http_req_failed: [{ threshold: "rate<0.01" }, { threshold: "rate<0.20", abortOnFail: true, delayAbortEval: "30s" }],
    checks: ["rate>0.99"],
  };
  for (const group of groups) {
    const [p95, p99] = LATENCY_TARGETS[group];
    thresholds[`http_req_duration{rg:${group},expected_response:true}`] = [
      `p(95)<${Math.round(p95 * slack)}`,
      `p(99)<${Math.round(p99 * slack)}`,
    ];
  }
  return { ...thresholds, ...extra };
}

/**
 * Grafana Cloud k6 settings (used by `k6 cloud run`, ignored by `k6 run`):
 * one load zone in Sydney, next to the app's region. K6_CLOUD_PROJECT_ID
 * picks the project.
 */
export function cloudOptions(name, env) {
  const cloud = { name, distribution: { sydney: { loadZone: "amazon:au:sydney", percent: 100 } } };
  if (env.K6_CLOUD_PROJECT_ID) cloud.projectID = Number(env.K6_CLOUD_PROJECT_ID);
  return cloud;
}

/** The summary's trend columns: what the README's results template asks for. */
export const SUMMARY_TREND_STATS = ["avg", "med", "p(90)", "p(95)", "p(99)", "max", "count"];
